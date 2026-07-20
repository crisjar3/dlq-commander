/* global document, innerHeight, innerWidth, localStorage */

import { _electron as electron } from '@playwright/test'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = process.cwd()
const outputDirectory = resolve(root, 'docs/assets/tutorials')
const userDataPath = await mkdtemp(join(tmpdir(), 'dlq-commander-docs-'))
let electronApp

async function addMarkers(page, locators) {
  const positions = []
  for (const locator of locators) {
    await locator.waitFor({ state: 'visible' })
    const box = await locator.boundingBox()
    if (!box) throw new Error('No se pudo ubicar un control para la captura documental')
    positions.push({
      x: Math.max(4, Math.min(box.x - 30, 1404)),
      y: Math.max(4, Math.min(box.y + (box.height - 26) / 2, 864))
    })
  }

  await page.evaluate((markerPositions) => {
    document.querySelectorAll('[data-doc-marker]').forEach((element) => element.remove())
    const style = document.createElement('style')
    style.dataset.docMarker = 'style'
    style.textContent = `
      [data-doc-marker="item"] {
        align-items: center;
        background: #b42318;
        border: 2px solid #ffffff;
        border-radius: 50%;
        box-shadow: 0 2px 8px rgb(0 0 0 / 35%);
        color: #ffffff;
        display: flex;
        font: 700 14px/1 system-ui, sans-serif;
        height: 26px;
        justify-content: center;
        pointer-events: none;
        position: fixed;
        width: 26px;
        z-index: 2147483647;
      }
    `
    document.head.append(style)
    markerPositions.forEach((position, index) => {
      const marker = document.createElement('span')
      marker.dataset.docMarker = 'item'
      marker.textContent = String(index + 1)
      marker.style.left = `${position.x}px`
      marker.style.top = `${position.y}px`
      document.body.append(marker)
    })
  }, positions)
}

async function removeMarkers(page) {
  await page.evaluate(() => document.querySelectorAll('[data-doc-marker]').forEach((element) => element.remove()))
}

async function capture(page, name, locators, region) {
  const pageSize = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
  await page.mouse.move(pageSize.width - 4, 4)
  await addMarkers(page, locators)
  await page.waitForTimeout(150)
  const options = { path: join(outputDirectory, name), animations: 'disabled' }
  if (region) {
    const box = await region.boundingBox()
    if (!box) throw new Error('No se pudo recortar la región documental')
    const margin = 32
    const x = Math.max(0, box.x - margin)
    const y = Math.max(0, box.y - margin)
    options.clip = {
      x,
      y,
      width: Math.min(pageSize.width - x, box.width + margin * 2),
      height: Math.min(pageSize.height - y, box.height + margin * 2)
    }
  }
  await page.screenshot(options)
  await removeMarkers(page)
  console.log(`Captured ${name}`)
}

async function scrollModalToBottom(page) {
  await page.locator('.connection-modal').evaluate((element) => {
    element.scrollTop = element.scrollHeight
  })
  await page.waitForTimeout(100)
}

try {
  await mkdir(outputDirectory, { recursive: true })
  electronApp = await electron.launch({
    args: ['.'],
    cwd: root,
    env: {
      ...process.env,
      DLQ_COMMANDER_E2E_USER_DATA: userDataPath,
      ELECTRON_DISABLE_SECURITY_WARNINGS: 'true'
    }
  })

  await electronApp.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]
    window?.setSize(1440, 900)
    window?.center()
  })

  const page = await electronApp.firstWindow()
  await page.waitForSelector('[data-testid="app-shell"]')
  await page.evaluate(() => localStorage.setItem('dlq-theme', 'light'))
  await page.reload()
  await page.waitForSelector('[data-testid="app-shell"]')
  await page.getByText('Orders / DLQ').waitFor()

  await capture(page, 'first-run-01-dashboard.png', [
    page.getByRole('button', { name: 'Dashboard' }),
    page.locator('.metric-strip'),
    page.locator('.table-section')
  ])

  await page.getByRole('button', { name: 'Ajustes' }).click()
  await page.getByRole('button', { name: 'Oscuro', exact: true }).click()
  await capture(page, 'appearance-01-settings-dark.png', [
    page.getByRole('button', { name: 'Oscuro', exact: true }),
    page.getByRole('button', { name: 'Activar tema claro' })
  ])

  await page.getByRole('button', { name: 'Claro', exact: true }).click()
  await page.getByRole('button', { name: 'Conexiones' }).click()
  await capture(page, 'connection-01-open-form.png', [
    page.getByRole('button', { name: 'Nueva conexión' })
  ])

  await page.getByRole('button', { name: 'Nueva conexión' }).click()
  await page.getByLabel('Nombre del perfil').fill('RabbitMQ laboratorio')
  await page.getByLabel('Contraseña').fill('dlqcommander')
  await page.getByRole('button', { name: 'Conectar y buscar' }).click()
  await page.getByText(/colas encontradas/).waitFor({ timeout: 15_000 })
  await page.getByRole('combobox', { name: 'Cola destino' }).click()
  await page.locator('.resource-option').filter({ has: page.getByText('orders', { exact: true }) }).click()
  await scrollModalToBottom(page)
  await capture(page, 'connection-02-discovered-queues.png', [
    page.locator('.routing-status-line'),
    page.getByRole('combobox', { name: 'Cola DLQ' }),
    page.getByRole('combobox', { name: 'Cola destino' })
  ], page.locator('.connection-modal'))
  await page.getByRole('button', { name: 'Cancelar' }).click()

  await page.getByRole('button', { name: 'Nueva conexión' }).click()
  await page.getByLabel('Nombre del perfil').fill('Entrada manual laboratorio')
  await page.getByLabel('Contraseña').fill('credencial-invalida')
  await page.getByRole('button', { name: 'Conectar y buscar' }).click()
  await page.getByText('Permisos insuficientes').waitFor({ timeout: 15_000 })
  await page.getByRole('button', { name: 'Ingresar manualmente' }).click()
  await page.getByLabel('Cola DLQ').fill('orders.dlq')
  await page.getByLabel('Cola destino').fill('orders')
  await scrollModalToBottom(page)
  await capture(page, 'connection-03-manual-fallback.png', [
    page.getByText('Entrada manual', { exact: true }),
    page.getByLabel('Cola DLQ'),
    page.getByLabel('Cola destino')
  ], page.locator('.connection-modal'))
  await page.getByRole('button', { name: 'Cancelar' }).click()

  await page.getByRole('button', { name: 'Dashboard' }).click()
  await page.getByText('Orders / DLQ').click()
  await page.getByRole('heading', { name: 'Orders / DLQ' }).waitFor()
  await page.getByLabel(/Seleccionar mensaje demo-orders\.dlq-/).first().waitFor()
  await capture(page, 'inspect-01-message-list.png', [
    page.getByPlaceholder('Filtrar por ID, causa, header o payload'),
    page.getByText('ValidationFailed', { exact: true }).first(),
    page.getByLabel(/Seleccionar mensaje demo-orders\.dlq-/).first()
  ])

  await page.locator('.virtual-row').first().click()
  await page.getByText('Detalle del mensaje', { exact: true }).waitFor()
  await capture(page, 'inspect-02-message-detail.png', [
    page.locator('.detail-tabs')
  ])
  await page.getByRole('button', { name: 'Cerrar detalle' }).click()

  await page.getByLabel(/Seleccionar mensaje demo-orders\.dlq-/).first().check()
  await capture(page, 'requeue-01-selection.png', [
    page.getByLabel(/Seleccionar mensaje demo-orders\.dlq-/).first(),
    page.getByRole('button', { name: /Requeue \(1\)/ })
  ])

  await page.getByRole('button', { name: /Requeue \(1\)/ }).click()
  await page.getByRole('heading', { name: 'Reenviar 1 mensajes' }).waitFor()
  await capture(page, 'requeue-02-confirmation.png', [
    page.locator('.confirm-summary'),
    page.getByLabel('Máximo por segundo'),
    page.getByRole('button', { name: 'Confirmar requeue' })
  ], page.locator('.modal-small'))

  await page.getByRole('button', { name: 'Confirmar requeue' }).click()
  await page.getByText('Requeue completado').waitFor({ timeout: 10_000 })
  await page.getByRole('button', { name: 'Auditoría' }).click()
  await page.getByRole('heading', { name: 'Auditoría' }).waitFor()
  await page.getByText('1 ok').first().waitFor()
  await capture(page, 'requeue-03-audit.png', [
    page.locator('.data-table tbody tr').first()
  ])
} finally {
  await electronApp?.close()
  await rm(userDataPath, { recursive: true, force: true })
}

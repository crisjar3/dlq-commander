/* global document, innerHeight, innerWidth, localStorage, window */

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
    if (!box) throw new Error('Could not locate a control for the documentation screenshot')
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
    if (!box) throw new Error('Could not crop the documentation screenshot region')
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

async function installAzureDocumentationFixture(app) {
  await app.evaluate(({ ipcMain }) => {
    const emptyMetrics = () => ({
      totalMessages: null,
      activeMessages: null,
      readyMessages: null,
      unacknowledgedMessages: null,
      deadLetterMessages: null,
      scheduledMessages: null,
      sizeBytes: null,
      subscriptionCount: null
    })
    const queues = Array.from({ length: 183 }, (_, index) => {
      const name = `customer-workflow-${String(index + 1).padStart(3, '0')}`
      const dlq = index % 19 === 0 ? index + 2 : 0
      return {
        key: `queue:${name}`, name, kind: 'queue', parent: null,
        messageCount: dlq, childCount: null, canInspect: true, canTarget: true,
        suggestedSource: dlq > 0, status: null,
        metrics: { ...emptyMetrics(), totalMessages: dlq + index % 7, activeMessages: index % 7, deadLetterMessages: dlq, scheduledMessages: index % 3, sizeBytes: 2048 + index * 64 }
      }
    })
    const topics = Array.from({ length: 68 }, (_, index) => {
      const name = index < 8 ? `billing-events-${String(index + 1).padStart(2, '0')}` : `domain-events-${String(index + 1).padStart(3, '0')}`
      const subscriptions = 2 + index % 9
      return {
        key: `topic:${name}`, name, kind: 'topic', parent: null,
        messageCount: null, childCount: subscriptions, canInspect: false, canTarget: true,
        suggestedSource: false, status: null,
        metrics: { ...emptyMetrics(), subscriptionCount: subscriptions, scheduledMessages: index % 4, sizeBytes: 4096 + index * 128 }
      }
    })
    const subscriptions = (topicName) => Array.from({ length: 73 }, (_, index) => {
      const name = index < 6 ? `retry-worker-${String(index + 1).padStart(2, '0')}` : `consumer-${String(index + 1).padStart(3, '0')}`
      const dlq = index % 11 === 0 ? index + 1 : 0
      return {
        key: `subscription:${encodeURIComponent(topicName)}/${encodeURIComponent(name)}`,
        name, kind: 'subscription', parent: { kind: 'topic', name: topicName },
        messageCount: dlq, childCount: null, canInspect: true, canTarget: false,
        suggestedSource: dlq > 0, status: null,
        metrics: { ...emptyMetrics(), totalMessages: dlq + index % 5, activeMessages: index % 5, deadLetterMessages: dlq }
      }
    })

    ipcMain.removeHandler('resources:list-page')
    ipcMain.handle('resources:list-page', async (_event, input) => {
      const collection = input.collection
      const all = collection.kind === 'queues' ? queues : collection.kind === 'topics' ? topics : subscriptions(collection.topicName)
      const offset = input.cursor ? Number(input.cursor) : 0
      if (offset > 0) await new Promise((resolve) => setTimeout(resolve, 700))
      const page = all.slice(offset, offset + input.pageSize)
      const nextOffset = offset + page.length
      return {
        entities: page,
        nextCursor: nextOffset < all.length ? String(nextOffset) : null,
        totalCount: all.length,
        latencyMs: offset > 0 ? 700 : 8
      }
    })
  })
}

try {
  await mkdir(outputDirectory, { recursive: true })
  electronApp = await electron.launch({
    args: ['.'],
    cwd: root,
    env: {
      ...process.env,
      DLQ_COMMANDER_E2E_USER_DATA: userDataPath,
      DLQ_COMMANDER_DEMO_RESOURCE_COUNT: '184',
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
  await page.getByText('Demo local').waitFor()

  await capture(page, 'first-run-01-dashboard.png', [
    page.getByRole('button', { name: 'Dashboard' }),
    page.locator('.metric-strip'),
    page.locator('.connection-table')
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
  await page.getByLabel('Nombre del perfil').fill('RabbitMQ lab')
  await page.getByLabel('Contraseña').fill('dlqcommander')
  await page.getByRole('button', { name: 'Conectar y buscar' }).click()
  await page.getByPlaceholder('Buscar queue o topic').fill('orders')
  await page.getByRole('option', { name: /orders\.dlq/i }).waitFor({ timeout: 15_000 })
  await scrollModalToBottom(page)
  await capture(page, 'connection-02-discovered-queues.png', [
    page.locator('.routing-status-line'),
    page.getByPlaceholder('Buscar queue o topic'),
    page.getByRole('option', { name: /orders\.dlq/i })
  ], page.locator('.connection-modal'))
  await page.getByRole('button', { name: 'Cancelar' }).click()

  await page.getByRole('button', { name: 'Nueva conexión' }).click()
  await page.getByLabel('Nombre del perfil').fill('Manual entry lab')
  await page.getByLabel('Contraseña').fill('credencial-invalida')
  await page.getByRole('button', { name: 'Conectar y buscar' }).click()
  await page.getByText('Permisos insuficientes').waitFor({ timeout: 15_000 })
  await page.getByRole('button', { name: 'Ingresar manualmente' }).click()
  await page.getByLabel('Queue origen').fill('orders.dlq')
  await page.getByLabel('Destino').fill('orders')
  await scrollModalToBottom(page)
  await capture(page, 'connection-03-manual-fallback.png', [
    page.getByText('Ruta fija manual', { exact: true }),
    page.getByLabel('Queue origen'),
    page.getByLabel('Destino')
  ], page.locator('.connection-modal'))
  await page.getByRole('button', { name: 'Cancelar' }).click()

  await page.getByRole('button', { name: 'Dashboard' }).click()
  await page.getByText('Demo local').click()
  await page.getByText('184 recursos').waitFor({ timeout: 15_000 })
  await capture(page, 'resource-explorer-02-pagination.png', [
    page.locator('.resource-result-count'),
    page.locator('.resource-paginator')
  ])
  await page.getByPlaceholder('Buscar queue').fill('paymnts.dlq')
  await capture(page, 'resource-explorer-03-typo-search.png', [
    page.getByPlaceholder('Buscar queue'),
    page.getByRole('option', { name: /payments\.dlq/i })
  ])
  await page.getByPlaceholder('Buscar queue').fill('payments')
  await capture(page, 'resource-explorer-01-search.png', [
    page.getByPlaceholder('Buscar queue'),
    page.getByRole('option', { name: /payments\.dlq/i })
  ])
  await page.getByPlaceholder('Buscar queue').fill('')
  await page.getByRole('option', { name: /orders\.dlq/i }).click()
  await page.getByRole('heading', { name: 'orders.dlq' }).waitFor()
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
    page.getByPlaceholder('Buscar destino'),
    page.getByLabel('Máximo por segundo'),
    page.getByRole('button', { name: 'Confirmar requeue' })
  ], page.locator('.requeue-modal'))

  await page.getByRole('button', { name: 'Confirmar requeue' }).click()
  await page.getByText('Requeue completado').waitFor({ timeout: 10_000 })
  await page.getByRole('button', { name: 'Auditoría' }).click()
  await page.getByRole('heading', { name: 'Auditoría' }).waitFor()
  await page.getByText('1 ok').first().waitFor()
  await capture(page, 'requeue-03-audit.png', [
    page.locator('.data-table tbody tr').first()
  ])

  await installAzureDocumentationFixture(electronApp)
  await page.evaluate(async () => {
    await window.dlqCommander.invoke('saveProfile', {
      name: 'Azure tutorial namespace',
      brokerType: 'azure-service-bus',
      readOnly: true,
      configuration: { profileMode: 'namespace' },
      secret: { connectionString: 'documentation-fixture' }
    })
  })
  await page.reload()
  await page.waitForSelector('[data-testid="app-shell"]')
  await page.getByText('Azure tutorial namespace').click()
  await page.getByText(/50 cargados/).waitFor()
  await capture(page, 'resource-explorer-05-loading-progress.png', [
    page.locator('.resource-result-count'),
    page.locator('.resource-loading-icon'),
    page.locator('.resource-list-row').first()
  ])
  await page.getByRole('tab', { name: /Topics/ }).click()
  await page.getByPlaceholder('Buscar topic').fill('billing')
  await page.getByRole('option', { name: /billing-events-01/i }).waitFor()
  await capture(page, 'azure-resources-01-topics.png', [
    page.getByRole('tab', { name: /Topics/ }),
    page.getByPlaceholder('Buscar topic'),
    page.getByRole('option', { name: /billing-events-01/i })
  ])
  await page.getByRole('option', { name: /billing-events-01/i }).click()
  await page.getByPlaceholder('Buscar subscription').fill('retry')
  await page.getByRole('option', { name: /retry-worker-01/i }).waitFor()
  await capture(page, 'azure-resources-02-subscriptions.png', [
    page.locator('.resource-breadcrumb'),
    page.getByPlaceholder('Buscar subscription'),
    page.getByRole('option', { name: /retry-worker-01/i })
  ])
  await electronApp.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setSize(375, 812)
  })
  await page.getByRole('button', { name: 'Activar tema oscuro' }).click()
  await capture(page, 'resource-explorer-04-mobile-dark.png', [
    page.getByPlaceholder('Buscar subscription'),
    page.getByRole('option', { name: /retry-worker-01/i }),
    page.locator('.resource-paginator')
  ])
} finally {
  await electronApp?.close()
  await rm(userDataPath, { recursive: true, force: true })
}

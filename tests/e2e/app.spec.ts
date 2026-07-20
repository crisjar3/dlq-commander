import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let electronApp: ElectronApplication
let page: Page
let userDataPath: string

test.beforeEach(async () => {
  userDataPath = await mkdtemp(join(tmpdir(), 'dlq-commander-e2e-'))
  electronApp = await electron.launch({
    args: ['.'],
    cwd: process.cwd(),
    env: { ...process.env, DLQ_COMMANDER_E2E_USER_DATA: userDataPath, DLQ_COMMANDER_DEMO_RESOURCE_COUNT: '2000' }
  })
  page = await electronApp.firstWindow()
  await page.waitForSelector('[data-testid="app-shell"]')
})

test.afterEach(async () => {
  await electronApp.close()
  await rm(userDataPath, { recursive: true, force: true })
})

test('starts with a sandboxed renderer and an operational demo dashboard', async () => {
  await expect(page.getByRole('heading', { name: 'Namespaces conectados' })).toBeVisible()
  await expect(page.getByText('Demo local')).toBeVisible()
  const rendererGlobals = await page.evaluate(() => ({
    requireType: typeof (window as unknown as { require?: unknown }).require,
    processType: typeof (window as unknown as { process?: unknown }).process
  }))
  expect(rendererGlobals).toEqual({ requireType: 'undefined', processType: 'undefined' })
})

test('persists light, dark and system appearance preferences', async () => {
  await page.getByRole('button', { name: 'Ajustes' }).click()
  await expect(page.getByRole('heading', { name: 'Ajustes' })).toBeVisible()

  await page.getByRole('button', { name: 'Oscuro', exact: true }).click()
  await expect.poll(() => page.evaluate(() => ({
    theme: document.documentElement.dataset.theme,
    preference: document.documentElement.dataset.themePreference,
    colorScheme: document.documentElement.style.colorScheme
  }))).toEqual({ theme: 'dark', preference: 'dark', colorScheme: 'dark' })

  await page.reload()
  await page.waitForSelector('[data-testid="app-shell"]')
  await expect.poll(() => page.evaluate(() => localStorage.getItem('dlq-theme'))).toBe('dark')
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe('dark')

  await page.getByRole('button', { name: 'Ajustes' }).click()
  await page.getByRole('button', { name: 'Claro', exact: true }).click()
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe('light')

  await page.getByRole('button', { name: 'Sistema', exact: true }).click()
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.themePreference)).toBe('system')
})

test('requeues one message and records the completed operation', async () => {
  await page.getByText('Demo local').click()
  await page.getByRole('option', { name: /orders\.dlq/i }).click()
  await expect(page.getByRole('heading', { name: 'orders.dlq' })).toBeVisible()
  await page.getByLabel(/Seleccionar mensaje demo-orders\.dlq-/).first().check()
  await page.getByRole('button', { name: /Requeue \(1\)/ }).click()
  await expect(page.getByRole('heading', { name: 'Reenviar 1 mensajes' })).toBeVisible()
  await page.getByRole('button', { name: 'Confirmar requeue' }).click()
  await expect(page.getByText('Requeue completado')).toBeVisible({ timeout: 10_000 })

  await page.getByRole('button', { name: 'Auditoría' }).click()
  await expect(page.getByRole('heading', { name: 'Auditoría' })).toBeVisible()
  await expect(page.getByText('Completado').first()).toBeVisible()
  await expect(page.getByText('1 ok').first()).toBeVisible()
})

test('searches resources with the keyboard on a compact dark viewport', async () => {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 375,
    height: 812,
    deviceScaleFactor: 1,
    mobile: false
  })
  await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(375)
  if (await page.evaluate(() => document.documentElement.dataset.theme) !== 'dark') {
    await page.getByRole('button', { name: 'Activar tema oscuro' }).click()
  }
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe('dark')
  await page.getByText('Demo local').click()

  const search = page.getByRole('combobox', { name: 'Buscar recursos' })
  await search.fill('payments.dlq')
  await expect(page.getByText(/1 coincidencia en/)).toBeVisible()
  await search.press('Enter')
  await expect(page.getByRole('heading', { name: 'payments.dlq' })).toBeVisible()

  await page.getByRole('button', { name: 'Volver a recursos' }).click()
  await expect(page.getByRole('heading', { name: 'Explorador de recursos' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
})

test('paginates and searches a 2,000-resource namespace without rendering the full catalog', async () => {
  await page.getByText('Demo local').click()
  const search = page.getByRole('combobox', { name: 'Buscar recursos' })
  await expect(page.getByText(/2.?000 recursos/)).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('Página 1 de 40')).toBeVisible()
  expect(await page.locator('.resource-list-row').count()).toBeLessThan(50)

  await search.press('PageDown')
  await expect(page.getByText('Página 2 de 40')).toBeVisible()
  await search.fill('servce region 0184')
  await expect(page.getByText(/coincidencia.*2.?000 recursos cargados/)).toBeVisible()
  await expect(search).toHaveAttribute('aria-activedescendant', /0184/)
  await search.press('Enter')
  await expect(page.getByRole('heading', { name: 'service-region-0184.dlq' })).toBeVisible()
})

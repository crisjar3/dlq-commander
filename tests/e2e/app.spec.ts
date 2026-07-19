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
    env: { ...process.env, DLQ_COMMANDER_E2E_USER_DATA: userDataPath }
  })
  page = await electronApp.firstWindow()
  await page.waitForSelector('[data-testid="app-shell"]')
})

test.afterEach(async () => {
  await electronApp.close()
  await rm(userDataPath, { recursive: true, force: true })
})

test('starts with a sandboxed renderer and an operational demo dashboard', async () => {
  await expect(page.getByRole('heading', { name: 'Colas de mensajes muertos' })).toBeVisible()
  await expect(page.getByText('Orders / DLQ')).toBeVisible()
  const rendererGlobals = await page.evaluate(() => ({
    requireType: typeof (window as unknown as { require?: unknown }).require,
    processType: typeof (window as unknown as { process?: unknown }).process
  }))
  expect(rendererGlobals).toEqual({ requireType: 'undefined', processType: 'undefined' })
})

test('requeues one message and records the completed operation', async () => {
  await page.getByText('Orders / DLQ').click()
  await expect(page.getByRole('heading', { name: 'Orders / DLQ' })).toBeVisible()
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

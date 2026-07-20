import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DlqCommanderApi } from '../../src/shared/ipc-contract'

let electronApp: ElectronApplication | undefined
let page: Page
let userDataPath: string

test.beforeAll(async () => {
  userDataPath = await mkdtemp(join(tmpdir(), 'dlq-commander-brokers-e2e-'))
  electronApp = await electron.launch({
    args: ['.'],
    cwd: process.cwd(),
    env: { ...process.env, DLQ_COMMANDER_E2E_USER_DATA: userDataPath }
  })
  page = await electronApp.firstWindow()
  await page.waitForSelector('[data-testid="app-shell"]')
})

test.afterAll(async () => {
  await electronApp?.close()
  await rm(userDataPath, { recursive: true, force: true })
})

test('tests RabbitMQ and Kafka profiles through the real Electron IPC boundary', async () => {
  const result = await page.evaluate(async () => {
    const api = (window as unknown as { dlqCommander: DlqCommanderApi }).dlqCommander
    const [rabbitDiscovery, kafkaDiscovery] = await Promise.all([
      api.invoke('discoverEntities', {
        brokerType: 'rabbitmq',
        configuration: { host: 'localhost', port: 5672, vhost: '/', tls: false },
        secret: { username: 'dlqcommander', password: 'dlqcommander' }
      }),
      api.invoke('discoverEntities', {
        brokerType: 'kafka',
        configuration: { bootstrapServers: 'localhost:9092', clientId: 'dlq-commander-e2e-discovery' },
        secret: {}
      })
    ])
    const rabbit = await api.invoke('saveProfile', {
      name: 'RabbitMQ Compose',
      brokerType: 'rabbitmq',
      readOnly: true,
      configuration: {
        host: 'localhost', port: 5672, vhost: '/', tls: false,
        sourceQueue: 'orders.dlq', targetQueue: 'orders'
      },
      secret: { username: 'dlqcommander', password: 'dlqcommander' }
    })
    const kafka = await api.invoke('saveProfile', {
      name: 'Kafka Compose',
      brokerType: 'kafka',
      readOnly: true,
      configuration: {
        bootstrapServers: 'localhost:9092',
        dltTopic: 'orders.events.dlt',
        targetTopic: 'orders.events',
        clientId: 'dlq-commander-e2e'
      },
      secret: {}
    })
    const [rabbitTest, kafkaTest, rabbitSources, kafkaSources] = await Promise.all([
      api.invoke('testProfile', { id: rabbit.id }),
      api.invoke('testProfile', { id: kafka.id }),
      api.invoke('listSources', { profileId: rabbit.id }),
      api.invoke('listSources', { profileId: kafka.id })
    ])
    return { rabbitDiscovery, kafkaDiscovery, rabbitTest, kafkaTest, rabbitSources, kafkaSources }
  })

  expect(result.rabbitDiscovery.entities.map((entity) => entity.name)).toEqual(expect.arrayContaining(['orders', 'orders.dlq']))
  expect(result.kafkaDiscovery.entities.map((entity) => entity.name)).toEqual(expect.arrayContaining(['orders.events', 'orders.events.dlt']))
  expect(result.rabbitTest).toMatchObject({ ok: true, message: 'Conexion y DLQ verificadas' })
  expect(result.kafkaTest).toMatchObject({ ok: true, message: 'Broker y topics verificados' })
  expect(result.rabbitSources[0]).toMatchObject({ brokerType: 'rabbitmq', name: 'orders.dlq' })
  expect(result.kafkaSources[0]).toMatchObject({ brokerType: 'kafka', name: 'orders.events.dlt' })
  expect(result.rabbitSources[0]!.depth).toBeGreaterThan(0)
  expect(result.kafkaSources[0]!.depth).toBeGreaterThan(0)
})

test('creates a RabbitMQ profile from discovered queues in the modal', async () => {
  await page.getByRole('button', { name: 'Conexiones' }).click()
  await page.getByRole('button', { name: 'Nueva conexión' }).click()
  await page.getByLabel('Nombre del perfil').fill('RabbitMQ UI Discovery')
  await page.getByLabel('Contraseña').fill('dlqcommander')
  await page.getByRole('button', { name: 'Conectar y buscar' }).click()

  await expect(page.getByText(/colas encontradas/)).toBeVisible()
  await page.getByLabel('Virtual host').fill('/stale')
  await expect(page.getByText('La conexión cambió')).toBeVisible()
  await page.getByLabel('Virtual host').fill('/')
  await page.getByRole('button', { name: 'Buscar nuevamente' }).click()
  await expect(page.getByText(/colas encontradas/)).toBeVisible()
  await page.getByRole('combobox', { name: 'Cola destino' }).click()
  await page.locator('.resource-option').filter({ has: page.getByText('orders', { exact: true }) }).click()
  await page.getByRole('button', { name: 'Guardar perfil' }).click()

  const profile = page.locator('article').filter({ hasText: 'RabbitMQ UI Discovery' })
  await expect(profile).toBeVisible()
  await profile.getByRole('button', { name: 'Probar' }).click()
  await expect(page.getByText(/Conexion y DLQ verificadas/)).toBeVisible()
})

test('offers manual routing when RabbitMQ discovery has insufficient permissions', async () => {
  await page.getByRole('button', { name: 'Nueva conexión' }).click()
  await page.getByLabel('Nombre del perfil').fill('RabbitMQ Manual Fallback')
  await page.getByLabel('Contraseña').fill('incorrect-password')
  await page.getByRole('button', { name: 'Conectar y buscar' }).click()

  await expect(page.getByText('Permisos insuficientes')).toBeVisible()
  await page.getByRole('button', { name: 'Ingresar manualmente' }).click()
  await expect(page.getByText('Entrada manual')).toBeVisible()
  await page.getByLabel('Cola DLQ').fill('orders.dlq')
  await page.getByLabel('Cola destino').fill('orders')
  await expect(page.getByRole('button', { name: 'Guardar perfil' })).toBeEnabled()
  await page.getByRole('button', { name: 'Cancelar' }).click()
})

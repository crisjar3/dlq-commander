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
    const rabbitPageOne = await api.invoke('discoverResourcePage', {
      connection: {
        brokerType: 'rabbitmq',
        configuration: { host: 'localhost', port: 5672, vhost: '/', tls: false },
        secret: { username: 'dlqcommander', password: 'dlqcommander' }
      },
      request: { collection: { kind: 'queues' }, pageSize: 50 }
    })
    const rabbitPageTwo = await api.invoke('discoverResourcePage', {
      connection: {
        brokerType: 'rabbitmq',
        configuration: { host: 'localhost', port: 5672, vhost: '/', tls: false },
        secret: { username: 'dlqcommander', password: 'dlqcommander' }
      },
      request: { collection: { kind: 'queues' }, pageSize: 50, cursor: rabbitPageOne.nextCursor }
    })
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
    return { rabbitDiscovery, kafkaDiscovery, rabbitPageOne, rabbitPageTwo, rabbitTest, kafkaTest, rabbitSources, kafkaSources }
  })

  expect(result.rabbitDiscovery.entities.map((entity) => entity.name)).toEqual(expect.arrayContaining(['orders', 'orders.dlq']))
  expect(result.kafkaDiscovery.entities.map((entity) => entity.name)).toEqual(expect.arrayContaining(['orders.events', 'orders.events.dlt']))
  expect(result.rabbitPageOne.entities).toHaveLength(50)
  expect(result.rabbitPageOne.nextCursor).not.toBeNull()
  expect(result.rabbitPageOne.totalCount).toBeGreaterThan(100)
  expect(result.rabbitPageTwo.entities).toHaveLength(50)
  expect(result.rabbitTest).toMatchObject({ ok: true, message: 'Conexion y DLQ verificadas' })
  expect(result.kafkaTest).toMatchObject({ ok: true, message: 'Broker y topics verificados' })
  expect(result.rabbitSources[0]).toMatchObject({ brokerType: 'rabbitmq', name: 'orders.dlq' })
  expect(result.kafkaSources[0]).toMatchObject({ brokerType: 'kafka', name: 'orders.events.dlt' })
  expect(result.rabbitSources[0]!.depth).toBeGreaterThan(0)
  expect(result.kafkaSources[0]!.depth).toBeGreaterThan(0)
})

test('creates an explorable RabbitMQ namespace from the modal', async () => {
  await page.getByRole('button', { name: 'Conexiones' }).click()
  await page.getByRole('button', { name: 'Nueva conexión' }).click()
  await page.getByLabel('Nombre del perfil').fill('RabbitMQ UI Discovery')
  await page.getByLabel('Contraseña').fill('dlqcommander')
  await page.getByRole('button', { name: 'Conectar y buscar' }).click()

  await expect(page.getByText(/recursos/).first()).toBeVisible()
  await page.getByLabel('Virtual host').fill('/stale')
  await expect(page.getByText('La conexión cambió')).toBeVisible()
  await page.getByLabel('Virtual host').fill('/')
  await page.getByRole('button', { name: 'Buscar nuevamente' }).click()
  await page.getByPlaceholder('Buscar queue o topic').fill('orders.dlq')
  await expect(page.getByRole('option', { name: /orders\.dlq/i })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Guardar y explorar' })).toBeEnabled()
  await page.getByRole('button', { name: 'Guardar y explorar' }).click()
  await expect(page.getByRole('heading', { name: 'Explorador de recursos' })).toBeVisible()

  await page.getByRole('button', { name: 'Conexiones' }).click()
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
  await expect(page.getByText('Ruta fija manual')).toBeVisible()
  await page.getByLabel('Queue origen').fill('orders.dlq')
  await page.getByLabel('Destino').fill('orders')
  await expect(page.getByRole('button', { name: 'Guardar ruta fija' })).toBeEnabled()
  await page.getByRole('button', { name: 'Cancelar' }).click()
})

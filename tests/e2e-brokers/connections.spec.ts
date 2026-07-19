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
    return { rabbitTest, kafkaTest, rabbitSources, kafkaSources }
  })

  expect(result.rabbitTest).toMatchObject({ ok: true, message: 'Conexion y DLQ verificadas' })
  expect(result.kafkaTest).toMatchObject({ ok: true, message: 'Broker y topics verificados' })
  expect(result.rabbitSources[0]).toMatchObject({ brokerType: 'rabbitmq', name: 'orders.dlq' })
  expect(result.kafkaSources[0]).toMatchObject({ brokerType: 'kafka', name: 'orders.events.dlt' })
  expect(result.rabbitSources[0]!.depth).toBeGreaterThan(0)
  expect(result.kafkaSources[0]!.depth).toBeGreaterThan(0)
})

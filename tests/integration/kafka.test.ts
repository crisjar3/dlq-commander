import { randomUUID } from 'node:crypto'
import { afterAll, describe, expect, it } from 'vitest'
import { Kafka, logLevel } from 'kafkajs'
import { KafkaAdapter } from '../../src/main/brokers/KafkaAdapter'

const KAFKA_BOOTSTRAP_SERVERS = 'localhost:9092'
const DLT_TOPIC = 'orders.events.dlt'
const TARGET_TOPIC = 'orders.events'
const kafka = new Kafka({
  brokers: [KAFKA_BOOTSTRAP_SERVERS],
  clientId: 'dlq-commander-integration',
  logLevel: logLevel.ERROR
})
const adapter = new KafkaAdapter('kafka-integration', {
  bootstrapServers: KAFKA_BOOTSTRAP_SERVERS,
  dltTopic: DLT_TOPIC,
  targetTopic: TARGET_TOPIC,
  clientId: 'dlq-commander-integration-adapter'
})

afterAll(async () => adapter.close())

describe('KafkaAdapter integration', () => {
  it('copies a selected DLT record while preserving the append-only source', async () => {
    const testId = `integration-${randomUUID()}`
    const producer = kafka.producer({ allowAutoTopicCreation: false })
    await producer.connect()
    try {
      await producer.send({
        topic: DLT_TOPIC,
        messages: [{
          key: testId,
          value: JSON.stringify({ testId, scenario: 'integration' }),
          headers: {
            'content-type': 'application/json',
            'dead-letter-reason': 'IntegrationTest',
            'delivery-count': '4'
          }
        }]
      })
    } finally {
      await producer.disconnect()
    }

    const connectionResult = await adapter.testConnection()
    expect(connectionResult.ok).toBe(true)
    const sourcesBefore = await adapter.listSources()
    const depthBefore = sourcesBefore[0]?.depth ?? 0
    expect(depthBefore).toBeGreaterThan(0)

    const page = await adapter.listMessages(DLT_TOPIC, 500)
    expect(page.warning).toMatch(/append-only/i)
    const selected = page.items.find((message) =>
      typeof message.body === 'object' && message.body !== null && 'testId' in message.body && message.body.testId === testId
    )
    expect(selected).toBeDefined()

    await adapter.requeueMessage(DLT_TOPIC, TARGET_TOPIC, selected!.id)
    const copied = await consumeByTestId(testId)
    expect(copied).toMatchObject({ testId, scenario: 'integration' })

    const sourcesAfter = await adapter.listSources()
    expect(sourcesAfter[0]?.depth).toBe(depthBefore)
  }, 30_000)
})

async function consumeByTestId(testId: string): Promise<Record<string, unknown> | null> {
  const consumer = kafka.consumer({
    groupId: `dlq-commander-assert-${randomUUID()}`,
    sessionTimeout: 6_000,
    maxWaitTimeInMs: 250
  })
  let result: Record<string, unknown> | null = null
  let resolveFound: (() => void) | null = null
  const found = new Promise<void>((resolve) => { resolveFound = resolve })
  try {
    await consumer.connect()
    await consumer.subscribe({ topics: [TARGET_TOPIC], fromBeginning: true })
    await consumer.run({
      autoCommit: false,
      eachMessage: async ({ message }) => {
        if (!message.value) return
        const body = JSON.parse(message.value.toString('utf8')) as Record<string, unknown>
        if (body['testId'] === testId) {
          result = body
          resolveFound?.()
        }
      }
    })
    await Promise.race([found, new Promise<void>((resolve) => setTimeout(resolve, 10_000))])
    return result
  } finally {
    await consumer.stop().catch(() => undefined)
    await consumer.disconnect().catch(() => undefined)
  }
}

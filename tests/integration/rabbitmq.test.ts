import { randomUUID } from 'node:crypto'
import { afterAll, describe, expect, it } from 'vitest'
import { connect } from 'amqplib'
import { RabbitMqAdapter } from '../../src/main/brokers/RabbitMqAdapter'

const RABBITMQ_CONNECTION_STRING = 'amqp://dlqcommander:dlqcommander@localhost:5672/%2F'
const adapter = new RabbitMqAdapter(
  'rabbit-integration',
  { host: 'localhost', port: 5672, vhost: '/', tls: false, sourceQueue: 'orders.dlq', targetQueue: 'orders' },
  { username: 'dlqcommander', password: 'dlqcommander' }
)

afterAll(async () => adapter.close())

describe('RabbitMqAdapter integration', () => {
  it('publishes to the target before acknowledging the selected DLQ message', async () => {
    const messageId = `integration-${randomUUID()}`
    const connection = await connect(RABBITMQ_CONNECTION_STRING)
    const channel = await connection.createConfirmChannel()
    try {
      channel.sendToQueue('orders.dlq', Buffer.from(JSON.stringify({ messageId, scenario: 'integration' })), {
        messageId,
        contentType: 'application/json',
        persistent: true
      })
      await channel.waitForConfirms()

      const connectionResult = await adapter.testConnection()
      expect(connectionResult.ok).toBe(true)
      const sources = await adapter.listSources()
      expect(sources[0]?.depth).toBeGreaterThan(0)

      const source = { kind: 'queue' as const, name: 'orders.dlq' }
      const page = await adapter.listMessages(source, 100)
      expect(page.warning).toMatch(/no ofrece peek nativo/i)
      expect(page.items.some((message) => message.id === messageId)).toBe(true)

      await adapter.requeueMessage(source, { kind: 'queue', name: 'orders' }, messageId)

      let targetMessage = await channel.get('orders', { noAck: false })
      for (let index = 0; targetMessage && targetMessage.properties.messageId !== messageId && index < 100; index += 1) {
        channel.ack(targetMessage)
        targetMessage = await channel.get('orders', { noAck: false })
      }
      expect(targetMessage && targetMessage.properties.messageId).toBe(messageId)
      if (targetMessage) channel.ack(targetMessage)
    } finally {
      await channel.close()
      await connection.close()
    }
  })
})

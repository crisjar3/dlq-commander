import { randomUUID } from 'node:crypto'
import { connect } from 'amqplib'

const connection = await connect('amqp://dlqcommander:dlqcommander@localhost:5672/%2F')
const channel = await connection.createConfirmChannel()

for (let index = 0; index < 20; index += 1) {
  const body = Buffer.from(JSON.stringify({
    orderId: `LAB-${String(index + 1).padStart(5, '0')}`,
    scenario: index % 2 === 0 ? 'validation' : 'timeout',
    createdAt: new Date().toISOString()
  }))
  channel.sendToQueue('orders.dlq', body, {
    persistent: true,
    contentType: 'application/json',
    messageId: randomUUID(),
    headers: { 'x-lab-fixture': true, reason: index % 2 === 0 ? 'ValidationFailed' : 'Timeout' }
  })
}

await channel.waitForConfirms()
await channel.close()
await connection.close()
console.log('Seeded 20 messages into orders.dlq')

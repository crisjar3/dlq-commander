import { Kafka, logLevel } from 'kafkajs'

const kafka = new Kafka({
  brokers: ['localhost:9092'], clientId: 'dlq-commander-seed', logLevel: logLevel.ERROR
})
const producer = kafka.producer({ allowAutoTopicCreation: false })

await producer.connect()
await producer.send({
  topic: 'orders.events.dlt',
  messages: Array.from({ length: 20 }, (_, index) => ({
    key: `LAB-${String(index + 1).padStart(5, '0')}`,
    value: JSON.stringify({
      orderId: `LAB-${String(index + 1).padStart(5, '0')}`,
      scenario: index % 2 === 0 ? 'validation' : 'timeout',
      createdAt: new Date().toISOString()
    }),
    headers: {
      'content-type': 'application/json',
      'dead-letter-reason': index % 2 === 0 ? 'ValidationFailed' : 'Timeout',
      'delivery-count': String(3 + index % 5),
      'x-lab-fixture': 'true'
    }
  }))
})
await producer.disconnect()
console.log('Seeded 20 records into orders.events.dlt')

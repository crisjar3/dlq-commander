import { describe, expect, it } from 'vitest'
import { BrokerDiscoveryService } from '../../src/main/brokers/BrokerDiscoveryService'

const azureConnectionString = process.env['AZURE_SERVICE_BUS_CONNECTION_STRING']

describe('BrokerDiscoveryService integration', () => {
  const service = new BrokerDiscoveryService()

  it('discovers RabbitMQ queues from the local Management API', async () => {
    const result = await service.discover({
      brokerType: 'rabbitmq',
      configuration: { host: 'localhost', port: 5672, vhost: '/', tls: false },
      secret: { username: 'dlqcommander', password: 'dlqcommander' }
    })

    expect(result.entities.map((entity) => entity.name)).toEqual(expect.arrayContaining(['orders', 'orders.dlq']))
    expect(result.entities.find((entity) => entity.name === 'orders.dlq')).toMatchObject({
      kind: 'queue',
      suggestedSource: true
    })
  })

  it('discovers Kafka topics and removes internal topics', async () => {
    const result = await service.discover({
      brokerType: 'kafka',
      configuration: { bootstrapServers: 'localhost:9092', clientId: 'dlq-commander-discovery-integration' },
      secret: {}
    })

    expect(result.entities.map((entity) => entity.name)).toEqual(expect.arrayContaining(['orders.events', 'orders.events.dlt']))
    expect(result.entities.every((entity) => !entity.name.startsWith('__'))).toBe(true)
  })

  it.skipIf(!azureConnectionString)('discovers Azure Service Bus queues with an opt-in credential', async () => {
    const result = await service.discover({
      brokerType: 'azure-service-bus',
      configuration: {},
      secret: { connectionString: azureConnectionString! }
    })

    expect(result.entities.length).toBeGreaterThan(0)
    expect(result.entities.every((entity) => entity.kind === 'queue')).toBe(true)
  })
})

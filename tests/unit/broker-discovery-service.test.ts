import { describe, expect, it, vi } from 'vitest'
import { BrokerDiscoveryService } from '../../src/main/brokers/BrokerDiscoveryService'

const rabbitInput = {
  brokerType: 'rabbitmq' as const,
  configuration: {
    host: 'localhost',
    port: 5672,
    vhost: '/',
    tls: false,
    managementUrl: 'http://localhost:15672/ops/'
  },
  secret: { username: 'operator', password: 'secret-value' }
}

describe('BrokerDiscoveryService', () => {
  it('discovers RabbitMQ queues through the Management API without credentials in the URL', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      void input
      void init
      return new Response(JSON.stringify([
        { name: 'orders', messages: 0 },
        { name: 'orders.dlq', messages: 7 }
      ]), { status: 200, headers: { 'content-type': 'application/json' } })
    })
    const service = new BrokerDiscoveryService({ fetch: fetchMock as typeof fetch })

    const result = await service.discover(rabbitInput)

    expect(result.entities.map((entity) => entity.name)).toEqual(['orders.dlq', 'orders'])
    expect(result.entities[0]).toMatchObject({ kind: 'queue', messageCount: 7, suggestedSource: true })
    const [request, init] = fetchMock.mock.calls[0]!
    expect(String(request)).toBe('http://localhost:15672/ops/api/queues/%2F')
    expect(String(request)).not.toContain('operator')
    expect(new Headers(init?.headers).get('Authorization')).toBe(`Basic ${Buffer.from('operator:secret-value').toString('base64')}`)
  })

  it('discovers Azure queues and prioritizes a queue with dead-letter messages', async () => {
    const service = new BrokerDiscoveryService({
      createAzureAdministrationClient: () => ({
        async *listQueuesRuntimeProperties() {
          yield { name: 'payments', deadLetterMessageCount: 0 }
          yield { name: 'billing', deadLetterMessageCount: 3 }
        }
      })
    })

    const result = await service.discover({
      brokerType: 'azure-service-bus',
      configuration: {},
      secret: { connectionString: 'Endpoint=sb://example/;SharedAccessKeyName=test;SharedAccessKey=secret' }
    })

    expect(result.entities).toEqual([
      { name: 'billing', kind: 'queue', messageCount: 3, suggestedSource: true },
      { name: 'payments', kind: 'queue', messageCount: 0, suggestedSource: false }
    ])
  })

  it('filters internal Kafka topics and always disconnects the admin client', async () => {
    const disconnect = vi.fn(async () => undefined)
    const service = new BrokerDiscoveryService({
      createKafkaClient: () => ({
        admin: () => ({
          connect: vi.fn(async () => undefined),
          listTopics: vi.fn(async () => ['__consumer_offsets', 'orders.events', 'orders.events.dlt']),
          disconnect
        })
      })
    })

    const result = await service.discover({
      brokerType: 'kafka',
      configuration: { bootstrapServers: 'one:9092, two:9092', clientId: 'discovery-test' },
      secret: {}
    })

    expect(result.entities.map((entity) => entity.name)).toEqual(['orders.events.dlt', 'orders.events'])
    expect(result.entities[0]?.messageCount).toBeNull()
    expect(disconnect).toHaveBeenCalledOnce()
  })

  it.each([401, 403])('maps RabbitMQ status %s to a permission error', async (status) => {
    const service = new BrokerDiscoveryService({
      fetch: vi.fn(async () => new Response(null, { status })) as unknown as typeof fetch
    })

    await expect(service.discover(rabbitInput)).rejects.toMatchObject({
      code: 'DISCOVERY_PERMISSION_DENIED'
    })
  })

  it('maps malformed broker payloads without exposing credentials', async () => {
    const service = new BrokerDiscoveryService({
      fetch: vi.fn(async () => new Response(JSON.stringify([{ name: 'queue', messages: 'invalid' }]), { status: 200 })) as unknown as typeof fetch
    })

    await expect(service.discover(rabbitInput)).rejects.toMatchObject({
      code: 'DISCOVERY_INVALID_RESPONSE',
      message: expect.not.stringContaining('secret-value')
    })
  })

  it('maps invalid JSON to an invalid response error', async () => {
    const service = new BrokerDiscoveryService({
      fetch: vi.fn(async () => new Response('{not-json', { status: 200 })) as unknown as typeof fetch
    })

    await expect(service.discover(rabbitInput)).rejects.toMatchObject({ code: 'DISCOVERY_INVALID_RESPONSE' })
  })

  it('fails a stalled discovery using the configured timeout', async () => {
    const service = new BrokerDiscoveryService({
      timeoutMs: 5,
      fetch: vi.fn(async (_input, init) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })
      })) as unknown as typeof fetch
    })

    await expect(service.discover(rabbitInput)).rejects.toMatchObject({ code: 'DISCOVERY_UNAVAILABLE' })
  })
})

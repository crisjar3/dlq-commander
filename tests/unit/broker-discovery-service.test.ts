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

    expect(result.entities.map((entity) => entity.name)).toEqual(['orders', 'orders.dlq'])
    expect(result.entities.find((entity) => entity.name === 'orders.dlq')).toMatchObject({ kind: 'queue', messageCount: 7, suggestedSource: true })
    const [request, init] = fetchMock.mock.calls[0]!
    const requestUrl = new URL(String(request))
    expect(`${requestUrl.origin}${requestUrl.pathname}`).toBe('http://localhost:15672/ops/api/queues/%2F')
    expect(Object.fromEntries(requestUrl.searchParams)).toMatchObject({
      pagination: 'true', page: '1', page_size: '50', disable_stats: 'true', enable_queue_totals: 'true'
    })
    expect(String(request)).not.toContain('operator')
    expect(new Headers(init?.headers).get('Authorization')).toBe(`Basic ${Buffer.from('operator:secret-value').toString('base64')}`)
  })

  it('discovers Azure queues and prioritizes a queue with dead-letter messages', async () => {
    const service = new BrokerDiscoveryService({
      createAzureAdministrationClient: () => ({
        async *listQueuesRuntimeProperties() {
          yield { name: 'payments', deadLetterMessageCount: 0 }
          yield { name: 'billing', deadLetterMessageCount: 3 }
        },
        async *listTopicsRuntimeProperties() {
          yield { name: 'orders-events', subscriptionCount: 2 }
        },
        async *listSubscriptionsRuntimeProperties(topicName: string) {
          yield { topicName, subscriptionName: 'fulfillment', deadLetterMessageCount: 5 }
        }
      })
    })

    const result = await service.discover({
      brokerType: 'azure-service-bus',
      configuration: {},
      secret: { connectionString: 'Endpoint=sb://example/;SharedAccessKeyName=test;SharedAccessKey=secret' }
    })

    expect(result.entities.map((entity) => entity.name)).toEqual(['billing', 'orders-events', 'payments'])
    expect(result.entities[0]).toMatchObject({ kind: 'queue', messageCount: 3, suggestedSource: true, canInspect: true })
    expect(result.entities[1]).toMatchObject({ kind: 'topic', childCount: 2, canInspect: false, canTarget: true })

    const subscriptions = await service.discover({
      brokerType: 'azure-service-bus',
      scope: { kind: 'topic', topicName: 'orders-events' },
      configuration: {},
      secret: { connectionString: 'Endpoint=sb://example/;SharedAccessKeyName=test;SharedAccessKey=secret' }
    })
    expect(subscriptions.entities[0]).toMatchObject({
      name: 'fulfillment', kind: 'subscription', parent: { kind: 'topic', name: 'orders-events' },
      messageCount: 5, canInspect: true, canTarget: false
    })
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

    expect(result.entities.map((entity) => entity.name)).toEqual(['orders.events', 'orders.events.dlt'])
    expect(result.entities[0]?.messageCount).toBeNull()
    expect(disconnect).toHaveBeenCalledOnce()
  })

  it('paginates RabbitMQ responses and normalizes operational metrics', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const page = Number(new URL(String(input)).searchParams.get('page'))
      return new Response(JSON.stringify({
        items: page === 1
          ? [{ name: 'alpha', state: 'running', messages: 11, messages_ready: 8, messages_unacknowledged: 3 }]
          : [{ name: 'beta', state: 'idle', messages: 0, messages_ready: 0, messages_unacknowledged: 0 }],
        page,
        page_count: 2,
        total_count: 2
      }), { status: 200 })
    })
    const service = new BrokerDiscoveryService({ fetch: fetchMock as typeof fetch })
    const first = await service.discoverPage({
      connection: rabbitInput,
      request: { collection: { kind: 'queues' }, pageSize: 10 }
    })
    const second = await service.discoverPage({
      connection: rabbitInput,
      request: { collection: { kind: 'queues' }, pageSize: 10, cursor: first.nextCursor }
    })
    expect(first).toMatchObject({ totalCount: 2, entities: [{ status: 'running', metrics: { totalMessages: 11, readyMessages: 8, unacknowledgedMessages: 3 } }] })
    expect(first.nextCursor).not.toBeNull()
    expect(second.entities.map((item) => item.name)).toEqual(['beta'])
    expect(second.nextCursor).toBeNull()
    await expect(service.discoverPage({
      connection: rabbitInput,
      request: { collection: { kind: 'queues' }, pageSize: 10, cursor: 'not-an-opaque-cursor' }
    })).rejects.toMatchObject({ code: 'RESOURCE_CURSOR_INVALID' })
  })

  it('uses Azure continuation tokens and maps queue runtime metrics', async () => {
    const byPage = vi.fn(({ continuationToken }: { continuationToken?: string }) => ({
      async *[Symbol.asyncIterator]() {
        const values = continuationToken
          ? [{ name: 'queue-b', totalMessageCount: 2, activeMessageCount: 2, deadLetterMessageCount: 0, scheduledMessageCount: 0, sizeInBytes: 128 }]
          : [{ name: 'queue-a', totalMessageCount: 8, activeMessageCount: 5, deadLetterMessageCount: 3, scheduledMessageCount: 1, sizeInBytes: 512 }]
        const page = Object.assign(values, { continuationToken: continuationToken ? undefined : 'azure-next' })
        yield page
      }
    }))
    const source = { async *[Symbol.asyncIterator]() {}, byPage }
    const service = new BrokerDiscoveryService({
      createAzureAdministrationClient: () => ({
        listQueuesRuntimeProperties: () => source,
        listTopicsRuntimeProperties: () => ({ async *[Symbol.asyncIterator]() {} }),
        listSubscriptionsRuntimeProperties: () => ({ async *[Symbol.asyncIterator]() {} })
      })
    })
    const connection = {
      brokerType: 'azure-service-bus' as const,
      configuration: {},
      secret: { connectionString: 'Endpoint=sb://example/;SharedAccessKeyName=test;SharedAccessKey=secret' }
    }
    const first = await service.discoverPage({ connection, request: { collection: { kind: 'queues' }, pageSize: 50 } })
    const second = await service.discoverPage({ connection, request: { collection: { kind: 'queues' }, pageSize: 50, cursor: first.nextCursor } })
    expect(first.entities[0]?.metrics).toMatchObject({ totalMessages: 8, activeMessages: 5, deadLetterMessages: 3, scheduledMessages: 1, sizeBytes: 512 })
    expect(second.entities[0]?.name).toBe('queue-b')
    expect(byPage).toHaveBeenNthCalledWith(2, { continuationToken: 'azure-next', maxPageSize: 50 })
  })

  it('loads Kafka topics once and serves subsequent pages from its cache', async () => {
    const listTopics = vi.fn(async () => ['__internal', ...Array.from({ length: 25 }, (_, index) => `topic-${String(index).padStart(2, '0')}`)])
    const disconnect = vi.fn(async () => undefined)
    const service = new BrokerDiscoveryService({
      createKafkaClient: () => ({ admin: () => ({ connect: vi.fn(async () => undefined), listTopics, disconnect }) })
    })
    const connection = { brokerType: 'kafka' as const, configuration: { bootstrapServers: 'one:9092', clientId: 'paged' }, secret: {} }
    const first = await service.discoverPage({ connection, request: { collection: { kind: 'topics' }, pageSize: 10 } })
    const second = await service.discoverPage({ connection, request: { collection: { kind: 'topics' }, pageSize: 10, cursor: first.nextCursor } })
    expect(first.entities).toHaveLength(10)
    expect(second.entities[0]?.name).toBe('topic-10')
    expect(listTopics).toHaveBeenCalledOnce()
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

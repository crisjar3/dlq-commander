import { describe, expect, it } from 'vitest'
import { brokerResourceRefSchema, connectionProfileInputSchema, capabilitiesByBroker, discoveredEntitySchema, emptyResourceMetrics, targetResourceRefSchema } from '../../src/shared/domain'
import { ipcContract } from '../../src/shared/ipc-contract'

describe('shared domain contract', () => {
  it('keeps broker semantics explicit', () => {
    expect(capabilitiesByBroker.rabbitmq.inspectionMode).toBe('receive-and-release')
    expect(capabilitiesByBroker['azure-service-bus'].inspectionMode).toBe('native-peek')
    expect(capabilitiesByBroker.kafka.inspectionMode).toBe('append-only-read')
    expect(capabilitiesByBroker.kafka.canPurge).toBe(false)
    expect(capabilitiesByBroker.demo.canRequeue).toBe(true)
    expect(capabilitiesByBroker.rabbitmq.canDiscover).toBe(true)
    expect(capabilitiesByBroker['azure-service-bus'].canDiscover).toBe(true)
    expect(capabilitiesByBroker.kafka.canDiscover).toBe(true)
  })

  it('rejects incomplete profiles at the IPC boundary', () => {
    const parsed = connectionProfileInputSchema.safeParse({
      name: 'x',
      brokerType: 'rabbitmq',
      readOnly: true,
      configuration: {},
      secret: {}
    })
    expect(parsed.success).toBe(false)
  })

  it('rejects unsafe bulk job sizes and throttle values', () => {
    const oversized = ipcContract.startRequeue.input.safeParse({
      profileId: 'profile',
      source: { kind: 'queue', name: 'source' },
      target: { kind: 'queue', name: 'target' },
      messageIds: Array.from({ length: 5001 }, (_, index) => String(index)),
      throttlePerSecond: 101
    })
    expect(oversized.success).toBe(false)
  })

  it('keeps subscriptions hierarchical and excludes them from destination refs', () => {
    expect(brokerResourceRefSchema.safeParse({ kind: 'subscription', topicName: 'orders', name: 'worker' }).success).toBe(true)
    expect(brokerResourceRefSchema.safeParse({ kind: 'subscription', name: 'worker' }).success).toBe(false)
    expect(targetResourceRefSchema.safeParse({ kind: 'subscription', topicName: 'orders', name: 'worker' }).success).toBe(false)
    expect(discoveredEntitySchema.safeParse({
      key: 'subscription:orders/worker', name: 'worker', kind: 'subscription', parent: null,
      messageCount: 0, childCount: null, canInspect: true, canTarget: false, suggestedSource: false,
      status: null, metrics: emptyResourceMetrics()
    }).success).toBe(false)
  })

  it('keeps discovery inputs broker-specific', () => {
    expect(ipcContract.discoverEntities.input.safeParse({
      brokerType: 'rabbitmq',
      configuration: { host: 'localhost', port: 5672, vhost: '/', tls: false },
      secret: { username: 'guest', password: 'guest' }
    }).success).toBe(true)

    expect(ipcContract.discoverEntities.input.safeParse({
      brokerType: 'kafka',
      configuration: { bootstrapServers: 'localhost:9092', clientId: 'test', connectionString: 'not-allowed' },
      secret: {}
    }).success).toBe(false)

    expect(ipcContract.discoverEntities.input.safeParse({
      brokerType: 'rabbitmq',
      scope: { kind: 'topic', topicName: 'orders' },
      configuration: { host: 'localhost', port: 5672, vhost: '/', tls: false },
      secret: { username: 'guest', password: 'guest' }
    }).success).toBe(false)

    expect(ipcContract.discoverEntities.input.safeParse({
      brokerType: 'kafka',
      scope: { kind: 'topic', topicName: 'orders' },
      configuration: { bootstrapServers: 'localhost:9092', clientId: 'test' },
      secret: {}
    }).success).toBe(false)
  })

  it('validates paginated resource collections and applies safe defaults', () => {
    const parsed = ipcContract.listResourcePage.input.parse({
      profileId: 'profile',
      collection: { kind: 'queues' }
    })
    expect(parsed).toMatchObject({ cursor: null, pageSize: 50, force: false })
    expect(ipcContract.listResourcePage.input.safeParse({
      profileId: 'profile', collection: { kind: 'queues' }, pageSize: 9
    }).success).toBe(false)
    expect(ipcContract.listResourcePage.input.safeParse({
      profileId: 'profile', collection: { kind: 'topics' }, pageSize: 101
    }).success).toBe(false)
    expect(ipcContract.discoverResourcePage.input.safeParse({
      connection: {
        brokerType: 'kafka',
        configuration: { bootstrapServers: 'localhost:9092', clientId: 'test' },
        secret: {}
      },
      request: { collection: { kind: 'subscriptions', topicName: 'orders' } }
    }).success).toBe(false)
    expect(ipcContract.discoverResourcePage.input.safeParse({
      connection: {
        brokerType: 'azure-service-bus',
        scope: { kind: 'topic', topicName: 'orders' },
        configuration: {},
        secret: { connectionString: 'fixture' }
      },
      request: { collection: { kind: 'subscriptions', topicName: 'payments' } }
    }).success).toBe(false)
  })
})

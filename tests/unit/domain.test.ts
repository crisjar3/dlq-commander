import { describe, expect, it } from 'vitest'
import { connectionProfileInputSchema, capabilitiesByBroker } from '../../src/shared/domain'
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
      sourceId: 'source',
      targetName: 'target',
      messageIds: Array.from({ length: 5001 }, (_, index) => String(index)),
      throttlePerSecond: 101
    })
    expect(oversized.success).toBe(false)
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
  })
})

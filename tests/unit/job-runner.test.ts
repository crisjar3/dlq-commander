import { describe, expect, it, vi } from 'vitest'
import type { ConnectionProfile, OperationJob } from '../../src/shared/domain'
import { DemoAdapter } from '../../src/main/brokers/DemoAdapter'
import type { BrokerRegistry } from '../../src/main/brokers/BrokerRegistry'
import { JobRunner } from '../../src/main/jobs/JobRunner'
import type { ArchiveRepository } from '../../src/main/persistence/ArchiveRepository'
import type { AuditRepository } from '../../src/main/persistence/AuditRepository'
import type { ProfileRepository } from '../../src/main/persistence/ProfileRepository'

describe('JobRunner', () => {
  it('archives, throttles and reports a successful bulk requeue', async () => {
    const adapter = new DemoAdapter('demo-test')
    const initialPage = await adapter.listMessages('orders.dlq', 10)
    const selectedIds = initialPage.items.slice(0, 2).map((message) => message.id)
    const profile: ConnectionProfile = {
      id: 'demo-test',
      name: 'Demo test',
      brokerType: 'demo',
      readOnly: false,
      configuration: {},
      capabilities: adapter.capabilities,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
    const archived: string[] = []
    const emitted: OperationJob[] = []
    const profiles = { get: () => profile } as unknown as ProfileRepository
    const registry = { get: () => adapter } as unknown as BrokerRegistry
    const audit = { write: (entry: unknown) => entry } as unknown as AuditRepository
    const archive = { archive: (_jobId: string, _profileId: string, message: { id: string }) => archived.push(message.id) } as unknown as ArchiveRepository
    const runner = new JobRunner(profiles, registry, audit, archive, (job) => emitted.push(job))

    const started = runner.start({
      profileId: profile.id,
      sourceId: 'orders.dlq',
      targetName: 'orders',
      messageIds: selectedIds,
      throttlePerSecond: 100
    })

    await vi.waitFor(() => {
      expect(runner.list().find((job) => job.id === started.id)?.status).toBe('completed')
    })
    const completed = runner.list().find((job) => job.id === started.id)
    expect(completed).toMatchObject({ processed: 2, succeeded: 2, failed: 0 })
    expect(archived).toEqual(selectedIds)
    expect(emitted.at(-1)?.status).toBe('completed')
  })

  it('rejects operations from a read-only profile', () => {
    const adapter = new DemoAdapter('demo-test')
    const profiles = {
      get: () => ({ id: 'demo-test', readOnly: true, capabilities: adapter.capabilities })
    } as unknown as ProfileRepository
    const runner = new JobRunner(
      profiles,
      { get: () => adapter } as unknown as BrokerRegistry,
      { write: (entry: unknown) => entry } as unknown as AuditRepository,
      { archive: () => undefined } as unknown as ArchiveRepository,
      () => undefined
    )

    expect(() => runner.start({
      profileId: 'demo-test',
      sourceId: 'orders.dlq',
      targetName: 'orders',
      messageIds: ['one'],
      throttlePerSecond: 1
    })).toThrow(/solo lectura/i)
  })
})

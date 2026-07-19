import { describe, expect, it } from 'vitest'
import { DemoAdapter } from '../../src/main/brokers/DemoAdapter'

describe('DemoAdapter', () => {
  it('lists representative sources and messages', async () => {
    const adapter = new DemoAdapter('demo-test')
    const sources = await adapter.listSources()
    expect(sources).toHaveLength(3)
    expect(sources[0]?.profileId).toBe('demo-test')

    const page = await adapter.listMessages('orders.dlq', 10)
    expect(page.items).toHaveLength(10)
    expect(page.hasMore).toBe(true)
    expect(page.items[0]?.rawHash).toHaveLength(64)
  })

  it('removes a message only after requeue succeeds', async () => {
    const adapter = new DemoAdapter('demo-test')
    const before = await adapter.listMessages('payments.dlq', 100)
    const selected = before.items[0]
    expect(selected).toBeDefined()

    await adapter.requeueMessage('payments.dlq', 'payments', selected!.id)

    const after = await adapter.listMessages('payments.dlq', 100)
    expect(after.items).toHaveLength(before.items.length - 1)
    expect(after.items.some((message) => message.id === selected!.id)).toBe(false)
  })
})

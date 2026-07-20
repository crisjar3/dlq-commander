import { describe, expect, it } from 'vitest'
import type { DiscoveredEntity } from '../../src/shared/domain'
import { filterAndRankResources, resourceRefFromEntity, targetRefFromEntity } from '../../src/shared/resources'

const entity = (name: string, suggestedSource = false): DiscoveredEntity => ({
  key: `queue:${name}`, name, kind: 'queue', parent: null, messageCount: 0, childCount: null,
  canInspect: true, canTarget: true, suggestedSource
})

describe('resource explorer helpers', () => {
  it('ranks exact, prefix, segment prefix and substring matches', () => {
    const entities = [entity('archive-orders'), entity('orders.retry'), entity('orders'), entity('customer-orders')]
    expect(filterAndRankResources(entities, 'orders').map((item) => item.name)).toEqual([
      'orders', 'orders.retry', 'archive-orders', 'customer-orders'
    ])
  })

  it('searches thousands of resources without changing the source array', () => {
    const entities = Array.from({ length: 2_000 }, (_, index) => entity(`payments.region-${index}`))
    const result = filterAndRankResources(entities, 'region-1842')
    expect(result.map((item) => item.name)).toEqual(['payments.region-1842'])
    expect(entities).toHaveLength(2_000)
  })

  it('preserves a subscription parent and never returns it as a target', () => {
    const subscription: DiscoveredEntity = {
      key: 'subscription:orders/worker', name: 'worker', kind: 'subscription',
      parent: { kind: 'topic', name: 'orders' }, messageCount: 2, childCount: null,
      canInspect: true, canTarget: false, suggestedSource: true
    }
    expect(resourceRefFromEntity(subscription)).toEqual({ kind: 'subscription', topicName: 'orders', name: 'worker' })
    expect(targetRefFromEntity(subscription)).toBeNull()
  })
})

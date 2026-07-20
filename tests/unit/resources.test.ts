import { describe, expect, it } from 'vitest'
import { emptyResourceMetrics, type DiscoveredEntity } from '../../src/shared/domain'
import { filterAndRankResources, resourceRefFromEntity, targetRefFromEntity } from '../../src/shared/resources'

const entity = (name: string, suggestedSource = false): DiscoveredEntity => ({
  key: `queue:${name}`, name, kind: 'queue', parent: null, messageCount: 0, childCount: null,
  canInspect: true, canTarget: true, suggestedSource, status: null, metrics: emptyResourceMetrics()
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

  it('normalizes accents and separators, requires every term and tolerates a typo', () => {
    const entities = [
      entity('facturacion-crítica.retry'),
      entity('facturacion-normal.retry'),
      entity('orders-payment-dead-letter')
    ]
    expect(filterAndRankResources(entities, 'FACTURACION CRITICA').map((item) => item.name)).toEqual(['facturacion-crítica.retry'])
    expect(filterAndRankResources(entities, 'orders payment').map((item) => item.name)).toEqual(['orders-payment-dead-letter'])
    expect(filterAndRankResources(entities, 'facturacon critca').map((item) => item.name)).toEqual(['facturacion-crítica.retry'])
    expect(filterAndRankResources([entity('zeta'), entity('alpha')], '').map((item) => item.name)).toEqual(['alpha', 'zeta'])
  })

  it('prefers exact terms when another term needs typo tolerance', () => {
    const entities = [
      entity('orders.dlq'), entity('payments.dlq'), entity('notifications.dlq'),
      ...Array.from({ length: 1_994 }, (_, index) => entity(`service-region-${String(index + 4).padStart(4, '0')}.dlq`)),
      entity('orders'), entity('payments'), entity('notifications')
    ]

    expect(filterAndRankResources(entities, 'servce region 0184')[0]?.name).toBe('service-region-0184.dlq')
  })

  it('preserves a subscription parent and never returns it as a target', () => {
    const subscription: DiscoveredEntity = {
      key: 'subscription:orders/worker', name: 'worker', kind: 'subscription',
      parent: { kind: 'topic', name: 'orders' }, messageCount: 2, childCount: null,
      canInspect: true, canTarget: false, suggestedSource: true, status: null, metrics: emptyResourceMetrics()
    }
    expect(resourceRefFromEntity(subscription)).toEqual({ kind: 'subscription', topicName: 'orders', name: 'worker' })
    expect(targetRefFromEntity(subscription)).toBeNull()
  })
})

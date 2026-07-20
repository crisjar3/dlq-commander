import { describe, expect, it } from 'vitest'
import { discoveryErrorState, selectRouting, suggestedSourceName } from '../../src/shared/connection-discovery'
import type { DiscoveredEntity } from '../../src/shared/domain'

const entity = (name: string, messageCount: number, suggestedSource: boolean): DiscoveredEntity => ({
  key: `queue:${name}`, name, kind: 'queue', parent: null, messageCount, childCount: null,
  canInspect: true, canTarget: true, suggestedSource
})

describe('connection discovery state helpers', () => {
  it('only preselects an unambiguous source', () => {
    expect(suggestedSourceName([
      entity('orders', 0, false),
      entity('orders.dlq', 4, true)
    ])).toBe('orders.dlq')
    expect(suggestedSourceName([
      entity('orders.dlq', 4, true),
      entity('payments.dlq', 2, true)
    ])).toBe('')
  })

  it('updates an automatic target but preserves an explicit target', () => {
    expect(selectRouting('orders.dlq', 'orders.dlq', 'payments.dlq')).toEqual({
      source: 'payments.dlq',
      target: 'payments.dlq'
    })
    expect(selectRouting('orders.dlq', 'orders', 'payments.dlq')).toEqual({
      source: 'payments.dlq',
      target: 'orders'
    })
  })

  it('separates permission failures from availability failures', () => {
    expect(discoveryErrorState('DISCOVERY_PERMISSION_DENIED')).toBe('permission-denied')
    expect(discoveryErrorState('RABBIT_MANAGEMENT_NOT_FOUND')).toBe('network-error')
  })
})

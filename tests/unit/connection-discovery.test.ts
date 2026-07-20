import { describe, expect, it } from 'vitest'
import { discoveryErrorState, selectRouting, suggestedSourceName } from '../../src/shared/connection-discovery'

describe('connection discovery state helpers', () => {
  it('only preselects an unambiguous source', () => {
    expect(suggestedSourceName([
      { name: 'orders', kind: 'queue', messageCount: 0, suggestedSource: false },
      { name: 'orders.dlq', kind: 'queue', messageCount: 4, suggestedSource: true }
    ])).toBe('orders.dlq')
    expect(suggestedSourceName([
      { name: 'orders.dlq', kind: 'queue', messageCount: 4, suggestedSource: true },
      { name: 'payments.dlq', kind: 'queue', messageCount: 2, suggestedSource: true }
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

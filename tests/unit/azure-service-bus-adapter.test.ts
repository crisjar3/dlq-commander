import Long from 'long'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  closeClient: vi.fn().mockResolvedValue(undefined),
  closeReceiver: vi.fn().mockResolvedValue(undefined),
  createReceiver: vi.fn(),
  getQueueRuntimeProperties: vi.fn(),
  getSubscriptionRuntimeProperties: vi.fn(),
  peekMessages: vi.fn()
}))

vi.mock('@azure/service-bus', () => ({
  ServiceBusAdministrationClient: class {
    getQueueRuntimeProperties = mocks.getQueueRuntimeProperties
    getSubscriptionRuntimeProperties = mocks.getSubscriptionRuntimeProperties
  },
  ServiceBusClient: class {
    close = mocks.closeClient
    createReceiver = mocks.createReceiver
  }
}))

import { AzureServiceBusAdapter } from '../../src/main/brokers/AzureServiceBusAdapter'

describe('AzureServiceBusAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createReceiver.mockReturnValue({
      close: mocks.closeReceiver,
      peekMessages: mocks.peekMessages
    })
    mocks.getQueueRuntimeProperties.mockResolvedValue({ deadLetterMessageCount: 1 })
    mocks.getSubscriptionRuntimeProperties.mockResolvedValue({ deadLetterMessageCount: 5 })
    mocks.peekMessages.mockResolvedValue([
      {
        body: { orderId: 'order-42' },
        deadLetterReason: 'ValidationFailed',
        enqueuedTimeUtc: new Date('2026-07-20T00:00:00.000Z'),
        messageId: 'message-42',
        sequenceNumber: Long.fromInt(42)
      }
    ])
  })

  it('opens a subscription dead-letter subqueue with its parent topic', async () => {
    const adapter = new AzureServiceBusAdapter(
      'azure-subscription-profile',
      {
        profileMode: 'fixed', sourceKind: 'subscription', topicName: 'orders',
        subscriptionName: 'fulfillment', targetKind: 'topic', targetName: 'orders-retry'
      },
      { connectionString: 'Endpoint=sb://example.servicebus.windows.net/;SharedAccessKeyName=test;SharedAccessKey=test' }
    )

    const sources = await adapter.listSources()
    const page = await adapter.listMessages({ kind: 'subscription', topicName: 'orders', name: 'fulfillment' }, 10)

    expect(mocks.createReceiver).toHaveBeenNthCalledWith(1, 'orders', 'fulfillment', expect.objectContaining({ subQueueType: 'deadLetter' }))
    expect(mocks.createReceiver).toHaveBeenNthCalledWith(2, 'orders', 'fulfillment', expect.objectContaining({ subQueueType: 'deadLetter' }))
    expect(sources[0]).toMatchObject({ displayName: 'orders / fulfillment / $DeadLetterQueue', depth: 5 })
    expect(page.items).toHaveLength(1)
  })

  it('starts every DLQ peek from the first sequence instead of sharing the SDK cursor', async () => {
    const adapter = new AzureServiceBusAdapter(
      'azure-profile',
      { queueName: 'orders', targetQueue: 'orders-target' },
      { connectionString: 'Endpoint=sb://example.servicebus.windows.net/;SharedAccessKeyName=test;SharedAccessKey=test' }
    )

    await adapter.testConnection()
    await adapter.listSources()
    const page = await adapter.listMessages({ kind: 'queue', name: 'orders' }, 10)

    expect(mocks.peekMessages).toHaveBeenNthCalledWith(1, 1, { fromSequenceNumber: Long.ZERO })
    expect(mocks.peekMessages).toHaveBeenNthCalledWith(2, 1, { fromSequenceNumber: Long.ZERO })
    expect(mocks.peekMessages).toHaveBeenNthCalledWith(3, 11, { fromSequenceNumber: Long.ZERO })
    expect(page.items).toHaveLength(1)
    expect(page.items[0]).toMatchObject({ nativeId: 'message-42', deadLetterReason: 'ValidationFailed' })
  })
})

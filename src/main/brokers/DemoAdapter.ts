import { randomUUID } from 'node:crypto'
import {
  capabilitiesByBroker,
  resourceKey,
  type BrokerResourceRef,
  type MessagePage,
  type NormalizedMessage,
  type SourceSummary,
  type TargetResourceRef
} from '@shared/domain'
import { AppError } from '../core/errors'
import type { BrokerAdapter, ConnectionTestResult } from './BrokerAdapter'
import { hashBody } from './normalize'

interface DemoSource {
  id: string
  name: string
  displayName: string
  targetName: string
  messages: NormalizedMessage[]
}

function createMessage(sourceId: string, index: number): NormalizedMessage {
  const body = {
    orderId: `ORD-${String(4800 + index).padStart(6, '0')}`,
    customerId: `CUS-${String(910 + (index % 8)).padStart(4, '0')}`,
    amount: Number((32.5 + index * 7.25).toFixed(2)),
    currency: index % 3 === 0 ? 'CRC' : 'USD',
    retryable: index % 4 !== 0
  }
  const nativeId = `demo-${sourceId}-${index + 1}`
  return {
    id: nativeId,
    nativeId,
    sourceId,
    body,
    bodyText: JSON.stringify(body, null, 2),
    contentType: 'application/json',
    enqueuedAt: new Date(Date.now() - (index + 1) * 9 * 60_000).toISOString(),
    deadLetterReason: index % 3 === 0 ? 'ValidationFailed' : index % 3 === 1 ? 'Timeout' : 'HandlerException',
    deadLetterDescription:
      index % 3 === 0 ? 'El esquema no cumple la version esperada' : 'El consumidor agoto sus reintentos',
    deliveryCount: 3 + (index % 7),
    sizeBytes: Buffer.byteLength(JSON.stringify(body)),
    headers: { correlationId: randomUUID(), producer: index % 2 ? 'checkout-api' : 'billing-worker' },
    rawHash: hashBody(body)
  }
}

export class DemoAdapter implements BrokerAdapter {
  readonly capabilities = capabilitiesByBroker.demo
  private readonly sources: DemoSource[]

  constructor(private readonly profileId: string) {
    this.sources = [
      { id: 'orders.dlq', name: 'orders.dlq', displayName: 'Orders / DLQ', targetName: 'orders', messages: [] },
      { id: 'payments.dlq', name: 'payments.dlq', displayName: 'Payments / DLQ', targetName: 'payments', messages: [] },
      { id: 'notifications.dlq', name: 'notifications.dlq', displayName: 'Notifications / DLQ', targetName: 'notifications', messages: [] }
    ]
    this.sources.forEach((source, sourceIndex) => {
      const count = sourceIndex === 0 ? 28 : sourceIndex === 1 ? 11 : 5
      source.messages = Array.from({ length: count }, (_, index) => createMessage(source.id, index + sourceIndex * 30))
    })
  }

  async testConnection(): Promise<ConnectionTestResult> {
    return { ok: true, latencyMs: 12, message: 'Entorno demo disponible' }
  }

  async listSources(): Promise<SourceSummary[]> {
    return this.sources.map((source) => ({
      id: resourceKey({ kind: 'queue', name: source.id }),
      resource: { kind: 'queue', name: source.id },
      profileId: this.profileId,
      name: source.name,
      displayName: source.displayName,
      targetName: source.targetName,
      depth: source.messages.length,
      brokerType: 'demo',
      status: source.messages.length >= 20 ? 'warning' : 'healthy',
      oldestMessageAt: source.messages.at(-1)?.enqueuedAt ?? null,
      capabilities: this.capabilities
    }))
  }

  async listMessages(resource: BrokerResourceRef, limit: number): Promise<MessagePage> {
    const source = this.findSource(resource)
    return {
      items: source.messages.slice(0, limit),
      hasMore: source.messages.length > limit,
      inspectedAt: new Date().toISOString(),
      warning: null
    }
  }

  async getMessageSnapshots(resource: BrokerResourceRef, messageIds: string[]): Promise<NormalizedMessage[]> {
    const source = this.findSource(resource)
    const ids = new Set(messageIds)
    return source.messages.filter((message) => ids.has(message.id))
  }

  async requeueMessage(resource: BrokerResourceRef, _target: TargetResourceRef, messageId: string): Promise<void> {
    const source = this.findSource(resource)
    const messageIndex = source.messages.findIndex((message) => message.id === messageId)
    if (messageIndex < 0) throw new AppError('MESSAGE_NOT_FOUND', `El mensaje ${messageId} ya no esta disponible`)
    source.messages.splice(messageIndex, 1)
  }

  async close(): Promise<void> {}

  private findSource(resource: BrokerResourceRef): DemoSource {
    if (resource.kind !== 'queue') throw new AppError('SOURCE_NOT_FOUND', 'El entorno demo solo expone colas')
    const source = this.sources.find((candidate) => candidate.id === resource.name)
    if (!source) throw new AppError('SOURCE_NOT_FOUND', `No existe la fuente ${resource.name}`)
    return source
  }
}

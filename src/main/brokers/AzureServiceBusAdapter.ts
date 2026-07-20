import { ServiceBusAdministrationClient, ServiceBusClient, type ServiceBusReceivedMessage } from '@azure/service-bus'
import Long from 'long'
import { z } from 'zod'
import {
  capabilitiesByBroker,
  resourceDisplayName,
  resourceKey,
  type BrokerResourceRef,
  type MessagePage,
  type NormalizedMessage,
  type SourceSummary,
  type TargetResourceRef
} from '@shared/domain'
import { AppError } from '../core/errors'
import type { BrokerAdapter, ConnectionTestResult } from './BrokerAdapter'
import { bodyToText, hashBody, stableMessageId } from './normalize'

const configSchema = z.object({
  profileMode: z.enum(['namespace', 'fixed']).optional(),
  sourceKind: z.enum(['queue', 'subscription']).optional(),
  queueName: z.string().min(1).optional(),
  topicName: z.string().min(1).optional(),
  subscriptionName: z.string().min(1).optional(),
  targetKind: z.enum(['queue', 'topic']).optional(),
  targetName: z.string().min(1).optional(),
  targetQueue: z.string().min(1).optional()
})
const secretSchema = z.object({ connectionString: z.string().min(1) })
const peekFromStart = { fromSequenceNumber: Long.ZERO }

export class AzureServiceBusAdapter implements BrokerAdapter {
  readonly capabilities = capabilitiesByBroker['azure-service-bus']
  private readonly client: ServiceBusClient
  private readonly administration: ServiceBusAdministrationClient
  private readonly config: z.infer<typeof configSchema>
  private readonly inspectionCache = new Map<string, NormalizedMessage>()

  constructor(
    private readonly profileId: string,
    rawConfig: Record<string, string | number | boolean>,
    rawSecret: Record<string, string>
  ) {
    this.config = configSchema.parse(rawConfig)
    const secret = secretSchema.parse(rawSecret)
    this.client = new ServiceBusClient(secret.connectionString)
    this.administration = new ServiceBusAdministrationClient(secret.connectionString)
  }

  async testConnection(): Promise<ConnectionTestResult> {
    const startedAt = performance.now()
    if (this.isNamespaceProfile()) {
      await this.administration.getNamespaceProperties()
    } else {
      const receiver = this.createDeadLetterReceiver(this.fixedSource())
      await receiver.peekMessages(1, peekFromStart)
      await receiver.close()
    }
    return { ok: true, latencyMs: Math.round(performance.now() - startedAt), message: 'Namespace y DLQ verificados' }
  }

  async listSources(): Promise<SourceSummary[]> {
    if (this.isNamespaceProfile()) return []
    const source = this.fixedSource()
    const receiver = this.createDeadLetterReceiver(source)
    try {
      const sample = await receiver.peekMessages(1, peekFromStart)
      let depth = sample.length
      try {
        const runtime = source.kind === 'queue'
          ? await this.administration.getQueueRuntimeProperties(source.name)
          : await this.administration.getSubscriptionRuntimeProperties(source.topicName, source.name)
        depth = runtime.deadLetterMessageCount
      } catch {
        // Listen-only connection strings cannot query management properties; retain the safe sample count.
      }
      return [
        {
          id: resourceKey(source),
          resource: source,
          profileId: this.profileId,
          name: source.name,
          displayName: `${resourceDisplayName(source)} / $DeadLetterQueue`,
          targetName: this.fixedTarget()?.name ?? null,
          depth,
          brokerType: 'azure-service-bus',
          status: depth > 0 ? 'warning' : 'healthy',
          oldestMessageAt: sample.at(0)?.enqueuedTimeUtc?.toISOString() ?? null,
          capabilities: this.capabilities
        }
      ]
    } finally {
      await receiver.close()
    }
  }

  async listMessages(source: BrokerResourceRef, limit: number): Promise<MessagePage> {
    this.assertSource(source)
    const sourceId = resourceKey(source)
    const receiver = this.createDeadLetterReceiver(source)
    try {
      const messages = await receiver.peekMessages(limit + 1, peekFromStart)
      const items = messages.slice(0, limit).map((message) => this.normalize(sourceId, message))
      items.forEach((message) => this.inspectionCache.set(message.id, message))
      return {
        items,
        hasMore: messages.length > limit,
        inspectedAt: new Date().toISOString(),
        warning: null
      }
    } finally {
      await receiver.close()
    }
  }

  async getMessageSnapshots(source: BrokerResourceRef, messageIds: string[]): Promise<NormalizedMessage[]> {
    this.assertSource(source)
    const missing = messageIds.filter((id) => !this.inspectionCache.has(id))
    if (missing.length > 0) await this.listMessages(source, 500)
    return messageIds.flatMap((id) => {
      const message = this.inspectionCache.get(id)
      return message ? [message] : []
    })
  }

  async requeueMessage(source: BrokerResourceRef, target: TargetResourceRef, messageId: string): Promise<void> {
    this.assertSource(source)
    const sourceId = resourceKey(source)
    const receiver = this.createDeadLetterReceiver(source)
    const sender = this.client.createSender(target.name)
    const held: ServiceBusReceivedMessage[] = []
    try {
      for (let attempt = 0; attempt < 25; attempt += 1) {
        const messages = await receiver.receiveMessages(20, { maxWaitTimeInMs: 1200 })
        if (messages.length === 0) break
        for (const message of messages) {
          if (this.normalize(sourceId, message).id === messageId) {
            await sender.sendMessages({
              body: message.body,
              contentType: message.contentType,
              correlationId: message.correlationId,
              messageId: message.messageId,
              subject: message.subject,
              applicationProperties: {
                ...message.applicationProperties,
                dlqCommanderRequeuedAt: new Date().toISOString()
              }
            })
            await receiver.completeMessage(message)
            return
          }
          held.push(message)
        }
      }
      throw new AppError('MESSAGE_NOT_FOUND', `El mensaje ${messageId} ya no esta disponible`)
    } finally {
      await Promise.allSettled(held.map((message) => receiver.abandonMessage(message)))
      await Promise.allSettled([receiver.close(), sender.close()])
    }
  }

  async close(): Promise<void> {
    await this.client.close()
    this.inspectionCache.clear()
  }

  private isNamespaceProfile(): boolean {
    return this.config.profileMode === 'namespace'
  }

  private fixedSource(): Exclude<BrokerResourceRef, { kind: 'topic' }> {
    if (this.config.sourceKind === 'subscription') {
      if (!this.config.topicName || !this.config.subscriptionName) {
        throw new AppError('SOURCE_NOT_FOUND', 'El perfil fijo no define topic y subscription')
      }
      return { kind: 'subscription', topicName: this.config.topicName, name: this.config.subscriptionName }
    }
    if (!this.config.queueName) throw new AppError('SOURCE_NOT_FOUND', 'El perfil fijo no define una cola')
    return { kind: 'queue', name: this.config.queueName }
  }

  private fixedTarget(): TargetResourceRef | null {
    const name = this.config.targetName ?? this.config.targetQueue
    if (!name) return null
    return { kind: this.config.targetKind ?? 'queue', name }
  }

  private assertSource(source: BrokerResourceRef): asserts source is Exclude<BrokerResourceRef, { kind: 'topic' }> {
    if (source.kind === 'topic') throw new AppError('SOURCE_NOT_FOUND', 'Los topics de Azure no tienen una DLQ inspeccionable')
    if (!this.isNamespaceProfile() && resourceKey(source) !== resourceKey(this.fixedSource())) {
      throw new AppError('SOURCE_NOT_FOUND', `No existe la fuente ${resourceDisplayName(source)}`)
    }
  }

  private createDeadLetterReceiver(source: Exclude<BrokerResourceRef, { kind: 'topic' }>) {
    const options = { subQueueType: 'deadLetter' as const, receiveMode: 'peekLock' as const }
    return source.kind === 'queue'
      ? this.client.createReceiver(source.name, options)
      : this.client.createReceiver(source.topicName, source.name, options)
  }

  private normalize(sourceId: string, message: ServiceBusReceivedMessage): NormalizedMessage {
    const nativeId = message.messageId === undefined ? null : String(message.messageId)
    const body = message.body
    return {
      id: stableMessageId(nativeId, body, String(message.sequenceNumber)),
      nativeId,
      sourceId,
      body,
      bodyText: bodyToText(body),
      contentType: message.contentType ?? null,
      enqueuedAt: message.enqueuedTimeUtc?.toISOString() ?? null,
      deadLetterReason: message.deadLetterReason ?? null,
      deadLetterDescription: message.deadLetterErrorDescription ?? null,
      deliveryCount: message.deliveryCount ?? 0,
      sizeBytes: Buffer.byteLength(bodyToText(body)),
      headers: message.applicationProperties ?? {},
      rawHash: hashBody(body)
    }
  }
}

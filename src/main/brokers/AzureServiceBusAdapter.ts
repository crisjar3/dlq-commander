import { ServiceBusAdministrationClient, ServiceBusClient, type ServiceBusReceivedMessage } from '@azure/service-bus'
import Long from 'long'
import { z } from 'zod'
import { capabilitiesByBroker, type MessagePage, type NormalizedMessage, type SourceSummary } from '@shared/domain'
import { AppError } from '../core/errors'
import type { BrokerAdapter, ConnectionTestResult } from './BrokerAdapter'
import { bodyToText, hashBody, stableMessageId } from './normalize'

const configSchema = z.object({
  queueName: z.string().min(1),
  targetQueue: z.string().min(1)
})
const secretSchema = z.object({ connectionString: z.string().min(1) })
const peekFromStart = { fromSequenceNumber: Long.ZERO }

export class AzureServiceBusAdapter implements BrokerAdapter {
  readonly capabilities = capabilitiesByBroker['azure-service-bus']
  private readonly client: ServiceBusClient
  private readonly administration: ServiceBusAdministrationClient
  private readonly config: z.infer<typeof configSchema>

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
    const receiver = this.client.createReceiver(this.config.queueName, { subQueueType: 'deadLetter', receiveMode: 'peekLock' })
    await receiver.peekMessages(1, peekFromStart)
    await receiver.close()
    return { ok: true, latencyMs: Math.round(performance.now() - startedAt), message: 'Namespace y DLQ verificados' }
  }

  async listSources(): Promise<SourceSummary[]> {
    const receiver = this.client.createReceiver(this.config.queueName, { subQueueType: 'deadLetter', receiveMode: 'peekLock' })
    try {
      const sample = await receiver.peekMessages(1, peekFromStart)
      let depth = sample.length
      try {
        const runtime = await this.administration.getQueueRuntimeProperties(this.config.queueName)
        depth = runtime.deadLetterMessageCount
      } catch {
        // Listen-only connection strings cannot query management properties; retain the safe sample count.
      }
      return [
        {
          id: this.config.queueName,
          profileId: this.profileId,
          name: this.config.queueName,
          displayName: `${this.config.queueName} / $DeadLetterQueue`,
          targetName: this.config.targetQueue,
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

  async listMessages(sourceId: string, limit: number): Promise<MessagePage> {
    this.assertSource(sourceId)
    const receiver = this.client.createReceiver(sourceId, { subQueueType: 'deadLetter', receiveMode: 'peekLock' })
    try {
      const messages = await receiver.peekMessages(limit, peekFromStart)
      return {
        items: messages.map((message) => this.normalize(sourceId, message)),
        hasMore: messages.length === limit,
        inspectedAt: new Date().toISOString(),
        warning: null
      }
    } finally {
      await receiver.close()
    }
  }

  async requeueMessage(sourceId: string, targetName: string, messageId: string): Promise<void> {
    this.assertSource(sourceId)
    const receiver = this.client.createReceiver(sourceId, { subQueueType: 'deadLetter', receiveMode: 'peekLock' })
    const sender = this.client.createSender(targetName)
    const held: ServiceBusReceivedMessage[] = []
    try {
      for (let attempt = 0; attempt < 10; attempt += 1) {
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
  }

  private assertSource(sourceId: string): void {
    if (sourceId !== this.config.queueName) throw new AppError('SOURCE_NOT_FOUND', `No existe la fuente ${sourceId}`)
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

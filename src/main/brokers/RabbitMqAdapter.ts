import { connect, type ChannelModel, type ConfirmChannel, type GetMessage } from 'amqplib'
import { z } from 'zod'
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
import { bodyToText, hashBody, stableMessageId } from './normalize'

const configSchema = z.object({
  host: z.string().min(1),
  port: z.coerce.number().int().positive().default(5672),
  vhost: z.string().default('/'),
  tls: z.union([z.boolean(), z.string()]).transform((value) => value === true || value === 'true').default(false),
  profileMode: z.enum(['namespace', 'fixed']).optional(),
  sourceQueue: z.string().min(1).optional(),
  targetQueue: z.string().min(1).optional(),
  managementUrl: z.string().url().optional()
})
const secretSchema = z.object({ username: z.string().min(1), password: z.string() })

export class RabbitMqAdapter implements BrokerAdapter {
  readonly capabilities = capabilitiesByBroker.rabbitmq
  private connection: ChannelModel | null = null
  private readonly inspectionCache = new Map<string, NormalizedMessage>()

  constructor(
    private readonly profileId: string,
    rawConfig: Record<string, string | number | boolean>,
    rawSecret: Record<string, string>
  ) {
    this.config = configSchema.parse(rawConfig)
    this.secret = secretSchema.parse(rawSecret)
  }

  private readonly config: z.infer<typeof configSchema>
  private readonly secret: z.infer<typeof secretSchema>

  async testConnection(): Promise<ConnectionTestResult> {
    const startedAt = performance.now()
    const connection = await connect(this.connectionUrl())
    const channel = await connection.createChannel()
    if (!this.isNamespaceProfile()) await channel.checkQueue(this.fixedSourceName())
    await channel.close()
    await connection.close()
    return { ok: true, latencyMs: Math.round(performance.now() - startedAt), message: 'Conexion y DLQ verificadas' }
  }

  async listSources(): Promise<SourceSummary[]> {
    if (this.isNamespaceProfile()) return []
    const sourceName = this.fixedSourceName()
    const channel = await this.createChannel()
    try {
      const queue = await channel.checkQueue(sourceName)
      return [
        {
          id: resourceKey({ kind: 'queue', name: sourceName }),
          resource: { kind: 'queue', name: sourceName },
          profileId: this.profileId,
          name: sourceName,
          displayName: sourceName,
          targetName: this.config.targetQueue ?? null,
          depth: queue.messageCount,
          brokerType: 'rabbitmq',
          status: queue.messageCount > 0 ? 'warning' : 'healthy',
          oldestMessageAt: null,
          capabilities: this.capabilities
        }
      ]
    } finally {
      await channel.close()
    }
  }

  async listMessages(source: BrokerResourceRef, limit: number): Promise<MessagePage> {
    this.assertSource(source)
    const sourceName = source.name
    const sourceId = resourceKey(source)
    const channel = await this.createChannel()
    const held: GetMessage[] = []
    const items: NormalizedMessage[] = []
    try {
      for (let index = 0; index < limit + 1; index += 1) {
        const raw = await channel.get(sourceName, { noAck: false })
        if (!raw) break
        held.push(raw)
        const normalized = this.normalize(sourceId, raw)
        items.push(normalized)
        this.inspectionCache.set(normalized.id, normalized)
      }
    } finally {
      held.forEach((message) => channel.nack(message, false, true))
      await channel.close()
    }
    return {
      items: items.slice(0, limit),
      hasMore: items.length > limit,
      inspectedAt: new Date().toISOString(),
      warning: 'RabbitMQ no ofrece peek nativo: la inspeccion usa basic.get y devuelve los mensajes con nack/requeue.'
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
    if (target.kind !== 'queue') throw new AppError('TARGET_NOT_FOUND', 'RabbitMQ solo permite colas como destino')
    const sourceName = source.name
    const channel = await this.createConfirmChannel()
    const held: GetMessage[] = []
    try {
      const queue = await channel.checkQueue(sourceName)
      let found: GetMessage | null = null
      for (let index = 0; index < queue.messageCount; index += 1) {
        const raw = await channel.get(sourceName, { noAck: false })
        if (!raw) break
        if (this.normalize(resourceKey(source), raw).id === messageId) {
          found = raw
          break
        }
        held.push(raw)
      }
      if (!found) throw new AppError('MESSAGE_NOT_FOUND', `El mensaje ${messageId} ya no esta disponible`)
      channel.sendToQueue(target.name, found.content, {
        ...found.properties,
        headers: { ...found.properties.headers, 'x-dlq-commander-requeued-at': new Date().toISOString() }
      })
      await channel.waitForConfirms()
      channel.ack(found)
    } finally {
      held.forEach((message) => channel.nack(message, false, true))
      await channel.close()
    }
  }

  async close(): Promise<void> {
    if (this.connection) {
      await this.connection.close()
      this.connection = null
    }
    this.inspectionCache.clear()
  }

  private async getConnection(): Promise<ChannelModel> {
    this.connection ??= await connect(this.connectionUrl())
    return this.connection
  }

  private async createChannel() {
    return (await this.getConnection()).createChannel()
  }

  private async createConfirmChannel(): Promise<ConfirmChannel> {
    return (await this.getConnection()).createConfirmChannel()
  }

  private connectionUrl(): string {
    const protocol = this.config.tls ? 'amqps' : 'amqp'
    const username = encodeURIComponent(this.secret.username)
    const password = encodeURIComponent(this.secret.password)
    const vhost = this.config.vhost === '/' ? '%2F' : encodeURIComponent(this.config.vhost.replace(/^\//, ''))
    return `${protocol}://${username}:${password}@${this.config.host}:${this.config.port}/${vhost}`
  }

  private isNamespaceProfile(): boolean {
    return this.config.profileMode === 'namespace'
  }

  private fixedSourceName(): string {
    if (!this.config.sourceQueue) throw new AppError('SOURCE_NOT_FOUND', 'El perfil fijo no tiene una cola de origen')
    return this.config.sourceQueue
  }

  private assertSource(source: BrokerResourceRef): asserts source is Extract<BrokerResourceRef, { kind: 'queue' }> {
    if (source.kind !== 'queue') throw new AppError('SOURCE_NOT_FOUND', 'RabbitMQ solo expone colas')
    if (!this.isNamespaceProfile() && source.name !== this.fixedSourceName()) {
      throw new AppError('SOURCE_NOT_FOUND', `No existe la fuente ${source.name}`)
    }
  }

  private normalize(sourceId: string, message: GetMessage): NormalizedMessage {
    const text = bodyToText(message.content)
    let body: unknown = text
    try {
      body = JSON.parse(text)
    } catch {
      // Text payloads remain text.
    }
    const nativeId = message.properties.messageId
    return {
      id: stableMessageId(
        nativeId,
        body,
        `${String(message.properties.correlationId ?? '')}:${String(message.properties.timestamp ?? '')}`
      ),
      nativeId: nativeId ?? null,
      sourceId,
      body,
      bodyText: bodyToText(body),
      contentType: message.properties.contentType ?? null,
      enqueuedAt: typeof message.properties.timestamp === 'number' ? new Date(message.properties.timestamp).toISOString() : null,
      deadLetterReason: String(message.properties.headers?.['x-death'] ? 'x-death' : 'Dead-lettered'),
      deadLetterDescription: null,
      deliveryCount: message.fields.redelivered ? 1 : 0,
      sizeBytes: message.content.byteLength,
      headers: message.properties.headers ?? {},
      rawHash: hashBody(message.content)
    }
  }
}

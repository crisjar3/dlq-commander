import { connect, type ChannelModel, type ConfirmChannel, type GetMessage } from 'amqplib'
import { z } from 'zod'
import { capabilitiesByBroker, type MessagePage, type NormalizedMessage, type SourceSummary } from '@shared/domain'
import { AppError } from '../core/errors'
import type { BrokerAdapter, ConnectionTestResult } from './BrokerAdapter'
import { bodyToText, hashBody, stableMessageId } from './normalize'

const configSchema = z.object({
  host: z.string().min(1),
  port: z.coerce.number().int().positive().default(5672),
  vhost: z.string().default('/'),
  tls: z.union([z.boolean(), z.string()]).transform((value) => value === true || value === 'true').default(false),
  sourceQueue: z.string().min(1),
  targetQueue: z.string().min(1)
})
const secretSchema = z.object({ username: z.string().min(1), password: z.string() })

export class RabbitMqAdapter implements BrokerAdapter {
  readonly capabilities = capabilitiesByBroker.rabbitmq
  private connection: ChannelModel | null = null

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
    await channel.checkQueue(this.config.sourceQueue)
    await channel.close()
    await connection.close()
    return { ok: true, latencyMs: Math.round(performance.now() - startedAt), message: 'Conexion y DLQ verificadas' }
  }

  async listSources(): Promise<SourceSummary[]> {
    const channel = await this.createChannel()
    try {
      const queue = await channel.checkQueue(this.config.sourceQueue)
      return [
        {
          id: this.config.sourceQueue,
          profileId: this.profileId,
          name: this.config.sourceQueue,
          displayName: this.config.sourceQueue,
          targetName: this.config.targetQueue,
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

  async listMessages(sourceId: string, limit: number): Promise<MessagePage> {
    this.assertSource(sourceId)
    const channel = await this.createChannel()
    const held: GetMessage[] = []
    const items: NormalizedMessage[] = []
    try {
      for (let index = 0; index < limit; index += 1) {
        const raw = await channel.get(sourceId, { noAck: false })
        if (!raw) break
        held.push(raw)
        items.push(this.normalize(sourceId, raw))
      }
    } finally {
      held.forEach((message) => channel.nack(message, false, true))
      await channel.close()
    }
    return {
      items,
      hasMore: items.length === limit,
      inspectedAt: new Date().toISOString(),
      warning: 'RabbitMQ no ofrece peek nativo: la inspeccion usa basic.get y devuelve los mensajes con nack/requeue.'
    }
  }

  async requeueMessage(sourceId: string, targetName: string, messageId: string): Promise<void> {
    this.assertSource(sourceId)
    const channel = await this.createConfirmChannel()
    const held: GetMessage[] = []
    try {
      const queue = await channel.checkQueue(sourceId)
      let found: GetMessage | null = null
      for (let index = 0; index < queue.messageCount; index += 1) {
        const raw = await channel.get(sourceId, { noAck: false })
        if (!raw) break
        if (this.normalize(sourceId, raw).id === messageId) {
          found = raw
          break
        }
        held.push(raw)
      }
      if (!found) throw new AppError('MESSAGE_NOT_FOUND', `El mensaje ${messageId} ya no esta disponible`)
      channel.sendToQueue(targetName, found.content, {
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

  private assertSource(sourceId: string): void {
    if (sourceId !== this.config.sourceQueue) throw new AppError('SOURCE_NOT_FOUND', `No existe la fuente ${sourceId}`)
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

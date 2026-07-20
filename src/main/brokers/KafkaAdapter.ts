import { randomUUID } from 'node:crypto'
import { Kafka, logLevel, type IHeaders, type Producer } from 'kafkajs'
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
import { bodyToText, hashBody } from './normalize'

const configSchema = z.object({
  bootstrapServers: z.string().min(1),
  profileMode: z.enum(['namespace', 'fixed']).optional(),
  dltTopic: z.string().min(1).optional(),
  targetTopic: z.string().min(1).optional(),
  clientId: z.string().min(1).default('dlq-commander')
})

interface CachedKafkaRecord {
  key: Buffer | null
  value: Buffer | null
  headers: IHeaders
  timestamp: string
  partition: number
  offset: string
}

export class KafkaAdapter implements BrokerAdapter {
  readonly capabilities = capabilitiesByBroker.kafka
  private readonly config: z.infer<typeof configSchema>
  private readonly kafka: Kafka
  private readonly cache = new Map<string, CachedKafkaRecord>()
  private producer: Producer | null = null
  private producerConnected = false

  constructor(
    private readonly profileId: string,
    rawConfig: Record<string, string | number | boolean>
  ) {
    this.config = configSchema.parse(rawConfig)
    this.kafka = new Kafka({
      brokers: this.config.bootstrapServers.split(',').map((broker) => broker.trim()).filter(Boolean),
      clientId: this.config.clientId,
      connectionTimeout: 5_000,
      requestTimeout: 10_000,
      logLevel: logLevel.ERROR
    })
  }

  async testConnection(): Promise<ConnectionTestResult> {
    const startedAt = performance.now()
    const admin = this.kafka.admin()
    try {
      await admin.connect()
      const topics = await admin.listTopics()
      if (!this.isNamespaceProfile()) {
        const sourceName = this.fixedSourceName()
        const targetName = this.fixedTargetName()
        if (!topics.includes(sourceName)) {
          throw new AppError('KAFKA_TOPIC_NOT_FOUND', `No existe el topic DLT ${sourceName}`)
        }
        if (!topics.includes(targetName)) {
          throw new AppError('KAFKA_TOPIC_NOT_FOUND', `No existe el topic destino ${targetName}`)
        }
      }
      return {
        ok: true,
        latencyMs: Math.round(performance.now() - startedAt),
        message: 'Broker y topics verificados'
      }
    } finally {
      await admin.disconnect()
    }
  }

  async listSources(): Promise<SourceSummary[]> {
    if (this.isNamespaceProfile()) return []
    const sourceName = this.fixedSourceName()
    const depth = await this.topicDepth(sourceName)
    return [{
      id: resourceKey({ kind: 'topic', name: sourceName }),
      resource: { kind: 'topic', name: sourceName },
      profileId: this.profileId,
      name: sourceName,
      displayName: `${sourceName} / DLT`,
      targetName: this.config.targetTopic ?? null,
      depth,
      brokerType: 'kafka',
      status: depth > 0 ? 'warning' : 'healthy',
      oldestMessageAt: null,
      capabilities: this.capabilities
    }]
  }

  async listMessages(source: BrokerResourceRef, limit: number): Promise<MessagePage> {
    this.assertSource(source)
    const sourceName = source.name
    const depth = await this.topicDepth(sourceName)
    const expectedCount = Math.min(depth, limit)
    if (expectedCount === 0) {
      return {
        items: [],
        hasMore: false,
        inspectedAt: new Date().toISOString(),
        warning: 'Kafka es append-only: requeue publica una copia al topic destino y conserva el registro original en el DLT.'
      }
    }
    const consumer = this.kafka.consumer({
      groupId: `${this.config.clientId}-inspect-${randomUUID()}`,
      sessionTimeout: 6_000,
      maxWaitTimeInMs: 250
    })
    const items: NormalizedMessage[] = []
    let reachedLimit: (() => void) | null = null
    const complete = new Promise<void>((resolve) => { reachedLimit = resolve })

    try {
      await consumer.connect()
      await consumer.subscribe({ topics: [sourceName], fromBeginning: true })
      await consumer.run({
        autoCommit: false,
        partitionsConsumedConcurrently: 3,
        eachMessage: async ({ topic, partition, message }) => {
          if (items.length >= limit) return
          const id = this.messageId(topic, partition, message.offset)
          const record: CachedKafkaRecord = {
            key: message.key,
            value: message.value,
            headers: message.headers ?? {},
            timestamp: message.timestamp,
            partition,
            offset: message.offset
          }
          this.cache.set(id, record)
          items.push(this.normalize(topic, record))
          if (items.length >= expectedCount) reachedLimit?.()
        }
      })
      await Promise.race([complete, this.delay(10_000)])
    } finally {
      await consumer.stop().catch(() => undefined)
      await consumer.disconnect().catch(() => undefined)
    }

    items.sort((left, right) => {
      const leftRecord = this.cache.get(left.id)
      const rightRecord = this.cache.get(right.id)
      if (!leftRecord || !rightRecord) return 0
      return leftRecord.partition - rightRecord.partition || Number(BigInt(leftRecord.offset) - BigInt(rightRecord.offset))
    })
    return {
      items: items.slice(0, limit),
      hasMore: depth > limit,
      inspectedAt: new Date().toISOString(),
      warning: 'Kafka es append-only: requeue publica una copia al topic destino y conserva el registro original en el DLT.'
    }
  }

  async getMessageSnapshots(source: BrokerResourceRef, messageIds: string[]): Promise<NormalizedMessage[]> {
    this.assertSource(source)
    const missing = messageIds.filter((id) => !this.cache.has(id))
    if (missing.length > 0) await this.listMessages(source, 500)
    return messageIds.flatMap((id) => {
      const record = this.cache.get(id)
      return record ? [this.normalize(source.name, record)] : []
    })
  }

  async requeueMessage(source: BrokerResourceRef, target: TargetResourceRef, messageId: string): Promise<void> {
    this.assertSource(source)
    if (target.kind !== 'topic') throw new AppError('TARGET_NOT_FOUND', 'Kafka solo permite topics como destino')
    let record = this.cache.get(messageId)
    if (!record) {
      await this.listMessages(source, 500)
      record = this.cache.get(messageId)
    }
    if (!record) throw new AppError('MESSAGE_NOT_FOUND', `No se encontro el registro Kafka ${messageId}`)

    this.producer ??= this.kafka.producer({ idempotent: true, allowAutoTopicCreation: false })
    if (!this.producerConnected) {
      await this.producer.connect()
      this.producerConnected = true
    }
    await this.producer.send({
      topic: target.name,
      messages: [{
        key: record.key,
        value: record.value,
        headers: {
          ...record.headers,
          'x-dlq-commander-source-topic': source.name,
          'x-dlq-commander-source-partition': String(record.partition),
          'x-dlq-commander-source-offset': record.offset,
          'x-dlq-commander-requeued-at': new Date().toISOString()
        }
      }]
    })
  }

  async close(): Promise<void> {
    if (this.producer && this.producerConnected) await this.producer.disconnect()
    this.producer = null
    this.producerConnected = false
    this.cache.clear()
  }

  private normalize(topic: string, record: CachedKafkaRecord): NormalizedMessage {
    const text = record.value?.toString('utf8') ?? ''
    let body: unknown = text
    try {
      body = JSON.parse(text)
    } catch {
      // Non-JSON Kafka values remain text.
    }
    return {
      id: this.messageId(topic, record.partition, record.offset),
      nativeId: `${record.partition}:${record.offset}`,
      sourceId: topic,
      body,
      bodyText: bodyToText(body),
      contentType: this.headerValue(record.headers['content-type']),
      enqueuedAt: record.timestamp ? new Date(Number(record.timestamp)).toISOString() : null,
      deadLetterReason: this.headerValue(record.headers['dead-letter-reason']) ?? 'DLT record',
      deadLetterDescription: this.headerValue(record.headers['dead-letter-description']),
      deliveryCount: Number(this.headerValue(record.headers['delivery-count']) ?? 0),
      sizeBytes: record.value?.byteLength ?? 0,
      headers: this.normalizeHeaders(record.headers),
      rawHash: hashBody(record.value ?? '')
    }
  }

  private normalizeHeaders(headers: IHeaders): Record<string, unknown> {
    return Object.fromEntries(Object.entries(headers).map(([key, value]) => [
      key,
      Array.isArray(value) ? value.map((item) => Buffer.isBuffer(item) ? item.toString('utf8') : item) : Buffer.isBuffer(value) ? value.toString('utf8') : value
    ]))
  }

  private headerValue(value: IHeaders[string]): string | null {
    if (Array.isArray(value)) value = value.at(-1)
    if (value === undefined) return null
    return Buffer.isBuffer(value) ? value.toString('utf8') : value
  }

  private messageId(topic: string, partition: number, offset: string): string {
    return `${topic}:${partition}:${offset}`
  }

  private async topicDepth(topic: string): Promise<number> {
    const admin = this.kafka.admin()
    try {
      await admin.connect()
      const offsets = await admin.fetchTopicOffsets(topic)
      return offsets.reduce((total, partition) => {
        const available = BigInt(partition.high) - BigInt(partition.low)
        return total + Number(available > 0n ? available : 0n)
      }, 0)
    } finally {
      await admin.disconnect()
    }
  }

  private isNamespaceProfile(): boolean {
    return this.config.profileMode === 'namespace'
  }

  private fixedSourceName(): string {
    if (!this.config.dltTopic) throw new AppError('SOURCE_NOT_FOUND', 'El perfil fijo no define un topic DLT')
    return this.config.dltTopic
  }

  private fixedTargetName(): string {
    if (!this.config.targetTopic) throw new AppError('TARGET_NOT_FOUND', 'El perfil fijo no define un topic destino')
    return this.config.targetTopic
  }

  private assertSource(source: BrokerResourceRef): asserts source is Extract<BrokerResourceRef, { kind: 'topic' }> {
    if (source.kind !== 'topic') throw new AppError('SOURCE_NOT_FOUND', 'Kafka solo expone topics')
    if (!this.isNamespaceProfile() && source.name !== this.fixedSourceName()) {
      throw new AppError('SOURCE_NOT_FOUND', `No existe la fuente ${source.name}`)
    }
  }

  private async delay(ms: number): Promise<void> {
    await new Promise<void>((resolve) => setTimeout(resolve, ms))
  }
}

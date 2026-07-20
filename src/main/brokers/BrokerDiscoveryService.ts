import { ServiceBusAdministrationClient } from '@azure/service-bus'
import { Kafka, logLevel } from 'kafkajs'
import { z, ZodError } from 'zod'
import {
  brokerDiscoveryInputSchema,
  brokerDiscoveryPageInputSchema,
  discoveredEntitySchema,
  emptyResourceMetrics,
  resourceKey,
  resourcePageResultSchema,
  type BrokerDiscoveryInput,
  type BrokerDiscoveryPageInput,
  type BrokerResourceRef,
  type DiscoveredEntity,
  type DiscoveryResult,
  type ResourceCollection,
  type ResourcePageResult,
  type ValidatedBrokerDiscoveryInput,
  type ValidatedBrokerDiscoveryPageInput
} from '@shared/domain'
import { AppError } from '../core/errors'

const DISCOVERY_TIMEOUT_MS = 15_000
const RESOURCE_CACHE_MS = 60_000

const rabbitQueueSchema = z.object({
  name: z.string().min(1),
  state: z.string().nullable().optional(),
  messages: z.number().int().nonnegative().optional(),
  messages_ready: z.number().int().nonnegative().optional(),
  messages_unacknowledged: z.number().int().nonnegative().optional()
}).passthrough()
const rabbitQueueListSchema = z.array(rabbitQueueSchema)
const rabbitQueuePageSchema = z.object({
  items: rabbitQueueListSchema,
  page: z.number().int().positive().optional(),
  page_size: z.number().int().positive().optional(),
  page_count: z.number().int().nonnegative().optional(),
  total_count: z.number().int().nonnegative().optional(),
  filtered_count: z.number().int().nonnegative().optional(),
  item_count: z.number().int().nonnegative().optional()
}).passthrough()

interface AzurePage<T> extends Array<T> {
  continuationToken?: string
}

interface AzurePagedSource<T> extends AsyncIterable<T> {
  byPage?(settings: { continuationToken?: string; maxPageSize?: number }): AsyncIterable<AzurePage<T>>
}

interface AzureQueueRuntime {
  name: string
  totalMessageCount?: number
  activeMessageCount?: number
  deadLetterMessageCount: number
  scheduledMessageCount?: number
  sizeInBytes?: number
}

interface AzureTopicRuntime {
  name: string
  subscriptionCount?: number
  scheduledMessageCount?: number
  sizeInBytes?: number
}

interface AzureSubscriptionRuntime {
  subscriptionName: string
  topicName: string
  totalMessageCount?: number
  activeMessageCount?: number
  deadLetterMessageCount: number
}

interface AzureAdministrationClient {
  listQueuesRuntimeProperties(options?: { abortSignal?: AbortSignal }): AzurePagedSource<AzureQueueRuntime>
  listTopicsRuntimeProperties(options?: { abortSignal?: AbortSignal }): AzurePagedSource<AzureTopicRuntime>
  listSubscriptionsRuntimeProperties(topicName: string, options?: { abortSignal?: AbortSignal }): AzurePagedSource<AzureSubscriptionRuntime>
}

interface KafkaAdministrationClient {
  connect(): Promise<void>
  listTopics(): Promise<string[]>
  disconnect(): Promise<void>
}

interface KafkaClient {
  admin(): KafkaAdministrationClient
}

interface DiscoveryDependencies {
  fetch: typeof globalThis.fetch
  timeoutMs: number
  createAzureAdministrationClient(connectionString: string): AzureAdministrationClient
  createKafkaClient(bootstrapServers: string[], clientId: string): KafkaClient
}

interface CursorPayload {
  version: 1
  brokerType: ValidatedBrokerDiscoveryInput['brokerType']
  collection: string
  position: string
}

interface KafkaCatalog {
  expiresAt: number
  topics: string[]
}

type RabbitPageInput = {
  connection: Extract<ValidatedBrokerDiscoveryInput, { brokerType: 'rabbitmq' }>
  request: ValidatedBrokerDiscoveryPageInput['request']
}
type AzurePageInput = {
  connection: Extract<ValidatedBrokerDiscoveryInput, { brokerType: 'azure-service-bus' }>
  request: ValidatedBrokerDiscoveryPageInput['request']
}
type KafkaPageInput = {
  connection: Extract<ValidatedBrokerDiscoveryInput, { brokerType: 'kafka' }>
  request: ValidatedBrokerDiscoveryPageInput['request']
}

const defaultDependencies: DiscoveryDependencies = {
  fetch: globalThis.fetch,
  timeoutMs: DISCOVERY_TIMEOUT_MS,
  createAzureAdministrationClient: (connectionString) => new ServiceBusAdministrationClient(connectionString),
  createKafkaClient: (bootstrapServers, clientId) => new Kafka({
    brokers: bootstrapServers,
    clientId,
    connectionTimeout: 5_000,
    requestTimeout: 10_000,
    logLevel: logLevel.ERROR
  })
}

export class BrokerDiscoveryService {
  private readonly dependencies: DiscoveryDependencies
  private readonly kafkaCatalogs = new Map<string, KafkaCatalog>()

  constructor(dependencies: Partial<DiscoveryDependencies> = {}) {
    this.dependencies = { ...defaultDependencies, ...dependencies }
  }

  async discover(input: BrokerDiscoveryInput): Promise<DiscoveryResult> {
    const connection = brokerDiscoveryInputSchema.parse(input)
    const startedAt = performance.now()
    try {
      const collections = collectionsForConnection(connection)
      const pages = await Promise.all(collections.map((collection) => this.collectAll(connection, collection)))
      const byKey = new Map<string, DiscoveredEntity>()
      for (const entities of pages) {
        for (const entity of entities) byKey.set(entity.key, entity)
      }
      return {
        entities: sortDiscoveredEntities([...byKey.values()]),
        latencyMs: Math.max(0, Math.round(performance.now() - startedAt))
      }
    } catch (error) {
      throw this.normalizeError(error, connection.brokerType)
    }
  }

  async discoverPage(input: BrokerDiscoveryPageInput): Promise<ResourcePageResult> {
    const validated = brokerDiscoveryPageInputSchema.parse(input)
    const startedAt = performance.now()
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.dependencies.timeoutMs)

    try {
      const page = await this.withTimeout(this.discoverBrokerPage(validated, controller.signal), controller.signal)
      const parsed = resourcePageResultSchema.parse({
        ...page,
        entities: sortDiscoveredEntities(discoveredEntitySchema.array().parse(page.entities)),
        latencyMs: Math.max(0, Math.round(performance.now() - startedAt))
      })
      if (validated.request.cursor && parsed.nextCursor === validated.request.cursor) {
        throw new AppError('RESOURCE_CURSOR_INVALID', 'El broker devolvio un cursor repetido')
      }
      return parsed
    } catch (error) {
      throw this.normalizeError(error, validated.connection.brokerType)
    } finally {
      clearTimeout(timeout)
    }
  }

  private async collectAll(
    connection: ValidatedBrokerDiscoveryInput,
    collection: ResourceCollection
  ): Promise<DiscoveredEntity[]> {
    const entities = new Map<string, DiscoveredEntity>()
    const seenCursors = new Set<string>()
    let cursor: string | null = null
    let force = false
    do {
      const page = await this.discoverPage({
        connection,
        request: { collection, cursor, pageSize: 50, force }
      })
      for (const entity of page.entities) entities.set(entity.key, entity)
      cursor = page.nextCursor
      force = false
      if (cursor && seenCursors.has(cursor)) {
        throw new AppError('RESOURCE_CURSOR_INVALID', 'El broker devolvio un cursor repetido')
      }
      if (cursor) seenCursors.add(cursor)
    } while (cursor)
    return [...entities.values()]
  }

  private async discoverBrokerPage(
    input: ValidatedBrokerDiscoveryPageInput,
    signal: AbortSignal
  ): Promise<Omit<ResourcePageResult, 'latencyMs'>> {
    const { connection, request } = input
    if (connection.brokerType === 'rabbitmq') return this.discoverRabbitMqPage({ connection, request }, signal)
    if (connection.brokerType === 'azure-service-bus') return this.discoverAzurePage({ connection, request }, signal)
    return this.discoverKafkaPage({ connection, request })
  }

  private async discoverRabbitMqPage(
    input: RabbitPageInput,
    signal: AbortSignal
  ): Promise<Omit<ResourcePageResult, 'latencyMs'>> {
    const connection = input.connection
    const collectionKey = resourceCollectionKey(input.request.collection)
    const page = input.request.cursor
      ? parsePositiveIntegerCursor(input.request.cursor, connection.brokerType, collectionKey)
      : 1
    const managementUrl = connection.configuration.managementUrl
      ? normalizeManagementUrl(connection.configuration.managementUrl)
      : deriveRabbitManagementUrl(connection.configuration.host, connection.configuration.tls)
    const url = new URL(`${managementUrl}/api/queues/${encodeURIComponent(connection.configuration.vhost)}`)
    if (url.username || url.password) {
      throw new AppError('DISCOVERY_UNAVAILABLE', 'La URL de Management API no debe incluir credenciales')
    }
    url.searchParams.set('pagination', 'true')
    url.searchParams.set('page', String(page))
    url.searchParams.set('page_size', String(input.request.pageSize))
    url.searchParams.set('disable_stats', 'true')
    url.searchParams.set('enable_queue_totals', 'true')

    const authorization = Buffer.from(`${connection.secret.username}:${connection.secret.password}`, 'utf8').toString('base64')
    const response = await this.dependencies.fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: `Basic ${authorization}` },
      signal
    })
    if (response.status === 401 || response.status === 403) {
      throw new AppError('DISCOVERY_PERMISSION_DENIED', 'Las credenciales no pueden consultar las colas de RabbitMQ')
    }
    if (response.status === 404) {
      throw new AppError('RABBIT_MANAGEMENT_NOT_FOUND', 'No se encontro la Management API de RabbitMQ en la URL configurada')
    }
    if (!response.ok) throw new AppError('DISCOVERY_UNAVAILABLE', 'RabbitMQ Management API no esta disponible')

    let payload: unknown
    try {
      payload = await response.json()
    } catch {
      throw new AppError('DISCOVERY_INVALID_RESPONSE', 'RabbitMQ devolvio una respuesta que no es JSON valido')
    }

    const parsed = z.union([rabbitQueuePageSchema, rabbitQueueListSchema]).parse(payload)
    const queues = Array.isArray(parsed) ? parsed : parsed.items
    const totalCount = Array.isArray(parsed)
      ? queues.length
      : parsed.filtered_count ?? parsed.total_count ?? parsed.item_count ?? null
    const hasNext = Array.isArray(parsed)
      ? false
      : parsed.page_count !== undefined
        ? page < parsed.page_count
        : totalCount !== null && page * input.request.pageSize < totalCount
    return {
      entities: queues.map((queue) => rabbitEntity(queue)),
      nextCursor: hasNext ? encodeCursor(connection.brokerType, collectionKey, String(page + 1)) : null,
      totalCount
    }
  }

  private async discoverAzurePage(
    input: AzurePageInput,
    signal: AbortSignal
  ): Promise<Omit<ResourcePageResult, 'latencyMs'>> {
    const { connection, request } = input
    const collectionKey = resourceCollectionKey(request.collection)
    const continuationToken = request.cursor
      ? decodeCursor(request.cursor, connection.brokerType, collectionKey).position
      : undefined
    const client = this.dependencies.createAzureAdministrationClient(connection.secret.connectionString)

    if (request.collection.kind === 'queues') {
      const page = await readAzurePage(client.listQueuesRuntimeProperties({ abortSignal: signal }), continuationToken, request.pageSize)
      return azurePageResult(page, connection.brokerType, collectionKey, azureQueueEntity)
    }
    if (request.collection.kind === 'topics') {
      const page = await readAzurePage(client.listTopicsRuntimeProperties({ abortSignal: signal }), continuationToken, request.pageSize)
      return azurePageResult(page, connection.brokerType, collectionKey, azureTopicEntity)
    }
    const page = await readAzurePage(
      client.listSubscriptionsRuntimeProperties(request.collection.topicName, { abortSignal: signal }),
      continuationToken,
      request.pageSize
    )
    return azurePageResult(page, connection.brokerType, collectionKey, (subscription) =>
      azureSubscriptionEntity(subscription, request.collection.kind === 'subscriptions' ? request.collection.topicName : subscription.topicName)
    )
  }

  private async discoverKafkaPage(
    input: KafkaPageInput
  ): Promise<Omit<ResourcePageResult, 'latencyMs'>> {
    const { connection, request } = input
    const brokers = connection.configuration.bootstrapServers.split(',').map((value) => value.trim()).filter(Boolean)
    if (brokers.length === 0) throw new AppError('DISCOVERY_UNAVAILABLE', 'Agrega al menos un bootstrap server de Kafka')
    const cacheKey = `${brokers.join(',')}\u0000${connection.configuration.clientId}`
    if (request.force) this.kafkaCatalogs.delete(cacheKey)
    let catalog = this.kafkaCatalogs.get(cacheKey)
    if (!catalog || catalog.expiresAt <= Date.now()) {
      const admin = this.dependencies.createKafkaClient(brokers, connection.configuration.clientId).admin()
      try {
        await admin.connect()
        const topics = await admin.listTopics()
        catalog = {
          expiresAt: Date.now() + RESOURCE_CACHE_MS,
          topics: topics.filter((topic) => !topic.startsWith('__')).sort(naturalCompare)
        }
        this.kafkaCatalogs.set(cacheKey, catalog)
      } finally {
        await admin.disconnect().catch(() => undefined)
      }
    }

    const collectionKey = resourceCollectionKey(request.collection)
    const offset = request.cursor
      ? parseNonNegativeIntegerCursor(request.cursor, connection.brokerType, collectionKey)
      : 0
    if (offset > catalog.topics.length) throw new AppError('RESOURCE_CURSOR_INVALID', 'El cursor de recursos ya no es valido')
    const topics = catalog.topics.slice(offset, offset + request.pageSize)
    const nextOffset = offset + topics.length
    return {
      entities: topics.map(kafkaEntity),
      nextCursor: nextOffset < catalog.topics.length
        ? encodeCursor(connection.brokerType, collectionKey, String(nextOffset))
        : null,
      totalCount: catalog.topics.length
    }
  }

  private async withTimeout<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
    return Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          reject(new AppError('DISCOVERY_UNAVAILABLE', 'La pagina excedio el tiempo limite de 15 segundos'))
        }, { once: true })
      })
    ])
  }

  private normalizeError(error: unknown, brokerType: ValidatedBrokerDiscoveryInput['brokerType']): AppError {
    if (error instanceof AppError) return error
    if (error instanceof ZodError) {
      return new AppError('DISCOVERY_INVALID_RESPONSE', 'El broker devolvio una respuesta de descubrimiento invalida')
    }
    const statusCode = readNumberProperty(error, 'statusCode')
    const kafkaCode = readNumberProperty(error, 'code')
    const errorType = readStringProperty(error, 'type')
    if (statusCode === 401 || statusCode === 403 || kafkaCode === 29 || kafkaCode === 30 || errorType.includes('AUTHORIZATION')) {
      return new AppError('DISCOVERY_PERMISSION_DENIED', `Las credenciales no pueden listar recursos de ${brokerLabel(brokerType)}`)
    }
    return new AppError('DISCOVERY_UNAVAILABLE', `No fue posible consultar los recursos de ${brokerLabel(brokerType)}`)
  }
}

interface ReadAzurePageResult<T> {
  items: T[]
  continuationToken: string | null
  totalCount: number | null
}

async function readAzurePage<T>(
  source: AzurePagedSource<T>,
  continuationToken: string | undefined,
  pageSize: number
): Promise<ReadAzurePageResult<T>> {
  if (source.byPage) {
    const iterator = source.byPage({ continuationToken, maxPageSize: pageSize })[Symbol.asyncIterator]()
    const next = await iterator.next()
    if (next.done || !next.value) return { items: [], continuationToken: null, totalCount: null }
    return {
      items: [...next.value],
      continuationToken: next.value.continuationToken ?? null,
      totalCount: null
    }
  }

  const all: T[] = []
  for await (const value of source) all.push(value)
  const offset = continuationToken ? Number(continuationToken) : 0
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > all.length) {
    throw new AppError('RESOURCE_CURSOR_INVALID', 'El cursor de Azure Service Bus no es valido')
  }
  const items = all.slice(offset, offset + pageSize)
  const nextOffset = offset + items.length
  return { items, continuationToken: nextOffset < all.length ? String(nextOffset) : null, totalCount: all.length }
}

function azurePageResult<T>(
  page: ReadAzurePageResult<T>,
  brokerType: 'azure-service-bus',
  collectionKey: string,
  map: (item: T) => DiscoveredEntity
): Omit<ResourcePageResult, 'latencyMs'> {
  return {
    entities: page.items.map(map),
    nextCursor: page.continuationToken ? encodeCursor(brokerType, collectionKey, page.continuationToken) : null,
    totalCount: page.totalCount
  }
}

function rabbitEntity(queue: z.infer<typeof rabbitQueueSchema>): DiscoveredEntity {
  const total = queue.messages ?? null
  return {
    key: resourceKey({ kind: 'queue', name: queue.name }),
    name: queue.name,
    kind: 'queue',
    parent: null,
    messageCount: total,
    childCount: null,
    canInspect: true,
    canTarget: true,
    suggestedSource: (total ?? 0) > 0 || isDeadLetterName(queue.name),
    status: queue.state ?? null,
    metrics: {
      ...emptyResourceMetrics(),
      totalMessages: total,
      readyMessages: queue.messages_ready ?? null,
      unacknowledgedMessages: queue.messages_unacknowledged ?? null
    }
  }
}

function azureQueueEntity(queue: AzureQueueRuntime): DiscoveredEntity {
  return {
    key: resourceKey({ kind: 'queue', name: queue.name }),
    name: queue.name,
    kind: 'queue',
    parent: null,
    messageCount: queue.deadLetterMessageCount,
    childCount: null,
    canInspect: true,
    canTarget: true,
    suggestedSource: queue.deadLetterMessageCount > 0 || isDeadLetterName(queue.name),
    status: null,
    metrics: {
      ...emptyResourceMetrics(),
      totalMessages: queue.totalMessageCount ?? null,
      activeMessages: queue.activeMessageCount ?? null,
      deadLetterMessages: queue.deadLetterMessageCount,
      scheduledMessages: queue.scheduledMessageCount ?? null,
      sizeBytes: queue.sizeInBytes ?? null
    }
  }
}

function azureTopicEntity(topic: AzureTopicRuntime): DiscoveredEntity {
  return {
    key: resourceKey({ kind: 'topic', name: topic.name }),
    name: topic.name,
    kind: 'topic',
    parent: null,
    messageCount: null,
    childCount: topic.subscriptionCount ?? 0,
    canInspect: false,
    canTarget: true,
    suggestedSource: false,
    status: null,
    metrics: {
      ...emptyResourceMetrics(),
      scheduledMessages: topic.scheduledMessageCount ?? null,
      sizeBytes: topic.sizeInBytes ?? null,
      subscriptionCount: topic.subscriptionCount ?? 0
    }
  }
}

function azureSubscriptionEntity(subscription: AzureSubscriptionRuntime, topicName: string): DiscoveredEntity {
  const ref: BrokerResourceRef = { kind: 'subscription', topicName, name: subscription.subscriptionName }
  return {
    key: resourceKey(ref),
    name: subscription.subscriptionName,
    kind: 'subscription',
    parent: { kind: 'topic', name: topicName },
    messageCount: subscription.deadLetterMessageCount,
    childCount: null,
    canInspect: true,
    canTarget: false,
    suggestedSource: subscription.deadLetterMessageCount > 0 || isDeadLetterName(subscription.subscriptionName),
    status: null,
    metrics: {
      ...emptyResourceMetrics(),
      totalMessages: subscription.totalMessageCount ?? null,
      activeMessages: subscription.activeMessageCount ?? null,
      deadLetterMessages: subscription.deadLetterMessageCount
    }
  }
}

function kafkaEntity(topic: string): DiscoveredEntity {
  return {
    key: resourceKey({ kind: 'topic', name: topic }),
    name: topic,
    kind: 'topic',
    parent: null,
    messageCount: null,
    childCount: null,
    canInspect: true,
    canTarget: true,
    suggestedSource: isDeadLetterName(topic),
    status: null,
    metrics: emptyResourceMetrics()
  }
}

function collectionsForConnection(input: ValidatedBrokerDiscoveryInput): ResourceCollection[] {
  if (input.brokerType === 'rabbitmq') return [{ kind: 'queues' }]
  if (input.brokerType === 'kafka') return [{ kind: 'topics' }]
  if (input.scope.kind === 'topic') return [{ kind: 'subscriptions', topicName: input.scope.topicName }]
  return [{ kind: 'queues' }, { kind: 'topics' }]
}

function resourceCollectionKey(collection: ResourceCollection): string {
  return collection.kind === 'subscriptions'
    ? `subscriptions:${encodeURIComponent(collection.topicName)}`
    : collection.kind
}

function encodeCursor(
  brokerType: ValidatedBrokerDiscoveryInput['brokerType'],
  collection: string,
  position: string
): string {
  const payload: CursorPayload = { version: 1, brokerType, collection, position }
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
}

function decodeCursor(
  cursor: string,
  brokerType: ValidatedBrokerDiscoveryInput['brokerType'],
  collection: string
): CursorPayload {
  try {
    const payload = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as Partial<CursorPayload>
    if (
      payload.version !== 1 || payload.brokerType !== brokerType || payload.collection !== collection ||
      typeof payload.position !== 'string' || payload.position.length === 0
    ) throw new Error('cursor binding mismatch')
    return payload as CursorPayload
  } catch {
    throw new AppError('RESOURCE_CURSOR_INVALID', 'El cursor no pertenece a este broker o coleccion')
  }
}

function parsePositiveIntegerCursor(cursor: string, brokerType: CursorPayload['brokerType'], collection: string): number {
  const value = Number(decodeCursor(cursor, brokerType, collection).position)
  if (!Number.isSafeInteger(value) || value < 1) throw new AppError('RESOURCE_CURSOR_INVALID', 'El cursor de pagina no es valido')
  return value
}

function parseNonNegativeIntegerCursor(cursor: string, brokerType: CursorPayload['brokerType'], collection: string): number {
  const value = Number(decodeCursor(cursor, brokerType, collection).position)
  if (!Number.isSafeInteger(value) || value < 0) throw new AppError('RESOURCE_CURSOR_INVALID', 'El cursor de pagina no es valido')
  return value
}

export function deriveRabbitManagementUrl(host: string, tls: boolean): string {
  const normalizedHost = host.trim().replace(/^https?:\/\//i, '').replace(/\/$/, '')
  return `${tls ? 'https' : 'http'}://${normalizedHost}:${tls ? 15671 : 15672}`
}

export function normalizeManagementUrl(value: string): string {
  const url = new URL(value.trim())
  url.search = ''
  url.hash = ''
  url.pathname = url.pathname.replace(/\/+$/, '')
  return url.toString().replace(/\/$/, '')
}

export function sortDiscoveredEntities(entities: DiscoveredEntity[]): DiscoveredEntity[] {
  return [...entities].sort((left, right) => naturalCompare(left.name, right.name))
}

function naturalCompare(left: string, right: string): number {
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' })
}

function isDeadLetterName(name: string): boolean {
  return /(^|[._-])(dlq|dlt|dead[._-]?letter)([._-]|$)/i.test(name)
}

function brokerLabel(brokerType: ValidatedBrokerDiscoveryInput['brokerType']): string {
  if (brokerType === 'azure-service-bus') return 'Azure Service Bus'
  if (brokerType === 'rabbitmq') return 'RabbitMQ'
  return 'Kafka'
}

function readNumberProperty(value: unknown, key: string): number | undefined {
  if (!value || typeof value !== 'object' || !(key in value)) return undefined
  const candidate = (value as Record<string, unknown>)[key]
  return typeof candidate === 'number' ? candidate : undefined
}

function readStringProperty(value: unknown, key: string): string {
  if (!value || typeof value !== 'object' || !(key in value)) return ''
  const candidate = (value as Record<string, unknown>)[key]
  return typeof candidate === 'string' ? candidate.toUpperCase() : ''
}

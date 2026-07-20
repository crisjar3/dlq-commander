import { ServiceBusAdministrationClient } from '@azure/service-bus'
import { Kafka, logLevel } from 'kafkajs'
import { z, ZodError } from 'zod'
import { discoveredEntitySchema, type BrokerDiscoveryInput, type DiscoveredEntity, type DiscoveryResult } from '@shared/domain'
import { AppError } from '../core/errors'

const DISCOVERY_TIMEOUT_MS = 15_000
const rabbitQueueListSchema = z.array(z.object({
  name: z.string().min(1),
  messages: z.number().int().nonnegative()
}).passthrough())

interface AzureAdministrationClient {
  listQueuesRuntimeProperties(options?: { abortSignal?: AbortSignal }): AsyncIterable<{
    name: string
    deadLetterMessageCount: number
  }>
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

  constructor(dependencies: Partial<DiscoveryDependencies> = {}) {
    this.dependencies = { ...defaultDependencies, ...dependencies }
  }

  async discover(input: BrokerDiscoveryInput): Promise<DiscoveryResult> {
    const startedAt = performance.now()
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.dependencies.timeoutMs)

    try {
      const entities = discoveredEntitySchema.array().parse(
        await this.withTimeout(this.discoverBroker(input, controller.signal), controller.signal)
      )
      return {
        entities: sortDiscoveredEntities(entities),
        latencyMs: Math.max(0, Math.round(performance.now() - startedAt))
      }
    } catch (error) {
      throw this.normalizeError(error, input.brokerType)
    } finally {
      clearTimeout(timeout)
    }
  }

  private async discoverBroker(input: BrokerDiscoveryInput, signal: AbortSignal): Promise<DiscoveredEntity[]> {
    if (input.brokerType === 'rabbitmq') return this.discoverRabbitMq(input, signal)
    if (input.brokerType === 'azure-service-bus') return this.discoverAzure(input, signal)
    return this.discoverKafka(input)
  }

  private async discoverRabbitMq(
    input: Extract<BrokerDiscoveryInput, { brokerType: 'rabbitmq' }>,
    signal: AbortSignal
  ): Promise<DiscoveredEntity[]> {
    const managementUrl = input.configuration.managementUrl
      ? normalizeManagementUrl(input.configuration.managementUrl)
      : deriveRabbitManagementUrl(input.configuration.host, input.configuration.tls)
    const url = new URL(`${managementUrl}/api/queues/${encodeURIComponent(input.configuration.vhost)}`)
    if (url.username || url.password) {
      throw new AppError('DISCOVERY_UNAVAILABLE', 'La URL de Management API no debe incluir credenciales')
    }

    const authorization = Buffer.from(`${input.secret.username}:${input.secret.password}`, 'utf8').toString('base64')
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
    if (!response.ok) {
      throw new AppError('DISCOVERY_UNAVAILABLE', 'RabbitMQ Management API no esta disponible')
    }

    let payload: unknown
    try {
      payload = await response.json()
    } catch {
      throw new AppError('DISCOVERY_INVALID_RESPONSE', 'RabbitMQ devolvio una respuesta que no es JSON valido')
    }
    const queues = rabbitQueueListSchema.parse(payload)
    return queues.map((queue) => ({
      name: queue.name,
      kind: 'queue',
      messageCount: queue.messages,
      suggestedSource: queue.messages > 0 || isDeadLetterName(queue.name)
    }))
  }

  private async discoverAzure(
    input: Extract<BrokerDiscoveryInput, { brokerType: 'azure-service-bus' }>,
    signal: AbortSignal
  ): Promise<DiscoveredEntity[]> {
    const client = this.dependencies.createAzureAdministrationClient(input.secret.connectionString)
    const entities: DiscoveredEntity[] = []
    for await (const queue of client.listQueuesRuntimeProperties({ abortSignal: signal })) {
      entities.push({
        name: queue.name,
        kind: 'queue',
        messageCount: queue.deadLetterMessageCount,
        suggestedSource: queue.deadLetterMessageCount > 0 || isDeadLetterName(queue.name)
      })
    }
    return entities
  }

  private async discoverKafka(
    input: Extract<BrokerDiscoveryInput, { brokerType: 'kafka' }>
  ): Promise<DiscoveredEntity[]> {
    const brokers = input.configuration.bootstrapServers.split(',').map((value) => value.trim()).filter(Boolean)
    if (brokers.length === 0) throw new AppError('DISCOVERY_UNAVAILABLE', 'Agrega al menos un bootstrap server de Kafka')
    const admin = this.dependencies.createKafkaClient(brokers, input.configuration.clientId).admin()
    try {
      await admin.connect()
      const topics = await admin.listTopics()
      return topics.filter((topic) => !topic.startsWith('__')).map((topic) => ({
        name: topic,
        kind: 'topic',
        messageCount: null,
        suggestedSource: isDeadLetterName(topic)
      }))
    } finally {
      await admin.disconnect().catch(() => undefined)
    }
  }

  private async withTimeout<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
    return Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          reject(new AppError('DISCOVERY_UNAVAILABLE', 'La busqueda excedio el tiempo limite de 15 segundos'))
        }, { once: true })
      })
    ])
  }

  private normalizeError(error: unknown, brokerType: BrokerDiscoveryInput['brokerType']): AppError {
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
  return [...entities].sort((left, right) => {
    if (left.suggestedSource !== right.suggestedSource) return left.suggestedSource ? -1 : 1
    return left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: 'base' })
  })
}

function isDeadLetterName(name: string): boolean {
  return /(^|[._-])(dlq|dlt|dead[._-]?letter)([._-]|$)/i.test(name)
}

function brokerLabel(brokerType: BrokerDiscoveryInput['brokerType']): string {
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

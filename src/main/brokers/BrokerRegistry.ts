import {
  brokerDiscoveryInputSchema,
  emptyResourceMetrics,
  resourceKey,
  resourcePageRequestSchema,
  type BrokerDiscoveryInput,
  type BrokerResourceRef,
  type ConnectionProfile,
  type DiscoveredEntity,
  type DiscoveryResult,
  type ResourceScope,
  type ResourceCollection,
  type ResourcePageRequest,
  type ResourcePageResult,
  type TargetResourceRef
} from '@shared/domain'
import type { BrokerAdapter, ConnectionTestResult } from './BrokerAdapter'
import type { ProfileRepository } from '../persistence/ProfileRepository'
import { DemoAdapter } from './DemoAdapter'
import { RabbitMqAdapter } from './RabbitMqAdapter'
import { AzureServiceBusAdapter } from './AzureServiceBusAdapter'
import { KafkaAdapter } from './KafkaAdapter'
import { BrokerDiscoveryService, sortDiscoveredEntities } from './BrokerDiscoveryService'
import { AppError } from '../core/errors'

const RESOURCE_CACHE_MS = 60_000

interface CachedResources {
  expiresAt: number
  result: ResourcePageResult
}

export class BrokerRegistry {
  private readonly adapters = new Map<string, BrokerAdapter>()
  private readonly resources = new Map<string, CachedResources>()

  constructor(
    private readonly profiles: ProfileRepository,
    private readonly discovery: BrokerDiscoveryService
  ) {}

  get(profileId: string): BrokerAdapter {
    const cached = this.adapters.get(profileId)
    if (cached) return cached
    const { profile, secret } = this.profiles.getWithSecret(profileId)
    let adapter: BrokerAdapter
    switch (profile.brokerType) {
      case 'demo':
        adapter = new DemoAdapter(profile.id)
        break
      case 'rabbitmq':
        adapter = new RabbitMqAdapter(profile.id, profile.configuration, secret)
        break
      case 'azure-service-bus':
        adapter = new AzureServiceBusAdapter(profile.id, profile.configuration, secret)
        break
      case 'kafka':
        adapter = new KafkaAdapter(profile.id, profile.configuration)
        break
    }
    this.adapters.set(profileId, adapter)
    return adapter
  }

  async test(profileId: string): Promise<ConnectionTestResult> {
    const adapterResult = await this.get(profileId).testConnection()
    const profile = this.profiles.get(profileId)
    if (profile.configuration['profileMode'] === 'namespace') await this.listResources(profileId, { kind: 'root' }, true)
    return adapterResult
  }

  async listResources(profileId: string, scope: ResourceScope, force = false): Promise<DiscoveryResult> {
    const profile = this.profiles.get(profileId)
    if (profile.brokerType !== 'demo' && profile.configuration['profileMode'] !== 'namespace') {
      return { entities: this.fixedResources(profile), latencyMs: 0 }
    }
    const collections = collectionsForProfile(profile, scope)
    const startedAt = performance.now()
    const groups = await Promise.all(collections.map((collection) => this.collectAllPages(profileId, collection, force)))
    const entities = new Map<string, DiscoveredEntity>()
    for (const group of groups) for (const entity of group) entities.set(entity.key, entity)
    return {
      entities: sortDiscoveredEntities([...entities.values()]),
      latencyMs: Math.max(0, Math.round(performance.now() - startedAt))
    }
  }

  async listResourcePage(profileId: string, rawRequest: ResourcePageRequest): Promise<ResourcePageResult> {
    const request = resourcePageRequestSchema.parse(rawRequest)
    const { profile, secret } = this.profiles.getWithSecret(profileId)
    const collectionKey = resourceCollectionKey(request.collection)
    const cachePrefix = `${profileId}:${collectionKey}:`
    if (request.force) {
      for (const key of this.resources.keys()) if (key.startsWith(cachePrefix)) this.resources.delete(key)
    }
    const cacheKey = `${cachePrefix}${request.pageSize}:${request.cursor ?? 'first'}`
    const cached = this.resources.get(cacheKey)
    if (!request.force && cached && cached.expiresAt > Date.now()) return cached.result

    let result: ResourcePageResult
    if (profile.brokerType === 'demo') {
      result = await this.demoResourcePage(profileId, profile, request)
    } else if (profile.configuration['profileMode'] !== 'namespace') {
      result = this.memoryPage(profile, this.fixedResources(profile), request)
    } else {
      const scope: ResourceScope = request.collection.kind === 'subscriptions'
        ? { kind: 'topic', topicName: request.collection.topicName }
        : { kind: 'root' }
      result = await this.discovery.discoverPage({
        connection: this.discoveryInput(profile, secret, scope),
        request
      })
    }
    this.resources.set(cacheKey, { result, expiresAt: Date.now() + RESOURCE_CACHE_MS })
    return result
  }

  async invalidate(profileId: string): Promise<void> {
    const adapter = this.adapters.get(profileId)
    this.adapters.delete(profileId)
    if (adapter) await adapter.close()
    for (const key of this.resources.keys()) {
      if (key.startsWith(`${profileId}:`)) this.resources.delete(key)
    }
  }

  async closeAll(): Promise<void> {
    await Promise.allSettled([...this.adapters.values()].map((adapter) => adapter.close()))
    this.adapters.clear()
    this.resources.clear()
  }

  private discoveryInput(
    profile: ConnectionProfile,
    secret: Record<string, string>,
    scope: ResourceScope
  ): BrokerDiscoveryInput {
    const config = profile.configuration
    if (profile.brokerType === 'rabbitmq') {
      return brokerDiscoveryInputSchema.parse({
        brokerType: 'rabbitmq',
        scope,
        configuration: {
          host: config['host'],
          port: config['port'],
          vhost: config['vhost'],
          tls: config['tls'],
          ...(typeof config['managementUrl'] === 'string' ? { managementUrl: config['managementUrl'] } : {})
        },
        secret
      })
    }
    if (profile.brokerType === 'azure-service-bus') {
      return brokerDiscoveryInputSchema.parse({ brokerType: 'azure-service-bus', scope, configuration: {}, secret })
    }
    return brokerDiscoveryInputSchema.parse({
      brokerType: 'kafka',
      scope,
      configuration: { bootstrapServers: config['bootstrapServers'], clientId: config['clientId'] },
      secret: {}
    })
  }

  private async collectAllPages(
    profileId: string,
    collection: ResourceCollection,
    force: boolean
  ): Promise<DiscoveredEntity[]> {
    const entities = new Map<string, DiscoveredEntity>()
    const seen = new Set<string>()
    let cursor: string | null = null
    do {
      const page = await this.listResourcePage(profileId, { collection, cursor, pageSize: 50, force })
      force = false
      for (const entity of page.entities) entities.set(entity.key, entity)
      cursor = page.nextCursor
      if (cursor && seen.has(cursor)) throw new AppError('RESOURCE_CURSOR_INVALID', 'El broker devolvio un cursor repetido')
      if (cursor) seen.add(cursor)
    } while (cursor)
    return [...entities.values()]
  }

  private async demoResourcePage(
    profileId: string,
    profile: ConnectionProfile,
    request: ResourcePageRequest
  ): Promise<ResourcePageResult> {
    const sources = await this.get(profileId).listSources()
    const entities = new Map<string, DiscoveredEntity>()
    for (const source of sources) {
      entities.set(source.id, {
        key: source.id,
        name: source.resource.name,
        kind: source.resource.kind,
        parent: source.resource.kind === 'subscription' ? { kind: 'topic', name: source.resource.topicName } : null,
        messageCount: source.depth,
        childCount: null,
        canInspect: true,
        canTarget: source.resource.kind !== 'subscription',
        suggestedSource: source.depth > 0,
        status: source.status,
        metrics: { ...emptyResourceMetrics(), totalMessages: source.depth, deadLetterMessages: source.depth }
      })
      if (source.targetName) {
        const target = { kind: 'queue' as const, name: source.targetName }
        if (!entities.has(resourceKey(target))) entities.set(resourceKey(target), fixedEntity(target, false, true))
      }
    }
    return this.memoryPage(profile, [...entities.values()], request)
  }

  private memoryPage(
    profile: ConnectionProfile,
    allEntities: DiscoveredEntity[],
    request: ResourcePageRequest
  ): ResourcePageResult {
    const filtered = sortDiscoveredEntities(allEntities.filter((entity) => entityMatchesCollection(entity, request.collection)))
    const offset = request.cursor ? decodeMemoryCursor(request.cursor, profile, request.collection) : 0
    if (offset > filtered.length) throw new AppError('RESOURCE_CURSOR_INVALID', 'El cursor de recursos ya no es valido')
    const entities = filtered.slice(offset, offset + request.pageSize)
    const nextOffset = offset + entities.length
    return {
      entities,
      nextCursor: nextOffset < filtered.length ? encodeMemoryCursor(profile, request.collection, nextOffset) : null,
      totalCount: filtered.length,
      latencyMs: 0
    }
  }

  private fixedResources(profile: ConnectionProfile): DiscoveredEntity[] {
    const config = profile.configuration
    let source: BrokerResourceRef | null = null
    let target: TargetResourceRef | null = null
    if (profile.brokerType === 'rabbitmq') {
      if (typeof config['sourceQueue'] === 'string') source = { kind: 'queue', name: config['sourceQueue'] }
      if (typeof config['targetQueue'] === 'string') target = { kind: 'queue', name: config['targetQueue'] }
    } else if (profile.brokerType === 'kafka') {
      if (typeof config['dltTopic'] === 'string') source = { kind: 'topic', name: config['dltTopic'] }
      if (typeof config['targetTopic'] === 'string') target = { kind: 'topic', name: config['targetTopic'] }
    } else if (config['sourceKind'] === 'subscription') {
      if (typeof config['topicName'] === 'string' && typeof config['subscriptionName'] === 'string') {
        source = { kind: 'subscription', topicName: config['topicName'], name: config['subscriptionName'] }
      }
      const targetName = config['targetName']
      if (typeof targetName === 'string') target = { kind: config['targetKind'] === 'topic' ? 'topic' : 'queue', name: targetName }
    } else {
      if (typeof config['queueName'] === 'string') source = { kind: 'queue', name: config['queueName'] }
      const targetName = config['targetName'] ?? config['targetQueue']
      if (typeof targetName === 'string') target = { kind: config['targetKind'] === 'topic' ? 'topic' : 'queue', name: targetName }
    }

    const byKey = new Map<string, DiscoveredEntity>()
    if (source) byKey.set(resourceKey(source), fixedEntity(source, true, source.kind !== 'subscription'))
    if (target) {
      const existing = byKey.get(resourceKey(target))
      byKey.set(resourceKey(target), existing ? { ...existing, canTarget: true } : fixedEntity(target, false, true))
    }
    return sortDiscoveredEntities([...byKey.values()])
  }
}

function fixedEntity(resource: BrokerResourceRef, canInspect: boolean, canTarget: boolean): DiscoveredEntity {
  return {
    key: resourceKey(resource),
    name: resource.name,
    kind: resource.kind,
    parent: resource.kind === 'subscription' ? { kind: 'topic', name: resource.topicName } : null,
    messageCount: null,
    childCount: null,
    canInspect,
    canTarget,
    suggestedSource: canInspect,
    status: null,
    metrics: emptyResourceMetrics()
  }
}

function collectionsForProfile(profile: ConnectionProfile, scope: ResourceScope): ResourceCollection[] {
  if (scope.kind === 'topic') return [{ kind: 'subscriptions', topicName: scope.topicName }]
  if (profile.brokerType === 'rabbitmq' || profile.brokerType === 'demo') return [{ kind: 'queues' }]
  if (profile.brokerType === 'kafka') return [{ kind: 'topics' }]
  return [{ kind: 'queues' }, { kind: 'topics' }]
}

function resourceCollectionKey(collection: ResourceCollection): string {
  return collection.kind === 'subscriptions'
    ? `subscriptions:${encodeURIComponent(collection.topicName)}`
    : collection.kind
}

function entityMatchesCollection(entity: DiscoveredEntity, collection: ResourceCollection): boolean {
  if (collection.kind === 'queues') return entity.kind === 'queue'
  if (collection.kind === 'topics') return entity.kind === 'topic'
  return entity.kind === 'subscription' && entity.parent?.name === collection.topicName
}

function encodeMemoryCursor(profile: ConnectionProfile, collection: ResourceCollection, offset: number): string {
  return Buffer.from(JSON.stringify({
    version: 1,
    profileId: profile.id,
    brokerType: profile.brokerType,
    collection: resourceCollectionKey(collection),
    offset
  }), 'utf8').toString('base64url')
}

function decodeMemoryCursor(cursor: string, profile: ConnectionProfile, collection: ResourceCollection): number {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as Record<string, unknown>
    if (
      parsed['version'] !== 1 || parsed['profileId'] !== profile.id || parsed['brokerType'] !== profile.brokerType ||
      parsed['collection'] !== resourceCollectionKey(collection) || !Number.isSafeInteger(parsed['offset']) ||
      (parsed['offset'] as number) < 0
    ) throw new Error('cursor binding mismatch')
    return parsed['offset'] as number
  } catch {
    throw new AppError('RESOURCE_CURSOR_INVALID', 'El cursor no pertenece a este perfil o coleccion')
  }
}

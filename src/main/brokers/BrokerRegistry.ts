import {
  brokerDiscoveryInputSchema,
  resourceKey,
  type BrokerDiscoveryInput,
  type BrokerResourceRef,
  type ConnectionProfile,
  type DiscoveredEntity,
  type DiscoveryResult,
  type ResourceScope,
  type TargetResourceRef
} from '@shared/domain'
import type { BrokerAdapter, ConnectionTestResult } from './BrokerAdapter'
import type { ProfileRepository } from '../persistence/ProfileRepository'
import { DemoAdapter } from './DemoAdapter'
import { RabbitMqAdapter } from './RabbitMqAdapter'
import { AzureServiceBusAdapter } from './AzureServiceBusAdapter'
import { KafkaAdapter } from './KafkaAdapter'
import { BrokerDiscoveryService, sortDiscoveredEntities } from './BrokerDiscoveryService'

const RESOURCE_CACHE_MS = 60_000

interface CachedResources {
  expiresAt: number
  result: DiscoveryResult
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
    const { profile, secret } = this.profiles.getWithSecret(profileId)
    if (profile.brokerType === 'demo') {
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
          canTarget: true,
          suggestedSource: source.depth > 0
        })
        if (source.targetName) {
          const target = { kind: 'queue' as const, name: source.targetName }
          if (!entities.has(resourceKey(target))) entities.set(resourceKey(target), fixedEntity(target, false, true))
        }
      }
      return { entities: sortDiscoveredEntities([...entities.values()]), latencyMs: 0 }
    }
    if (profile.configuration['profileMode'] !== 'namespace') {
      return { entities: this.fixedResources(profile), latencyMs: 0 }
    }

    const cacheKey = `${profileId}:${scope.kind === 'root' ? 'root' : `topic:${scope.topicName}`}`
    const cached = this.resources.get(cacheKey)
    if (!force && cached && cached.expiresAt > Date.now()) return cached.result

    const result = await this.discovery.discover(this.discoveryInput(profile, secret, scope))
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
    suggestedSource: canInspect
  }
}

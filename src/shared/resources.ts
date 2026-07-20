import type {
  BrokerResourceRef,
  ConnectionProfile,
  DiscoveredEntity,
  TargetResourceRef
} from './domain'

export function resourceRefFromEntity(entity: DiscoveredEntity): BrokerResourceRef {
  if (entity.kind === 'subscription') {
    if (!entity.parent) throw new Error(`Subscription ${entity.name} does not have a parent topic`)
    return { kind: 'subscription', topicName: entity.parent.name, name: entity.name }
  }
  return { kind: entity.kind, name: entity.name }
}

export function targetRefFromEntity(entity: DiscoveredEntity): TargetResourceRef | null {
  if (!entity.canTarget || entity.kind === 'subscription') return null
  return { kind: entity.kind, name: entity.name }
}

export function filterAndRankResources(entities: DiscoveredEntity[], rawQuery: string): DiscoveredEntity[] {
  const query = normalizeSearch(rawQuery.trim())
  if (!query) return [...entities].sort(defaultResourceOrder)

  return entities
    .map((entity) => ({ entity, score: matchScore(entity, query) }))
    .filter((candidate) => candidate.score < Number.POSITIVE_INFINITY)
    .sort((left, right) => left.score - right.score || defaultResourceOrder(left.entity, right.entity))
    .map(({ entity }) => entity)
}

export function fixedProfileTarget(profile: ConnectionProfile): TargetResourceRef | null {
  const config = profile.configuration
  if (profile.brokerType === 'rabbitmq' && typeof config['targetQueue'] === 'string') {
    return { kind: 'queue', name: config['targetQueue'] }
  }
  if (profile.brokerType === 'kafka' && typeof config['targetTopic'] === 'string') {
    return { kind: 'topic', name: config['targetTopic'] }
  }
  if (profile.brokerType === 'azure-service-bus') {
    const name = config['targetName'] ?? config['targetQueue']
    if (typeof name === 'string') return { kind: config['targetKind'] === 'topic' ? 'topic' : 'queue', name }
  }
  return null
}

function matchScore(entity: DiscoveredEntity, query: string): number {
  const name = normalizeSearch(entity.name)
  const path = normalizeSearch(entity.parent ? `${entity.parent.name}/${entity.name}` : entity.name)
  if (name === query || path === query) return 0
  if (name.startsWith(query)) return 1
  if (name.split(/[._\-/\s]+/).some((segment) => segment.startsWith(query))) return 2
  if (name.includes(query) || path.includes(query)) return 3
  return Number.POSITIVE_INFINITY
}

function defaultResourceOrder(left: DiscoveredEntity, right: DiscoveredEntity): number {
  const leftPriority = left.suggestedSource || (left.messageCount ?? 0) > 0 ? 0 : 1
  const rightPriority = right.suggestedSource || (right.messageCount ?? 0) > 0 ? 0 : 1
  if (leftPriority !== rightPriority) return leftPriority - rightPriority
  return left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: 'base' })
}

function normalizeSearch(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase()
}

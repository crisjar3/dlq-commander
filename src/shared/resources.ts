import Fuse from 'fuse.js'
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
  return new ResourceSearchIndex(entities).search(rawQuery)
}

interface SearchRecord {
  entity: DiscoveredEntity
  name: string
  path: string
  segments: string[]
}

export class ResourceSearchIndex {
  private readonly records: SearchRecord[]
  private readonly fuse: Fuse<SearchRecord>

  constructor(entities: DiscoveredEntity[]) {
    this.records = entities.map((entity) => {
      const name = normalizeSearch(entity.name)
      const path = normalizeSearch(entity.parent ? `${entity.parent.name}/${entity.name}` : entity.name)
      return { entity, name, path, segments: name.split(' ').filter(Boolean) }
    })
    this.fuse = new Fuse(this.records, {
      keys: ['name', 'path'],
      threshold: 0.34,
      distance: 120,
      ignoreLocation: true,
      includeScore: true,
      minMatchCharLength: 2
    })
  }

  search(rawQuery: string): DiscoveredEntity[] {
    const query = normalizeSearch(rawQuery)
    if (!query) return this.records.map(({ entity }) => entity).sort(alphabeticalResourceOrder)
    const terms = query.split(' ').filter(Boolean)
    const fuzzyByTerm = terms.map((term) => new Map(
      this.fuse.search(term).map((result) => [result.item.entity.key, result.score ?? 1])
    ))

    const ranked = this.records
      .map((record) => ({ record, rank: matchRank(record, query, terms, fuzzyByTerm) }))
      .filter((candidate) => candidate.rank !== null)
    const hasDirectMatch = ranked.some((candidate) => candidate.rank!.tier < 4)
    return ranked
      .filter((candidate) => !hasDirectMatch || candidate.rank!.tier < 4)
      .sort((left, right) => compareRank(left.rank!, right.rank!) || alphabeticalResourceOrder(left.record.entity, right.record.entity))
      .map(({ record }) => record.entity)
  }
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

interface MatchRank {
  tier: number
  fuzzyScore: number
}

function matchRank(
  record: SearchRecord,
  query: string,
  terms: string[],
  fuzzyByTerm: Array<Map<string, number>>
): MatchRank | null {
  if (record.name === query || record.path === query) return { tier: 0, fuzzyScore: 0 }
  if (record.name.startsWith(query)) return { tier: 1, fuzzyScore: 0 }
  if (record.segments.some((segment) => segment.startsWith(query))) return { tier: 2, fuzzyScore: 0 }
  if (terms.every((term) => record.path.includes(term))) return { tier: 3, fuzzyScore: 0 }

  const scores = terms.map((term, index) => (
    record.path.includes(term) ? 0 : fuzzyByTerm[index]?.get(record.entity.key)
  ))
  if (scores.some((score) => score === undefined)) return null
  return { tier: 4, fuzzyScore: scores.reduce<number>((sum, score) => sum + (score ?? 1), 0) / scores.length }
}

function compareRank(left: MatchRank, right: MatchRank): number {
  return left.tier - right.tier || left.fuzzyScore - right.fuzzyScore
}

function alphabeticalResourceOrder(left: DiscoveredEntity, right: DiscoveredEntity): number {
  return left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: 'base' })
}

export function normalizeResourceSearch(value: string): string {
  return normalizeSearch(value)
}

function normalizeSearch(value: string): string {
  return value
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .replace(/[._\-/\\\s]+/g, ' ')
    .replace(/\s+/g, ' ')
}

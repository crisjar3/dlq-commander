import type { DiscoveredEntity } from './domain'

export type DiscoveryUiState =
  | 'initial'
  | 'discovering'
  | 'success'
  | 'empty'
  | 'permission-denied'
  | 'network-error'
  | 'manual'
  | 'stale'

export function suggestedSourceName(entities: DiscoveredEntity[]): string {
  if (entities.length === 1) return entities[0]?.name ?? ''
  const suggested = entities.filter((entity) => entity.suggestedSource)
  return suggested.length === 1 ? suggested[0]?.name ?? '' : ''
}

export function selectRouting(
  currentSource: string,
  currentTarget: string,
  nextSource: string
): { source: string; target: string } {
  return {
    source: nextSource,
    target: !currentTarget || currentTarget === currentSource ? nextSource : currentTarget
  }
}

export function discoveryErrorState(code: string): Extract<DiscoveryUiState, 'permission-denied' | 'network-error'> {
  return code === 'DISCOVERY_PERMISSION_DENIED' ? 'permission-denied' : 'network-error'
}

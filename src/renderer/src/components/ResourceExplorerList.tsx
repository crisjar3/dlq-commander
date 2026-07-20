import { useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Check, ChevronRight, GitBranch, Inbox, Search, Waypoints, X } from 'lucide-react'
import type { DiscoveredEntity } from '@shared/domain'
import { filterAndRankResources } from '@shared/resources'

interface ResourceExplorerListProps {
  id: string
  entities: DiscoveredEntity[]
  selectedKey?: string | null
  searchPlaceholder?: string
  emptyText?: string
  compact?: boolean
  autoFocus?: boolean
  onActivate(entity: DiscoveredEntity): void
}

export function ResourceExplorerList({
  id,
  entities,
  selectedKey = null,
  searchPlaceholder = 'Buscar por nombre',
  emptyText = 'No hay recursos que coincidan',
  compact = false,
  autoFocus = false,
  onActivate
}: ResourceExplorerListProps): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const parentRef = useRef<HTMLDivElement>(null)
  const results = useMemo(() => filterAndRankResources(entities, query), [entities, query])
  const virtualizer = useVirtualizer({
    count: results.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 44,
    initialRect: { width: 900, height: compact ? 220 : 500 },
    overscan: 8
  })
  const measuredRows = virtualizer.getVirtualItems()
  const visibleRows = measuredRows.length > 0
    ? measuredRows
    : results.slice(0, compact ? 8 : 16).map((_, index) => ({ index, size: 44, start: index * 44 }))

  useEffect(() => setActiveIndex(0), [query, entities])
  useEffect(() => {
    if (results.length > 0) virtualizer.scrollToIndex(Math.min(activeIndex, results.length - 1), { align: 'auto' })
  }, [activeIndex, results.length, virtualizer])

  const moveActive = (next: number): void => {
    if (results.length === 0) return
    setActiveIndex(Math.max(0, Math.min(next, results.length - 1)))
  }

  const activateCurrent = (): void => {
    const entity = results[activeIndex]
    if (entity) onActivate(entity)
  }

  return (
    <div className={`resource-explorer-list ${compact ? 'compact' : ''}`}>
      <div className="resource-search-toolbar">
        <label className="search-field resource-search">
          <Search size={16} aria-hidden="true" />
          <span className="sr-only">Buscar recursos</span>
          <input
            autoFocus={autoFocus}
            value={query}
            placeholder={searchPlaceholder}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded="true"
            aria-controls={`${id}-results`}
            aria-activedescendant={results[activeIndex] ? `${id}-${results[activeIndex].key}` : undefined}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') { event.preventDefault(); moveActive(activeIndex + 1) }
              else if (event.key === 'ArrowUp') { event.preventDefault(); moveActive(activeIndex - 1) }
              else if (event.key === 'Home') { event.preventDefault(); moveActive(0) }
              else if (event.key === 'End') { event.preventDefault(); moveActive(results.length - 1) }
              else if (event.key === 'Enter') { event.preventDefault(); activateCurrent() }
              else if (event.key === 'Escape' && query) { event.preventDefault(); setQuery('') }
            }}
          />
          {query ? <button type="button" className="search-clear" aria-label="Limpiar búsqueda" onClick={() => setQuery('')}><X size={15} /></button> : null}
        </label>
        <span className="resource-result-count" aria-live="polite">{results.length} de {entities.length}</span>
      </div>

      <div className="resource-list-header" aria-hidden="true"><span>Nombre</span><span>Tipo</span><span>Actividad</span><span /></div>
      <div className="resource-list-scroll" id={`${id}-results`} role="listbox" ref={parentRef}>
        {results.length === 0 ? <div className="resource-list-empty">{emptyText}</div> : (
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
            {visibleRows.map((virtualRow) => {
              const entity = results[virtualRow.index]
              if (!entity) return null
              const selected = entity.key === selectedKey
              const active = virtualRow.index === activeIndex
              return (
                <button
                  type="button"
                  id={`${id}-${entity.key}`}
                  role="option"
                  aria-selected={selected}
                  className={`resource-list-row ${active ? 'active' : ''} ${selected ? 'selected' : ''}`}
                  key={entity.key}
                  onMouseEnter={() => setActiveIndex(virtualRow.index)}
                  onClick={() => onActivate(entity)}
                  style={{ height: virtualRow.size, transform: `translateY(${virtualRow.start}px)` }}
                >
                  <span className={`resource-kind-icon kind-${entity.kind}`}><ResourceIcon kind={entity.kind} /></span>
                  <span className="resource-primary"><strong>{entity.name}</strong>{entity.parent ? <small>{entity.parent.name}</small> : null}</span>
                  <span className="resource-kind-label">{resourceKindLabel(entity.kind)}</span>
                  <span className="resource-activity">{activityLabel(entity)}</span>
                  <span className="resource-row-action">{selected ? <Check size={16} /> : <ChevronRight size={16} />}</span>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function ResourceIcon({ kind }: { kind: DiscoveredEntity['kind'] }): React.JSX.Element {
  if (kind === 'queue') return <Inbox size={16} aria-hidden="true" />
  if (kind === 'subscription') return <GitBranch size={16} aria-hidden="true" />
  return <Waypoints size={16} aria-hidden="true" />
}

function resourceKindLabel(kind: DiscoveredEntity['kind']): string {
  if (kind === 'queue') return 'Queue'
  if (kind === 'subscription') return 'Subscription'
  return 'Topic'
}

function activityLabel(entity: DiscoveredEntity): string {
  if (entity.childCount !== null) return `${entity.childCount.toLocaleString('es-CR')} subscriptions`
  if (entity.messageCount !== null) return `${entity.messageCount.toLocaleString('es-CR')} mensajes`
  return 'Sin contador'
}

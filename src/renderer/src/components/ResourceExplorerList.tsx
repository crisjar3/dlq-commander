import { useDeferredValue, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import {
  Check,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  GitBranch,
  Inbox,
  LoaderCircle,
  RefreshCw,
  Search,
  Waypoints,
  X
} from 'lucide-react'
import type { BrokerType, DiscoveredEntity, ResourceCollection } from '@shared/domain'
import { ResourceSearchIndex } from '@shared/resources'

const VISIBLE_PAGE_SIZE = 50

interface ResourceExplorerListProps {
  id: string
  entities: DiscoveredEntity[]
  brokerType?: BrokerType
  collection?: ResourceCollection
  selectedKey?: string | null
  searchPlaceholder?: string
  emptyText?: string
  compact?: boolean
  autoFocus?: boolean
  loadingMore?: boolean
  complete?: boolean
  totalCount?: number | null
  loadError?: string | null
  onRetry?(): void
  onRefresh?(): void
  onActivate(entity: DiscoveredEntity): void
}

export function ResourceExplorerList({
  id,
  entities,
  brokerType = 'demo',
  collection,
  selectedKey = null,
  searchPlaceholder = 'Buscar por nombre',
  emptyText = 'No hay recursos que coincidan',
  compact = false,
  autoFocus = false,
  loadingMore = false,
  complete = true,
  totalCount = null,
  loadError = null,
  onRetry,
  onRefresh,
  onActivate
}: ResourceExplorerListProps): React.JSX.Element {
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)
  const [pageIndex, setPageIndex] = useState(0)
  const [activeIndex, setActiveIndex] = useState(0)
  const parentRef = useRef<HTMLDivElement>(null)
  const searchIndex = useMemo(() => new ResourceSearchIndex(entities), [entities])
  const results = useMemo(() => searchIndex.search(deferredQuery), [deferredQuery, searchIndex])
  const searchPending = query !== deferredQuery
  const pageCount = Math.max(1, Math.ceil(results.length / VISIBLE_PAGE_SIZE))
  const safePageIndex = Math.min(pageIndex, pageCount - 1)
  const pageStart = safePageIndex * VISIBLE_PAGE_SIZE
  const pageEntities = results.slice(pageStart, pageStart + VISIBLE_PAGE_SIZE)
  const metrics = metricColumns(brokerType, collection, pageEntities)
  const gridStyle = { gridTemplateColumns: `28px minmax(190px, 1fr) repeat(${metrics.length}, minmax(76px, 108px)) 28px` } as CSSProperties
  const virtualizer = useVirtualizer({
    count: pageEntities.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 44,
    initialRect: { width: 900, height: compact ? 220 : 500 },
    overscan: 8
  })
  const measuredRows = virtualizer.getVirtualItems()
  const visibleRows = measuredRows.length > 0
    ? measuredRows
    : pageEntities.slice(0, compact ? 8 : 16).map((_, index) => ({ index, size: 44, start: index * 44 }))

  useEffect(() => { setPageIndex(0); setActiveIndex(0) }, [deferredQuery])
  useEffect(() => {
    if (pageIndex >= pageCount) setPageIndex(pageCount - 1)
  }, [pageCount, pageIndex])
  useEffect(() => {
    if (pageEntities.length > 0) virtualizer.scrollToIndex(Math.min(activeIndex, pageEntities.length - 1), { align: 'auto' })
  }, [activeIndex, pageEntities.length, virtualizer])

  const goToPage = (next: number, active = 0): void => {
    const bounded = Math.max(0, Math.min(next, pageCount - 1))
    setPageIndex(bounded)
    setActiveIndex(Math.max(0, Math.min(active, Math.max(0, results.slice(bounded * VISIBLE_PAGE_SIZE, (bounded + 1) * VISIBLE_PAGE_SIZE).length - 1))))
    if (parentRef.current) parentRef.current.scrollTop = 0
  }
  const moveActive = (next: number): void => {
    if (pageEntities.length === 0) return
    setActiveIndex(Math.max(0, Math.min(next, pageEntities.length - 1)))
  }
  const activateCurrent = (): void => {
    if (searchPending) {
      const immediateEntity = searchIndex.search(query)[0]
      if (immediateEntity) onActivate(immediateEntity)
      return
    }
    const entity = pageEntities[activeIndex]
    if (entity) onActivate(entity)
  }
  const updateQuery = (nextQuery: string): void => {
    setQuery(nextQuery)
    setPageIndex(0)
    setActiveIndex(0)
    if (parentRef.current) parentRef.current.scrollTop = 0
  }
  const progressText = searchPending
    ? `Buscando en ${entities.length.toLocaleString('es-CR')} recursos cargados...`
    : deferredQuery
    ? `${results.length.toLocaleString('es-CR')} ${results.length === 1 ? 'coincidencia' : 'coincidencias'} en ${entities.length.toLocaleString('es-CR')} recursos cargados`
    : complete
      ? `${(totalCount ?? entities.length).toLocaleString('es-CR')} recursos`
      : `${entities.length.toLocaleString('es-CR')} cargados${loadingMore ? ' · cargando...' : ''}`
  const visibleFrom = results.length === 0 ? 0 : pageStart + 1
  const visibleTo = Math.min(pageStart + VISIBLE_PAGE_SIZE, results.length)

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
            aria-activedescendant={pageEntities[activeIndex] ? `${id}-${pageEntities[activeIndex].key}` : undefined}
            onChange={(event) => updateQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') { event.preventDefault(); moveActive(activeIndex + 1) }
              else if (event.key === 'ArrowUp') { event.preventDefault(); moveActive(activeIndex - 1) }
              else if (event.key === 'PageDown') { event.preventDefault(); goToPage(safePageIndex + 1, activeIndex) }
              else if (event.key === 'PageUp') { event.preventDefault(); goToPage(safePageIndex - 1, activeIndex) }
              else if (event.key === 'Home') { event.preventDefault(); goToPage(0, 0) }
              else if (event.key === 'End') { event.preventDefault(); goToPage(pageCount - 1, VISIBLE_PAGE_SIZE - 1) }
              else if (event.key === 'Enter') { event.preventDefault(); activateCurrent() }
              else if (event.key === 'Escape' && query) { event.preventDefault(); updateQuery('') }
            }}
          />
          {query ? <button type="button" className="search-clear" aria-label="Limpiar búsqueda" onClick={() => updateQuery('')}><X size={15} /></button> : null}
        </label>
        <span className="resource-result-count" aria-live="polite">{progressText}</span>
        {loadingMore ? <LoaderCircle size={16} className="spin resource-loading-icon" aria-hidden="true" /> : null}
        {onRefresh ? <button type="button" className="icon-button" aria-label="Actualizar catálogo" title="Actualizar catálogo" onClick={onRefresh}><RefreshCw size={16} /></button> : null}
      </div>

      {loadError ? <div className="resource-partial-error" role="alert"><span>{loadError}</span>{onRetry ? <button type="button" className="text-button" onClick={onRetry}>Reintentar desde aquí</button> : null}</div> : null}
      <div className="resource-list-header" style={gridStyle} aria-hidden="true"><span /><span>Nombre</span>{metrics.map((metric) => <span key={metric.key}>{metric.label}</span>)}<span /></div>
      <div className="resource-list-scroll" id={`${id}-results`} role="listbox" ref={parentRef}>
        {pageEntities.length === 0 ? <div className="resource-list-empty">{loadingMore ? 'Cargando recursos...' : emptyText}</div> : (
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
            {visibleRows.map((virtualRow) => {
              const entity = pageEntities[virtualRow.index]
              if (!entity) return null
              const selected = entity.key === selectedKey
              const active = virtualRow.index === activeIndex
              const primaryMetric = metrics.find((metric) => metric.key === 'deadLetterMessages' && metricValue(entity, metric.key) !== null)
                ?? metrics.find((metric) => metricValue(entity, metric.key) !== null)
              const secondaryText = `${entity.parent?.name ?? resourceKindLabel(entity.kind)}${primaryMetric ? ` · ${primaryMetric.label} ${formatMetric(entity, primaryMetric.key)}` : ''}`
              return (
                <button
                  type="button"
                  id={`${id}-${entity.key}`}
                  role="option"
                  aria-selected={selected}
                  className={`resource-list-row ${active ? 'active' : ''} ${selected ? 'selected' : ''}`}
                  key={entity.key}
                  onPointerMove={() => setActiveIndex(virtualRow.index)}
                  onClick={() => onActivate(entity)}
                  style={{ ...gridStyle, height: virtualRow.size, transform: `translateY(${virtualRow.start}px)` }}
                >
                  <span className={`resource-kind-icon kind-${entity.kind}`}><ResourceIcon kind={entity.kind} /></span>
                  <span className="resource-primary"><strong><HighlightedName name={entity.name} query={deferredQuery} /></strong><small>{secondaryText}</small></span>
                  {metrics.map((metric) => <span className="resource-metric" key={metric.key}>{formatMetric(entity, metric.key)}</span>)}
                  <span className="resource-row-action">{selected ? <Check size={16} /> : <ChevronRight size={16} />}</span>
                </button>
              )
            })}
          </div>
        )}
      </div>
      <footer className="resource-paginator">
        <span>{visibleFrom.toLocaleString('es-CR')}-{visibleTo.toLocaleString('es-CR')} de {results.length.toLocaleString('es-CR')}</span>
        <span>Página {safePageIndex + 1} de {pageCount}</span>
        <div className="paginator-actions">
          <button type="button" className="icon-button" aria-label="Primera página" title="Primera página" disabled={safePageIndex === 0} onClick={() => goToPage(0)}><ChevronsLeft size={16} /></button>
          <button type="button" className="icon-button" aria-label="Página anterior" title="Página anterior" disabled={safePageIndex === 0} onClick={() => goToPage(safePageIndex - 1)}><ChevronLeft size={16} /></button>
          <button type="button" className="icon-button" aria-label="Página siguiente" title="Página siguiente" disabled={safePageIndex >= pageCount - 1} onClick={() => goToPage(safePageIndex + 1)}><ChevronRight size={16} /></button>
          <button type="button" className="icon-button" aria-label="Última página" title="Última página" disabled={safePageIndex >= pageCount - 1} onClick={() => goToPage(pageCount - 1)}><ChevronsRight size={16} /></button>
        </div>
      </footer>
    </div>
  )
}

type MetricKey = keyof DiscoveredEntity['metrics'] | 'status' | 'kind'
interface MetricColumn { key: MetricKey; label: string }

function metricColumns(brokerType: BrokerType, collection: ResourceCollection | undefined, entities: DiscoveredEntity[]): MetricColumn[] {
  if (!collection && new Set(entities.map((entity) => entity.kind)).size > 1) {
    return [{ key: 'kind', label: 'Tipo' }, { key: 'deadLetterMessages', label: 'DLQ' }, { key: 'subscriptionCount', label: 'Subscriptions' }]
  }
  const kind = collection?.kind ?? (entities[0]?.kind === 'subscription' ? 'subscriptions' : entities[0]?.kind === 'topic' ? 'topics' : 'queues')
  if (brokerType === 'azure-service-bus' && kind === 'topics') return [{ key: 'subscriptionCount', label: 'Subscriptions' }, { key: 'scheduledMessages', label: 'Programados' }, { key: 'sizeBytes', label: 'Tamaño' }]
  if (brokerType === 'azure-service-bus' && kind === 'subscriptions') return [{ key: 'totalMessages', label: 'Total' }, { key: 'activeMessages', label: 'Activos' }, { key: 'deadLetterMessages', label: 'DLQ' }]
  if (brokerType === 'azure-service-bus') return [{ key: 'totalMessages', label: 'Total' }, { key: 'activeMessages', label: 'Activos' }, { key: 'deadLetterMessages', label: 'DLQ' }, { key: 'scheduledMessages', label: 'Programados' }, { key: 'sizeBytes', label: 'Tamaño' }]
  if (brokerType === 'rabbitmq') return [{ key: 'status', label: 'Estado' }, { key: 'totalMessages', label: 'Total' }, { key: 'readyMessages', label: 'Ready' }, { key: 'unacknowledgedMessages', label: 'Unacked' }]
  if (brokerType === 'kafka') return [{ key: 'kind', label: 'Tipo' }]
  return [{ key: 'totalMessages', label: 'Total' }, { key: 'deadLetterMessages', label: 'DLQ' }]
}

function metricValue(entity: DiscoveredEntity, key: MetricKey): number | string | null {
  if (key === 'status') return entity.status
  if (key === 'kind') return resourceKindLabel(entity.kind)
  return entity.metrics[key]
}

function formatMetric(entity: DiscoveredEntity, key: MetricKey): string {
  const value = metricValue(entity, key)
  if (value === null) return '-'
  if (key === 'sizeBytes' && typeof value === 'number') return formatBytes(value)
  return typeof value === 'number' ? value.toLocaleString('es-CR') : value
}

function formatBytes(value: number): string {
  if (value < 1_024) return `${value} B`
  if (value < 1_048_576) return `${(value / 1_024).toFixed(1)} KB`
  return `${(value / 1_048_576).toFixed(1)} MB`
}

function HighlightedName({ name, query }: { name: string; query: string }): ReactNode {
  const terms = query.trim().split(/\s+/).filter((term) => term.length > 1)
  if (terms.length === 0) return name
  const expression = new RegExp(`(${terms.map(escapeRegExp).join('|')})`, 'gi')
  return name.split(expression).map((part, index) =>
    terms.some((term) => part.localeCompare(term, undefined, { sensitivity: 'accent' }) === 0)
      ? <mark key={`${part}-${index}`}>{part}</mark>
      : part
  )
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
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

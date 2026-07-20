import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertCircle, ArrowLeft, ChevronRight } from 'lucide-react'
import {
  capabilitiesByBroker,
  resourceDisplayName,
  resourceKey,
  type ConnectionProfile,
  type DiscoveredEntity,
  type ResourceCollection,
  type SourceSummary
} from '@shared/domain'
import { resourceRefFromEntity } from '@shared/resources'
import { ResourceExplorerList } from '../components/ResourceExplorerList'
import { useResourceCatalog } from '../hooks/useResourceCatalog'
import { invoke, readableError } from '../lib/api'

interface ResourceExplorerViewProps {
  profile: ConnectionProfile
  initialResource?: DiscoveredEntity | null
  onBack(): void
  onInspect(source: SourceSummary, profile: ConnectionProfile): void
}

export function ResourceExplorerView({ profile, initialResource = null, onBack, onInspect }: ResourceExplorerViewProps): React.JSX.Element {
  const [tab, setTab] = useState<'queue' | 'topic'>('queue')
  const [topicName, setTopicName] = useState<string | null>(null)
  const initialHandled = useRef(false)
  const namespaceMode = profile.brokerType === 'demo' || profile.configuration['profileMode'] === 'namespace'
  const queueCollection: ResourceCollection = { kind: 'queues' }
  const topicCollection: ResourceCollection = { kind: 'topics' }
  const subscriptionCollection: ResourceCollection = { kind: 'subscriptions', topicName: topicName ?? '__inactive__' }
  const queues = useResourceCatalog(profile.id, queueCollection, namespaceMode && !topicName && profile.brokerType !== 'kafka')
  const topics = useResourceCatalog(profile.id, topicCollection, namespaceMode && !topicName && (profile.brokerType === 'azure-service-bus' || profile.brokerType === 'kafka'))
  const subscriptions = useResourceCatalog(profile.id, subscriptionCollection, namespaceMode && Boolean(topicName))
  const legacyQuery = useQuery({
    queryKey: ['resources', profile.id, 'legacy-fixed'],
    queryFn: () => invoke('listResources', { profileId: profile.id, scope: { kind: 'root' }, force: false }),
    enabled: !namespaceMode,
    staleTime: 60_000
  })

  const activeCollection = topicName
    ? subscriptionCollection
    : profile.brokerType === 'kafka' || profile.brokerType === 'azure-service-bus' && tab === 'topic'
      ? topicCollection
      : queueCollection
  const activeCatalog = topicName ? subscriptions : activeCollection.kind === 'topics' ? topics : queues
  const legacyEntities = useMemo(() => legacyQuery.data?.entities ?? [], [legacyQuery.data])
  const entities = namespaceMode
    ? activeCatalog.entities
    : legacyEntities.filter((entity) => topicName ? entity.kind === 'subscription' : entity.canInspect)
  const queueCount = namespaceMode ? queues.loadedCount : legacyEntities.filter((entity) => entity.kind === 'queue').length
  const topicCount = namespaceMode ? topics.loadedCount : legacyEntities.filter((entity) => entity.kind === 'topic').length

  useEffect(() => {
    if (initialHandled.current || !initialResource) return
    initialHandled.current = true
    if (initialResource.kind === 'topic' && profile.brokerType === 'azure-service-bus') setTopicName(initialResource.name)
    else if (initialResource.canInspect) onInspect(sourceFromEntity(initialResource, profile), profile)
  }, [initialResource, onInspect, profile])

  const activate = (entity: DiscoveredEntity): void => {
    if (entity.kind === 'topic' && profile.brokerType === 'azure-service-bus') {
      setTopicName(entity.name)
      return
    }
    if (entity.canInspect) onInspect(sourceFromEntity(entity, profile), profile)
  }

  const goBack = (): void => {
    if (topicName) setTopicName(null)
    else onBack()
  }
  const error = namespaceMode ? activeCatalog.error : legacyQuery.error
  const loading = namespaceMode ? activeCatalog.isInitialLoading : legacyQuery.isLoading

  return (
    <section className="view resource-view" aria-labelledby="resource-view-title">
      <header className="view-header compact">
        <div className="title-with-back">
          <button className="icon-button" onClick={goBack} aria-label={topicName ? 'Volver a topics' : 'Volver al dashboard'}><ArrowLeft size={18} /></button>
          <div>
            <div className="resource-breadcrumb" aria-label="Ruta actual">
              <span>{profile.name}</span>
              {topicName ? <><ChevronRight size={13} /><span>Topics</span><ChevronRight size={13} /><strong>{topicName}</strong></> : null}
            </div>
            <h1 id="resource-view-title">{topicName ? 'Subscriptions' : 'Explorador de recursos'}</h1>
            <p className="view-subtitle">{topicName ? `DLQ disponibles en ${topicName}` : brokerExplorerDescription(profile)}</p>
          </div>
        </div>
      </header>

      {profile.brokerType === 'azure-service-bus' && !topicName ? (
        <div className="resource-tabs" role="tablist" aria-label="Tipo de recurso">
          <button role="tab" aria-selected={tab === 'queue'} className={tab === 'queue' ? 'active' : ''} onClick={() => setTab('queue')}>Queues <span>{queueCount}</span></button>
          <button role="tab" aria-selected={tab === 'topic'} className={tab === 'topic' ? 'active' : ''} onClick={() => setTab('topic')}>Topics <span>{topicCount}</span></button>
        </div>
      ) : null}

      {error && entities.length === 0 ? (
        <div className="notice notice-error" role="alert"><AlertCircle size={18} /><div><strong>No se pudieron cargar los recursos.</strong><span>{readableError(error)}</span></div></div>
      ) : null}

      {loading ? <ResourceExplorerSkeleton /> : (
        <ResourceExplorerList
          id={`resources-${profile.id}-${topicName ?? tab}`}
          entities={entities}
          brokerType={profile.brokerType}
          collection={activeCollection}
          autoFocus
          loadingMore={namespaceMode && activeCatalog.isLoadingMore}
          complete={!namespaceMode || activeCatalog.isComplete}
          totalCount={namespaceMode ? activeCatalog.totalCount : entities.length}
          loadError={error && entities.length > 0 ? readableError(error) : null}
          onRetry={namespaceMode ? activeCatalog.retry : undefined}
          onRefresh={namespaceMode ? activeCatalog.refresh : undefined}
          searchPlaceholder={topicName ? 'Buscar subscription' : tab === 'topic' ? 'Buscar topic' : profile.brokerType === 'kafka' ? 'Buscar topic' : 'Buscar queue'}
          emptyText={topicName ? 'No hay subscriptions que coincidan' : 'No hay recursos que coincidan'}
          onActivate={activate}
        />
      )}
    </section>
  )
}

function sourceFromEntity(entity: DiscoveredEntity, profile: ConnectionProfile): SourceSummary {
  const resource = resourceRefFromEntity(entity)
  const suffix = profile.brokerType === 'azure-service-bus'
    ? ' / $DeadLetterQueue'
    : profile.brokerType === 'kafka' ? ' / DLT' : ''
  const depth = entity.metrics.deadLetterMessages ?? entity.messageCount ?? entity.metrics.totalMessages ?? 0
  return {
    id: resourceKey(resource),
    resource,
    profileId: profile.id,
    name: entity.name,
    displayName: `${resourceDisplayName(resource)}${suffix}`,
    targetName: profile.brokerType === 'demo' ? entity.name.replace(/\.dlq$/i, '') : null,
    depth,
    brokerType: profile.brokerType,
    status: depth > 0 ? 'warning' : 'healthy',
    oldestMessageAt: null,
    capabilities: capabilitiesByBroker[profile.brokerType]
  }
}

function brokerExplorerDescription(profile: ConnectionProfile): string {
  if (profile.brokerType === 'azure-service-bus') return 'Queues, topics y subscriptions del namespace.'
  if (profile.brokerType === 'rabbitmq') return 'Queues disponibles en el virtual host configurado.'
  if (profile.brokerType === 'kafka') return 'Topics visibles para este client ID.'
  return 'Fuentes preparadas en el entorno demo.'
}

function ResourceExplorerSkeleton(): React.JSX.Element {
  return <div className="resource-explorer-skeleton" aria-label="Cargando recursos" aria-busy="true">{Array.from({ length: 8 }, (_, index) => <div className="skeleton-row" key={index}><span className="skeleton skeleton-square" /><span className="skeleton skeleton-wide" /><span className="skeleton" /></div>)}</div>
}

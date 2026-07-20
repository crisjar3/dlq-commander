import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertCircle, ArrowLeft, ChevronRight, RefreshCw } from 'lucide-react'
import {
  capabilitiesByBroker,
  resourceDisplayName,
  resourceKey,
  type ConnectionProfile,
  type DiscoveredEntity,
  type ResourceScope,
  type SourceSummary
} from '@shared/domain'
import { resourceRefFromEntity } from '@shared/resources'
import { ResourceExplorerList } from '../components/ResourceExplorerList'
import { invoke, readableError } from '../lib/api'

interface ResourceExplorerViewProps {
  profile: ConnectionProfile
  initialResource?: DiscoveredEntity | null
  onBack(): void
  onInspect(source: SourceSummary, profile: ConnectionProfile): void
}

export function ResourceExplorerView({ profile, initialResource = null, onBack, onInspect }: ResourceExplorerViewProps): React.JSX.Element {
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<'queue' | 'topic'>('queue')
  const [topicName, setTopicName] = useState<string | null>(null)
  const initialHandled = useRef(false)
  const scope: ResourceScope = topicName ? { kind: 'topic', topicName } : { kind: 'root' }
  const queryKey = ['resources', profile.id, scope.kind, topicName ?? 'root'] as const
  const resourcesQuery = useQuery({
    queryKey,
    queryFn: () => invoke('listResources', { profileId: profile.id, scope, force: false }),
    staleTime: 60_000
  })
  const allEntities = useMemo(() => resourcesQuery.data?.entities ?? [], [resourcesQuery.data])
  const entities = useMemo(() => {
    if (topicName) return allEntities
    if (profile.brokerType === 'azure-service-bus') return allEntities.filter((entity) => entity.kind === tab)
    return allEntities.filter((entity) => entity.canInspect)
  }, [allEntities, profile.brokerType, tab, topicName])
  const queueCount = allEntities.filter((entity) => entity.kind === 'queue').length
  const topicCount = allEntities.filter((entity) => entity.kind === 'topic').length

  useEffect(() => {
    if (initialHandled.current || !initialResource) return
    initialHandled.current = true
    if (initialResource.kind === 'topic' && profile.brokerType === 'azure-service-bus') setTopicName(initialResource.name)
    else if (initialResource.canInspect) onInspect(sourceFromEntity(initialResource, profile), profile)
  }, [initialResource, onInspect, profile])

  const refresh = async (): Promise<void> => {
    const result = await invoke('listResources', { profileId: profile.id, scope, force: true })
    queryClient.setQueryData(queryKey, result)
  }

  const activate = (entity: DiscoveredEntity): void => {
    if (entity.kind === 'topic' && profile.brokerType === 'azure-service-bus') {
      setTopicName(entity.name)
      return
    }
    if (!entity.canInspect) return
    onInspect(sourceFromEntity(entity, profile), profile)
  }

  const goBack = (): void => {
    if (topicName) setTopicName(null)
    else onBack()
  }

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
        <button className="button button-secondary" onClick={() => void refresh()} disabled={resourcesQuery.isFetching}>
          <RefreshCw size={16} className={resourcesQuery.isFetching ? 'spin' : ''} />Actualizar
        </button>
      </header>

      {profile.brokerType === 'azure-service-bus' && !topicName ? (
        <div className="resource-tabs" role="tablist" aria-label="Tipo de recurso">
          <button role="tab" aria-selected={tab === 'queue'} className={tab === 'queue' ? 'active' : ''} onClick={() => setTab('queue')}>Queues <span>{queueCount}</span></button>
          <button role="tab" aria-selected={tab === 'topic'} className={tab === 'topic' ? 'active' : ''} onClick={() => setTab('topic')}>Topics <span>{topicCount}</span></button>
        </div>
      ) : null}

      {resourcesQuery.error ? (
        <div className="notice notice-error" role="alert"><AlertCircle size={18} /><div><strong>No se pudieron cargar los recursos.</strong><span>{readableError(resourcesQuery.error)}</span></div></div>
      ) : null}

      {resourcesQuery.isLoading ? <ResourceExplorerSkeleton /> : (
        <ResourceExplorerList
          id={`resources-${profile.id}-${topicName ?? tab}`}
          entities={entities}
          autoFocus
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
  const depth = entity.messageCount ?? 0
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

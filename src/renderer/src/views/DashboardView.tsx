import { useQueries, useQuery } from '@tanstack/react-query'
import { AlertCircle, ArrowRight, Clock3, Inbox, RefreshCw, Server } from 'lucide-react'
import type { ConnectionProfile, SourceSummary } from '@shared/domain'
import { invoke, formatRelative, readableError } from '../lib/api'
import { StatusBadge } from '../components/StatusBadge'

interface DashboardViewProps {
  onInspect: (source: SourceSummary, profile: ConnectionProfile) => void
}

export function DashboardView({ onInspect }: DashboardViewProps): React.JSX.Element {
  const profilesQuery = useQuery({ queryKey: ['profiles'], queryFn: () => invoke('listProfiles', {}) })
  const profiles = profilesQuery.data ?? []
  const sourceQueries = useQueries({
    queries: profiles.map((profile) => ({
      queryKey: ['sources', profile.id],
      queryFn: () => invoke('listSources', { profileId: profile.id }),
      refetchInterval: 15_000
    }))
  })
  const sources = sourceQueries.flatMap((query) => query.data ?? [])
  const totalDepth = sources.reduce((sum, source) => sum + source.depth, 0)
  const error = profilesQuery.error ?? sourceQueries.find((query) => query.error)?.error
  const isFetching = profilesQuery.isFetching || sourceQueries.some((query) => query.isFetching)
  const isInitialLoading = profilesQuery.isLoading || (profiles.length > 0 && sources.length === 0 && sourceQueries.some((query) => query.isLoading))

  const refresh = async (): Promise<void> => {
    await Promise.all([profilesQuery.refetch(), ...sourceQueries.map((query) => query.refetch())])
  }

  return (
    <section className="view" aria-labelledby="dashboard-title">
      <header className="view-header">
        <div>
          <h1 id="dashboard-title">Colas de mensajes muertos</h1>
          <p className="view-subtitle">Profundidad y estado actual de los perfiles configurados.</p>
        </div>
        <button className="button button-secondary" onClick={() => void refresh()} disabled={isFetching}>
          <RefreshCw size={16} className={isFetching ? 'spin' : ''} aria-hidden="true" />
          Actualizar
        </button>
      </header>

      {error ? (
        <div className="notice notice-error" role="alert">
          <AlertCircle size={18} aria-hidden="true" />
          <div><strong>No se pudo actualizar el dashboard.</strong><span>{readableError(error)}</span></div>
        </div>
      ) : null}

      <div className="metric-strip" aria-label="Resumen de dead-letter queues">
        <div className="metric"><span className="metric-symbol"><Inbox size={18} /></span><div><span>Mensajes pendientes</span><strong>{isInitialLoading ? <span className="skeleton skeleton-number" /> : totalDepth.toLocaleString('es-CR')}</strong></div></div>
        <div className="metric"><span className="metric-symbol"><Server size={18} /></span><div><span>Fuentes visibles</span><strong>{isInitialLoading ? <span className="skeleton skeleton-number" /> : sources.length}</strong></div></div>
        <div className="metric"><CheckMetric /><div><span>Perfiles activos</span><strong>{profilesQuery.isLoading ? <span className="skeleton skeleton-number" /> : profiles.length}</strong></div></div>
      </div>

      <div className="table-section">
        <div className="section-heading">
          <div><h2>Fuentes</h2><span>{isFetching ? 'Consultando brokers...' : `Actualizado ${formatRelative(new Date().toISOString())}`}</span></div>
        </div>
        {isInitialLoading ? (
          <div className="table-skeleton" aria-label="Cargando fuentes" aria-busy="true">
            {Array.from({ length: 3 }, (_, index) => <div className="skeleton-row" key={index}><span className="skeleton skeleton-wide" /><span className="skeleton" /><span className="skeleton skeleton-short" /><span className="skeleton" /></div>)}
          </div>
        ) : sources.length === 0 && !isFetching ? (
          <div className="empty-state"><Inbox size={28} /><h3>No hay fuentes disponibles</h3><p>Revisa la conexión del perfil o configura una DLQ manual.</p></div>
        ) : (
          <div className="data-table-wrap">
            <table className="data-table">
              <thead><tr><th>Fuente</th><th>Broker</th><th>Profundidad</th><th>Más antiguo</th><th>Estado</th><th><span className="sr-only">Abrir</span></th></tr></thead>
              <tbody>
                {sources.map((source) => {
                  const profile = profiles.find((candidate) => candidate.id === source.profileId)
                  if (!profile) return null
                  return (
                    <tr key={`${source.profileId}:${source.id}`} className="clickable-row" tabIndex={0} aria-label={`Inspeccionar ${source.displayName}`} onClick={() => onInspect(source, profile)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onInspect(source, profile) } }}>
                      <td><strong>{source.displayName}</strong><span>{profile.name}</span></td>
                      <td><span className="broker-label">{profile.brokerType === 'azure-service-bus' ? 'Azure Service Bus' : profile.brokerType === 'rabbitmq' ? 'RabbitMQ' : profile.brokerType === 'kafka' ? 'Kafka' : 'Demo'}</span></td>
                      <td><span className="numeric-strong">{source.depth.toLocaleString('es-CR')}</span></td>
                      <td><span className="inline-muted"><Clock3 size={14} />{formatRelative(source.oldestMessageAt)}</span></td>
                      <td><StatusBadge status={source.status} /></td>
                      <td><button className="icon-button" tabIndex={-1} aria-hidden="true"><ArrowRight size={17} /></button></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  )
}

function CheckMetric(): React.JSX.Element {
  return <span className="metric-dot" aria-hidden="true" />
}

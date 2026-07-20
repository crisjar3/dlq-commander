import { useQuery } from '@tanstack/react-query'
import { AlertCircle, ArrowRight, Cloud, DatabaseZap, Eye, EyeOff, Rabbit, RefreshCw, Server, Waypoints } from 'lucide-react'
import type { BrokerType, ConnectionProfile } from '@shared/domain'
import { invoke, readableError } from '../lib/api'

interface DashboardViewProps {
  onExplore(profile: ConnectionProfile): void
}

export function DashboardView({ onExplore }: DashboardViewProps): React.JSX.Element {
  const profilesQuery = useQuery({ queryKey: ['profiles'], queryFn: () => invoke('listProfiles', {}) })
  const profiles = profilesQuery.data ?? []
  const namespaceCount = profiles.filter((profile) => profile.configuration['profileMode'] === 'namespace').length
  const writableCount = profiles.filter((profile) => !profile.readOnly).length

  return (
    <section className="view" aria-labelledby="dashboard-title">
      <header className="view-header">
        <div><h1 id="dashboard-title">Namespaces conectados</h1><p className="view-subtitle">Abre una conexión para buscar y operar sus recursos.</p></div>
        <button className="button button-secondary" onClick={() => void profilesQuery.refetch()} disabled={profilesQuery.isFetching}>
          <RefreshCw size={16} className={profilesQuery.isFetching ? 'spin' : ''} aria-hidden="true" />Actualizar
        </button>
      </header>

      {profilesQuery.error ? <div className="notice notice-error" role="alert"><AlertCircle size={18} /><div><strong>No se pudieron cargar las conexiones.</strong><span>{readableError(profilesQuery.error)}</span></div></div> : null}

      <div className="metric-strip" aria-label="Resumen de conexiones">
        <div className="metric"><span className="metric-symbol"><Server size={18} /></span><div><span>Conexiones</span><strong>{profiles.length}</strong></div></div>
        <div className="metric"><span className="metric-symbol"><DatabaseZap size={18} /></span><div><span>Namespaces</span><strong>{namespaceCount}</strong></div></div>
        <div className="metric"><span className="metric-symbol"><Eye size={18} /></span><div><span>Operaciones habilitadas</span><strong>{writableCount}</strong></div></div>
      </div>

      <div className="table-section">
        <div className="section-heading"><div><h2>Conexiones</h2><span>{profiles.length} perfiles locales</span></div></div>
        {profilesQuery.isLoading ? <div className="table-skeleton" aria-label="Cargando conexiones" aria-busy="true">{Array.from({ length: 3 }, (_, index) => <div className="skeleton-row" key={index}><span className="skeleton skeleton-square" /><span className="skeleton skeleton-wide" /><span className="skeleton" /></div>)}</div> : profiles.length === 0 ? (
          <div className="empty-state"><Server size={28} /><h3>No hay conexiones configuradas</h3><p>Crea una conexión para empezar a explorar recursos.</p></div>
        ) : (
          <div className="data-table-wrap">
            <table className="data-table connection-table">
              <thead><tr><th>Conexión</th><th>Broker</th><th>Modo</th><th>Acceso</th><th><span className="sr-only">Explorar</span></th></tr></thead>
              <tbody>{profiles.map((profile) => (
                <tr key={profile.id} className="clickable-row" tabIndex={0} onClick={() => onExplore(profile)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onExplore(profile) } }}>
                  <td><strong>{profile.name}</strong><span>Actualizado localmente</span></td>
                  <td><span className={`broker-inline broker-${profile.brokerType}`}><BrokerIcon brokerType={profile.brokerType} />{brokerName(profile.brokerType)}</span></td>
                  <td><span>{profile.configuration['profileMode'] === 'namespace' ? 'Namespace' : 'Ruta fija'}</span></td>
                  <td><span className="inline-muted">{profile.readOnly ? <Eye size={14} /> : <EyeOff size={14} />}{profile.readOnly ? 'Solo lectura' : 'Requeue habilitado'}</span></td>
                  <td><button className="icon-button" tabIndex={-1} aria-hidden="true"><ArrowRight size={17} /></button></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  )
}

function BrokerIcon({ brokerType }: { brokerType: BrokerType }): React.JSX.Element {
  if (brokerType === 'rabbitmq') return <Rabbit size={16} aria-hidden="true" />
  if (brokerType === 'azure-service-bus') return <Cloud size={16} aria-hidden="true" />
  if (brokerType === 'kafka') return <Waypoints size={16} aria-hidden="true" />
  return <DatabaseZap size={16} aria-hidden="true" />
}

function brokerName(brokerType: BrokerType): string {
  if (brokerType === 'azure-service-bus') return 'Azure Service Bus'
  if (brokerType === 'rabbitmq') return 'RabbitMQ'
  if (brokerType === 'kafka') return 'Apache Kafka'
  return 'Demo'
}

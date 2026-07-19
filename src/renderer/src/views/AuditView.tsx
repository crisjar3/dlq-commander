import { useQuery } from '@tanstack/react-query'
import { ClipboardList, RefreshCw } from 'lucide-react'
import { StatusBadge } from '../components/StatusBadge'
import { formatDate, invoke } from '../lib/api'

export function AuditView(): React.JSX.Element {
  const auditQuery = useQuery({ queryKey: ['audit'], queryFn: () => invoke('listAudit', { limit: 250 }) })
  return <section className="view" aria-labelledby="audit-title">
    <header className="view-header"><div><h1 id="audit-title">Auditoría</h1><p className="view-subtitle">Intentos y resultados de operaciones que modifican mensajes.</p></div><button className="button button-secondary" onClick={() => void auditQuery.refetch()} disabled={auditQuery.isFetching}><RefreshCw size={16} className={auditQuery.isFetching ? 'spin' : ''} />Actualizar</button></header>
    <div className="table-section">
      {auditQuery.isLoading ? <div className="table-skeleton" aria-label="Cargando auditoría" aria-busy="true">{Array.from({ length: 4 }, (_, index) => <div className="skeleton-row" key={index}><span className="skeleton skeleton-wide" /><span className="skeleton" /><span className="skeleton" /><span className="skeleton skeleton-short" /></div>)}</div> : (auditQuery.data ?? []).length === 0 ? <div className="empty-state"><ClipboardList size={28} /><h3>Aún no hay operaciones registradas</h3><p>Los requeues iniciados y finalizados aparecerán aquí.</p></div> : <div className="data-table-wrap"><table className="data-table"><thead><tr><th>Fecha</th><th>Acción</th><th>Origen</th><th>Destino</th><th>Solicitados</th><th>Resultado</th><th>Estado</th></tr></thead><tbody>{auditQuery.data?.map((entry) => <tr key={entry.id}><td>{formatDate(entry.createdAt)}</td><td><strong>{entry.action}</strong><span><code>{entry.id.slice(0, 8)}</code></span></td><td><code>{entry.sourceId ?? '-'}</code></td><td><code>{entry.targetName ?? '-'}</code></td><td className="numeric">{entry.requested}</td><td><span className="result-count success-text">{entry.succeeded} ok</span><span className={entry.failed > 0 ? 'result-count danger-text' : 'result-count'}>{entry.failed} fallidos</span></td><td><StatusBadge status={entry.status} /></td></tr>)}</tbody></table></div>}
    </div>
  </section>
}

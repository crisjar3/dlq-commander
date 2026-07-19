import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Activity, ClipboardList, DatabaseZap, LayoutDashboard, Moon, PlugZap, Settings, Sun } from 'lucide-react'
import type { ConnectionProfile, OperationJob, SourceSummary } from '@shared/domain'
import { invoke } from './lib/api'
import { DashboardView } from './views/DashboardView'
import { ConnectionsView } from './views/ConnectionsView'
import { InspectorView } from './views/InspectorView'
import { AuditView } from './views/AuditView'

type View = 'dashboard' | 'connections' | 'audit' | 'settings' | 'inspector'

interface InspectorSelection {
  source: SourceSummary
  profile: ConnectionProfile
}

export function App(): React.JSX.Element {
  const queryClient = useQueryClient()
  const [view, setView] = useState<View>('dashboard')
  const [selection, setSelection] = useState<InspectorSelection | null>(null)
  const [theme, setTheme] = useState<'light' | 'dark'>(() => localStorage.getItem('dlq-theme') === 'dark' ? 'dark' : 'light')
  const [activeJob, setActiveJob] = useState<OperationJob | null>(null)
  const healthQuery = useQuery({ queryKey: ['health'], queryFn: () => invoke('health', {}) })

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('dlq-theme', theme)
  }, [theme])

  useEffect(() => window.dlqCommander.onJobProgress((job) => {
    setActiveJob(job)
    void queryClient.invalidateQueries({ queryKey: ['jobs'] })
    if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
      void queryClient.invalidateQueries({ queryKey: ['sources', job.profileId] })
      void queryClient.invalidateQueries({ queryKey: ['messages', job.profileId, job.sourceId] })
      void queryClient.invalidateQueries({ queryKey: ['audit'] })
    }
  }), [queryClient])

  const navigate = (nextView: Exclude<View, 'inspector'>): void => {
    setView(nextView)
    setSelection(null)
  }

  const inspect = (source: SourceSummary, profile: ConnectionProfile): void => {
    setSelection({ source, profile })
    setView('inspector')
  }

  return <div className="app-shell" data-testid="app-shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark"><DatabaseZap size={22} /></span><div><strong>DLQCommander</strong><small>Operations console</small></div></div>
      <nav aria-label="Navegación principal">
        <button title="Dashboard" aria-current={view === 'dashboard' || view === 'inspector' ? 'page' : undefined} className={view === 'dashboard' || view === 'inspector' ? 'active' : ''} onClick={() => navigate('dashboard')}><LayoutDashboard size={19} /><span>Dashboard</span></button>
        <button title="Conexiones" aria-current={view === 'connections' ? 'page' : undefined} className={view === 'connections' ? 'active' : ''} onClick={() => navigate('connections')}><PlugZap size={19} /><span>Conexiones</span></button>
        <button title="Auditoría" aria-current={view === 'audit' ? 'page' : undefined} className={view === 'audit' ? 'active' : ''} onClick={() => navigate('audit')}><ClipboardList size={19} /><span>Auditoría</span></button>
      </nav>
      <div className="sidebar-bottom">
        <button title="Ajustes" aria-current={view === 'settings' ? 'page' : undefined} onClick={() => navigate('settings')} className={view === 'settings' ? 'active' : ''}><Settings size={19} /><span>Ajustes</span></button>
        <button title={theme === 'light' ? 'Activar tema oscuro' : 'Activar tema claro'} aria-label={theme === 'light' ? 'Activar tema oscuro' : 'Activar tema claro'} onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}><span>{theme === 'light' ? <Moon size={19} /> : <Sun size={19} />}</span><span>{theme === 'light' ? 'Tema oscuro' : 'Tema claro'}</span></button>
        <div className="local-status"><span className={healthQuery.data?.ok ? 'online' : ''} /><div><strong>{healthQuery.data?.ok ? 'Servicio local activo' : 'Conectando servicio'}</strong><small>{healthQuery.data ? `v${healthQuery.data.version} · ${healthQuery.data.encryptionAvailable ? 'Cifrado activo' : 'Sin cifrado'}` : 'Validando IPC'}</small></div></div>
      </div>
    </aside>
    <main id="main-content">
      {view === 'dashboard' ? <DashboardView onInspect={inspect} /> : null}
      {view === 'connections' ? <ConnectionsView /> : null}
      {view === 'audit' ? <AuditView /> : null}
      {view === 'inspector' && selection ? <InspectorView source={selection.source} profile={selection.profile} activeJob={activeJob} onBack={() => navigate('dashboard')} /> : null}
      {view === 'settings' ? <section className="view"><header className="view-header"><div><h1>Ajustes</h1><p className="view-subtitle">Preferencias locales de DLQCommander.</p></div></header><div className="settings-band"><Activity size={20} /><div><strong>Modo conservador</strong><p>Los perfiles nuevos comienzan en solo lectura y cada operación requiere confirmación.</p></div></div></section> : null}
    </main>
  </div>
}

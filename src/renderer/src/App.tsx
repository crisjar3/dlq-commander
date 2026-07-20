import { useEffect, useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Activity,
  ClipboardList,
  DatabaseZap,
  LayoutDashboard,
  Monitor,
  Moon,
  Palette,
  PlugZap,
  Settings,
  Sun
} from 'lucide-react'
import type { ConnectionProfile, DiscoveredEntity, OperationJob, SourceSummary } from '@shared/domain'
import { invoke } from './lib/api'
import { useTheme, type ResolvedTheme, type ThemePreference } from './lib/theme'
import { DashboardView } from './views/DashboardView'
import { ConnectionsView } from './views/ConnectionsView'
import { InspectorView } from './views/InspectorView'
import { AuditView } from './views/AuditView'
import { ResourceExplorerView } from './views/ResourceExplorerView'

type View = 'dashboard' | 'connections' | 'audit' | 'settings' | 'resources' | 'inspector'

interface InspectorSelection {
  source: SourceSummary
  profile: ConnectionProfile
}

export function App(): React.JSX.Element {
  const queryClient = useQueryClient()
  const [view, setView] = useState<View>('dashboard')
  const [selection, setSelection] = useState<InspectorSelection | null>(null)
  const [resourceProfile, setResourceProfile] = useState<ConnectionProfile | null>(null)
  const [initialResource, setInitialResource] = useState<DiscoveredEntity | null>(null)
  const [activeJob, setActiveJob] = useState<OperationJob | null>(null)
  const { preference, resolvedTheme, setPreference, toggleResolvedTheme } = useTheme()
  const healthQuery = useQuery({ queryKey: ['health'], queryFn: () => invoke('health', {}) })

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
    setResourceProfile(null)
    setInitialResource(null)
  }

  const explore = (profile: ConnectionProfile, resource: DiscoveredEntity | null = null): void => {
    setResourceProfile(profile)
    setInitialResource(resource)
    setSelection(null)
    setView('resources')
  }

  const inspect = (source: SourceSummary, profile: ConnectionProfile): void => {
    setInitialResource(null)
    setSelection({ source, profile })
    setView('inspector')
  }

  const themeAction = resolvedTheme === 'light' ? 'Activar tema oscuro' : 'Activar tema claro'

  return <div className="app-shell" data-testid="app-shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark"><DatabaseZap size={22} /></span><div><strong>DLQCommander</strong><small>Operations console</small></div></div>
      <nav aria-label="Navegación principal">
        <button title="Dashboard" aria-current={view === 'dashboard' || view === 'resources' || view === 'inspector' ? 'page' : undefined} className={view === 'dashboard' || view === 'resources' || view === 'inspector' ? 'active' : ''} onClick={() => navigate('dashboard')}><LayoutDashboard size={19} /><span>Dashboard</span></button>
        <button title="Conexiones" aria-current={view === 'connections' ? 'page' : undefined} className={view === 'connections' ? 'active' : ''} onClick={() => navigate('connections')}><PlugZap size={19} /><span>Conexiones</span></button>
        <button title="Auditoría" aria-current={view === 'audit' ? 'page' : undefined} className={view === 'audit' ? 'active' : ''} onClick={() => navigate('audit')}><ClipboardList size={19} /><span>Auditoría</span></button>
      </nav>
      <div className="sidebar-bottom">
        <button title="Ajustes" aria-current={view === 'settings' ? 'page' : undefined} onClick={() => navigate('settings')} className={view === 'settings' ? 'active' : ''}><Settings size={19} /><span>Ajustes</span></button>
        <button title={themeAction} aria-label={themeAction} onClick={toggleResolvedTheme}><span>{resolvedTheme === 'light' ? <Moon size={19} /> : <Sun size={19} />}</span><span>{resolvedTheme === 'light' ? 'Tema oscuro' : 'Tema claro'}</span></button>
        <div className="local-status"><span className={healthQuery.data?.ok ? 'online' : ''} /><div><strong>{healthQuery.data?.ok ? 'Servicio local activo' : 'Conectando servicio'}</strong><small>{healthQuery.data ? `v${healthQuery.data.version} · ${healthQuery.data.encryptionAvailable ? 'Cifrado activo' : 'Sin cifrado'}` : 'Validando IPC'}</small></div></div>
      </div>
    </aside>
    <main id="main-content">
      {view === 'dashboard' ? <DashboardView onExplore={explore} /> : null}
      {view === 'connections' ? <ConnectionsView onExplore={explore} /> : null}
      {view === 'audit' ? <AuditView /> : null}
      {view === 'resources' && resourceProfile ? <ResourceExplorerView profile={resourceProfile} initialResource={initialResource} onInspect={inspect} onBack={() => navigate('dashboard')} /> : null}
      {view === 'inspector' && selection ? <InspectorView source={selection.source} profile={selection.profile} activeJob={activeJob} onBack={() => resourceProfile ? setView('resources') : navigate('dashboard')} /> : null}
      {view === 'settings' ? <SettingsView themePreference={preference} resolvedTheme={resolvedTheme} onThemeChange={setPreference} /> : null}
    </main>
  </div>
}

interface SettingsViewProps {
  themePreference: ThemePreference
  resolvedTheme: ResolvedTheme
  onThemeChange(preference: ThemePreference): void
}

function SettingsView({ themePreference, resolvedTheme, onThemeChange }: SettingsViewProps): React.JSX.Element {
  const appearanceStatus = themePreference === 'system'
    ? `Sistema · ${resolvedTheme === 'dark' ? 'oscuro' : 'claro'}`
    : themePreference === 'dark' ? 'Oscuro' : 'Claro'

  return (
    <section className="view" aria-labelledby="settings-title">
      <header className="view-header"><div><h1 id="settings-title">Ajustes</h1><p className="view-subtitle">Preferencias locales de DLQCommander.</p></div></header>
      <div className="settings-list">
        <section className="settings-row" aria-labelledby="appearance-title">
          <div className="settings-symbol"><Palette size={20} aria-hidden="true" /></div>
          <div className="settings-copy"><h2 id="appearance-title">Apariencia</h2><p>{appearanceStatus}</p></div>
          <fieldset className="segmented theme-selector">
            <legend className="sr-only">Tema de la aplicación</legend>
            <ThemeOption active={themePreference === 'system'} label="Sistema" icon={<Monitor size={16} />} onClick={() => onThemeChange('system')} />
            <ThemeOption active={themePreference === 'light'} label="Claro" icon={<Sun size={16} />} onClick={() => onThemeChange('light')} />
            <ThemeOption active={themePreference === 'dark'} label="Oscuro" icon={<Moon size={16} />} onClick={() => onThemeChange('dark')} />
          </fieldset>
        </section>
        <section className="settings-row" aria-labelledby="safety-title">
          <div className="settings-symbol"><Activity size={20} aria-hidden="true" /></div>
          <div className="settings-copy"><h2 id="safety-title">Modo conservador</h2><p>Los perfiles nuevos comienzan en solo lectura y cada operación requiere confirmación.</p></div>
        </section>
      </div>
    </section>
  )
}

interface ThemeOptionProps {
  active: boolean
  label: string
  icon: ReactNode
  onClick(): void
}

function ThemeOption({ active, label, icon, onClick }: ThemeOptionProps): React.JSX.Element {
  return <button type="button" className={active ? 'active' : ''} aria-pressed={active} onClick={onClick}>{icon}<span>{label}</span></button>
}

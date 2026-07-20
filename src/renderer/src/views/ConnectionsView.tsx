import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertCircle,
  Cable,
  Check,
  Cloud,
  DatabaseZap,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  Plus,
  Rabbit,
  RefreshCw,
  Search,
  Server,
  Trash2,
  Waypoints,
  X
} from 'lucide-react'
import type {
  BrokerDiscoveryInput,
  BrokerType,
  ConnectionProfile,
  ConnectionProfileInput,
  DiscoveredEntity,
  ResourceCollection
} from '@shared/domain'
import { discoveryErrorState, type DiscoveryUiState } from '@shared/connection-discovery'
import { ResourceExplorerList } from '../components/ResourceExplorerList'
import { invoke, parseAppError, readableError } from '../lib/api'

interface ConnectionsViewProps {
  onExplore(profile: ConnectionProfile, initialResource?: DiscoveredEntity | null): void
}

interface FormState {
  name: string
  brokerType: Exclude<BrokerType, 'demo'>
  readOnly: boolean
  host: string
  port: string
  vhost: string
  tls: boolean
  managementUrl: string
  sourceKind: 'queue' | 'subscription'
  sourceTopic: string
  sourceQueue: string
  targetKind: 'queue' | 'topic'
  targetQueue: string
  username: string
  password: string
  connectionString: string
  bootstrapServers: string
  clientId: string
}

type ConnectionField = 'host' | 'port' | 'vhost' | 'tls' | 'managementUrl' | 'username' | 'password' | 'connectionString' | 'bootstrapServers' | 'clientId'

interface DiscoveryRequest {
  input: BrokerDiscoveryInput
  revision: number
  resume: boolean
}

interface DiscoverySession {
  input: BrokerDiscoveryInput
  revision: number
  entities: Map<string, DiscoveredEntity>
  cursors: Map<string, string | null>
  completed: Set<string>
  seenCursors: Set<string>
  totalByCollection: Map<string, number | null>
  latencyMs: number
}

const initialForm: FormState = {
  name: '', brokerType: 'rabbitmq', readOnly: true,
  host: 'localhost', port: '5672', vhost: '/', tls: false, managementUrl: '',
  sourceKind: 'queue', sourceTopic: '', sourceQueue: '', targetKind: 'queue', targetQueue: '',
  username: 'dlqcommander', password: '', connectionString: '',
  bootstrapServers: 'localhost:9092', clientId: 'dlq-commander'
}

export function ConnectionsView({ onExplore }: ConnectionsViewProps): React.JSX.Element {
  const queryClient = useQueryClient()
  const profilesQuery = useQuery({ queryKey: ['profiles'], queryFn: () => invoke('listProfiles', {}) })
  const [formOpen, setFormOpen] = useState(false)
  const [form, setForm] = useState<FormState>(initialForm)
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'error'; text: string } | null>(null)
  const [discoveryState, setDiscoveryState] = useState<DiscoveryUiState>('initial')
  const [entities, setEntities] = useState<DiscoveredEntity[]>([])
  const [selectedEntity, setSelectedEntity] = useState<DiscoveredEntity | null>(null)
  const [discoveryError, setDiscoveryError] = useState('')
  const [discoveryLatency, setDiscoveryLatency] = useState<number | null>(null)
  const [discoveryTotal, setDiscoveryTotal] = useState<number | null>(null)
  const discoveryRevision = useRef(0)
  const discoverySession = useRef<DiscoverySession | null>(null)

  const resetDialog = (): void => {
    discoveryRevision.current += 1
    setForm(initialForm)
    setEntities([])
    setSelectedEntity(null)
    setDiscoveryState('initial')
    setDiscoveryError('')
    setDiscoveryLatency(null)
    setDiscoveryTotal(null)
    discoverySession.current = null
  }

  const saveMutation = useMutation({
    mutationFn: (input: ConnectionProfileInput) => invoke('saveProfile', input),
    onSuccess: async (profile) => {
      await queryClient.invalidateQueries({ queryKey: ['profiles'] })
      const initialResource = selectedEntity
      setFormOpen(false)
      resetDialog()
      setFeedback({ tone: 'success', text: 'Conexión guardada. Las credenciales quedaron cifradas por el sistema operativo.' })
      onExplore(profile, initialResource)
    },
    onError: (error) => setFeedback({ tone: 'error', text: readableError(error) })
  })
  const discoveryMutation = useMutation({
    mutationFn: async ({ input, revision, resume }: DiscoveryRequest) => {
      const collections = discoveryCollections(input.brokerType)
      let session = discoverySession.current
      if (!resume || !session || session.revision !== revision) {
        session = {
          input,
          revision,
          entities: new Map(),
          cursors: new Map(collections.map((collection) => [collectionKey(collection), null])),
          completed: new Set(),
          seenCursors: new Set(),
          totalByCollection: new Map(),
          latencyMs: 0
        }
        discoverySession.current = session
      }

      const loadCollection = async (collection: ResourceCollection): Promise<void> => {
        const key = collectionKey(collection)
        if (session.completed.has(key)) return
        let cursor = session.cursors.get(key) ?? null
        do {
          const result = await invoke('discoverResourcePage', {
            connection: input,
            request: { collection, cursor, pageSize: 50, force: false }
          })
          if (revision !== discoveryRevision.current) return
          for (const entity of result.entities) session.entities.set(entity.key, entity)
          session.latencyMs += result.latencyMs
          session.totalByCollection.set(key, result.totalCount)
          cursor = result.nextCursor
          if (cursor && session.seenCursors.has(cursor)) throw new Error('El broker devolvio un cursor repetido')
          if (cursor) session.seenCursors.add(cursor)
          session.cursors.set(key, cursor)
          setEntities([...session.entities.values()])
          setDiscoveryLatency(session.latencyMs)
          setDiscoveryTotal(sumKnownTotals(session.totalByCollection))
        } while (cursor)
        session.completed.add(key)
      }

      await Promise.all(collections.map(loadCollection))
      return { entities: [...session.entities.values()], latencyMs: session.latencyMs }
    },
    onMutate: (request) => {
      setDiscoveryState('discovering')
      setDiscoveryError('')
      if (!request.resume) {
        setEntities([])
        setDiscoveryLatency(null)
        setDiscoveryTotal(null)
        setSelectedEntity(null)
      }
    },
    onSuccess: (result, request) => {
      if (request.revision !== discoveryRevision.current) return
      setEntities(result.entities)
      setDiscoveryLatency(result.latencyMs)
      setDiscoveryState(result.entities.length === 0 ? 'empty' : 'success')
    },
    onError: (error, request) => {
      if (request.revision !== discoveryRevision.current) return
      const parsed = parseAppError(error)
      setSelectedEntity(null)
      setDiscoveryError(parsed.message)
      setDiscoveryState(discoveryErrorState(parsed.code))
    }
  })
  const testMutation = useMutation({
    mutationFn: (id: string) => invoke('testProfile', { id }),
    onSuccess: (result) => setFeedback({ tone: 'success', text: `${result.message} · ${result.latencyMs} ms` }),
    onError: (error) => setFeedback({ tone: 'error', text: readableError(error) })
  })
  const deleteMutation = useMutation({
    mutationFn: (id: string) => invoke('deleteProfile', { id }),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ['profiles'] }),
    onError: (error) => setFeedback({ tone: 'error', text: readableError(error) })
  })
  const busy = saveMutation.isPending || discoveryMutation.isPending

  useEffect(() => {
    if (!formOpen) return
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !busy) { setFormOpen(false); resetDialog() }
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [busy, formOpen])

  const updateConnectionField = <K extends ConnectionField>(field: K, value: FormState[K]): void => {
    discoveryRevision.current += 1
    setForm((current) => ({ ...current, [field]: value }))
    if (discoveryState !== 'manual') {
      setEntities([])
      setSelectedEntity(null)
      setDiscoveryError('')
      setDiscoveryLatency(null)
      setDiscoveryTotal(null)
      discoverySession.current = null
      if (discoveryState !== 'initial') setDiscoveryState('stale')
    }
  }

  const switchBroker = (brokerType: FormState['brokerType']): void => {
    discoveryRevision.current += 1
    setForm((current) => ({ ...initialForm, name: current.name, readOnly: current.readOnly, brokerType }))
    setEntities([]); setSelectedEntity(null); setDiscoveryState('initial'); setDiscoveryError(''); setDiscoveryLatency(null); setDiscoveryTotal(null); discoverySession.current = null
  }
  const discover = (): void => discoveryMutation.mutate({ input: buildDiscoveryInput(form), revision: discoveryRevision.current, resume: false })
  const retryDiscovery = (): void => {
    const session = discoverySession.current
    if (session && session.revision === discoveryRevision.current) {
      discoveryMutation.mutate({ input: session.input, revision: session.revision, resume: true })
    } else {
      discover()
    }
  }
  const closeDialog = (): void => { if (!busy) { setFormOpen(false); resetDialog() } }
  const submit = (event: FormEvent): void => {
    event.preventDefault()
    if (canSaveProfile(form, discoveryState)) saveMutation.mutate(buildProfileInput(form, discoveryState))
  }
  const confirmDelete = (id: string, name: string): void => {
    if (window.confirm(`Eliminar el perfil "${name}"? Las credenciales cifradas también se eliminarán.`)) deleteMutation.mutate(id)
  }

  return (
    <section className="view" aria-labelledby="connections-title">
      <header className="view-header"><div><h1 id="connections-title">Conexiones</h1><p className="view-subtitle">Namespaces locales y credenciales protegidas por el sistema operativo.</p></div><button className="button button-primary" onClick={() => { resetDialog(); setFormOpen(true) }}><Plus size={16} />Nueva conexión</button></header>
      {feedback ? <div className={`notice notice-${feedback.tone}`} role={feedback.tone === 'error' ? 'alert' : 'status'}>{feedback.tone === 'success' ? <Check size={18} /> : <AlertCircle size={18} />}<span>{feedback.text}</span><button className="icon-button" aria-label="Cerrar aviso" onClick={() => setFeedback(null)}><X size={16} /></button></div> : null}

      <div className="connection-list">
        {profilesQuery.isLoading ? Array.from({ length: 2 }, (_, index) => <div className="connection-row connection-skeleton" key={index} aria-hidden="true"><span className="skeleton skeleton-square" /><span className="skeleton skeleton-wide" /><span className="skeleton" /><span className="skeleton skeleton-button" /></div>) : (profilesQuery.data ?? []).map((profile) => {
          const isTesting = testMutation.isPending && testMutation.variables === profile.id
          return <article className="connection-row" key={profile.id}>
            <div className={`broker-mark broker-${profile.brokerType}`}><BrokerIcon brokerType={profile.brokerType} /></div>
            <div className="connection-main"><h2>{profile.name}</h2><p>{brokerName(profile.brokerType)} · {profile.configuration['profileMode'] === 'namespace' ? 'Namespace' : 'Ruta fija'}</p></div>
            <div className="connection-meta"><span><LockKeyhole size={14} />{profile.readOnly ? 'Solo lectura' : 'Operaciones habilitadas'}</span><span><KeyRound size={14} />{profile.brokerType === 'demo' || profile.brokerType === 'kafka' ? 'Sin credenciales' : 'Cifrado local'}</span></div>
            <div className="row-actions"><button className="button button-secondary" onClick={() => onExplore(profile)}><Search size={16} />Explorar</button><button className="button button-secondary" onClick={() => testMutation.mutate(profile.id)} disabled={testMutation.isPending}>{isTesting ? <LoaderCircle size={16} className="spin" /> : <Cable size={16} />}{isTesting ? 'Probando' : 'Probar'}</button>{profile.brokerType !== 'demo' ? <button className="icon-button danger" aria-label={`Eliminar ${profile.name}`} onClick={() => confirmDelete(profile.id, profile.name)}><Trash2 size={17} /></button> : null}</div>
          </article>
        })}
      </div>

      {formOpen ? <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeDialog() }}>
        <section className="modal connection-modal namespace-modal" role="dialog" aria-modal="true" aria-labelledby="connection-form-title">
          <header className="modal-header"><div><h2 id="connection-form-title">Conectar broker</h2><p className="modal-subtitle">Valida el namespace y revisa sus recursos antes de guardarlo.</p></div><button className="icon-button" aria-label="Cerrar" onClick={closeDialog} disabled={busy}><X size={18} /></button></header>
          <form onSubmit={submit}>
            <div className="form-grid">
              <label className="field field-wide"><span>Nombre del perfil</span><input autoFocus required minLength={2} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Producción pagos" /></label>
              <fieldset className="field field-wide"><legend>Broker</legend><div className="segmented three"><button type="button" aria-pressed={form.brokerType === 'rabbitmq'} className={form.brokerType === 'rabbitmq' ? 'active' : ''} onClick={() => switchBroker('rabbitmq')}><Rabbit size={16} />RabbitMQ</button><button type="button" aria-pressed={form.brokerType === 'azure-service-bus'} className={form.brokerType === 'azure-service-bus' ? 'active' : ''} onClick={() => switchBroker('azure-service-bus')}><Cloud size={16} />Azure Service Bus</button><button type="button" aria-pressed={form.brokerType === 'kafka'} className={form.brokerType === 'kafka' ? 'active' : ''} onClick={() => switchBroker('kafka')}><Waypoints size={16} />Kafka</button></div></fieldset>
              <div className="form-section-heading field-wide"><span>Endpoint</span></div>
              {form.brokerType === 'rabbitmq' ? <RabbitFields form={form} onChange={updateConnectionField} /> : form.brokerType === 'azure-service-bus' ? <label className="field field-wide"><span>Connection string</span><textarea required rows={3} value={form.connectionString} onChange={(event) => updateConnectionField('connectionString', event.target.value)} placeholder="Endpoint=sb://..." /></label> : <><label className="field field-wide"><span>Bootstrap servers</span><input required value={form.bootstrapServers} onChange={(event) => updateConnectionField('bootstrapServers', event.target.value)} /></label><label className="field field-wide"><span>Client ID</span><input required value={form.clientId} onChange={(event) => updateConnectionField('clientId', event.target.value)} /></label></>}
              <div className="discovery-action field-wide"><button type="button" className="button button-secondary" onClick={discover} disabled={!canDiscover(form) || discoveryMutation.isPending}>{discoveryMutation.isPending ? <LoaderCircle size={16} className="spin" /> : discoveryState === 'stale' ? <RefreshCw size={16} /> : <Cable size={16} />}{discoveryMutation.isPending ? 'Buscando recursos' : discoveryState === 'stale' ? 'Buscar nuevamente' : 'Conectar y buscar'}</button></div>
              <div className="form-section-heading field-wide"><span>Recursos</span></div>
              <DiscoveryArea state={discoveryState} brokerType={form.brokerType} entities={entities} selected={selectedEntity} latency={discoveryLatency} total={discoveryTotal} error={discoveryError} form={form} onSelect={setSelectedEntity} onRetry={retryDiscovery} onEnterManual={() => { discoveryRevision.current += 1; setEntities([]); setSelectedEntity(null); setDiscoveryError(''); setDiscoveryState('manual') }} onLeaveManual={() => { discoveryRevision.current += 1; setForm((current) => ({ ...current, sourceQueue: '', sourceTopic: '', targetQueue: '' })); setDiscoveryState('initial') }} onManualChange={setForm} />
              <label className="toggle field-wide"><input type="checkbox" checked={form.readOnly} onChange={(event) => setForm({ ...form, readOnly: event.target.checked })} /><span className="toggle-track" /><span><strong>Solo lectura</strong><small>Bloquea requeue y operaciones masivas.</small></span></label>
            </div>
            <footer className="modal-actions"><button type="button" className="button button-secondary" onClick={closeDialog} disabled={busy}>Cancelar</button><button type="submit" className="button button-primary" disabled={busy || !canSaveProfile(form, discoveryState)}>{saveMutation.isPending ? 'Guardando...' : discoveryState === 'manual' ? 'Guardar ruta fija' : 'Guardar y explorar'}</button></footer>
          </form>
        </section>
      </div> : null}
    </section>
  )
}

interface RabbitFieldsProps { form: FormState; onChange<K extends ConnectionField>(field: K, value: FormState[K]): void }
function RabbitFields({ form, onChange }: RabbitFieldsProps): React.JSX.Element {
  const derived = `${form.tls ? 'https' : 'http'}://${form.host || 'host'}:${form.tls ? '15671' : '15672'}`
  return <><label className="field"><span>Host</span><input required value={form.host} onChange={(event) => onChange('host', event.target.value)} /></label><label className="field"><span>Puerto AMQP</span><input required type="number" min="1" max="65535" value={form.port} onChange={(event) => onChange('port', event.target.value)} /></label><label className="field"><span>Virtual host</span><input required value={form.vhost} onChange={(event) => onChange('vhost', event.target.value)} /></label><label className="field"><span>Usuario</span><input required autoComplete="username" value={form.username} onChange={(event) => onChange('username', event.target.value)} /></label><label className="field field-wide"><span>Contraseña</span><input required type="password" autoComplete="new-password" value={form.password} onChange={(event) => onChange('password', event.target.value)} /></label><details className="advanced-options field-wide"><summary>Opciones avanzadas</summary><div className="advanced-options-content"><label className="toggle"><input type="checkbox" checked={form.tls} onChange={(event) => onChange('tls', event.target.checked)} /><span className="toggle-track" /><span><strong>TLS</strong><small>Usa AMQPS y Management API segura.</small></span></label><label className="field"><span>Management URL</span><input type="url" value={form.managementUrl} onChange={(event) => onChange('managementUrl', event.target.value)} placeholder={derived} /></label></div></details></>
}

interface DiscoveryAreaProps { state: DiscoveryUiState; brokerType: FormState['brokerType']; entities: DiscoveredEntity[]; selected: DiscoveredEntity | null; latency: number | null; total: number | null; error: string; form: FormState; onSelect(entity: DiscoveredEntity): void; onRetry(): void; onEnterManual(): void; onLeaveManual(): void; onManualChange(form: FormState): void }
function DiscoveryArea(props: DiscoveryAreaProps): React.JSX.Element {
  if (props.state === 'success') return <div className="discovery-preview field-wide" aria-live="polite"><div className="routing-status-line"><span className="success-text"><Check size={15} />{props.entities.length} recursos · {props.latency ?? 0} ms</span><button type="button" className="text-button" onClick={props.onEnterManual}>Ingresar manualmente</button></div><ResourceExplorerList id="connection-preview" entities={props.entities} brokerType={props.brokerType} selectedKey={props.selected?.key} compact complete totalCount={props.total} searchPlaceholder="Buscar queue o topic" onActivate={props.onSelect} /></div>
  if (props.state === 'manual') return <ManualRouting form={props.form} onChange={props.onManualChange} onLeave={props.onLeaveManual} />
  if (props.state === 'discovering' && props.entities.length > 0) return <div className="discovery-preview field-wide" aria-live="polite"><div className="routing-status-line"><span><LoaderCircle size={15} className="spin" />{props.entities.length} cargados · cargando...</span></div><ResourceExplorerList id="connection-preview-loading" entities={props.entities} brokerType={props.brokerType} selectedKey={props.selected?.key} compact loadingMore complete={false} totalCount={props.total} searchPlaceholder="Buscar mientras carga" onActivate={props.onSelect} /></div>
  if (props.state === 'discovering') return <div className="routing-feedback routing-loading field-wide" role="status"><LoaderCircle size={18} className="spin" /><div><strong>Consultando el namespace</strong><span>Validando endpoint, credenciales y permisos de administración.</span></div></div>
  if ((props.state === 'permission-denied' || props.state === 'network-error') && props.entities.length > 0) return <div className="discovery-preview field-wide"><ResourceExplorerList id="connection-preview-partial" entities={props.entities} brokerType={props.brokerType} selectedKey={props.selected?.key} compact complete={false} totalCount={props.total} loadError={props.error} onRetry={props.onRetry} searchPlaceholder="Buscar en recursos cargados" onActivate={props.onSelect} /><div className="routing-status-line"><button type="button" className="text-button" onClick={props.onEnterManual}>Ingresar manualmente</button></div></div>
  if (props.state === 'permission-denied' || props.state === 'network-error') return <div className="routing-feedback routing-error field-wide" role="alert"><AlertCircle size={18} /><div><strong>{props.state === 'permission-denied' ? 'Permisos insuficientes' : 'No fue posible completar la búsqueda'}</strong><span>{props.error}</span><div className="inline-actions"><button type="button" className="text-button" onClick={props.onRetry}>Reintentar</button><button type="button" className="text-button" onClick={props.onEnterManual}>Ingresar manualmente</button></div></div></div>
  if (props.state === 'empty') return <div className="routing-feedback field-wide" role="status"><AlertCircle size={18} /><div><strong>El namespace no devolvió recursos</strong><span>Revisa los permisos o configura una ruta fija.</span><button type="button" className="text-button" onClick={props.onEnterManual}>Ingresar manualmente</button></div></div>
  if (props.state === 'stale') return <div className="routing-feedback routing-stale field-wide" role="status"><RefreshCw size={18} /><div><strong>La conexión cambió</strong><span>Busca nuevamente para validar los recursos.</span></div></div>
  return <div className="routing-feedback field-wide" role="status"><Cable size={18} /><div><strong>Namespace pendiente</strong><span>Conecta para cargar queues, topics y subscriptions disponibles.</span></div></div>
}

function ManualRouting({ form, onChange, onLeave }: { form: FormState; onChange(form: FormState): void; onLeave(): void }): React.JSX.Element {
  const sourceLabel = form.brokerType === 'kafka' ? 'Topic DLT' : form.sourceKind === 'subscription' ? 'Subscription' : 'Queue origen'
  return <div className="routing-manual field-wide"><div className="routing-status-line"><span>Ruta fija manual</span><button type="button" className="text-button" onClick={onLeave}>Volver a búsqueda automática</button></div>{form.brokerType === 'azure-service-bus' ? <div className="segmented manual-kind"><button type="button" className={form.sourceKind === 'queue' ? 'active' : ''} aria-pressed={form.sourceKind === 'queue'} onClick={() => onChange({ ...form, sourceKind: 'queue', sourceTopic: '' })}>Queue</button><button type="button" className={form.sourceKind === 'subscription' ? 'active' : ''} aria-pressed={form.sourceKind === 'subscription'} onClick={() => onChange({ ...form, sourceKind: 'subscription' })}>Subscription</button></div> : null}<div className="routing-grid">{form.brokerType === 'azure-service-bus' && form.sourceKind === 'subscription' ? <label className="field"><span>Topic padre</span><input required value={form.sourceTopic} onChange={(event) => onChange({ ...form, sourceTopic: event.target.value })} /></label> : null}<label className="field"><span>{sourceLabel}</span><input required value={form.sourceQueue} onChange={(event) => onChange({ ...form, sourceQueue: event.target.value })} /></label>{form.brokerType === 'azure-service-bus' ? <label className="field"><span>Tipo de destino</span><select value={form.targetKind} onChange={(event) => onChange({ ...form, targetKind: event.target.value as 'queue' | 'topic' })}><option value="queue">Queue</option><option value="topic">Topic</option></select></label> : null}<label className="field"><span>{form.brokerType === 'kafka' ? 'Topic destino' : 'Destino'}</span><input required value={form.targetQueue} onChange={(event) => onChange({ ...form, targetQueue: event.target.value })} /></label></div></div>
}

function buildDiscoveryInput(form: FormState): BrokerDiscoveryInput {
  if (form.brokerType === 'rabbitmq') return { brokerType: 'rabbitmq', scope: { kind: 'root' }, configuration: { host: form.host, port: Number(form.port), vhost: form.vhost, tls: form.tls, ...(form.managementUrl.trim() ? { managementUrl: form.managementUrl.trim() } : {}) }, secret: { username: form.username, password: form.password } }
  if (form.brokerType === 'azure-service-bus') return { brokerType: 'azure-service-bus', scope: { kind: 'root' }, configuration: {}, secret: { connectionString: form.connectionString } }
  return { brokerType: 'kafka', scope: { kind: 'root' }, configuration: { bootstrapServers: form.bootstrapServers, clientId: form.clientId }, secret: {} }
}

function buildProfileInput(form: FormState, state: DiscoveryUiState): ConnectionProfileInput {
  const fixed = state === 'manual'
  if (form.brokerType === 'rabbitmq') return { name: form.name, brokerType: 'rabbitmq', readOnly: form.readOnly, configuration: { profileMode: fixed ? 'fixed' : 'namespace', host: form.host, port: Number(form.port), vhost: form.vhost, tls: form.tls, ...(fixed ? { sourceQueue: form.sourceQueue, targetQueue: form.targetQueue } : {}), ...(form.managementUrl.trim() ? { managementUrl: form.managementUrl.trim() } : {}) }, secret: { username: form.username, password: form.password } }
  if (form.brokerType === 'azure-service-bus') return { name: form.name, brokerType: 'azure-service-bus', readOnly: form.readOnly, configuration: fixed ? { profileMode: 'fixed', sourceKind: form.sourceKind, ...(form.sourceKind === 'queue' ? { queueName: form.sourceQueue } : { topicName: form.sourceTopic, subscriptionName: form.sourceQueue }), targetKind: form.targetKind, targetName: form.targetQueue } : { profileMode: 'namespace' }, secret: { connectionString: form.connectionString } }
  return { name: form.name, brokerType: 'kafka', readOnly: form.readOnly, configuration: { profileMode: fixed ? 'fixed' : 'namespace', bootstrapServers: form.bootstrapServers, clientId: form.clientId, ...(fixed ? { dltTopic: form.sourceQueue, targetTopic: form.targetQueue } : {}) }, secret: {} }
}

function canDiscover(form: FormState): boolean {
  if (form.brokerType === 'rabbitmq') { const port = Number(form.port); return Boolean(form.host.trim() && port > 0 && port <= 65535 && form.vhost && form.username.trim() && form.password && (!form.managementUrl.trim() || URL.canParse(form.managementUrl))) }
  if (form.brokerType === 'azure-service-bus') return Boolean(form.connectionString.trim())
  return Boolean(form.bootstrapServers.trim() && form.clientId.trim())
}
function discoveryCollections(brokerType: FormState['brokerType']): ResourceCollection[] {
  if (brokerType === 'rabbitmq') return [{ kind: 'queues' }]
  if (brokerType === 'kafka') return [{ kind: 'topics' }]
  return [{ kind: 'queues' }, { kind: 'topics' }]
}
function collectionKey(collection: ResourceCollection): string {
  return collection.kind === 'subscriptions' ? `subscriptions:${collection.topicName}` : collection.kind
}
function sumKnownTotals(totals: Map<string, number | null>): number | null {
  const values = [...totals.values()]
  return values.length > 0 && values.every((value): value is number => value !== null)
    ? values.reduce((sum, value) => sum + value, 0)
    : null
}
function canSaveProfile(form: FormState, state: DiscoveryUiState): boolean { return form.name.trim().length >= 2 && canDiscover(form) && (state === 'success' || state === 'manual' && Boolean(form.sourceQueue.trim() && form.targetQueue.trim() && (form.brokerType !== 'azure-service-bus' || form.sourceKind === 'queue' || form.sourceTopic.trim()))) }
function brokerName(type: BrokerType): string { return type === 'azure-service-bus' ? 'Azure Service Bus' : type === 'rabbitmq' ? 'RabbitMQ' : type === 'kafka' ? 'Apache Kafka' : 'Entorno demo integrado' }
function BrokerIcon({ brokerType }: { brokerType: BrokerType }): React.JSX.Element { if (brokerType === 'rabbitmq') return <Rabbit size={20} />; if (brokerType === 'azure-service-bus') return <Cloud size={20} />; if (brokerType === 'kafka') return <Waypoints size={20} />; if (brokerType === 'demo') return <DatabaseZap size={20} />; return <Server size={20} /> }

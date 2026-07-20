import { useEffect, useState, type FormEvent } from 'react'
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
  Server,
  Trash2,
  Waypoints,
  X
} from 'lucide-react'
import type {
  BrokerDiscoveryInput,
  BrokerType,
  ConnectionProfileInput,
  DiscoveredEntity
} from '@shared/domain'
import { ResourceCombobox } from '../components/ResourceCombobox'
import {
  discoveryErrorState,
  selectRouting,
  suggestedSourceName,
  type DiscoveryUiState
} from '@shared/connection-discovery'
import { invoke, parseAppError, readableError } from '../lib/api'

interface FormState {
  name: string
  brokerType: Exclude<BrokerType, 'demo'>
  readOnly: boolean
  host: string
  port: string
  vhost: string
  tls: boolean
  managementUrl: string
  sourceQueue: string
  targetQueue: string
  username: string
  password: string
  connectionString: string
  bootstrapServers: string
  clientId: string
}

type ConnectionField = 'host' | 'port' | 'vhost' | 'tls' | 'managementUrl' | 'username' | 'password' | 'connectionString' | 'bootstrapServers' | 'clientId'

const initialForm: FormState = {
  name: '',
  brokerType: 'rabbitmq',
  readOnly: true,
  host: 'localhost',
  port: '5672',
  vhost: '/',
  tls: false,
  managementUrl: '',
  sourceQueue: '',
  targetQueue: '',
  username: 'dlqcommander',
  password: '',
  connectionString: '',
  bootstrapServers: 'localhost:9092',
  clientId: 'dlq-commander'
}

export function ConnectionsView(): React.JSX.Element {
  const queryClient = useQueryClient()
  const profilesQuery = useQuery({ queryKey: ['profiles'], queryFn: () => invoke('listProfiles', {}) })
  const [formOpen, setFormOpen] = useState(false)
  const [form, setForm] = useState<FormState>(initialForm)
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'error'; text: string } | null>(null)
  const [discoveryState, setDiscoveryState] = useState<DiscoveryUiState>('initial')
  const [entities, setEntities] = useState<DiscoveredEntity[]>([])
  const [discoveryError, setDiscoveryError] = useState('')
  const [discoveryLatency, setDiscoveryLatency] = useState<number | null>(null)

  function resetDialog(): void {
    setForm(initialForm)
    setEntities([])
    setDiscoveryState('initial')
    setDiscoveryError('')
    setDiscoveryLatency(null)
  }

  const saveMutation = useMutation({
    mutationFn: (input: ConnectionProfileInput) => invoke('saveProfile', input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['profiles'] })
      setFormOpen(false)
      resetDialog()
      setFeedback({ tone: 'success', text: 'Perfil guardado. Las credenciales quedaron cifradas por el sistema operativo.' })
    },
    onError: (error) => setFeedback({ tone: 'error', text: readableError(error) })
  })
  const discoveryMutation = useMutation({
    mutationFn: (input: BrokerDiscoveryInput) => invoke('discoverEntities', input),
    onMutate: () => {
      setDiscoveryState('discovering')
      setDiscoveryError('')
      setDiscoveryLatency(null)
    },
    onSuccess: (result) => {
      setEntities(result.entities)
      setDiscoveryLatency(result.latencyMs)
      if (result.entities.length === 0) {
        setForm((current) => ({ ...current, sourceQueue: '', targetQueue: '' }))
        setDiscoveryState('empty')
        return
      }
      const suggestedSource = suggestedSourceName(result.entities)
      setForm((current) => ({
        ...current,
        sourceQueue: suggestedSource,
        targetQueue: suggestedSource
      }))
      setDiscoveryState('success')
    },
    onError: (error) => {
      const parsed = parseAppError(error)
      setEntities([])
      setForm((current) => ({ ...current, sourceQueue: '', targetQueue: '' }))
      setDiscoveryError(parsed.message)
      setDiscoveryState(discoveryErrorState(parsed.code))
    }
  })
  const testMutation = useMutation({
    mutationFn: (id: string) => invoke('testProfile', { id }),
    onSuccess: (result) => setFeedback({ tone: 'success', text: `${result.message} (${result.latencyMs} ms)` }),
    onError: (error) => setFeedback({ tone: 'error', text: readableError(error) })
  })
  const deleteMutation = useMutation({
    mutationFn: (id: string) => invoke('deleteProfile', { id }),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ['profiles'] }),
    onError: (error) => setFeedback({ tone: 'error', text: readableError(error) })
  })

  const busy = saveMutation.isPending || discoveryMutation.isPending

  useEffect(() => {
    if (!formOpen) return undefined
    const closeOnEscape = (event: KeyboardEvent): void => {
      const comboboxOpen = document.querySelector('[data-headlessui-state~="open"]')
      if (event.key === 'Escape' && !busy && !comboboxOpen) {
        setFormOpen(false)
        resetDialog()
      }
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [busy, formOpen])

  const openDialog = (): void => {
    resetDialog()
    setFormOpen(true)
  }

  const closeDialog = (): void => {
    if (busy) return
    setFormOpen(false)
    resetDialog()
  }

  const switchBroker = (brokerType: FormState['brokerType']): void => {
    setForm((current) => ({ ...initialForm, name: current.name, readOnly: current.readOnly, brokerType }))
    setEntities([])
    setDiscoveryState('initial')
    setDiscoveryError('')
    setDiscoveryLatency(null)
  }

  const updateConnectionField = <K extends ConnectionField>(field: K, value: FormState[K]): void => {
    setForm((current) => ({
      ...current,
      [field]: value,
      ...(discoveryState === 'manual' ? {} : { sourceQueue: '', targetQueue: '' })
    }))
    if (discoveryState !== 'manual') {
      setEntities([])
      setDiscoveryError('')
      setDiscoveryLatency(null)
      if (discoveryState !== 'initial') setDiscoveryState('stale')
    }
  }

  const discover = (): void => {
    discoveryMutation.mutate(buildDiscoveryInput(form))
  }

  const enterManualMode = (): void => {
    setEntities([])
    setDiscoveryError('')
    setDiscoveryState('manual')
  }

  const leaveManualMode = (): void => {
    setForm((current) => ({ ...current, sourceQueue: '', targetQueue: '' }))
    setDiscoveryState('initial')
  }

  const changeSource = (nextSource: string): void => {
    setForm((current) => {
      const routing = selectRouting(current.sourceQueue, current.targetQueue, nextSource)
      return { ...current, sourceQueue: routing.source, targetQueue: routing.target }
    })
  }

  const submit = (event: FormEvent): void => {
    event.preventDefault()
    if (!canSaveProfile(form, discoveryState)) return
    saveMutation.mutate(buildProfileInput(form))
  }

  const confirmDelete = (id: string, name: string): void => {
    if (window.confirm(`Eliminar el perfil "${name}"? Las credenciales cifradas también se eliminarán.`)) deleteMutation.mutate(id)
  }

  return (
    <section className="view" aria-labelledby="connections-title">
      <header className="view-header">
        <div><h1 id="connections-title">Conexiones</h1><p className="view-subtitle">Perfiles locales y credenciales protegidas por el sistema operativo.</p></div>
        <button className="button button-primary" onClick={openDialog}><Plus size={16} />Nueva conexión</button>
      </header>

      {feedback ? <div className={`notice notice-${feedback.tone}`} role={feedback.tone === 'error' ? 'alert' : 'status'}>{feedback.tone === 'success' ? <Check size={18} /> : <AlertCircle size={18} />}<span>{feedback.text}</span><button className="icon-button" aria-label="Cerrar aviso" onClick={() => setFeedback(null)}><X size={16} /></button></div> : null}

      <div className="connection-list">
        {profilesQuery.isLoading ? Array.from({ length: 2 }, (_, index) => <div className="connection-row connection-skeleton" key={index} aria-hidden="true"><span className="skeleton skeleton-square" /><span className="skeleton skeleton-wide" /><span className="skeleton" /><span className="skeleton skeleton-button" /></div>) : (profilesQuery.data ?? []).map((profile) => {
          const isTesting = testMutation.isPending && testMutation.variables === profile.id
          return (
            <article className="connection-row" key={profile.id}>
              <div className={`broker-mark broker-${profile.brokerType}`}><BrokerIcon brokerType={profile.brokerType} /></div>
              <div className="connection-main"><h2>{profile.name}</h2><p>{brokerName(profile.brokerType)}</p></div>
              <div className="connection-meta"><span><LockKeyhole size={14} />{profile.readOnly ? 'Solo lectura' : 'Operaciones habilitadas'}</span><span><KeyRound size={14} />{profile.brokerType === 'demo' || profile.brokerType === 'kafka' ? 'Sin credenciales' : 'Cifrado local'}</span></div>
              <div className="row-actions">
                <button className="button button-secondary" onClick={() => testMutation.mutate(profile.id)} disabled={testMutation.isPending}>{isTesting ? <LoaderCircle size={16} className="spin" /> : <Cable size={16} />}{isTesting ? 'Probando' : 'Probar'}</button>
                {profile.brokerType !== 'demo' ? <button className="icon-button danger" aria-label={`Eliminar ${profile.name}`} onClick={() => confirmDelete(profile.id, profile.name)}><Trash2 size={17} /></button> : null}
              </div>
            </article>
          )
        })}
      </div>

      {formOpen ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeDialog() }}>
          <section className="modal connection-modal" role="dialog" aria-modal="true" aria-labelledby="connection-form-title">
            <header className="modal-header"><div><h2 id="connection-form-title">Conectar broker</h2><p className="modal-subtitle">Conecta, descubre recursos y define el enrutamiento.</p></div><button className="icon-button" aria-label="Cerrar" onClick={closeDialog} disabled={busy}><X size={18} /></button></header>
            <form onSubmit={submit}>
              <div className="form-grid">
                <label className="field field-wide"><span>Nombre del perfil</span><input autoFocus required minLength={2} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Producción pagos" /></label>
                <fieldset className="field field-wide"><legend>Broker</legend><div className="segmented three"><button type="button" aria-pressed={form.brokerType === 'rabbitmq'} className={form.brokerType === 'rabbitmq' ? 'active' : ''} onClick={() => switchBroker('rabbitmq')}><Rabbit size={16} />RabbitMQ</button><button type="button" aria-pressed={form.brokerType === 'azure-service-bus'} className={form.brokerType === 'azure-service-bus' ? 'active' : ''} onClick={() => switchBroker('azure-service-bus')}><Cloud size={16} />Azure Service Bus</button><button type="button" aria-pressed={form.brokerType === 'kafka'} className={form.brokerType === 'kafka' ? 'active' : ''} onClick={() => switchBroker('kafka')}><Waypoints size={16} />Kafka</button></div></fieldset>

                <div className="form-section-heading field-wide"><span>Endpoint</span></div>
                {form.brokerType === 'rabbitmq' ? <RabbitFields form={form} onChange={updateConnectionField} /> : form.brokerType === 'azure-service-bus' ? <label className="field field-wide"><span>Connection string</span><textarea required rows={3} value={form.connectionString} onChange={(event) => updateConnectionField('connectionString', event.target.value)} placeholder="Endpoint=sb://..." /></label> : <>
                  <label className="field field-wide"><span>Bootstrap servers</span><input required value={form.bootstrapServers} onChange={(event) => updateConnectionField('bootstrapServers', event.target.value)} placeholder="localhost:9092" /></label>
                  <label className="field field-wide"><span>Client ID</span><input required value={form.clientId} onChange={(event) => updateConnectionField('clientId', event.target.value)} /></label>
                </>}

                <div className="discovery-action field-wide">
                  <button type="button" className="button button-secondary" onClick={discover} disabled={!canDiscover(form) || discoveryMutation.isPending}>
                    {discoveryMutation.isPending ? <LoaderCircle size={16} className="spin" /> : discoveryState === 'stale' ? <RefreshCw size={16} /> : <Cable size={16} />}
                    {discoveryMutation.isPending ? 'Buscando recursos' : discoveryState === 'stale' ? 'Buscar nuevamente' : 'Conectar y buscar'}
                  </button>
                </div>

                <div className="form-section-heading field-wide"><span>Enrutamiento</span></div>
                <RoutingFields
                  state={discoveryState}
                  brokerType={form.brokerType}
                  entities={entities}
                  source={form.sourceQueue}
                  target={form.targetQueue}
                  latency={discoveryLatency}
                  error={discoveryError}
                  onSourceChange={changeSource}
                  onTargetChange={(targetQueue) => setForm((current) => ({ ...current, targetQueue }))}
                  onManualSourceChange={(sourceQueue) => setForm((current) => ({ ...current, sourceQueue }))}
                  onManualTargetChange={(targetQueue) => setForm((current) => ({ ...current, targetQueue }))}
                  onRetry={discover}
                  onEnterManual={enterManualMode}
                  onLeaveManual={leaveManualMode}
                />

                <label className="toggle field-wide"><input type="checkbox" checked={form.readOnly} onChange={(event) => setForm({ ...form, readOnly: event.target.checked })} /><span className="toggle-track" /><span><strong>Solo lectura</strong><small>Bloquea requeue y operaciones masivas.</small></span></label>
              </div>
              <footer className="modal-actions"><button type="button" className="button button-secondary" onClick={closeDialog} disabled={busy}>Cancelar</button><button type="submit" className="button button-primary" disabled={busy || !canSaveProfile(form, discoveryState)}>{saveMutation.isPending ? 'Guardando...' : 'Guardar perfil'}</button></footer>
            </form>
          </section>
        </div>
      ) : null}
    </section>
  )
}

interface RabbitFieldsProps {
  form: FormState
  onChange<K extends ConnectionField>(field: K, value: FormState[K]): void
}

function RabbitFields({ form, onChange }: RabbitFieldsProps): React.JSX.Element {
  const derivedManagementUrl = `${form.tls ? 'https' : 'http'}://${form.host || 'host'}:${form.tls ? '15671' : '15672'}`
  return (
    <>
      <label className="field"><span>Host</span><input required value={form.host} onChange={(event) => onChange('host', event.target.value)} /></label>
      <label className="field"><span>Puerto AMQP</span><input required type="number" min="1" max="65535" value={form.port} onChange={(event) => onChange('port', event.target.value)} /></label>
      <label className="field"><span>Virtual host</span><input required value={form.vhost} onChange={(event) => onChange('vhost', event.target.value)} /></label>
      <label className="field"><span>Usuario</span><input required autoComplete="username" value={form.username} onChange={(event) => onChange('username', event.target.value)} /></label>
      <label className="field field-wide"><span>Contraseña</span><input required type="password" autoComplete="new-password" value={form.password} onChange={(event) => onChange('password', event.target.value)} /></label>
      <details className="advanced-options field-wide">
        <summary>Opciones avanzadas</summary>
        <div className="advanced-options-content">
          <label className="toggle"><input type="checkbox" checked={form.tls} onChange={(event) => onChange('tls', event.target.checked)} /><span className="toggle-track" /><span><strong>TLS</strong><small>Usa AMQPS y Management API segura.</small></span></label>
          <label className="field"><span>Management URL</span><input type="url" value={form.managementUrl} onChange={(event) => onChange('managementUrl', event.target.value)} placeholder={derivedManagementUrl} /></label>
        </div>
      </details>
    </>
  )
}

interface RoutingFieldsProps {
  state: DiscoveryUiState
  brokerType: FormState['brokerType']
  entities: DiscoveredEntity[]
  source: string
  target: string
  latency: number | null
  error: string
  onSourceChange(value: string): void
  onTargetChange(value: string): void
  onManualSourceChange(value: string): void
  onManualTargetChange(value: string): void
  onRetry(): void
  onEnterManual(): void
  onLeaveManual(): void
}

function RoutingFields(props: RoutingFieldsProps): React.JSX.Element {
  const resourceName = props.brokerType === 'kafka' ? 'topics' : 'colas'
  const foundLabel = props.brokerType === 'kafka'
    ? `encontrado${props.entities.length === 1 ? '' : 's'}`
    : `encontrada${props.entities.length === 1 ? '' : 's'}`
  const sourceLabel = props.brokerType === 'kafka' ? 'Topic DLT' : props.brokerType === 'rabbitmq' ? 'Cola DLQ' : 'Cola origen'
  const targetLabel = props.brokerType === 'kafka' ? 'Topic destino' : 'Cola destino'

  if (props.state === 'manual') {
    return (
      <div className="routing-manual field-wide" aria-live="polite">
        <div className="routing-status-line"><span>Entrada manual</span><button type="button" className="text-button" onClick={props.onLeaveManual}>Volver a búsqueda automática</button></div>
        <div className="routing-grid">
          <label className="field"><span>{sourceLabel}</span><input required value={props.source} onChange={(event) => props.onManualSourceChange(event.target.value)} /></label>
          <label className="field"><span>{targetLabel}</span><input required value={props.target} onChange={(event) => props.onManualTargetChange(event.target.value)} /></label>
        </div>
      </div>
    )
  }

  if (props.state === 'success') {
    return (
      <div className="routing-results field-wide" aria-live="polite">
        <div className="routing-status-line"><span className="success-text"><Check size={15} />{props.entities.length} {resourceName} {foundLabel}{props.latency === null ? '' : ` · ${props.latency} ms`}</span><button type="button" className="text-button" onClick={props.onEnterManual}>Ingresar manualmente</button></div>
        <div className="routing-grid">
          <ResourceCombobox id="source-resource" label={sourceLabel} entities={props.entities} value={props.source} onChange={props.onSourceChange} />
          <ResourceCombobox id="target-resource" label={targetLabel} entities={props.entities} value={props.target} onChange={props.onTargetChange} />
        </div>
      </div>
    )
  }

  if (props.state === 'discovering') {
    return <div className="routing-feedback routing-loading field-wide" role="status" aria-live="polite"><LoaderCircle size={18} className="spin" /><div><strong>Consultando {resourceName}</strong><span>Validando el endpoint y los permisos del broker.</span></div></div>
  }

  if (props.state === 'permission-denied' || props.state === 'network-error') {
    return <div className="routing-feedback routing-error field-wide" role="alert"><AlertCircle size={18} /><div><strong>{props.state === 'permission-denied' ? 'Permisos insuficientes' : 'No fue posible completar la búsqueda'}</strong><span>{props.error}</span><div className="inline-actions"><button type="button" className="text-button" onClick={props.onRetry}>Reintentar</button><button type="button" className="text-button" onClick={props.onEnterManual}>Ingresar manualmente</button></div></div></div>
  }

  if (props.state === 'empty') {
    return <div className="routing-feedback field-wide" role="status"><AlertCircle size={18} /><div><strong>No se encontraron {resourceName}</strong><span>Revisa el alcance de las credenciales o ingresa los nombres manualmente.</span><button type="button" className="text-button" onClick={props.onEnterManual}>Ingresar manualmente</button></div></div>
  }

  if (props.state === 'stale') {
    return <div className="routing-feedback routing-stale field-wide" role="status" aria-live="polite"><RefreshCw size={18} /><div><strong>La conexión cambió</strong><span>Busca nuevamente para actualizar los recursos disponibles.</span></div></div>
  }

  return <div className="routing-feedback field-wide" role="status"><Cable size={18} /><div><strong>Recursos pendientes</strong><span>Conecta al broker para cargar automáticamente las opciones de enrutamiento.</span></div></div>
}

function buildDiscoveryInput(form: FormState): BrokerDiscoveryInput {
  if (form.brokerType === 'rabbitmq') {
    return {
      brokerType: 'rabbitmq',
      configuration: {
        host: form.host,
        port: Number(form.port),
        vhost: form.vhost,
        tls: form.tls,
        ...(form.managementUrl.trim() ? { managementUrl: form.managementUrl.trim() } : {})
      },
      secret: { username: form.username, password: form.password }
    }
  }
  if (form.brokerType === 'azure-service-bus') {
    return { brokerType: 'azure-service-bus', configuration: {}, secret: { connectionString: form.connectionString } }
  }
  return {
    brokerType: 'kafka',
    configuration: { bootstrapServers: form.bootstrapServers, clientId: form.clientId },
    secret: {}
  }
}

function buildProfileInput(form: FormState): ConnectionProfileInput {
  if (form.brokerType === 'rabbitmq') {
    return {
      name: form.name,
      brokerType: 'rabbitmq',
      readOnly: form.readOnly,
      configuration: {
        host: form.host,
        port: Number(form.port),
        vhost: form.vhost,
        tls: form.tls,
        sourceQueue: form.sourceQueue,
        targetQueue: form.targetQueue,
        ...(form.managementUrl.trim() ? { managementUrl: form.managementUrl.trim() } : {})
      },
      secret: { username: form.username, password: form.password }
    }
  }
  if (form.brokerType === 'azure-service-bus') {
    return {
      name: form.name,
      brokerType: 'azure-service-bus',
      readOnly: form.readOnly,
      configuration: { queueName: form.sourceQueue, targetQueue: form.targetQueue },
      secret: { connectionString: form.connectionString }
    }
  }
  return {
    name: form.name,
    brokerType: 'kafka',
    readOnly: form.readOnly,
    configuration: {
      bootstrapServers: form.bootstrapServers,
      dltTopic: form.sourceQueue,
      targetTopic: form.targetQueue,
      clientId: form.clientId
    },
    secret: {}
  }
}

function canDiscover(form: FormState): boolean {
  if (form.brokerType === 'rabbitmq') {
    const port = Number(form.port)
    return Boolean(
      form.host.trim()
      && port > 0
      && port <= 65535
      && form.vhost
      && form.username.trim()
      && form.password
      && (!form.managementUrl.trim() || URL.canParse(form.managementUrl))
    )
  }
  if (form.brokerType === 'azure-service-bus') return Boolean(form.connectionString.trim())
  return Boolean(form.bootstrapServers.trim() && form.clientId.trim())
}

function canSaveProfile(form: FormState, discoveryState: DiscoveryUiState): boolean {
  return form.name.trim().length >= 2
    && canDiscover(form)
    && Boolean(form.sourceQueue.trim() && form.targetQueue.trim())
    && (discoveryState === 'success' || discoveryState === 'manual')
}

function brokerName(brokerType: BrokerType): string {
  if (brokerType === 'azure-service-bus') return 'Azure Service Bus'
  if (brokerType === 'rabbitmq') return 'RabbitMQ'
  if (brokerType === 'kafka') return 'Apache Kafka'
  return 'Entorno demo integrado'
}

function BrokerIcon({ brokerType }: { brokerType: BrokerType }): React.JSX.Element {
  if (brokerType === 'rabbitmq') return <Rabbit size={20} aria-hidden="true" />
  if (brokerType === 'azure-service-bus') return <Cloud size={20} aria-hidden="true" />
  if (brokerType === 'kafka') return <Waypoints size={20} aria-hidden="true" />
  if (brokerType === 'demo') return <DatabaseZap size={20} aria-hidden="true" />
  return <Server size={20} aria-hidden="true" />
}

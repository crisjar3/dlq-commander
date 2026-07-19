import { useEffect, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertCircle, Cable, Check, Cloud, DatabaseZap, KeyRound, LoaderCircle, LockKeyhole, Plus, Rabbit, Server, Trash2, Waypoints, X } from 'lucide-react'
import type { BrokerType, ConnectionProfileInput } from '@shared/domain'
import { invoke, readableError } from '../lib/api'

interface FormState {
  name: string
  brokerType: Exclude<BrokerType, 'demo'>
  readOnly: boolean
  host: string
  port: string
  vhost: string
  sourceQueue: string
  targetQueue: string
  username: string
  password: string
  connectionString: string
  bootstrapServers: string
  clientId: string
}

const initialForm: FormState = {
  name: '', brokerType: 'rabbitmq', readOnly: true, host: 'localhost', port: '5672', vhost: '/',
  sourceQueue: '', targetQueue: '', username: 'dlqcommander', password: '', connectionString: '',
  bootstrapServers: 'localhost:9092', clientId: 'dlq-commander'
}

export function ConnectionsView(): React.JSX.Element {
  const queryClient = useQueryClient()
  const profilesQuery = useQuery({ queryKey: ['profiles'], queryFn: () => invoke('listProfiles', {}) })
  const [formOpen, setFormOpen] = useState(false)
  const [form, setForm] = useState<FormState>(initialForm)
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'error'; text: string } | null>(null)

  const saveMutation = useMutation({
    mutationFn: (input: ConnectionProfileInput) => invoke('saveProfile', input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['profiles'] })
      setFormOpen(false)
      setForm(initialForm)
      setFeedback({ tone: 'success', text: 'Perfil guardado. Las credenciales quedaron cifradas por el sistema operativo.' })
    },
    onError: (error) => setFeedback({ tone: 'error', text: readableError(error) })
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

  useEffect(() => {
    if (!formOpen) return undefined
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !saveMutation.isPending) setFormOpen(false)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [formOpen, saveMutation.isPending])

  const submit = (event: FormEvent): void => {
    event.preventDefault()
    let input: ConnectionProfileInput
    if (form.brokerType === 'rabbitmq') {
      input = {
          name: form.name,
          brokerType: 'rabbitmq',
          readOnly: form.readOnly,
          configuration: { host: form.host, port: Number(form.port), vhost: form.vhost, sourceQueue: form.sourceQueue, targetQueue: form.targetQueue, tls: false },
          secret: { username: form.username, password: form.password }
        }
    } else if (form.brokerType === 'azure-service-bus') {
      input = {
          name: form.name,
          brokerType: 'azure-service-bus',
          readOnly: form.readOnly,
          configuration: { queueName: form.sourceQueue, targetQueue: form.targetQueue },
          secret: { connectionString: form.connectionString }
        }
    } else {
      input = {
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
    saveMutation.mutate(input)
  }

  const confirmDelete = (id: string, name: string): void => {
    if (window.confirm(`Eliminar el perfil "${name}"? Las credenciales cifradas tambien se eliminaran.`)) deleteMutation.mutate(id)
  }

  return (
    <section className="view" aria-labelledby="connections-title">
      <header className="view-header">
        <div><h1 id="connections-title">Conexiones</h1><p className="view-subtitle">Perfiles locales y credenciales protegidas por el sistema operativo.</p></div>
        <button className="button button-primary" onClick={() => setFormOpen(true)}><Plus size={16} />Nueva conexión</button>
      </header>

      {feedback ? <div className={`notice notice-${feedback.tone}`} role={feedback.tone === 'error' ? 'alert' : 'status'}>{feedback.tone === 'success' ? <Check size={18} /> : <AlertCircle size={18} />}<span>{feedback.text}</span><button className="icon-button" aria-label="Cerrar aviso" onClick={() => setFeedback(null)}><X size={16} /></button></div> : null}

      <div className="connection-list">
        {profilesQuery.isLoading ? Array.from({ length: 2 }, (_, index) => <div className="connection-row connection-skeleton" key={index} aria-hidden="true"><span className="skeleton skeleton-square" /><span className="skeleton skeleton-wide" /><span className="skeleton" /><span className="skeleton skeleton-button" /></div>) : (profilesQuery.data ?? []).map((profile) => {
          const isTesting = testMutation.isPending && testMutation.variables === profile.id
          return (
          <article className="connection-row" key={profile.id}>
            <div className={`broker-mark broker-${profile.brokerType}`}><BrokerIcon brokerType={profile.brokerType} /></div>
            <div className="connection-main"><h2>{profile.name}</h2><p>{profile.brokerType === 'azure-service-bus' ? 'Azure Service Bus' : profile.brokerType === 'rabbitmq' ? 'RabbitMQ' : profile.brokerType === 'kafka' ? 'Apache Kafka' : 'Entorno demo integrado'}</p></div>
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
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setFormOpen(false) }}>
          <section className="modal" role="dialog" aria-modal="true" aria-labelledby="connection-form-title">
            <header className="modal-header"><div><h2 id="connection-form-title">Conectar broker</h2><p className="modal-subtitle">Define el origen DLT y el destino operativo.</p></div><button className="icon-button" aria-label="Cerrar" onClick={() => setFormOpen(false)} disabled={saveMutation.isPending}><X size={18} /></button></header>
            <form onSubmit={submit}>
              <div className="form-grid">
                <label className="field field-wide"><span>Nombre del perfil</span><input autoFocus required minLength={2} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Producción pagos" /></label>
                <fieldset className="field field-wide"><legend>Broker</legend><div className="segmented three"><button type="button" aria-pressed={form.brokerType === 'rabbitmq'} className={form.brokerType === 'rabbitmq' ? 'active' : ''} onClick={() => setForm({ ...form, brokerType: 'rabbitmq' })}><Rabbit size={16} />RabbitMQ</button><button type="button" aria-pressed={form.brokerType === 'azure-service-bus'} className={form.brokerType === 'azure-service-bus' ? 'active' : ''} onClick={() => setForm({ ...form, brokerType: 'azure-service-bus' })}><Cloud size={16} />Azure Service Bus</button><button type="button" aria-pressed={form.brokerType === 'kafka'} className={form.brokerType === 'kafka' ? 'active' : ''} onClick={() => setForm({ ...form, brokerType: 'kafka' })}><Waypoints size={16} />Kafka</button></div></fieldset>
                <div className="form-section-heading field-wide"><span>Endpoint</span></div>
                {form.brokerType === 'rabbitmq' ? <>
                  <label className="field"><span>Host</span><input required value={form.host} onChange={(event) => setForm({ ...form, host: event.target.value })} /></label>
                  <label className="field"><span>Puerto</span><input required type="number" min="1" max="65535" value={form.port} onChange={(event) => setForm({ ...form, port: event.target.value })} /></label>
                  <label className="field"><span>Virtual host</span><input required value={form.vhost} onChange={(event) => setForm({ ...form, vhost: event.target.value })} /></label>
                  <label className="field"><span>Usuario</span><input required autoComplete="username" value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} /></label>
                  <label className="field field-wide"><span>Contraseña</span><input required type="password" autoComplete="new-password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} /></label>
                </> : form.brokerType === 'azure-service-bus' ? <label className="field field-wide"><span>Connection string</span><textarea required rows={3} value={form.connectionString} onChange={(event) => setForm({ ...form, connectionString: event.target.value })} placeholder="Endpoint=sb://..." /></label> : <>
                  <label className="field field-wide"><span>Bootstrap servers</span><input required value={form.bootstrapServers} onChange={(event) => setForm({ ...form, bootstrapServers: event.target.value })} placeholder="localhost:9092" /></label>
                  <label className="field field-wide"><span>Client ID</span><input required value={form.clientId} onChange={(event) => setForm({ ...form, clientId: event.target.value })} /></label>
                </>}
                <div className="form-section-heading field-wide"><span>Enrutamiento</span></div>
                <label className="field"><span>{form.brokerType === 'rabbitmq' ? 'Cola DLQ' : form.brokerType === 'kafka' ? 'Topic DLT' : 'Cola origen'}</span><input required value={form.sourceQueue} onChange={(event) => setForm({ ...form, sourceQueue: event.target.value })} /></label>
                <label className="field"><span>{form.brokerType === 'kafka' ? 'Topic destino' : 'Cola destino'}</span><input required value={form.targetQueue} onChange={(event) => setForm({ ...form, targetQueue: event.target.value })} /></label>
                <label className="toggle field-wide"><input type="checkbox" checked={form.readOnly} onChange={(event) => setForm({ ...form, readOnly: event.target.checked })} /><span className="toggle-track" /><span><strong>Solo lectura</strong><small>Bloquea requeue y operaciones masivas.</small></span></label>
              </div>
              <footer className="modal-actions"><button type="button" className="button button-secondary" onClick={() => setFormOpen(false)}>Cancelar</button><button type="submit" className="button button-primary" disabled={saveMutation.isPending}>{saveMutation.isPending ? 'Guardando...' : 'Guardar perfil'}</button></footer>
            </form>
          </section>
        </div>
      ) : null}
    </section>
  )
}

function BrokerIcon({ brokerType }: { brokerType: BrokerType }): React.JSX.Element {
  if (brokerType === 'rabbitmq') return <Rabbit size={20} aria-hidden="true" />
  if (brokerType === 'azure-service-bus') return <Cloud size={20} aria-hidden="true" />
  if (brokerType === 'kafka') return <Waypoints size={20} aria-hidden="true" />
  if (brokerType === 'demo') return <DatabaseZap size={20} aria-hidden="true" />
  return <Server size={20} aria-hidden="true" />
}

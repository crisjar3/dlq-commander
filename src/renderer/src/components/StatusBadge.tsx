import { AlertTriangle, CheckCircle2, Circle, XCircle } from 'lucide-react'

type Status = 'healthy' | 'warning' | 'error' | 'completed' | 'failed' | 'running' | 'queued' | 'cancelled' | 'started'

const labels: Record<Status, string> = {
  healthy: 'Estable',
  warning: 'Con mensajes',
  error: 'Error',
  completed: 'Completado',
  failed: 'Fallido',
  running: 'En curso',
  queued: 'En espera',
  cancelled: 'Cancelado',
  started: 'Iniciado'
}

export function StatusBadge({ status }: { status: Status }): React.JSX.Element {
  const Icon = status === 'healthy' || status === 'completed' ? CheckCircle2 : status === 'warning' ? AlertTriangle : status === 'failed' || status === 'error' ? XCircle : Circle
  return (
    <span className={`status-badge status-${status}`}>
      <Icon size={13} aria-hidden="true" />
      {labels[status]}
    </span>
  )
}

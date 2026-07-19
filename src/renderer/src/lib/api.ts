import type { IpcInput, IpcMethod, IpcOutput } from '@shared/ipc-contract'

export async function invoke<K extends IpcMethod>(method: K, payload: IpcInput<K>): Promise<IpcOutput<K>> {
  return window.dlqCommander.invoke(method, payload)
}

export function readableError(error: unknown): string {
  const fallback = error instanceof Error ? error.message : String(error)
  const match = fallback.match(/\{"code":.*\}/)
  if (match) {
    try {
      const parsed = JSON.parse(match[0]) as { message?: string }
      if (parsed.message) return parsed.message
    } catch {
      // Fall through to Electron's original message.
    }
  }
  return fallback
}

export function formatDate(value: string | null): string {
  if (!value) return 'Sin datos'
  return new Intl.DateTimeFormat('es-CR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

export function formatRelative(value: string | null): string {
  if (!value) return 'Sin datos'
  const minutes = Math.round((new Date(value).getTime() - Date.now()) / 60_000)
  const formatter = new Intl.RelativeTimeFormat('es', { numeric: 'auto' })
  if (Math.abs(minutes) < 60) return formatter.format(minutes, 'minute')
  const hours = Math.round(minutes / 60)
  if (Math.abs(hours) < 24) return formatter.format(hours, 'hour')
  return formatter.format(Math.round(hours / 24), 'day')
}

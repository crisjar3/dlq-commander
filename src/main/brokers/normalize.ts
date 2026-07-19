import { createHash } from 'node:crypto'

export function bodyToText(body: unknown): string {
  if (typeof body === 'string') return body
  if (Buffer.isBuffer(body)) return body.toString('utf8')
  try {
    return JSON.stringify(body, null, 2)
  } catch {
    return String(body)
  }
}

export function stableMessageId(nativeId: string | undefined | null, body: unknown, salt = ''): string {
  if (nativeId) return nativeId
  return createHash('sha256').update(`${salt}:${bodyToText(body)}`).digest('hex').slice(0, 32)
}

export function hashBody(body: unknown): string {
  return createHash('sha256').update(bodyToText(body)).digest('hex')
}

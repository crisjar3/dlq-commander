import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { AuditEntry } from '@shared/domain'

interface AuditInput extends Omit<AuditEntry, 'id' | 'createdAt'> {
  id?: string
  createdAt?: string
}

interface AuditRow {
  id: string
  action: string
  profile_id: string
  source_id: string | null
  target_name: string | null
  status: AuditEntry['status']
  requested: number
  succeeded: number
  failed: number
  detail: string | null
  created_at: string
}

export class AuditRepository {
  constructor(private readonly db: DatabaseSync) {}

  write(input: AuditInput): AuditEntry {
    const entry: AuditEntry = {
      ...input,
      id: input.id ?? randomUUID(),
      createdAt: input.createdAt ?? new Date().toISOString()
    }
    this.db
      .prepare(`
        INSERT INTO audit_entries
          (id, action, profile_id, source_id, target_name, status, requested, succeeded, failed, detail, created_at)
        VALUES (@id, @action, @profileId, @sourceId, @targetName, @status, @requested, @succeeded, @failed, @detail, @createdAt)
      `)
      .run(entry)
    return entry
  }

  list(limit: number): AuditEntry[] {
    const rows = this.db
      .prepare('SELECT * FROM audit_entries ORDER BY created_at DESC LIMIT ?')
      .all(limit) as unknown as AuditRow[]
    return rows.map((row) => ({
      id: row.id,
      action: row.action,
      profileId: row.profile_id,
      sourceId: row.source_id,
      targetName: row.target_name,
      status: row.status,
      requested: row.requested,
      succeeded: row.succeeded,
      failed: row.failed,
      detail: row.detail,
      createdAt: row.created_at
    }))
  }
}

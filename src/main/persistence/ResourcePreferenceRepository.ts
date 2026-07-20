import type { DatabaseSync } from 'node:sqlite'
import { resourceKey, targetResourceRefSchema, type BrokerResourceRef, type TargetResourceRef } from '@shared/domain'

interface SettingRow {
  value_json: string
}

export class ResourcePreferenceRepository {
  constructor(private readonly db: DatabaseSync) {}

  getDestination(profileId: string, source: BrokerResourceRef): TargetResourceRef | null {
    const row = this.db.prepare('SELECT value_json FROM settings WHERE key = ?')
      .get(this.preferenceKey(profileId, source)) as unknown as SettingRow | undefined
    if (!row) return null
    try {
      const parsed = targetResourceRefSchema.safeParse(JSON.parse(row.value_json))
      return parsed.success ? parsed.data : null
    } catch {
      return null
    }
  }

  rememberDestination(profileId: string, source: BrokerResourceRef, target: TargetResourceRef): void {
    this.db.prepare(`
      INSERT INTO settings (key, value_json, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at
    `).run(this.preferenceKey(profileId, source), JSON.stringify(target), new Date().toISOString())
  }

  deleteForProfile(profileId: string): void {
    this.db.prepare("DELETE FROM settings WHERE key LIKE ? ESCAPE '\\'")
      .run(`${escapeLike(`destination:${profileId}:`)}%`)
  }

  private preferenceKey(profileId: string, source: BrokerResourceRef): string {
    return `destination:${profileId}:${resourceKey(source)}`
  }
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`)
}

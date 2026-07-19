import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import {
  capabilitiesByBroker,
  connectionProfileInputSchema,
  type BrokerType,
  type ConnectionProfile,
  type ConnectionProfileInput
} from '@shared/domain'
import type { SecretVault } from '../security/SecretVault'
import { AppError } from '../core/errors'

interface ProfileRow {
  id: string
  name: string
  broker_type: BrokerType
  read_only: number
  configuration_json: string
  encrypted_secret: Uint8Array | null
  created_at: string
  updated_at: string
}

export interface ProfileWithSecret {
  profile: ConnectionProfile
  secret: Record<string, string>
}

export class ProfileRepository {
  constructor(
    private readonly db: DatabaseSync,
    private readonly vault: SecretVault
  ) {}

  seedDemo(): void {
    const count = this.db.prepare('SELECT COUNT(*) AS count FROM connection_profiles').get() as { count: number }
    if (count.count > 0) return
    const now = new Date().toISOString()
    this.db
      .prepare(`
        INSERT INTO connection_profiles
          (id, name, broker_type, read_only, configuration_json, encrypted_secret, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, NULL, ?, ?)
      `)
      .run('demo-local', 'Demo local', 'demo', 0, '{}', now, now)
  }

  list(): ConnectionProfile[] {
    const rows = this.db.prepare('SELECT * FROM connection_profiles ORDER BY created_at ASC').all() as unknown as ProfileRow[]
    return rows.map((row) => this.toProfile(row))
  }

  get(id: string): ConnectionProfile {
    return this.toProfile(this.getRow(id))
  }

  getWithSecret(id: string): ProfileWithSecret {
    const row = this.getRow(id)
    return { profile: this.toProfile(row), secret: this.vault.decrypt(row.encrypted_secret ? Buffer.from(row.encrypted_secret) : null) }
  }

  save(rawInput: ConnectionProfileInput): ConnectionProfile {
    const input = connectionProfileInputSchema.parse(rawInput)
    const existing = input.id
      ? (this.db.prepare('SELECT * FROM connection_profiles WHERE id = ?').get(input.id) as ProfileRow | undefined)
      : undefined
    const id = existing?.id ?? randomUUID()
    const now = new Date().toISOString()
    let encryptedSecret: Uint8Array | null = existing?.encrypted_secret ?? null

    const requiresSecret = input.brokerType === 'rabbitmq' || input.brokerType === 'azure-service-bus'
    if (requiresSecret && Object.keys(input.secret).length > 0) {
      encryptedSecret = this.vault.encrypt(input.secret)
    }
    if (requiresSecret && !encryptedSecret) {
      throw new AppError('CREDENTIALS_REQUIRED', 'Debes ingresar las credenciales antes de guardar el perfil.')
    }

    this.db
      .prepare(`
        INSERT INTO connection_profiles
          (id, name, broker_type, read_only, configuration_json, encrypted_secret, created_at, updated_at)
        VALUES (@id, @name, @brokerType, @readOnly, @configuration, @secret, @createdAt, @updatedAt)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          broker_type = excluded.broker_type,
          read_only = excluded.read_only,
          configuration_json = excluded.configuration_json,
          encrypted_secret = excluded.encrypted_secret,
          updated_at = excluded.updated_at
      `)
      .run({
        id,
        name: input.name,
        brokerType: input.brokerType,
        readOnly: input.readOnly ? 1 : 0,
        configuration: JSON.stringify(input.configuration),
        secret: encryptedSecret,
        createdAt: existing?.created_at ?? now,
        updatedAt: now
      })
    return this.get(id)
  }

  delete(id: string): boolean {
    if (id === 'demo-local') throw new AppError('DEMO_PROFILE_REQUIRED', 'El perfil demo no se puede eliminar.')
    return this.db.prepare('DELETE FROM connection_profiles WHERE id = ?').run(id).changes > 0n
  }

  private getRow(id: string): ProfileRow {
    const row = this.db.prepare('SELECT * FROM connection_profiles WHERE id = ?').get(id) as ProfileRow | undefined
    if (!row) throw new AppError('PROFILE_NOT_FOUND', `No existe el perfil ${id}`)
    return row
  }

  private toProfile(row: ProfileRow): ConnectionProfile {
    return {
      id: row.id,
      name: row.name,
      brokerType: row.broker_type,
      readOnly: row.read_only === 1,
      configuration: JSON.parse(row.configuration_json) as Record<string, string | number | boolean>,
      capabilities: capabilitiesByBroker[row.broker_type],
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }
  }
}

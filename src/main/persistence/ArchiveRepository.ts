import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { NormalizedMessage } from '@shared/domain'
import type { SecretVault } from '../security/SecretVault'

export class ArchiveRepository {
  constructor(
    private readonly db: DatabaseSync,
    private readonly vault: SecretVault
  ) {}

  archive(jobId: string, profileId: string, message: NormalizedMessage): void {
    const snapshot = this.vault.encrypt({ payload: JSON.stringify(message) })
    this.db
      .prepare(`
        INSERT INTO archived_messages
          (id, job_id, profile_id, source_id, message_id, body_hash, encrypted_snapshot, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        randomUUID(),
        jobId,
        profileId,
        message.sourceId,
        message.id,
        message.rawHash,
        snapshot,
        new Date().toISOString()
      )
  }
}

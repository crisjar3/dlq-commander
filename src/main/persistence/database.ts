import { DatabaseSync } from 'node:sqlite'

export class AppDatabase {
  readonly connection: DatabaseSync

  constructor(path: string) {
    this.connection = new DatabaseSync(path)
    this.connection.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;')
    this.migrate()
  }

  close(): void {
    this.connection.close()
  }

  private migrate(): void {
    this.connection.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS connection_profiles (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        broker_type TEXT NOT NULL,
        read_only INTEGER NOT NULL DEFAULT 1,
        configuration_json TEXT NOT NULL,
        encrypted_secret BLOB,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS audit_entries (
        id TEXT PRIMARY KEY,
        action TEXT NOT NULL,
        profile_id TEXT NOT NULL,
        source_id TEXT,
        target_name TEXT,
        status TEXT NOT NULL,
        requested INTEGER NOT NULL DEFAULT 0,
        succeeded INTEGER NOT NULL DEFAULT 0,
        failed INTEGER NOT NULL DEFAULT 0,
        detail TEXT,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS audit_entries_created_at_idx
        ON audit_entries(created_at DESC);

      CREATE TABLE IF NOT EXISTS archived_messages (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL,
        profile_id TEXT NOT NULL,
        source_id TEXT NOT NULL,
        message_id TEXT NOT NULL,
        body_hash TEXT NOT NULL,
        encrypted_snapshot BLOB NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS saved_filters (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        profile_id TEXT,
        query_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      INSERT OR IGNORE INTO schema_migrations(version, applied_at)
        VALUES (1, datetime('now'));
    `)
  }
}

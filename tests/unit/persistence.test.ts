import { afterEach, describe, expect, it } from 'vitest'
import { AppDatabase } from '../../src/main/persistence/database'
import { ProfileRepository } from '../../src/main/persistence/ProfileRepository'
import { AuditRepository } from '../../src/main/persistence/AuditRepository'
import { SecretVault, type EncryptionProvider } from '../../src/main/security/SecretVault'
import { ResourcePreferenceRepository } from '../../src/main/persistence/ResourcePreferenceRepository'

class MemoryEncryption implements EncryptionProvider {
  isEncryptionAvailable(): boolean { return true }
  encryptString(value: string): Buffer { return Buffer.from(value, 'utf8') }
  decryptString(value: Buffer): string { return value.toString('utf8') }
}

let database: AppDatabase | null = null

afterEach(() => {
  database?.close()
  database = null
})

describe('SQLite repositories', () => {
  it('migrates, encrypts and returns only sanitized profiles', () => {
    database = new AppDatabase(':memory:')
    const profiles = new ProfileRepository(database.connection, new SecretVault(new MemoryEncryption()))
    profiles.seedDemo()
    const saved = profiles.save({
      name: 'Rabbit test',
      brokerType: 'rabbitmq',
      readOnly: true,
      configuration: { host: 'localhost', port: 5672, vhost: '/', sourceQueue: 'orders.dlq', targetQueue: 'orders' },
      secret: { username: 'operator', password: 'private' }
    })

    expect(profiles.list()).toHaveLength(2)
    expect(saved).not.toHaveProperty('secret')
    expect(profiles.getWithSecret(saved.id).secret).toEqual({ username: 'operator', password: 'private' })
    const kafka = profiles.save({
      name: 'Kafka local',
      brokerType: 'kafka',
      readOnly: false,
      configuration: { bootstrapServers: 'localhost:9092', dltTopic: 'orders.events.dlt', targetTopic: 'orders.events', clientId: 'test' },
      secret: {}
    })
    expect(profiles.getWithSecret(kafka.id).secret).toEqual({})
    expect(profiles.delete(saved.id)).toBe(true)
  })

  it('writes and reads operation audit records in descending order', () => {
    database = new AppDatabase(':memory:')
    const audit = new AuditRepository(database.connection)
    audit.write({
      action: 'requeue', profileId: 'demo', sourceId: 'orders.dlq', targetName: 'orders',
      status: 'completed', requested: 2, succeeded: 2, failed: 0, detail: null
    })

    expect(audit.list(10)).toMatchObject([
      { action: 'requeue', profileId: 'demo', requested: 2, succeeded: 2, status: 'completed' }
    ])
  })

  it('remembers a destination per profile and source', () => {
    database = new AppDatabase(':memory:')
    const preferences = new ResourcePreferenceRepository(database.connection)
    const source = { kind: 'subscription' as const, topicName: 'orders', name: 'fulfillment' }
    preferences.rememberDestination('azure-profile', source, { kind: 'topic', name: 'orders-retry' })
    expect(preferences.getDestination('azure-profile', source)).toEqual({ kind: 'topic', name: 'orders-retry' })
    preferences.deleteForProfile('azure-profile')
    expect(preferences.getDestination('azure-profile', source)).toBeNull()
  })
})

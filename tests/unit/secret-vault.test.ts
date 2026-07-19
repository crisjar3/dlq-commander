import { describe, expect, it } from 'vitest'
import { SecretVault, type EncryptionProvider } from '../../src/main/security/SecretVault'

class FakeEncryptionProvider implements EncryptionProvider {
  constructor(private readonly available: boolean) {}
  isEncryptionAvailable(): boolean { return this.available }
  encryptString(value: string): Buffer { return Buffer.from(value, 'utf8') }
  decryptString(value: Buffer): string { return value.toString('utf8') }
}

describe('SecretVault', () => {
  it('round trips a credential object without exposing plaintext APIs', () => {
    const vault = new SecretVault(new FakeEncryptionProvider(true))
    const encrypted = vault.encrypt({ username: 'operator', password: 'private' })
    expect(vault.decrypt(encrypted)).toEqual({ username: 'operator', password: 'private' })
  })

  it('fails closed when OS encryption is unavailable', () => {
    const vault = new SecretVault(new FakeEncryptionProvider(false))
    expect(() => vault.encrypt({ token: 'private' })).toThrow(/no ofrece cifrado seguro/i)
  })
})

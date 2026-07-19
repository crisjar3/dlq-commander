import { AppError } from '../core/errors'

export interface EncryptionProvider {
  isEncryptionAvailable(): boolean
  encryptString(value: string): Buffer
  decryptString(value: Buffer): string
}

export class SecretVault {
  constructor(private readonly provider: EncryptionProvider) {}

  isAvailable(): boolean {
    return this.provider.isEncryptionAvailable()
  }

  encrypt(value: Record<string, string>): Buffer {
    if (!this.isAvailable()) {
      throw new AppError(
        'ENCRYPTION_UNAVAILABLE',
        'El sistema operativo no ofrece cifrado seguro. No se guardaron las credenciales.',
        false
      )
    }
    return this.provider.encryptString(JSON.stringify(value))
  }

  decrypt(value: Buffer | null): Record<string, string> {
    if (!value) return {}
    if (!this.isAvailable()) {
      throw new AppError('ENCRYPTION_UNAVAILABLE', 'No es posible descifrar las credenciales en este sistema.', false)
    }
    return JSON.parse(this.provider.decryptString(value)) as Record<string, string>
  }
}

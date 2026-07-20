import { app, ipcMain, type WebContents } from 'electron'
import type { z } from 'zod'
import { ipcContract, jobProgressChannel, type IpcContract, type IpcMethod } from '@shared/ipc-contract'
import { toSafeError } from '../core/errors'
import type { ProfileRepository } from '../persistence/ProfileRepository'
import type { BrokerRegistry } from '../brokers/BrokerRegistry'
import type { JobRunner } from '../jobs/JobRunner'
import type { AuditRepository } from '../persistence/AuditRepository'
import type { SecretVault } from '../security/SecretVault'
import type { BrokerDiscoveryService } from '../brokers/BrokerDiscoveryService'
import type { ResourcePreferenceRepository } from '../persistence/ResourcePreferenceRepository'

interface IpcDependencies {
  profiles: ProfileRepository
  registry: BrokerRegistry
  jobs: JobRunner
  audit: AuditRepository
  vault: SecretVault
  discovery: BrokerDiscoveryService
  preferences: ResourcePreferenceRepository
}

type Handler<K extends IpcMethod> = (
  input: z.output<IpcContract[K]['input']>
) => Promise<z.input<IpcContract[K]['output']>> | z.input<IpcContract[K]['output']>

function register<K extends IpcMethod>(method: K, handler: Handler<K>): void {
  const definition = ipcContract[method]
  ipcMain.handle(definition.channel, async (_event, rawInput: unknown) => {
    try {
      const input = definition.input.parse(rawInput) as z.output<IpcContract[K]['input']>
      const output = await handler(input)
      return definition.output.parse(output)
    } catch (error) {
      const safeError = toSafeError(error)
      throw new Error(JSON.stringify({ code: safeError.code, message: safeError.message, recoverable: safeError.recoverable }))
    }
  })
}

export function registerIpcHandlers(dependencies: IpcDependencies): void {
  register('health', () => ({
    ok: true,
    version: app.getVersion(),
    encryptionAvailable: dependencies.vault.isAvailable()
  }))
  register('listProfiles', () => dependencies.profiles.list())
  register('saveProfile', async (input) => {
    const saved = dependencies.profiles.save(input)
    await dependencies.registry.invalidate(saved.id)
    return saved
  })
  register('deleteProfile', async ({ id }) => {
    await dependencies.registry.invalidate(id)
    dependencies.preferences.deleteForProfile(id)
    return { deleted: dependencies.profiles.delete(id) }
  })
  register('testProfile', async ({ id }) => dependencies.registry.test(id))
  register('discoverEntities', (input) => dependencies.discovery.discover(input))
  register('listResources', ({ profileId, scope, force }) => dependencies.registry.listResources(profileId, scope, force))
  register('getDestinationPreference', ({ profileId, source }) => ({
    target: dependencies.preferences.getDestination(profileId, source)
  }))
  register('listSources', async ({ profileId }) => dependencies.registry.get(profileId).listSources())
  register('listMessages', async ({ profileId, source, limit }) =>
    dependencies.registry.get(profileId).listMessages(source, limit)
  )
  register('startRequeue', (input) => dependencies.jobs.start(input))
  register('cancelJob', ({ id }) => dependencies.jobs.cancel(id))
  register('listJobs', () => dependencies.jobs.list())
  register('listAudit', ({ limit }) => dependencies.audit.list(limit))
}

export function emitJobProgress(webContents: WebContents | null, job: unknown): void {
  if (webContents && !webContents.isDestroyed()) webContents.send(jobProgressChannel, job)
}

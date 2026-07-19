import { z } from 'zod'
import {
  auditEntrySchema,
  connectionProfileInputSchema,
  connectionProfileSchema,
  messagePageSchema,
  operationJobSchema,
  sourceSummarySchema
} from './domain'

export const ipcContract = {
  health: {
    channel: 'app:health',
    input: z.object({}),
    output: z.object({ ok: z.literal(true), version: z.string(), encryptionAvailable: z.boolean() })
  },
  listProfiles: {
    channel: 'connections:list',
    input: z.object({}),
    output: z.array(connectionProfileSchema)
  },
  saveProfile: {
    channel: 'connections:save',
    input: connectionProfileInputSchema,
    output: connectionProfileSchema
  },
  deleteProfile: {
    channel: 'connections:delete',
    input: z.object({ id: z.string() }),
    output: z.object({ deleted: z.boolean() })
  },
  testProfile: {
    channel: 'connections:test',
    input: z.object({ id: z.string() }),
    output: z.object({ ok: z.boolean(), latencyMs: z.number().nonnegative(), message: z.string() })
  },
  listSources: {
    channel: 'sources:list',
    input: z.object({ profileId: z.string() }),
    output: z.array(sourceSummarySchema)
  },
  listMessages: {
    channel: 'messages:list',
    input: z.object({ profileId: z.string(), sourceId: z.string(), limit: z.number().int().min(1).max(500) }),
    output: messagePageSchema
  },
  startRequeue: {
    channel: 'operations:requeue',
    input: z.object({
      profileId: z.string(),
      sourceId: z.string(),
      targetName: z.string().min(1),
      messageIds: z.array(z.string()).min(1).max(5000),
      throttlePerSecond: z.number().min(0.2).max(100)
    }),
    output: operationJobSchema
  },
  cancelJob: {
    channel: 'jobs:cancel',
    input: z.object({ id: z.string() }),
    output: operationJobSchema
  },
  listJobs: {
    channel: 'jobs:list',
    input: z.object({}),
    output: z.array(operationJobSchema)
  },
  listAudit: {
    channel: 'audit:list',
    input: z.object({ limit: z.number().int().min(1).max(500) }),
    output: z.array(auditEntrySchema)
  }
} as const

export const jobProgressChannel = 'events:job-progress'

export type IpcContract = typeof ipcContract
export type IpcMethod = keyof IpcContract
export type IpcInput<K extends IpcMethod> = z.input<IpcContract[K]['input']>
export type IpcOutput<K extends IpcMethod> = z.output<IpcContract[K]['output']>

export interface DlqCommanderApi {
  invoke<K extends IpcMethod>(method: K, payload: IpcInput<K>): Promise<IpcOutput<K>>
  onJobProgress(callback: (job: z.infer<typeof operationJobSchema>) => void): () => void
}

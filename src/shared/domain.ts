import { z } from 'zod'

export const brokerTypeSchema = z.enum(['demo', 'rabbitmq', 'azure-service-bus', 'kafka'])
export type BrokerType = z.infer<typeof brokerTypeSchema>

export const brokerCapabilitiesSchema = z.object({
  canDiscover: z.boolean(),
  canPeek: z.boolean(),
  canRequeue: z.boolean(),
  canBulkRequeue: z.boolean(),
  canEditAndResend: z.boolean(),
  canPurge: z.boolean(),
  supportsNativeDeadLetter: z.boolean(),
  inspectionMode: z.enum(['native-peek', 'receive-and-release', 'append-only-read', 'demo'])
})
export type BrokerCapabilities = z.infer<typeof brokerCapabilitiesSchema>

export const profileConfigurationSchema = z.record(
  z.string(),
  z.union([z.string(), z.number(), z.boolean()])
)

export const connectionProfileSchema = z.object({
  id: z.string(),
  name: z.string(),
  brokerType: brokerTypeSchema,
  readOnly: z.boolean(),
  configuration: profileConfigurationSchema,
  capabilities: brokerCapabilitiesSchema,
  createdAt: z.string(),
  updatedAt: z.string()
})
export type ConnectionProfile = z.infer<typeof connectionProfileSchema>

export const connectionProfileInputSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(2).max(80),
  brokerType: brokerTypeSchema,
  readOnly: z.boolean().default(true),
  configuration: profileConfigurationSchema,
  secret: z.record(z.string(), z.string()).default({})
})
export type ConnectionProfileInput = z.infer<typeof connectionProfileInputSchema>

export const sourceSummarySchema = z.object({
  id: z.string(),
  profileId: z.string(),
  name: z.string(),
  displayName: z.string(),
  targetName: z.string().nullable(),
  depth: z.number().int().nonnegative(),
  brokerType: brokerTypeSchema,
  status: z.enum(['healthy', 'warning', 'error']),
  oldestMessageAt: z.string().nullable(),
  capabilities: brokerCapabilitiesSchema
})
export type SourceSummary = z.infer<typeof sourceSummarySchema>

export const normalizedMessageSchema = z.object({
  id: z.string(),
  nativeId: z.string().nullable(),
  sourceId: z.string(),
  body: z.unknown(),
  bodyText: z.string(),
  contentType: z.string().nullable(),
  enqueuedAt: z.string().nullable(),
  deadLetterReason: z.string().nullable(),
  deadLetterDescription: z.string().nullable(),
  deliveryCount: z.number().int().nonnegative(),
  sizeBytes: z.number().int().nonnegative(),
  headers: z.record(z.string(), z.unknown()),
  rawHash: z.string()
})
export type NormalizedMessage = z.infer<typeof normalizedMessageSchema>

export const messagePageSchema = z.object({
  items: z.array(normalizedMessageSchema),
  hasMore: z.boolean(),
  inspectedAt: z.string(),
  warning: z.string().nullable()
})
export type MessagePage = z.infer<typeof messagePageSchema>

export const jobStatusSchema = z.enum(['queued', 'running', 'completed', 'failed', 'cancelled'])
export type JobStatus = z.infer<typeof jobStatusSchema>

export const operationJobSchema = z.object({
  id: z.string(),
  profileId: z.string(),
  sourceId: z.string(),
  targetName: z.string(),
  status: jobStatusSchema,
  total: z.number().int().nonnegative(),
  processed: z.number().int().nonnegative(),
  succeeded: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  throttlePerSecond: z.number().positive(),
  error: z.string().nullable(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable()
})
export type OperationJob = z.infer<typeof operationJobSchema>

export const auditEntrySchema = z.object({
  id: z.string(),
  action: z.string(),
  profileId: z.string(),
  sourceId: z.string().nullable(),
  targetName: z.string().nullable(),
  status: z.enum(['started', 'completed', 'failed', 'cancelled']),
  requested: z.number().int().nonnegative(),
  succeeded: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  detail: z.string().nullable(),
  createdAt: z.string()
})
export type AuditEntry = z.infer<typeof auditEntrySchema>

export const appErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  recoverable: z.boolean()
})
export type AppErrorData = z.infer<typeof appErrorSchema>

export const capabilitiesByBroker: Record<BrokerType, BrokerCapabilities> = {
  demo: {
    canDiscover: true,
    canPeek: true,
    canRequeue: true,
    canBulkRequeue: true,
    canEditAndResend: false,
    canPurge: false,
    supportsNativeDeadLetter: true,
    inspectionMode: 'demo'
  },
  rabbitmq: {
    canDiscover: false,
    canPeek: true,
    canRequeue: true,
    canBulkRequeue: true,
    canEditAndResend: false,
    canPurge: false,
    supportsNativeDeadLetter: false,
    inspectionMode: 'receive-and-release'
  },
  'azure-service-bus': {
    canDiscover: false,
    canPeek: true,
    canRequeue: true,
    canBulkRequeue: true,
    canEditAndResend: false,
    canPurge: false,
    supportsNativeDeadLetter: true,
    inspectionMode: 'native-peek'
  },
  kafka: {
    canDiscover: false,
    canPeek: true,
    canRequeue: true,
    canBulkRequeue: true,
    canEditAndResend: false,
    canPurge: false,
    supportsNativeDeadLetter: false,
    inspectionMode: 'append-only-read'
  }
}

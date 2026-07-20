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

export const brokerResourceRefSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('queue'), name: z.string().trim().min(1) }).strict(),
  z.object({ kind: z.literal('topic'), name: z.string().trim().min(1) }).strict(),
  z.object({
    kind: z.literal('subscription'),
    topicName: z.string().trim().min(1),
    name: z.string().trim().min(1)
  }).strict()
])
export type BrokerResourceRef = z.infer<typeof brokerResourceRefSchema>

export const targetResourceRefSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('queue'), name: z.string().trim().min(1) }).strict(),
  z.object({ kind: z.literal('topic'), name: z.string().trim().min(1) }).strict()
])
export type TargetResourceRef = z.infer<typeof targetResourceRefSchema>

export const resourceScopeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('root') }).strict(),
  z.object({ kind: z.literal('topic'), topicName: z.string().trim().min(1) }).strict()
])
export type ResourceScope = z.infer<typeof resourceScopeSchema>

const rootResourceScopeSchema = z.object({ kind: z.literal('root') }).strict().default({ kind: 'root' })
const azureResourceScopeSchema = resourceScopeSchema.default({ kind: 'root' })

const rabbitDiscoveryInputSchema = z.object({
  brokerType: z.literal('rabbitmq'),
  scope: rootResourceScopeSchema,
  configuration: z.object({
    host: z.string().trim().min(1),
    port: z.coerce.number().int().min(1).max(65535),
    vhost: z.string().min(1),
    tls: z.boolean(),
    managementUrl: z.string().trim().url().optional()
  }).strict(),
  secret: z.object({
    username: z.string().min(1),
    password: z.string()
  }).strict()
}).strict()

const azureDiscoveryInputSchema = z.object({
  brokerType: z.literal('azure-service-bus'),
  scope: azureResourceScopeSchema,
  configuration: z.object({}).strict(),
  secret: z.object({ connectionString: z.string().trim().min(1) }).strict()
}).strict()

const kafkaDiscoveryInputSchema = z.object({
  brokerType: z.literal('kafka'),
  scope: rootResourceScopeSchema,
  configuration: z.object({
    bootstrapServers: z.string().trim().min(1),
    clientId: z.string().trim().min(1)
  }).strict(),
  secret: z.object({}).strict()
}).strict()

export const brokerDiscoveryInputSchema = z.discriminatedUnion('brokerType', [
  rabbitDiscoveryInputSchema,
  azureDiscoveryInputSchema,
  kafkaDiscoveryInputSchema
])
export type BrokerDiscoveryInput = z.input<typeof brokerDiscoveryInputSchema>
export type ValidatedBrokerDiscoveryInput = z.output<typeof brokerDiscoveryInputSchema>

export const discoveredEntitySchema = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  kind: z.enum(['queue', 'topic', 'subscription']),
  parent: z.object({ kind: z.literal('topic'), name: z.string().min(1) }).strict().nullable(),
  messageCount: z.number().int().nonnegative().nullable(),
  childCount: z.number().int().nonnegative().nullable(),
  canInspect: z.boolean(),
  canTarget: z.boolean(),
  suggestedSource: z.boolean()
}).superRefine((entity, context) => {
  if (entity.kind === 'subscription' && entity.parent === null) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['parent'], message: 'A subscription requires its parent topic' })
  }
  if (entity.kind !== 'subscription' && entity.parent !== null) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['parent'], message: 'Only subscriptions can have a parent topic' })
  }
})
export type DiscoveredEntity = z.infer<typeof discoveredEntitySchema>

export const discoveryResultSchema = z.object({
  entities: z.array(discoveredEntitySchema),
  latencyMs: z.number().int().nonnegative()
})
export type DiscoveryResult = z.infer<typeof discoveryResultSchema>

export const sourceSummarySchema = z.object({
  id: z.string(),
  resource: brokerResourceRefSchema,
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

export function resourceKey(resource: BrokerResourceRef): string {
  if (resource.kind === 'subscription') {
    return `subscription:${encodeURIComponent(resource.topicName)}/${encodeURIComponent(resource.name)}`
  }
  return `${resource.kind}:${encodeURIComponent(resource.name)}`
}

export function resourceDisplayName(resource: BrokerResourceRef): string {
  return resource.kind === 'subscription' ? `${resource.topicName} / ${resource.name}` : resource.name
}

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
    canDiscover: true,
    canPeek: true,
    canRequeue: true,
    canBulkRequeue: true,
    canEditAndResend: false,
    canPurge: false,
    supportsNativeDeadLetter: false,
    inspectionMode: 'receive-and-release'
  },
  'azure-service-bus': {
    canDiscover: true,
    canPeek: true,
    canRequeue: true,
    canBulkRequeue: true,
    canEditAndResend: false,
    canPurge: false,
    supportsNativeDeadLetter: true,
    inspectionMode: 'native-peek'
  },
  kafka: {
    canDiscover: true,
    canPeek: true,
    canRequeue: true,
    canBulkRequeue: true,
    canEditAndResend: false,
    canPurge: false,
    supportsNativeDeadLetter: false,
    inspectionMode: 'append-only-read'
  }
}

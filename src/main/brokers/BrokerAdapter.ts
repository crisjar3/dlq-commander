import type {
  BrokerCapabilities,
  BrokerResourceRef,
  MessagePage,
  NormalizedMessage,
  SourceSummary,
  TargetResourceRef
} from '@shared/domain'

export interface ConnectionTestResult {
  ok: boolean
  latencyMs: number
  message: string
}

export interface BrokerAdapter {
  readonly capabilities: BrokerCapabilities
  testConnection(): Promise<ConnectionTestResult>
  listSources(): Promise<SourceSummary[]>
  listMessages(source: BrokerResourceRef, limit: number): Promise<MessagePage>
  getMessageSnapshots(source: BrokerResourceRef, messageIds: string[]): Promise<NormalizedMessage[]>
  requeueMessage(source: BrokerResourceRef, target: TargetResourceRef, messageId: string): Promise<void>
  close(): Promise<void>
}

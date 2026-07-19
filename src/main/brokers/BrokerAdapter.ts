import type { BrokerCapabilities, MessagePage, SourceSummary } from '@shared/domain'

export interface ConnectionTestResult {
  ok: boolean
  latencyMs: number
  message: string
}

export interface BrokerAdapter {
  readonly capabilities: BrokerCapabilities
  testConnection(): Promise<ConnectionTestResult>
  listSources(): Promise<SourceSummary[]>
  listMessages(sourceId: string, limit: number): Promise<MessagePage>
  requeueMessage(sourceId: string, targetName: string, messageId: string): Promise<void>
  close(): Promise<void>
}

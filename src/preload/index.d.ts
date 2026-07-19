import type { DlqCommanderApi } from '@shared/ipc-contract'

declare global {
  interface Window {
    dlqCommander: DlqCommanderApi
  }
}

export {}

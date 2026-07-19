import { contextBridge, ipcRenderer } from 'electron'
import { ipcContract, jobProgressChannel, type DlqCommanderApi, type IpcMethod } from '@shared/ipc-contract'
import { operationJobSchema } from '@shared/domain'

const api: DlqCommanderApi = {
  invoke: async <K extends IpcMethod>(method: K, payload: Parameters<DlqCommanderApi['invoke']>[1]) => {
    const definition = ipcContract[method]
    const validatedInput = definition.input.parse(payload)
    const result: unknown = await ipcRenderer.invoke(definition.channel, validatedInput)
    return definition.output.parse(result) as Awaited<ReturnType<DlqCommanderApi['invoke']>>
  },
  onJobProgress: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, rawJob: unknown): void => {
      callback(operationJobSchema.parse(rawJob))
    }
    ipcRenderer.on(jobProgressChannel, listener)
    return () => ipcRenderer.removeListener(jobProgressChannel, listener)
  }
}

contextBridge.exposeInMainWorld('dlqCommander', api)

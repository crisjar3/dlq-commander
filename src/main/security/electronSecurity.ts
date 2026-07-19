import { shell, type BrowserWindow, type Session } from 'electron'

const allowedExternalProtocols = new Set(['https:'])

function isAllowedExternalUrl(rawUrl: string): boolean {
  try {
    return allowedExternalProtocols.has(new URL(rawUrl).protocol)
  } catch {
    return false
  }
}

export function secureSession(session: Session): void {
  session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
  session.setPermissionCheckHandler(() => false)
}

export function secureWindow(window: BrowserWindow): void {
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, url) => {
    const currentUrl = window.webContents.getURL()
    if (url !== currentUrl) event.preventDefault()
  })
}

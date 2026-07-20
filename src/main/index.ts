import { join } from 'node:path'
import { app, BrowserWindow, nativeTheme, safeStorage, session } from 'electron'
import log from 'electron-log/main'
import { AppDatabase } from './persistence/database'
import { SecretVault } from './security/SecretVault'
import { ProfileRepository } from './persistence/ProfileRepository'
import { AuditRepository } from './persistence/AuditRepository'
import { ArchiveRepository } from './persistence/ArchiveRepository'
import { BrokerRegistry } from './brokers/BrokerRegistry'
import { JobRunner } from './jobs/JobRunner'
import { emitJobProgress, registerIpcHandlers } from './ipc/registerIpcHandlers'
import { secureSession, secureWindow } from './security/electronSecurity'
import { BrokerDiscoveryService } from './brokers/BrokerDiscoveryService'
import { ResourcePreferenceRepository } from './persistence/ResourcePreferenceRepository'

let mainWindow: BrowserWindow | null = null
let database: AppDatabase | null = null
let registry: BrokerRegistry | null = null

if (process.env['DLQ_COMMANDER_E2E_USER_DATA']) {
  app.setPath('userData', process.env['DLQ_COMMANDER_E2E_USER_DATA'])
}

function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 360,
    minHeight: 600,
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#151a20' : '#f2f4f6',
    title: 'DLQCommander',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  })
  secureWindow(window)
  window.once('ready-to-show', () => window.show())
  if (process.env['ELECTRON_RENDERER_URL']) {
    void window.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return window
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  void app.whenReady().then(() => {
    log.initialize()
    log.transports.file.level = 'info'
    secureSession(session.defaultSession)

    database = new AppDatabase(join(app.getPath('userData'), 'dlq-commander.db'))
    const vault = new SecretVault(safeStorage)
    const profiles = new ProfileRepository(database.connection, vault)
    const audit = new AuditRepository(database.connection)
    const archive = new ArchiveRepository(database.connection, vault)
    profiles.seedDemo()
    const discovery = new BrokerDiscoveryService()
    const preferences = new ResourcePreferenceRepository(database.connection)
    registry = new BrokerRegistry(profiles, discovery)
    const jobs = new JobRunner(profiles, registry, audit, archive, preferences, (job) => emitJobProgress(mainWindow?.webContents ?? null, job))
    registerIpcHandlers({ profiles, registry, jobs, audit, vault, discovery, preferences })

    mainWindow = createMainWindow()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) mainWindow = createMainWindow()
    })
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  if (registry) void registry.closeAll()
  database?.close()
  database = null
})

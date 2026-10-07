import { app, BrowserWindow, nativeTheme, safeStorage, session, shell } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { IPC } from '@shared/ipc'
import icon from '../../resources/icon.png?asset'
import { ChatGPTAccount } from './accounts/chatgpt'
import { registerIpc } from './ipc'
import { JobManager } from './jobs'
import { Library } from './library'
import { ffmpegPath, libraryDir, modelsDir, tempDir, whisperCliPath } from './paths'
import { SettingsStore } from './settings'
import { Updater } from './updater'

// Permite aislar los datos (ajustes, historial, modelos) en pruebas: NOTETAKER_USER_DATA=/ruta npm run dev
if (process.env['NOTETAKER_USER_DATA']) app.setPath('userData', process.env['NOTETAKER_USER_DATA'])

let mainWindow: BrowserWindow | null = null

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload)
  }
}

function createWindow(): void {
  const isMac = process.platform === 'darwin'
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 860,
    minHeight: 560,
    show: false,
    autoHideMenuBar: true,
    title: 'NoteTaker',
    ...(isMac
      ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 16, y: 16 } }
      : {}),
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())
  mainWindow.on('closed', () => (mainWindow = null))

  // Los enlaces externos se abren en el navegador; nunca se navega dentro de la app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== mainWindow?.webContents.getURL()) event.preventDefault()
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

/** Solo se concede el micrófono (audio); cámara y demás permisos se deniegan. */
function configurePermissions(): void {
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback, details) => {
    if (permission === 'media') {
      const types = 'mediaTypes' in details ? (details.mediaTypes ?? []) : []
      callback(types.length > 0 && types.every((t) => t === 'audio'))
      return
    }
    callback(permission === 'clipboard-sanitized-write')
  })
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => {
    return permission === 'media' || permission === 'clipboard-sanitized-write'
  })
}

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.notetaker.app')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // Mantener la ventana nativa (menús, scrollbars) en sintonía con el tema elegido,
  // avisar al renderer de cualquier cambio hecho desde el main (claves, modelo activo…)
  // y reprogramar la búsqueda de actualizaciones si cambia ese ajuste.
  let updater: Updater | null = null
  const settings = new SettingsStore(app.getPath('userData'), (view) => {
    nativeTheme.themeSource = view.theme
    broadcast(IPC.settingsChanged, view)
    if (updater && view.autoCheckUpdates !== autoCheckUpdates) {
      autoCheckUpdates = view.autoCheckUpdates
      updater.schedule()
    }
  })
  let autoCheckUpdates = settings.get().autoCheckUpdates
  nativeTheme.themeSource = settings.get().theme

  // Cuenta de ChatGPT: avisa a los ajustes cuando cambia (conectar, desconectar, sesión caducada).
  const chatgpt = new ChatGPTAccount({
    dir: app.getPath('userData'),
    secrets: {
      available: () => safeStorage.isEncryptionAvailable(),
      encrypt: (plain) => safeStorage.encryptString(plain).toString('base64'),
      decrypt: (stored) => safeStorage.decryptString(Buffer.from(stored, 'base64'))
    },
    openBrowser: (url) => shell.openExternal(url),
    onChange: () => settings.notifyChanged()
  })
  settings.attachAccounts({ chatgpt: () => chatgpt.info() })

  const library = new Library(libraryDir())
  await library.recoverInterrupted()

  const jobs = new JobManager(
    library,
    settings,
    chatgpt,
    { ffmpeg: ffmpegPath, whisperCli: whisperCliPath, models: modelsDir, temp: tempDir },
    {
      progress: (p) => broadcast(IPC.jobProgress, p),
      delta: (d) => broadcast(IPC.jobSummaryDelta, d),
      finished: (f) => broadcast(IPC.jobFinished, f),
      libraryChanged: () => broadcast(IPC.libraryChanged, null)
    }
  )

  updater = new Updater(settings, (state) => broadcast(IPC.updateStatus, state))
  registerIpc({ library, settings, chatgpt, jobs, updater, modelsDir, broadcast })

  configurePermissions()
  createWindow()
  updater.schedule()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

import { app, shell } from 'electron'
import { autoUpdater, type UpdateInfo } from 'electron-updater'
import type { UpdateState } from '@shared/types'
import type { SettingsStore } from './settings'
import {
  canAutoInstall,
  pickInstallerFile,
  releaseNotesToText,
  resolveFileUrl
} from './update-utils'

const FIRST_CHECK_DELAY_MS = 10_000
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000

/**
 * Busca versiones nuevas en el feed publicado en S3 (latest-mac.yml / latest.yml).
 *
 * - Windows (o macOS firmada): descarga en segundo plano e instala al reiniciar.
 * - macOS sin firma: solo avisa y abre la descarga del .dmg en el navegador.
 */
export class Updater {
  private state: UpdateState
  private readonly feedUrl: string
  private timer: NodeJS.Timeout | null = null
  private firstCheck: NodeJS.Timeout | null = null
  private installerUrl: string | null = null

  constructor(
    private readonly settings: SettingsStore,
    private readonly broadcast: (state: UpdateState) => void
  ) {
    // La variable de entorno permite probar contra un feed local sin recompilar.
    this.feedUrl = (process.env['NOTETAKER_UPDATE_URL'] || __UPDATE_URL__).trim()
    const canInstall = canAutoInstall(process.platform, __MAC_AUTO_UPDATE__)
    this.state = {
      status: this.feedUrl ? 'idle' : 'disabled',
      currentVersion: app.getVersion(),
      canInstall
    }
    if (!this.feedUrl) return

    autoUpdater.setFeedURL({ provider: 'generic', url: this.feedUrl })
    // Fuera de la app empaquetada electron-updater no comprueba nada salvo que se fuerce.
    if (!app.isPackaged) autoUpdater.forceDevUpdateConfig = true
    autoUpdater.autoDownload = canInstall
    autoUpdater.autoInstallOnAppQuit = canInstall
    autoUpdater.allowPrerelease = false

    autoUpdater.on('checking-for-update', () => this.set({ status: 'checking', error: undefined }))
    autoUpdater.on('update-available', (info: UpdateInfo) => {
      const file = pickInstallerFile(info.files, process.platform)
      this.installerUrl = file ? resolveFileUrl(this.feedUrl, file) : null
      this.set({
        status: 'available',
        version: info.version,
        releaseNotes: releaseNotesToText(info.releaseNotes),
        percent: undefined
      })
    })
    autoUpdater.on('update-not-available', () =>
      this.set({ status: 'up-to-date', version: undefined, releaseNotes: undefined })
    )
    autoUpdater.on('download-progress', (p) =>
      this.set({ status: 'downloading', percent: Math.round(p.percent) })
    )
    autoUpdater.on('update-downloaded', (info: UpdateInfo) =>
      this.set({ status: 'downloaded', version: info.version, percent: 100 })
    )
    autoUpdater.on('error', (err: Error) => {
      // Un fallo de descarga no debe ocultar que hay una versión nueva disponible.
      const keepAvailable = this.state.status === 'downloading' && this.state.version
      this.set({
        status: keepAvailable ? 'available' : 'error',
        error: { code: 'UPDATE_FAILED', detail: err.message }
      })
    })
  }

  getState(): UpdateState {
    return this.state
  }

  /** Arranca (o detiene) las comprobaciones periódicas según el ajuste del usuario. */
  schedule(): void {
    this.stop()
    if (this.state.status === 'disabled' || !this.settings.get().autoCheckUpdates) return
    this.firstCheck = setTimeout(() => void this.check(), FIRST_CHECK_DELAY_MS)
    this.timer = setInterval(() => void this.check(), CHECK_INTERVAL_MS)
  }

  stop(): void {
    if (this.firstCheck) clearTimeout(this.firstCheck)
    if (this.timer) clearInterval(this.timer)
    this.firstCheck = null
    this.timer = null
  }

  async check(): Promise<UpdateState> {
    if (this.state.status === 'disabled') return this.state
    // Ya descargada o descargándose: no hay nada nuevo que comprobar.
    if (this.state.status === 'downloading' || this.state.status === 'downloaded') return this.state
    try {
      await autoUpdater.checkForUpdates()
    } catch {
      // El evento 'error' ya actualizó el estado.
    }
    return this.state
  }

  install(): void {
    if (this.state.status === 'downloaded') autoUpdater.quitAndInstall()
  }

  /** macOS sin firma: abrir la descarga del instalador nuevo en el navegador. */
  async openDownload(): Promise<void> {
    if (this.installerUrl) await shell.openExternal(this.installerUrl)
  }

  private set(patch: Partial<UpdateState>): void {
    this.state = { ...this.state, ...patch }
    this.broadcast(this.state)
  }
}

import {
  BrowserWindow,
  dialog,
  ipcMain,
  shell,
  systemPreferences,
  type IpcMainInvokeEvent
} from 'electron'
import { toAppError } from '@shared/errors'
import { IPC } from '@shared/ipc'
import type {
  ExportFormat,
  ExportTarget,
  ModelDownloadProgress,
  Result,
  SettingsPatch,
  SummaryProvider
} from '@shared/types'
import { exportEntry } from './export'
import type { JobManager } from './jobs'
import type { Library } from './library'
import type { SettingsStore } from './settings'
import type { Updater } from './updater'
import { listAnthropicModels } from './summary/anthropic'
import { listOpenAIModels } from './summary/openai'
import { deleteModel, downloadModel, isModelInstalled, listModels } from './transcription/models'

// prettier-ignore
const MEDIA_EXTENSIONS = [
  'mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'oga', 'opus', 'wma', 'aiff', 'aif', 'amr',
  'mp4', 'mov', 'm4v', 'mkv', 'webm', 'avi', 'wmv', 'flv', 'mpeg', 'mpg', '3gp'
]

export interface IpcDeps {
  library: Library
  settings: SettingsStore
  jobs: JobManager
  updater: Updater
  modelsDir: () => string
  broadcast: (channel: string, payload: unknown) => void
}

/** Registra un handler que devuelve `Result<T>` en lugar de lanzar a través de IPC. */
function handle<A extends unknown[], T>(
  channel: string,
  fn: (event: IpcMainInvokeEvent, ...args: A) => Promise<T> | T
): void {
  ipcMain.handle(channel, async (event, ...args): Promise<Result<T>> => {
    try {
      return { ok: true, data: await fn(event, ...(args as A)) }
    } catch (err) {
      const error = toAppError(err)
      if (error.code === 'UNKNOWN') console.error(`[ipc] ${channel}`, err)
      return { ok: false, error }
    }
  })
}

export function registerIpc({
  library,
  settings,
  jobs,
  updater,
  modelsDir,
  broadcast
}: IpcDeps): void {
  const downloads = new Map<string, AbortController>()

  // Ajustes
  handle(IPC.settingsGet, () => settings.view())
  handle(IPC.settingsUpdate, (_e, patch: SettingsPatch) => settings.update(patch))
  handle(IPC.settingsSetApiKey, (_e, provider: SummaryProvider, key: string | null) =>
    settings.setApiKey(provider, key)
  )
  handle(
    IPC.providerModels,
    (_e, provider: SummaryProvider, purpose: 'summary' | 'transcription') =>
      provider === 'anthropic'
        ? listAnthropicModels(settings.requireApiKey('anthropic'))
        : listOpenAIModels(settings.requireApiKey('openai'), purpose)
  )

  // Modelos de whisper
  handle(IPC.whisperModelsList, () => listModels(modelsDir()))
  handle(IPC.whisperModelsDownload, (_e, id: string) => {
    if (downloads.has(id)) return
    const controller = new AbortController()
    downloads.set(id, controller)
    const emit = (p: ModelDownloadProgress): void => broadcast(IPC.whisperModelsProgress, p)
    emit({ id, received: 0, total: null, state: 'downloading' })
    downloadModel(modelsDir(), id, {
      signal: controller.signal,
      onProgress: (received, total) => emit({ id, received, total, state: 'downloading' })
    })
      .then(async () => {
        // Si el modelo en uso no está instalado, pasar a usar el recién descargado.
        const active = settings.get().transcription.localModel
        if (!(await isModelInstalled(modelsDir(), active))) {
          await settings.update({ transcription: { localModel: id } })
        }
        emit({ id, received: 0, total: null, state: 'done' })
      })
      .catch((err) => {
        const error = toAppError(err)
        emit({
          id,
          received: 0,
          total: null,
          state: error.code === 'CANCELLED' ? 'cancelled' : 'error',
          error
        })
      })
      .finally(() => downloads.delete(id))
  })
  handle(IPC.whisperModelsCancel, (_e, id: string) => downloads.get(id)?.abort())
  handle(IPC.whisperModelsDelete, async (_e, id: string) => {
    await deleteModel(modelsDir(), id)
    // Si se borró el modelo en uso, pasar a otro que siga instalado.
    if (settings.get().transcription.localModel === id) {
      const fallback = (await listModels(modelsDir())).find((m) => m.installed)
      if (fallback) await settings.update({ transcription: { localModel: fallback.id } })
    }
  })

  // Diálogos y permisos
  handle(IPC.dialogPickMedia, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const options = {
      properties: ['openFile', 'multiSelections'] as Array<'openFile' | 'multiSelections'>,
      filters: [{ name: 'Audio / Video', extensions: MEDIA_EXTENSIONS }]
    }
    const res = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options)
    return res.canceled ? [] : res.filePaths
  })
  handle(IPC.micRequestAccess, async () => {
    if (process.platform !== 'darwin') return true
    if (systemPreferences.getMediaAccessStatus('microphone') === 'granted') return true
    return systemPreferences.askForMediaAccess('microphone')
  })

  // Trabajos
  handle(IPC.jobStartFile, (_e, path: string) => jobs.startFromFile(path))
  handle(IPC.jobStartRecording, (_e, data: ArrayBuffer, mimeType: string) =>
    jobs.startFromRecording(data, mimeType)
  )
  handle(IPC.jobSummarize, (_e, entryId: string, templateId: string) =>
    jobs.summarize(entryId, templateId)
  )
  handle(IPC.jobRetry, (_e, entryId: string) => jobs.retry(entryId))
  handle(IPC.jobCancel, (_e, jobId: string) => jobs.cancel(jobId))
  handle(IPC.jobActive, () => jobs.activeJobs())

  // Historial
  handle(IPC.libraryList, () => library.list())
  handle(IPC.libraryGet, (_e, id: string) => library.get(id))
  handle(IPC.libraryRename, async (_e, id: string, title: string) => {
    const meta = await library.updateMeta(id, { title: title.trim() || 'Untitled' })
    broadcast(IPC.libraryChanged, null)
    return meta
  })
  handle(IPC.libraryDelete, async (_e, id: string) => {
    // A la papelera del sistema: se puede recuperar.
    await shell.trashItem(library.entryDir(id))
    broadcast(IPC.libraryChanged, null)
  })
  handle(IPC.libraryDeleteSummary, async (_e, id: string, summaryId: string) => {
    await library.deleteSummary(id, summaryId)
    broadcast(IPC.libraryChanged, null)
  })

  // Exportar y enlaces
  handle(
    IPC.exportEntry,
    async (event, id: string, target: ExportTarget, format: ExportFormat, summaryId?: string) =>
      exportEntry(
        BrowserWindow.fromWebContents(event.sender),
        await library.get(id),
        target,
        format,
        summaryId
      )
  )
  handle(IPC.openExternal, async (_e, url: string) => {
    if (!/^https:\/\//.test(url)) return
    await shell.openExternal(url)
  })

  // Actualizaciones
  handle(IPC.updateGetState, () => updater.getState())
  handle(IPC.updateCheck, () => updater.check())
  handle(IPC.updateInstall, () => updater.install())
  handle(IPC.updateOpenDownload, () => updater.openDownload())
}

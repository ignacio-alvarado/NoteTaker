import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'
import type { PreloadApi } from '@shared/api'
import { IPC } from '@shared/ipc'
import type { Result } from '@shared/types'

function invoke<T>(channel: string, ...args: unknown[]): Promise<Result<T>> {
  return ipcRenderer.invoke(channel, ...args)
}

function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_e: IpcRendererEvent, payload: T): void => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => {
    ipcRenderer.removeListener(channel, listener)
  }
}

const api: PreloadApi = {
  platform: process.platform,

  getSettings: () => invoke(IPC.settingsGet),
  updateSettings: (patch) => invoke(IPC.settingsUpdate, patch),
  setApiKey: (provider, key) => invoke(IPC.settingsSetApiKey, provider, key),
  onSettingsChanged: (cb) => subscribe(IPC.settingsChanged, cb),
  listProviderModels: (provider, purpose) => invoke(IPC.providerModels, provider, purpose),

  listWhisperModels: () => invoke(IPC.whisperModelsList),
  downloadWhisperModel: (id) => invoke(IPC.whisperModelsDownload, id),
  cancelWhisperModelDownload: (id) => invoke(IPC.whisperModelsCancel, id),
  deleteWhisperModel: (id) => invoke(IPC.whisperModelsDelete, id),
  onModelDownloadProgress: (cb) => subscribe(IPC.whisperModelsProgress, cb),

  pickMediaFiles: () => invoke(IPC.dialogPickMedia),
  // Electron 32+ ya no expone `File.path`; esta es la vía soportada.
  getPathForFile: (file) => webUtils.getPathForFile(file),
  requestMicAccess: () => invoke(IPC.micRequestAccess),

  startFileJob: (path) => invoke(IPC.jobStartFile, path),
  startRecordingJob: (data, mimeType) => invoke(IPC.jobStartRecording, data, mimeType),
  summarize: (entryId, templateId) => invoke(IPC.jobSummarize, entryId, templateId),
  retryJob: (entryId) => invoke(IPC.jobRetry, entryId),
  cancelJob: (jobId) => invoke(IPC.jobCancel, jobId),
  activeJobs: () => invoke(IPC.jobActive),
  onJobProgress: (cb) => subscribe(IPC.jobProgress, cb),
  onSummaryDelta: (cb) => subscribe(IPC.jobSummaryDelta, cb),
  onJobFinished: (cb) => subscribe(IPC.jobFinished, cb),

  listEntries: () => invoke(IPC.libraryList),
  getEntry: (id) => invoke(IPC.libraryGet, id),
  renameEntry: (id, title) => invoke(IPC.libraryRename, id, title),
  deleteEntry: (id) => invoke(IPC.libraryDelete, id),
  deleteSummary: (id, summaryId) => invoke(IPC.libraryDeleteSummary, id, summaryId),
  onLibraryChanged: (cb) => subscribe(IPC.libraryChanged, cb),

  exportEntry: (id, target, format, summaryId) =>
    invoke(IPC.exportEntry, id, target, format, summaryId),
  openExternal: (url) => invoke(IPC.openExternal, url)
}

contextBridge.exposeInMainWorld('api', api)

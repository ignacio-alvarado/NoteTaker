import type {
  Entry,
  EntryMeta,
  ExportFormat,
  ExportTarget,
  JobFinished,
  JobProgress,
  JobStarted,
  ModelDownloadProgress,
  Result,
  SettingsPatch,
  SettingsView,
  SummaryDelta,
  SummaryProvider,
  UpdateState,
  WhisperModelInfo
} from './types'

type Unsubscribe = () => void

/** API que el preload expone en `window.api`. Las llamadas devuelven `Result<T>`. */
export interface PreloadApi {
  platform: string

  getSettings(): Promise<Result<SettingsView>>
  updateSettings(patch: SettingsPatch): Promise<Result<SettingsView>>
  setApiKey(provider: SummaryProvider, key: string | null): Promise<Result<SettingsView>>
  onSettingsChanged(cb: (view: SettingsView) => void): Unsubscribe
  listProviderModels(
    provider: SummaryProvider,
    purpose: 'summary' | 'transcription'
  ): Promise<Result<string[]>>

  listWhisperModels(): Promise<Result<WhisperModelInfo[]>>
  downloadWhisperModel(id: string): Promise<Result<void>>
  cancelWhisperModelDownload(id: string): Promise<Result<void>>
  deleteWhisperModel(id: string): Promise<Result<void>>
  onModelDownloadProgress(cb: (p: ModelDownloadProgress) => void): Unsubscribe

  pickMediaFiles(): Promise<Result<string[]>>
  getPathForFile(file: File): string
  requestMicAccess(): Promise<Result<boolean>>

  startFileJob(path: string): Promise<Result<JobStarted>>
  startRecordingJob(data: ArrayBuffer, mimeType: string): Promise<Result<JobStarted>>
  summarize(entryId: string, templateId: string): Promise<Result<JobStarted>>
  retryJob(entryId: string): Promise<Result<JobStarted>>
  cancelJob(jobId: string): Promise<Result<void>>
  activeJobs(): Promise<Result<JobProgress[]>>
  onJobProgress(cb: (p: JobProgress) => void): Unsubscribe
  onSummaryDelta(cb: (d: SummaryDelta) => void): Unsubscribe
  onJobFinished(cb: (f: JobFinished) => void): Unsubscribe

  listEntries(): Promise<Result<EntryMeta[]>>
  getEntry(id: string): Promise<Result<Entry>>
  renameEntry(id: string, title: string): Promise<Result<EntryMeta>>
  deleteEntry(id: string): Promise<Result<void>>
  deleteSummary(id: string, summaryId: string): Promise<Result<void>>
  onLibraryChanged(cb: () => void): Unsubscribe

  exportEntry(
    id: string,
    target: ExportTarget,
    format: ExportFormat,
    summaryId?: string
  ): Promise<Result<string | null>>
  openExternal(url: string): Promise<Result<void>>

  getUpdateState(): Promise<Result<UpdateState>>
  checkForUpdates(): Promise<Result<UpdateState>>
  installUpdate(): Promise<Result<void>>
  openUpdateDownload(): Promise<Result<void>>
  onUpdateStatus(cb: (state: UpdateState) => void): Unsubscribe
}

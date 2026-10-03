import { createContext, useContext, useMemo } from 'react'
import i18n from '../i18n'
import type {
  AppError,
  EntryMeta,
  JobProgress,
  ModelDownloadProgress,
  SettingsPatch,
  SettingsView,
  SummaryProvider,
  UpdateState,
  WhisperModelInfo
} from '@shared/types'

export interface Toast {
  id: number
  kind: 'error' | 'info'
  message: string
}

export interface AppContextValue {
  settings: SettingsView | null
  entries: EntryMeta[]
  selectedId: string | null
  /** Trabajos activos por jobId. */
  jobs: Record<string, JobProgress>
  /** Resumen en curso (streaming) por entryId. */
  streaming: Record<string, string>
  /** Último error de resumen por entryId. */
  summaryErrors: Record<string, AppError | undefined>
  /** Se incrementa cada vez que cambia el historial en disco. */
  libraryVersion: number
  toasts: Toast[]
  settingsOpen: string | null
  /** Catálogo de modelos de Whisper con su estado de instalación. */
  whisperModels: WhisperModelInfo[]
  /** Descargas de modelos en curso, por id de modelo. */
  modelDownloads: Record<string, ModelDownloadProgress>
  update: UpdateState | null

  select(id: string | null): void
  openSettings(tab?: string): void
  closeSettings(): void
  updateSettings(patch: SettingsPatch): Promise<void>
  setApiKey(provider: SummaryProvider, key: string | null): Promise<void>
  startFiles(paths: string[]): Promise<void>
  startRecording(data: ArrayBuffer, mimeType: string): Promise<void>
  summarize(entryId: string, templateId: string): Promise<void>
  retry(entryId: string): Promise<void>
  cancelJob(jobId: string): Promise<void>
  notify(kind: Toast['kind'], message: string): void
  notifyError(err: unknown): void
  dismissToast(id: number): void
  refreshWhisperModels(): Promise<void>
  checkForUpdates(): Promise<void>
  installUpdate(): Promise<void>
  openUpdateDownload(): Promise<void>
}

export const AppContext = createContext<AppContextValue | null>(null)

export function translateError(error: AppError): string {
  const base = i18n.t(`errors.${error.code}`, { defaultValue: i18n.t('errors.UNKNOWN') })
  return error.detail &&
    [
      'UNKNOWN',
      'API_ERROR',
      'FFMPEG_FAILED',
      'WHISPER_FAILED',
      'DOWNLOAD_FAILED',
      'UPDATE_FAILED',
      'REFUSAL'
    ].includes(error.code)
    ? `${base} (${error.detail})`
    : base
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be used inside <AppProvider>')
  return ctx
}

/** Trabajos activos de una entrada concreta. */
export function useEntryJobs(entryId: string | null): JobProgress[] {
  const { jobs } = useApp()
  return useMemo(() => Object.values(jobs).filter((j) => j.entryId === entryId), [jobs, entryId])
}

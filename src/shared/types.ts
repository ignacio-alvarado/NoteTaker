export type UiLanguage = 'es' | 'en'
export type Theme = 'system' | 'light' | 'dark'
export type TranscriptionEngine = 'local' | 'openai'
export type SummaryProvider = 'anthropic' | 'openai'
export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'
export type OutputLanguage = 'auto' | 'es' | 'en'

/** Un fragmento de la transcripción. Tiempos en segundos. */
export interface Segment {
  start: number
  end: number
  text: string
}

export interface Transcript {
  /** Código ISO-639-1 detectado o elegido (p. ej. "es"), si se conoce. */
  language: string | null
  segments: Segment[]
  text: string
}

export interface SummaryTemplate {
  id: string
  name: string
  prompt: string
  builtin: boolean
}

export interface TranscriptionSettings {
  engine: TranscriptionEngine
  /** Id del modelo GGML local (ver catálogo en transcription/models). */
  localModel: string
  /** "auto" o código ISO-639-1. */
  language: string
  /** 0 = automático. */
  threads: number
  useGpu: boolean
  openaiModel: string
}

export interface SummarySettings {
  provider: SummaryProvider
  anthropicModel: string
  openaiModel: string
  effort: Effort
  outputLanguage: OutputLanguage
  defaultTemplateId: string
  autoSummarize: boolean
}

export interface Settings {
  uiLanguage: UiLanguage
  theme: Theme
  transcription: TranscriptionSettings
  summary: SummarySettings
  customTemplates: SummaryTemplate[]
  /** Buscar versiones nuevas al arrancar y cada pocas horas. */
  autoCheckUpdates: boolean
}

export interface SettingsView extends Settings {
  /** Plantillas incluidas (en el idioma de la UI) + personalizadas. */
  templates: SummaryTemplate[]
  hasAnthropicKey: boolean
  hasOpenAIKey: boolean
  encryptionAvailable: boolean
}

export type SettingsPatch = Partial<
  Omit<Settings, 'transcription' | 'summary'> & {
    transcription: Partial<TranscriptionSettings>
    summary: Partial<SummarySettings>
  }
>

export type EntryStatus =
  'queued' | 'processing' | 'transcribed' | 'summarized' | 'error' | 'cancelled'

export interface EntryMeta {
  id: string
  title: string
  sourceName: string
  sourcePath: string | null
  isRecording: boolean
  createdAt: string
  durationSec: number | null
  language: string | null
  engine: TranscriptionEngine | null
  model: string | null
  status: EntryStatus
  error: AppError | null
}

export interface SummaryRecord {
  id: string
  templateId: string
  templateName: string
  provider: SummaryProvider
  model: string
  markdown: string
  createdAt: string
}

export interface Entry {
  meta: EntryMeta
  transcript: Transcript | null
  summaries: SummaryRecord[]
}

export type JobKind = 'transcription' | 'summary'
export type JobStage = 'queued' | 'converting' | 'transcribing' | 'summarizing'

export interface JobProgress {
  jobId: string
  entryId: string
  kind: JobKind
  stage: JobStage
  /** 0–100, o null si es indeterminado. */
  percent: number | null
}

export interface JobStarted {
  jobId: string
  entryId: string
}

export interface SummaryDelta {
  jobId: string
  entryId: string
  text: string
}

export interface JobFinished {
  jobId: string
  entryId: string
  kind: JobKind
  error: AppError | null
}

export interface WhisperModelInfo {
  id: string
  label: string
  sizeMB: number
  installed: boolean
  recommended: boolean
}

export interface ModelDownloadProgress {
  id: string
  received: number
  total: number | null
  state: 'downloading' | 'done' | 'error' | 'cancelled'
  error?: AppError
}

export type ExportTarget = 'summary' | 'transcript'
export type ExportFormat = 'md' | 'txt' | 'txt-timestamps' | 'srt' | 'vtt'

export type ErrorCode =
  | 'NO_API_KEY_ANTHROPIC'
  | 'NO_API_KEY_OPENAI'
  | 'NO_LOCAL_MODEL'
  | 'WHISPER_BINARY_MISSING'
  | 'FFMPEG_FAILED'
  | 'WHISPER_FAILED'
  | 'EMPTY_TRANSCRIPT'
  | 'AUTH_FAILED'
  | 'RATE_LIMITED'
  | 'NETWORK'
  | 'REFUSAL'
  | 'OUTPUT_TRUNCATED'
  | 'API_ERROR'
  | 'ENCRYPTION_UNAVAILABLE'
  | 'NOT_FOUND'
  | 'CANCELLED'
  | 'DOWNLOAD_FAILED'
  | 'UPDATE_FAILED'
  | 'UNKNOWN'

export interface AppError {
  code: ErrorCode
  detail?: string
}

export type UpdateStatus =
  | 'disabled'
  | 'idle'
  | 'checking'
  | 'up-to-date'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'error'

export interface UpdateState {
  status: UpdateStatus
  currentVersion: string
  /** Versión nueva disponible (available/downloading/downloaded). */
  version?: string
  /** Progreso de descarga, 0–100. */
  percent?: number
  releaseNotes?: string
  /** true si la app puede descargar e instalar sola (Windows, o macOS firmada). */
  canInstall: boolean
  error?: AppError
}

export type Result<T> = { ok: true; data: T } | { ok: false; error: AppError }

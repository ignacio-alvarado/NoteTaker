import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import i18n from '../i18n'
import type {
  AppError,
  EntryMeta,
  JobProgress,
  ModelDownloadProgress,
  SettingsView,
  WhisperModelInfo
} from '@shared/types'
import { api, asAppError } from './api'
import { AppContext, translateError, type AppContextValue, type Toast } from './context'

let toastSeq = 0

function applyTheme(theme: SettingsView['theme']): void {
  const dark =
    theme === 'dark' ||
    (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.classList.toggle('dark', dark)
}

export function AppProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [settings, setSettings] = useState<SettingsView | null>(null)
  const [entries, setEntries] = useState<EntryMeta[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [jobs, setJobs] = useState<Record<string, JobProgress>>({})
  const [streaming, setStreaming] = useState<Record<string, string>>({})
  const [summaryErrors, setSummaryErrors] = useState<Record<string, AppError | undefined>>({})
  const [libraryVersion, setLibraryVersion] = useState(0)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [settingsOpen, setSettingsOpen] = useState<string | null>(null)
  const [whisperModels, setWhisperModels] = useState<WhisperModelInfo[]>([])
  const [modelDownloads, setModelDownloads] = useState<Record<string, ModelDownloadProgress>>({})

  const notify = useCallback((kind: Toast['kind'], message: string) => {
    const id = ++toastSeq
    setToasts((t) => [...t, { id, kind, message }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 8000 : 4000)
  }, [])

  const notifyError = useCallback(
    (err: unknown) => notify('error', translateError(asAppError(err))),
    [notify]
  )

  const applySettings = useCallback((view: SettingsView) => {
    setSettings(view)
    if (i18n.language !== view.uiLanguage) void i18n.changeLanguage(view.uiLanguage)
    applyTheme(view.theme)
  }, [])

  const refreshEntries = useCallback(async () => {
    setEntries(await api.listEntries())
    setLibraryVersion((v) => v + 1)
  }, [])

  const refreshWhisperModels = useCallback(async () => {
    setWhisperModels(await api.listWhisperModels())
  }, [])

  // Carga inicial y suscripciones a eventos del proceso main.
  useEffect(() => {
    void api.getSettings().then(applySettings)
    void api.listEntries().then(setEntries)
    void api.activeJobs().then((list) => setJobs(Object.fromEntries(list.map((j) => [j.jobId, j]))))
    void api.listWhisperModels().then(setWhisperModels)

    const offs = [
      // Cambios hechos desde el main (API keys, modelo activo tras una descarga…).
      api.onSettingsChanged(applySettings),
      api.onModelDownloadProgress((p) => {
        setModelDownloads((prev) => {
          const next = { ...prev }
          if (p.state === 'downloading') next[p.id] = p
          else delete next[p.id]
          return next
        })
        if (p.state !== 'downloading') void refreshWhisperModels()
        if (p.state === 'error' && p.error) notify('error', translateError(p.error))
      }),
      api.onLibraryChanged(() => void refreshEntries()),
      api.onJobProgress((p) => setJobs((j) => ({ ...j, [p.jobId]: p }))),
      api.onSummaryDelta((d) =>
        setStreaming((s) => ({ ...s, [d.entryId]: (s[d.entryId] ?? '') + d.text }))
      ),
      api.onJobFinished((f) => {
        setJobs((j) => {
          const next = { ...j }
          delete next[f.jobId]
          return next
        })
        if (f.kind === 'summary') {
          setStreaming((s) => {
            const next = { ...s }
            delete next[f.entryId]
            return next
          })
          setSummaryErrors((e) => ({
            ...e,
            [f.entryId]: f.error && f.error.code !== 'CANCELLED' ? f.error : undefined
          }))
        }
        // Los errores de resumen se muestran en su panel; los de transcripción, también como aviso.
        if (f.kind === 'transcription' && f.error && f.error.code !== 'CANCELLED') {
          notify('error', translateError(f.error))
        }
      })
    ]
    return () => offs.forEach((off) => off())
  }, [applySettings, refreshEntries, refreshWhisperModels, notify])

  // Seguir el tema del sistema cuando está en "system".
  useEffect(() => {
    if (settings?.theme !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (): void => applyTheme('system')
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [settings?.theme])

  const value = useMemo<AppContextValue>(
    () => ({
      settings,
      entries,
      selectedId,
      jobs,
      streaming,
      summaryErrors,
      libraryVersion,
      toasts,
      settingsOpen,
      whisperModels,
      modelDownloads,
      refreshWhisperModels,
      select: setSelectedId,
      openSettings: (tab = 'general') => setSettingsOpen(tab),
      closeSettings: () => setSettingsOpen(null),
      async updateSettings(patch) {
        try {
          applySettings(await api.updateSettings(patch))
        } catch (err) {
          notifyError(err)
        }
      },
      async setApiKey(provider, key) {
        applySettings(await api.setApiKey(provider, key))
      },
      async startFiles(paths) {
        let first: string | null = null
        for (const path of paths) {
          try {
            const { entryId } = await api.startFileJob(path)
            first ??= entryId
          } catch (err) {
            notifyError(err)
          }
        }
        if (first) setSelectedId(first)
      },
      async startRecording(data, mimeType) {
        try {
          const { entryId } = await api.startRecordingJob(data, mimeType)
          setSelectedId(entryId)
        } catch (err) {
          notifyError(err)
        }
      },
      async summarize(entryId, templateId) {
        setSummaryErrors((e) => ({ ...e, [entryId]: undefined }))
        setStreaming((s) => ({ ...s, [entryId]: '' }))
        try {
          await api.summarize(entryId, templateId)
        } catch (err) {
          notifyError(err)
        }
      },
      async retry(entryId) {
        try {
          await api.retryJob(entryId)
        } catch (err) {
          notifyError(err)
        }
      },
      async cancelJob(jobId) {
        await api.cancelJob(jobId)
      },
      notify,
      notifyError,
      dismissToast: (id) => setToasts((t) => t.filter((x) => x.id !== id))
    }),
    [
      settings,
      entries,
      selectedId,
      jobs,
      streaming,
      summaryErrors,
      libraryVersion,
      toasts,
      settingsOpen,
      whisperModels,
      modelDownloads,
      refreshWhisperModels,
      applySettings,
      notify,
      notifyError
    ]
  )

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

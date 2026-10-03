import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Entry } from '@shared/types'
import { api, ApiError } from '../lib/api'
import { formatDate, formatDuration } from '../lib/format'
import { translateError, useApp, useEntryJobs } from '../lib/context'
import { AlertIcon, RefreshIcon, TrashIcon } from './icons'
import { JobProgress } from './JobProgress'
import { StatusBadge } from './StatusBadge'
import { SummaryPanel } from './SummaryPanel'
import { TranscriptPanel } from './TranscriptPanel'

function EditableTitle({ entry }: { entry: Entry }): React.JSX.Element {
  const { t } = useTranslation()
  const { notifyError } = useApp()
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(entry.meta.title)

  async function save(): Promise<void> {
    setEditing(false)
    if (value.trim() && value !== entry.meta.title) {
      try {
        await api.renameEntry(entry.meta.id, value)
      } catch (err) {
        notifyError(err)
      }
    } else {
      setValue(entry.meta.title)
    }
  }

  if (editing) {
    return (
      <input
        autoFocus
        className="input py-1 text-xl font-semibold"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => void save()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void save()
          if (e.key === 'Escape') {
            setValue(entry.meta.title)
            setEditing(false)
          }
        }}
      />
    )
  }
  return (
    <h1
      className="cursor-text truncate rounded px-1 -mx-1 text-xl font-semibold tracking-tight hover:bg-zinc-100 dark:hover:bg-zinc-800"
      title={t('entry.renameHint')}
      onClick={() => {
        setValue(entry.meta.title)
        setEditing(true)
      }}
    >
      {entry.meta.title || t('common.untitled')}
    </h1>
  )
}

export function EntryView({ entryId }: { entryId: string }): React.JSX.Element | null {
  const { t, i18n } = useTranslation()
  const { libraryVersion, select, retry, notifyError } = useApp()
  const jobs = useEntryJobs(entryId)
  const [entry, setEntry] = useState<Entry | null>(null)
  const [tab, setTab] = useState<'summary' | 'transcript'>('summary')

  useEffect(() => {
    let alive = true
    api
      .getEntry(entryId)
      .then((e) => alive && setEntry(e))
      .catch((err) => {
        if (!alive) return
        if (err instanceof ApiError && err.code === 'NOT_FOUND') select(null)
        else notifyError(err)
      })
    return () => {
      alive = false
    }
  }, [entryId, libraryVersion, select, notifyError])

  if (!entry) return null
  const { meta, transcript } = entry
  const transcriptionJob = jobs.find((j) => j.kind === 'transcription')
  const summaryJob = jobs.find((j) => j.kind === 'summary')
  const canRetry =
    !transcriptionJob && (meta.status === 'error' || meta.status === 'cancelled') && !transcript

  async function remove(): Promise<void> {
    if (!window.confirm(t('entry.deleteConfirm', { title: meta.title }))) return
    try {
      await api.deleteEntry(meta.id)
      select(null)
    } catch (err) {
      notifyError(err)
    }
  }

  const details = [
    formatDate(meta.createdAt, i18n.language === 'es' ? 'es' : 'en'),
    meta.durationSec !== null ? formatDuration(meta.durationSec) : null,
    meta.language
      ? t('entry.language', {
          lang: t(`languages.${meta.language}`, { defaultValue: meta.language })
        })
      : null,
    meta.engine ? `${t(`engine.${meta.engine}`)} · ${meta.model}` : null,
    meta.isRecording ? t('entry.recording') : meta.sourceName
  ].filter(Boolean)

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5 px-8 pt-2 pb-12">
      <header className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <EditableTitle entry={entry} />
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-500">
            <StatusBadge status={meta.status} />
            <span className="truncate">{details.join(' · ')}</span>
          </div>
        </div>
        {canRetry && (
          <button className="btn-secondary" onClick={() => void retry(meta.id)}>
            <RefreshIcon size={14} />
            {t('entry.retry')}
          </button>
        )}
        <button
          className="btn-danger"
          onClick={() => void remove()}
          title={t('entry.delete')}
          disabled={Boolean(transcriptionJob)}
        >
          <TrashIcon />
        </button>
      </header>

      {transcriptionJob && <JobProgress job={transcriptionJob} />}

      {!transcriptionJob && meta.status === 'error' && meta.error && (
        <div className="flex gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200">
          <AlertIcon className="mt-0.5 shrink-0" />
          <div className="selectable min-w-0">
            <p className="font-medium">{t('entry.errorTitle')}</p>
            <p className="mt-1 break-words whitespace-pre-wrap">{translateError(meta.error)}</p>
          </div>
        </div>
      )}

      {!transcriptionJob && meta.status === 'cancelled' && !transcript && (
        <p className="text-sm text-zinc-500">{t('entry.cancelledTitle')}</p>
      )}

      {transcript ? (
        <>
          <div className="flex gap-1 border-b border-zinc-200 dark:border-zinc-800">
            {(['summary', 'transcript'] as const).map((key) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
                  tab === key
                    ? 'border-accent-600 text-zinc-900 dark:text-zinc-100'
                    : 'border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'
                }`}
              >
                {key === 'summary' ? t('entry.tabSummary') : t('entry.tabTranscript')}
              </button>
            ))}
          </div>
          {tab === 'summary' ? (
            <SummaryPanel entry={entry} job={summaryJob} />
          ) : (
            <TranscriptPanel entry={entry} />
          )}
        </>
      ) : (
        transcriptionJob && <p className="text-sm text-zinc-500">{t('entry.waiting')}</p>
      )}
    </div>
  )
}

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Entry, ExportFormat, JobProgress } from '@shared/types'
import { api } from '../lib/api'
import { formatDate } from '../lib/format'
import { translateError, useApp } from '../lib/context'
import { AlertIcon, CopyIcon, DownloadIcon, SparklesIcon, TrashIcon } from './icons'
import { Markdown } from './Markdown'

export function SummaryPanel({
  entry,
  job
}: {
  entry: Entry
  job?: JobProgress
}): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const { settings, streaming, summaryErrors, summarize, cancelJob, notify, notifyError } = useApp()
  const entryId = entry.meta.id
  const templates = settings!.templates

  const [templateId, setTemplateId] = useState(settings!.summary.defaultTemplateId)
  // La versión elegida solo vale mientras no llegue un resumen más nuevo.
  const [pick, setPick] = useState<{ id: string; latest: string | undefined } | null>(null)

  const latestId = entry.summaries[0]?.id
  const versionId = pick && pick.latest === latestId ? pick.id : latestId

  const live = streaming[entryId]
  const generating = Boolean(job) || live !== undefined
  const error = summaryErrors[entryId]
  const summary = entry.summaries.find((s) => s.id === versionId) ?? entry.summaries[0]
  const lang = i18n.language === 'es' ? 'es' : 'en'

  async function exportAs(format: ExportFormat): Promise<void> {
    try {
      const path = await api.exportEntry(entryId, 'summary', format, summary?.id)
      if (path) notify('info', t('export.saved', { path }))
    } catch (err) {
      notifyError(err)
    }
  }

  async function copy(): Promise<void> {
    if (!summary) return
    await navigator.clipboard.writeText(summary.markdown)
    notify('info', t('summary.copied'))
  }

  async function removeVersion(): Promise<void> {
    if (!summary) return
    try {
      await api.deleteSummary(entryId, summary.id)
    } catch (err) {
      notifyError(err)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-2">
        <label className="min-w-48 flex-1">
          <span className="label">{t('summary.template')}</span>
          <select
            className="input"
            value={templateId}
            onChange={(e) => setTemplateId(e.target.value)}
            disabled={generating}
          >
            {templates.map((tpl) => (
              <option key={tpl.id} value={tpl.id}>
                {tpl.name}
              </option>
            ))}
          </select>
        </label>
        {generating ? (
          <button
            className="btn-secondary"
            disabled={!job}
            onClick={() => job && void cancelJob(job.jobId)}
          >
            {t('common.cancel')}
          </button>
        ) : (
          <button className="btn-primary" onClick={() => void summarize(entryId, templateId)}>
            <SparklesIcon size={14} />
            {entry.summaries.length ? t('summary.regenerate') : t('summary.generate')}
          </button>
        )}
      </div>

      {entry.summaries.length > 1 && !generating && (
        <label className="flex items-center gap-2 text-sm">
          <span className="text-zinc-500">{t('summary.version')}</span>
          <select
            className="input w-auto"
            value={summary?.id}
            onChange={(e) => setPick({ id: e.target.value, latest: latestId })}
          >
            {entry.summaries.map((s) => (
              <option key={s.id} value={s.id}>
                {s.templateName} · {s.model} · {formatDate(s.createdAt, lang)}
              </option>
            ))}
          </select>
        </label>
      )}

      {error && !generating && (
        <div className="flex gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200">
          <AlertIcon className="mt-0.5 shrink-0" />
          <div className="selectable min-w-0">
            <p className="font-medium">{t('summary.errorTitle')}</p>
            <p className="mt-1 break-words">{translateError(error)}</p>
          </div>
        </div>
      )}

      {generating ? (
        <article className="card p-6">
          {live ? (
            <Markdown>{live}</Markdown>
          ) : (
            <div className="flex items-center gap-2 text-sm text-zinc-500">
              <span className="h-2 w-2 animate-pulse rounded-full bg-accent-500" />
              {t('summary.generating')}
            </div>
          )}
        </article>
      ) : summary ? (
        <article className="card">
          <div className="flex items-center gap-1 border-b border-zinc-200 px-3 py-2 text-xs text-zinc-500 dark:border-zinc-800">
            <span className="truncate">
              {summary.templateName} · {t(`provider.${summary.provider}`)} {summary.model}
            </span>
            <span className="ml-auto" />
            <button className="btn-ghost px-2 py-1 text-xs" onClick={() => void copy()}>
              <CopyIcon size={13} />
              {t('summary.copy')}
            </button>
            <button className="btn-ghost px-2 py-1 text-xs" onClick={() => void exportAs('md')}>
              <DownloadIcon size={13} />
              {t('summary.exportMd')}
            </button>
            <button className="btn-ghost px-2 py-1 text-xs" onClick={() => void exportAs('txt')}>
              <DownloadIcon size={13} />
              {t('summary.exportTxt')}
            </button>
            <button
              className="btn-danger px-2 py-1"
              title={t('summary.deleteVersion')}
              onClick={() => void removeVersion()}
            >
              <TrashIcon size={13} />
            </button>
          </div>
          <div className="p-6">
            <Markdown>{summary.markdown}</Markdown>
          </div>
        </article>
      ) : (
        !error && (
          <div className="rounded-xl border border-dashed border-zinc-300 p-10 text-center text-sm text-zinc-500 dark:border-zinc-700">
            {t('summary.empty')}
          </div>
        )
      )}
    </div>
  )
}

import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { formatClock } from '@shared/format'
import type { Entry, ExportFormat } from '@shared/types'
import { api } from '../lib/api'
import { useApp } from '../lib/context'
import { CopyIcon, DownloadIcon, SearchIcon } from './icons'

function highlight(text: string, query: string): React.ReactNode {
  if (!query) return text
  const lower = text.toLowerCase()
  const parts: React.ReactNode[] = []
  let from = 0
  let idx = lower.indexOf(query, from)
  while (idx !== -1) {
    parts.push(text.slice(from, idx))
    parts.push(
      <mark key={idx} className="rounded bg-amber-200 px-0.5 text-inherit dark:bg-amber-500/40">
        {text.slice(idx, idx + query.length)}
      </mark>
    )
    from = idx + query.length
    idx = lower.indexOf(query, from)
  }
  parts.push(text.slice(from))
  return parts
}

const EXPORTS: Array<{ format: ExportFormat; key: string }> = [
  { format: 'txt', key: 'transcript.exportTxt' },
  { format: 'txt-timestamps', key: 'transcript.exportTxtTs' },
  { format: 'srt', key: 'transcript.exportSrt' },
  { format: 'vtt', key: 'transcript.exportVtt' }
]

export function TranscriptPanel({ entry }: { entry: Entry }): React.JSX.Element {
  const { t } = useTranslation()
  const { notify, notifyError } = useApp()
  const [query, setQuery] = useState('')
  const menuRef = useRef<HTMLDetailsElement>(null)
  const segments = entry.transcript?.segments
  const q = query.trim().toLowerCase()

  const visible = useMemo(
    () => (q ? (segments ?? []).filter((s) => s.text.toLowerCase().includes(q)) : (segments ?? [])),
    [segments, q]
  )

  async function exportAs(format: ExportFormat): Promise<void> {
    menuRef.current?.removeAttribute('open')
    try {
      const path = await api.exportEntry(entry.meta.id, 'transcript', format)
      if (path) notify('info', t('export.saved', { path }))
    } catch (err) {
      notifyError(err)
    }
  }

  async function copy(): Promise<void> {
    await navigator.clipboard.writeText(entry.transcript?.text ?? '')
    notify('info', t('summary.copied'))
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <SearchIcon
            className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-zinc-400"
            size={14}
          />
          <input
            className="input pl-8"
            placeholder={t('transcript.search')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <span className="text-xs whitespace-nowrap text-zinc-500">
          {t('transcript.segments', { count: visible.length })}
        </span>
        <button className="btn-secondary" onClick={() => void copy()}>
          <CopyIcon size={14} />
          {t('transcript.copy')}
        </button>
        <details ref={menuRef} className="relative">
          <summary className="btn-secondary cursor-pointer list-none">
            <DownloadIcon size={14} />
            {t('transcript.export')}
          </summary>
          <div className="absolute right-0 z-10 mt-1 w-56 rounded-lg border border-zinc-200 bg-white p-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
            {EXPORTS.map(({ format, key }) => (
              <button
                key={format}
                className="w-full rounded-md px-3 py-1.5 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
                onClick={() => void exportAs(format)}
              >
                {t(key)}
              </button>
            ))}
          </div>
        </details>
      </div>

      <div className="card selectable divide-y divide-zinc-100 dark:divide-zinc-800">
        {visible.length === 0 && (
          <p className="p-6 text-center text-sm text-zinc-500">{t('transcript.noMatches')}</p>
        )}
        {visible.map((seg, i) => (
          <div key={`${seg.start}-${i}`} className="flex gap-4 px-4 py-2.5 text-sm leading-relaxed">
            <span className="w-14 shrink-0 pt-px font-mono text-xs text-zinc-400 tabular-nums">
              {formatClock(seg.start)}
            </span>
            <p className="min-w-0 flex-1">{highlight(seg.text, q)}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

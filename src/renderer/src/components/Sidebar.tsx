import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { formatDuration } from '../lib/format'
import { useApp } from '../lib/context'
import { MicIcon, PlusIcon, SearchIcon, SettingsIcon } from './icons'
import { StatusBadge } from './StatusBadge'

export function Sidebar(): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const { entries, selectedId, select, openSettings, jobs } = useApp()
  const [query, setQuery] = useState('')
  const isMac = window.api.platform === 'darwin'

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? entries.filter((e) => e.title.toLowerCase().includes(q)) : entries
  }, [entries, query])

  const percentByEntry = useMemo(() => {
    const map: Record<string, number | null> = {}
    for (const job of Object.values(jobs)) map[job.entryId] = job.percent
    return map
  }, [jobs])

  return (
    <aside className="flex w-72 shrink-0 flex-col border-r border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/60">
      <div className={`drag flex h-11 shrink-0 items-center ${isMac ? 'pl-20' : 'pl-4'} pr-2`}>
        <span className="text-sm font-semibold tracking-tight">NoteTaker</span>
        <button
          className="no-drag btn-ghost ml-auto px-2"
          onClick={() => select(null)}
          title={t('sidebar.new')}
        >
          <PlusIcon />
          {t('sidebar.new')}
        </button>
      </div>

      <div className="px-3 pb-2">
        <div className="relative">
          <SearchIcon
            className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-zinc-400"
            size={14}
          />
          <input
            className="input pl-8"
            placeholder={t('sidebar.search')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {filtered.length === 0 && (
          <p className="px-2 py-6 text-center text-sm text-zinc-500">
            {entries.length === 0 ? t('sidebar.empty') : t('sidebar.noResults')}
          </p>
        )}
        <ul className="space-y-0.5">
          {filtered.map((entry) => {
            const active = entry.id === selectedId
            const pct = percentByEntry[entry.id]
            return (
              <li key={entry.id}>
                <button
                  onClick={() => select(entry.id)}
                  className={`w-full rounded-lg px-2.5 py-2 text-left transition-colors ${
                    active
                      ? 'bg-white shadow-sm ring-1 ring-zinc-200 dark:bg-zinc-800 dark:ring-zinc-700'
                      : 'hover:bg-zinc-100 dark:hover:bg-zinc-800/60'
                  }`}
                >
                  <div className="flex items-center gap-1.5">
                    {entry.isRecording && <MicIcon size={12} className="shrink-0 text-zinc-400" />}
                    <span className="truncate text-sm font-medium">
                      {entry.title || t('common.untitled')}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-xs text-zinc-500">
                    <StatusBadge status={entry.status} />
                    <span className="truncate">
                      {new Date(entry.createdAt).toLocaleDateString(
                        i18n.language === 'es' ? 'es-ES' : 'en-US',
                        { day: 'numeric', month: 'short' }
                      )}
                      {entry.durationSec !== null && ` · ${formatDuration(entry.durationSec)}`}
                    </span>
                    {pct !== undefined && pct !== null && (
                      <span className="ml-auto tabular-nums">{pct}%</span>
                    )}
                  </div>
                </button>
              </li>
            )
          })}
        </ul>
      </nav>

      <div className="border-t border-zinc-200 p-2 dark:border-zinc-800">
        <button className="btn-ghost w-full justify-start" onClick={() => openSettings()}>
          <SettingsIcon />
          {t('sidebar.settings')}
        </button>
      </div>
    </aside>
  )
}

import { useTranslation } from 'react-i18next'
import type { EntryStatus } from '@shared/types'

const STYLES: Record<EntryStatus, string> = {
  queued: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300',
  processing: 'bg-accent-100 text-accent-700 dark:bg-accent-600/20 dark:text-accent-100',
  transcribed: 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300',
  summarized: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  error: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300',
  cancelled: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300'
}

export function StatusBadge({ status }: { status: EntryStatus }): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${STYLES[status]}`}
    >
      {t(`status.${status}`)}
    </span>
  )
}

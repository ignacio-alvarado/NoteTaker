import { useTranslation } from 'react-i18next'
import type { JobProgress as Job } from '@shared/types'
import { useApp } from '../lib/context'

export function JobProgress({ job }: { job: Job }): React.JSX.Element {
  const { t } = useTranslation()
  const { cancelJob } = useApp()
  const determinate = job.percent !== null

  return (
    <div className="card flex items-center gap-4 p-4">
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium">{t(`stages.${job.stage}`)}…</span>
          {determinate && <span className="tabular-nums text-zinc-500">{job.percent}%</span>}
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
          {determinate ? (
            <div
              className="h-full rounded-full bg-accent-500 transition-[width] duration-300"
              style={{ width: `${job.percent}%` }}
            />
          ) : (
            <div className="h-full w-1/3 animate-[indeterminate_1.2s_ease-in-out_infinite] rounded-full bg-accent-500" />
          )}
        </div>
      </div>
      <button className="btn-secondary" onClick={() => void cancelJob(job.jobId)}>
        {t('entry.cancel')}
      </button>
    </div>
  )
}

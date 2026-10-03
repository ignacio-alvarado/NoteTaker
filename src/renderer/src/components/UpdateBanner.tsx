import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useApp } from '../lib/context'
import { CloseIcon, DownloadIcon, RefreshIcon } from './icons'

/** Aviso de versión nueva en la barra lateral. */
export function UpdateBanner(): React.JSX.Element | null {
  const { t } = useTranslation()
  const { update, installUpdate, openUpdateDownload } = useApp()
  // «Más tarde» oculta el aviso hasta que aparezca una versión distinta.
  const [dismissed, setDismissed] = useState<string | null>(null)

  if (!update?.version) return null
  if (!['available', 'downloading', 'downloaded'].includes(update.status)) return null
  if (dismissed === update.version && update.status !== 'downloaded') return null
  // Si la descarga automática falló, se ofrece la descarga manual del instalador.
  const manual = update.status === 'available' && (!update.canInstall || Boolean(update.error))

  return (
    <div className="mx-2 mb-2 rounded-lg border border-accent-100 bg-accent-50 p-3 text-sm dark:border-accent-600/30 dark:bg-accent-600/10">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="font-medium">{t('update.available', { version: update.version })}</p>
          <p className="mt-0.5 text-xs text-zinc-600 dark:text-zinc-400">
            {update.status === 'downloading'
              ? t('update.downloading', { percent: update.percent ?? 0 })
              : update.status === 'downloaded'
                ? t('update.readyToInstall')
                : manual
                  ? t('update.manualHint')
                  : t('update.preparing')}
          </p>
        </div>
        {update.status !== 'downloaded' && (
          <button
            className="shrink-0 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
            title={t('update.later')}
            onClick={() => setDismissed(update.version!)}
          >
            <CloseIcon size={14} />
          </button>
        )}
      </div>

      {update.status === 'downloading' && (
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-accent-100 dark:bg-zinc-800">
          <div
            className="h-full bg-accent-500 transition-[width]"
            style={{ width: `${update.percent ?? 0}%` }}
          />
        </div>
      )}

      {update.status === 'downloaded' && (
        <button className="btn-primary mt-2 w-full" onClick={() => void installUpdate()}>
          <RefreshIcon size={14} />
          {t('update.restart')}
        </button>
      )}

      {manual && (
        <button className="btn-primary mt-2 w-full" onClick={() => void openUpdateDownload()}>
          <DownloadIcon size={14} />
          {t('update.download')}
        </button>
      )}
    </div>
  )
}

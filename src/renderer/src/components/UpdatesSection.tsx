import { useTranslation } from 'react-i18next'
import { translateError, useApp } from '../lib/context'
import { DownloadIcon, RefreshIcon } from './icons'
import { Markdown } from './Markdown'

/** Ajustes → General: versión actual, estado y búsqueda de actualizaciones. */
export function UpdatesSection(): React.JSX.Element | null {
  const { t } = useTranslation()
  const { settings, update, updateSettings, checkForUpdates, installUpdate, openUpdateDownload } =
    useApp()
  if (!settings || !update) return null

  const disabled = update.status === 'disabled'
  const busy = update.status === 'checking' || update.status === 'downloading'
  const manual = update.status === 'available' && (!update.canInstall || Boolean(update.error))

  let status: string | null = null
  switch (update.status) {
    case 'disabled':
      status = t('update.notConfigured')
      break
    case 'checking':
      status = t('update.checking')
      break
    case 'up-to-date':
      status = t('update.upToDate')
      break
    case 'available':
      status = t('update.available', { version: update.version })
      break
    case 'downloading':
      status = t('update.downloading', { percent: update.percent ?? 0 })
      break
    case 'downloaded':
      status = t('update.readyToInstall')
      break
    case 'error':
      status = update.error ? translateError(update.error) : null
      break
  }

  return (
    <section className="flex flex-col gap-3">
      <div>
        <span className="label">{t('update.title')}</span>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {t('update.currentVersion', { version: update.currentVersion })}
        </p>
        {status && (
          <p
            className={`mt-1 text-sm ${update.status === 'error' ? 'text-red-600 dark:text-red-400' : 'text-zinc-600 dark:text-zinc-400'}`}
          >
            {status}
          </p>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          className="btn-secondary"
          disabled={disabled || busy}
          onClick={() => void checkForUpdates()}
        >
          <RefreshIcon size={14} className={update.status === 'checking' ? 'animate-spin' : ''} />
          {t('update.check')}
        </button>
        {manual && (
          <button className="btn-primary" onClick={() => void openUpdateDownload()}>
            <DownloadIcon size={14} />
            {t('update.download')}
          </button>
        )}
        {update.status === 'downloaded' && (
          <button className="btn-primary" onClick={() => void installUpdate()}>
            <RefreshIcon size={14} />
            {t('update.restart')}
          </button>
        )}
      </div>

      <label className={`flex items-center gap-2 text-sm ${disabled ? 'opacity-50' : ''}`}>
        <input
          type="checkbox"
          disabled={disabled}
          checked={settings.autoCheckUpdates}
          onChange={(e) => void updateSettings({ autoCheckUpdates: e.target.checked })}
        />
        {t('update.autoCheck')}
      </label>

      {update.version && update.releaseNotes && (
        <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
          <p className="mb-2 text-sm font-medium">
            {t('update.releaseNotes', { version: update.version })}
          </p>
          <Markdown>{update.releaseNotes}</Markdown>
        </div>
      )}
    </section>
  )
}

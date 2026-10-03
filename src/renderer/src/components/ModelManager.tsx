import { useTranslation } from 'react-i18next'
import { api } from '../lib/api'
import { formatBytes } from '../lib/format'
import { useApp } from '../lib/context'
import { CheckIcon, DownloadIcon, TrashIcon } from './icons'

/**
 * Lista de modelos con descarga, selección y borrado. El estado (instalados y descargas
 * en curso) vive en el contexto global, para que el inicio también se entere al instante.
 */
export function ModelManager(): React.JSX.Element {
  const { t } = useTranslation()
  const {
    settings,
    updateSettings,
    notifyError,
    whisperModels: models,
    modelDownloads: progress,
    refreshWhisperModels
  } = useApp()
  const active = settings!.transcription.localModel

  async function run(action: () => Promise<unknown>): Promise<void> {
    try {
      await action()
    } catch (err) {
      notifyError(err)
    }
  }

  return (
    <div className="divide-y divide-zinc-100 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
      {models.map((m) => {
        const dl = progress[m.id]
        const pct = dl?.total ? Math.round((dl.received / dl.total) * 100) : null
        return (
          <div key={m.id} className="flex items-center gap-3 px-3 py-2.5">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-sm font-medium">
                {m.label}
                {m.recommended && (
                  <span className="rounded bg-accent-100 px-1.5 py-0.5 text-[10px] font-semibold text-accent-700 uppercase dark:bg-accent-600/20 dark:text-accent-100">
                    {t('settings.transcription.recommended')}
                  </span>
                )}
                {m.installed && m.id === active && (
                  <span className="flex items-center gap-1 text-xs font-normal text-emerald-600 dark:text-emerald-400">
                    <CheckIcon size={12} />
                    {t('settings.transcription.active')}
                  </span>
                )}
              </div>
              <div className="text-xs text-zinc-500">
                {dl
                  ? `${formatBytes(dl.received)}${dl.total ? ` / ${formatBytes(dl.total)}` : ''}`
                  : `${m.sizeMB} MB`}
              </div>
              {dl && (
                <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
                  <div
                    className="h-full bg-accent-500 transition-[width]"
                    style={{ width: `${pct ?? 0}%` }}
                  />
                </div>
              )}
            </div>
            {dl ? (
              <button
                className="btn-secondary py-1"
                onClick={() => void run(() => api.cancelWhisperModelDownload(m.id))}
              >
                {t('common.cancel')}
              </button>
            ) : m.installed ? (
              <>
                {m.id !== active && (
                  <button
                    className="btn-secondary py-1"
                    onClick={() => void updateSettings({ transcription: { localModel: m.id } })}
                  >
                    {t('settings.transcription.use')}
                  </button>
                )}
                <button
                  className="btn-danger px-2 py-1"
                  title={t('settings.transcription.delete')}
                  onClick={() =>
                    void run(async () => {
                      await api.deleteWhisperModel(m.id)
                      await refreshWhisperModels()
                    })
                  }
                >
                  <TrashIcon size={14} />
                </button>
              </>
            ) : (
              <button
                className="btn-secondary py-1"
                // Al terminar, el main pasa a usarlo si el modelo activo no está instalado.
                onClick={() => void run(() => api.downloadWhisperModel(m.id))}
              >
                <DownloadIcon size={14} />
                {t('settings.transcription.download')}
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}

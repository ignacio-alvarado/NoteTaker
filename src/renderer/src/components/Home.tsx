import { useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { api } from '../lib/api'
import { useApp } from '../lib/context'
import { AlertIcon, UploadIcon } from './icons'
import { Recorder } from './Recorder'

function Warning({
  children,
  onFix
}: {
  children: React.ReactNode
  onFix: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <div className="flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
      <AlertIcon className="shrink-0" />
      <span className="flex-1">{children}</span>
      <button className="btn-secondary py-1" onClick={onFix}>
        {t('home.fix')}
      </button>
    </div>
  )
}

export function Home(): React.JSX.Element {
  const { t } = useTranslation()
  const { settings, startFiles, openSettings, notifyError, whisperModels } = useApp()
  const [dragging, setDragging] = useState(false)

  const engine = settings!.transcription.engine
  const localModel = settings!.transcription.localModel
  const provider = settings!.summary.provider

  // Mientras la lista no ha cargado (vacía) no se avisa, para no parpadear al arrancar.
  const missingLocalModel =
    engine === 'local' &&
    whisperModels.length > 0 &&
    !whisperModels.some((m) => m.id === localModel && m.installed)
  const { summaryReady } = settings!
  const hasAnyKey = summaryReady.anthropic || summaryReady.openai
  const providerHasKey = summaryReady[provider]

  async function chooseFiles(): Promise<void> {
    try {
      const paths = await api.pickMediaFiles()
      if (paths.length) await startFiles(paths)
    } catch (err) {
      notifyError(err)
    }
  }

  function onDrop(e: React.DragEvent): void {
    e.preventDefault()
    setDragging(false)
    const paths = Array.from(e.dataTransfer.files)
      .map((file) => api.getPathForFile(file))
      .filter(Boolean)
    if (paths.length) void startFiles(paths)
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 px-8 pt-4 pb-12">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{t('home.title')}</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{t('home.subtitle')}</p>
        <p className="mt-2 text-xs text-zinc-500">
          <Trans
            i18nKey="home.pipeline"
            values={{ engine: t(`engine.${engine}`), provider: t(`provider.${provider}`) }}
            components={{
              1: <strong className="font-medium text-zinc-700 dark:text-zinc-300" />,
              3: <strong className="font-medium text-zinc-700 dark:text-zinc-300" />
            }}
          />
        </p>
      </header>

      <div className="flex flex-col gap-2">
        {missingLocalModel && (
          <Warning onFix={() => openSettings('transcription')}>{t('home.warnNoModel')}</Warning>
        )}
        {engine === 'openai' && !settings!.hasOpenAIKey && (
          <Warning onFix={() => openSettings('keys')}>
            {t('home.warnNoOpenAIKeyTranscription')}
          </Warning>
        )}
        {!hasAnyKey ? (
          <Warning onFix={() => openSettings('keys')}>{t('home.warnNoSummaryKey')}</Warning>
        ) : (
          !providerHasKey && (
            <Warning onFix={() => openSettings('summary')}>{t('home.warnProviderKey')}</Warning>
          )
        )}
      </div>

      <div
        onDragEnter={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragOver={(e) => e.preventDefault()}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false)
        }}
        onDrop={onDrop}
        className={`flex flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-14 text-center transition-colors ${
          dragging
            ? 'border-accent-500 bg-accent-50 dark:bg-accent-600/10'
            : 'border-zinc-300 dark:border-zinc-700'
        }`}
      >
        <div className="mb-3 rounded-full bg-accent-100 p-3 text-accent-600 dark:bg-accent-600/20 dark:text-accent-100">
          <UploadIcon size={24} />
        </div>
        <p className="text-base font-medium">{dragging ? t('home.dropActive') : t('home.drop')}</p>
        <p className="my-2 text-sm text-zinc-500">{t('home.or')}</p>
        <button className="btn-primary" onClick={() => void chooseFiles()}>
          {t('home.choose')}
        </button>
        <p className="mt-3 text-xs text-zinc-500">{t('home.formats')}</p>
      </div>

      <Recorder />
    </div>
  )
}

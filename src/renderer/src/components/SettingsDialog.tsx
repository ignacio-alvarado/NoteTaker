import { useEffect, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Effort, SummaryProvider, SummaryTemplate } from '@shared/types'
import { api } from '../lib/api'
import { TRANSCRIPTION_LANGUAGES } from '../lib/format'
import { useApp } from '../lib/context'
import { CheckIcon, CloseIcon, RefreshIcon, TrashIcon } from './icons'
import { ModelManager } from './ModelManager'

const TABS = ['general', 'transcription', 'summary', 'keys', 'templates'] as const
const EFFORTS: Effort[] = ['low', 'medium', 'high', 'xhigh', 'max']
const OPENAI_TRANSCRIPTION_MODELS = [
  'whisper-1',
  'gpt-transcribe',
  'gpt-4o-transcribe',
  'gpt-4o-mini-transcribe'
]
const KEY_URLS: Record<SummaryProvider, string> = {
  anthropic: 'https://console.anthropic.com/settings/keys',
  openai: 'https://platform.openai.com/api-keys'
}

function Field({
  label,
  hint,
  children
}: {
  label: string
  hint?: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div>
      <span className="label">{label}</span>
      {children}
      {hint && <p className="hint">{hint}</p>}
    </div>
  )
}

function RadioCard({
  checked,
  onSelect,
  title,
  description
}: {
  checked: boolean
  onSelect: () => void
  title: string
  description?: string
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex-1 rounded-lg border p-3 text-left transition-colors ${
        checked
          ? 'border-accent-500 bg-accent-50 ring-1 ring-accent-500 dark:bg-accent-600/10'
          : 'border-zinc-200 hover:border-zinc-300 dark:border-zinc-700 dark:hover:border-zinc-600'
      }`}
    >
      <div className="text-sm font-medium">{title}</div>
      {description && (
        <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{description}</div>
      )}
    </button>
  )
}

/** Campo de texto libre con sugerencias cargadas desde la API del proveedor. */
function ModelInput({
  value,
  onCommit,
  provider,
  purpose,
  defaults,
  canLoad
}: {
  value: string
  onCommit: (v: string) => void
  provider: SummaryProvider
  purpose: 'summary' | 'transcription'
  defaults: string[]
  canLoad: boolean
}): React.JSX.Element {
  const { t } = useTranslation()
  const { notifyError } = useApp()
  const listId = useId()
  // null = sin editar: se muestra el valor guardado.
  const [draft, setDraft] = useState<string | null>(null)
  const [options, setOptions] = useState<string[]>(defaults)
  const [loading, setLoading] = useState(false)

  async function load(): Promise<void> {
    setLoading(true)
    try {
      const ids = await api.listProviderModels(provider, purpose)
      setOptions([...new Set([...defaults, ...ids])])
    } catch (err) {
      notifyError(err)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex gap-2">
      <input
        className="input font-mono"
        list={listId}
        value={draft ?? value}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft?.trim() && draft.trim() !== value) onCommit(draft.trim())
          setDraft(null)
        }}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
      <datalist id={listId}>
        {options.map((o) => (
          <option key={o} value={o} />
        ))}
      </datalist>
      <button
        className="btn-secondary shrink-0"
        disabled={!canLoad || loading}
        title={t('settings.transcription.refresh')}
        onClick={() => void load()}
      >
        <RefreshIcon size={14} className={loading ? 'animate-spin' : ''} />
      </button>
    </div>
  )
}

function ApiKeyField({ provider }: { provider: SummaryProvider }): React.JSX.Element {
  const { t } = useTranslation()
  const { settings, setApiKey, notifyError } = useApp()
  const [value, setValue] = useState('')
  const has = provider === 'anthropic' ? settings!.hasAnthropicKey : settings!.hasOpenAIKey

  async function save(key: string | null): Promise<void> {
    try {
      await setApiKey(provider, key)
      setValue('')
    } catch (err) {
      notifyError(err)
    }
  }

  return (
    <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-sm font-medium">{t(`settings.keys.${provider}`)}</span>
        {has ? (
          <span className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
            <CheckIcon size={12} />
            {t('settings.keys.saved')}
          </span>
        ) : (
          <span className="text-xs text-zinc-500">{t('settings.keys.notSet')}</span>
        )}
        <button
          className="ml-auto text-xs text-accent-600 hover:underline"
          onClick={() => void api.openExternal(KEY_URLS[provider])}
        >
          {t('settings.keys.getKey')} ↗
        </button>
      </div>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (value.trim()) void save(value)
        }}
      >
        <input
          className="input font-mono"
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder={has ? '••••••••••••••••' : t('settings.keys.placeholder')}
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <button
          className="btn-primary"
          type="submit"
          disabled={!value.trim() || !settings!.encryptionAvailable}
        >
          {t('settings.keys.save')}
        </button>
        {has && (
          <button className="btn-secondary" type="button" onClick={() => void save(null)}>
            {t('settings.keys.remove')}
          </button>
        )}
      </form>
    </div>
  )
}

function TemplatesTab(): React.JSX.Element {
  const { t } = useTranslation()
  const { settings, updateSettings } = useApp()
  const [editing, setEditing] = useState<SummaryTemplate | null>(null)
  const [viewing, setViewing] = useState<string | null>(null)
  const builtins = settings!.templates.filter((tpl) => tpl.builtin)
  const custom = settings!.customTemplates

  async function save(tpl: SummaryTemplate): Promise<void> {
    const exists = custom.some((c) => c.id === tpl.id)
    const next = exists ? custom.map((c) => (c.id === tpl.id ? tpl : c)) : [...custom, tpl]
    await updateSettings({ customTemplates: next })
    setEditing(null)
  }

  async function remove(tpl: SummaryTemplate): Promise<void> {
    if (!window.confirm(t('settings.templates.deleteConfirm', { name: tpl.name }))) return
    const patch: Parameters<typeof updateSettings>[0] = {
      customTemplates: custom.filter((c) => c.id !== tpl.id)
    }
    if (settings!.summary.defaultTemplateId === tpl.id)
      patch.summary = { defaultTemplateId: 'executive' }
    await updateSettings(patch)
  }

  if (editing) {
    return (
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          if (editing.name.trim() && editing.prompt.trim()) void save(editing)
        }}
      >
        <Field label={t('settings.templates.name')}>
          <input
            autoFocus
            className="input"
            value={editing.name}
            onChange={(e) => setEditing({ ...editing, name: e.target.value })}
          />
        </Field>
        <Field label={t('settings.templates.prompt')} hint={t('settings.templates.promptHint')}>
          <textarea
            className="input min-h-56 font-mono text-xs leading-relaxed"
            value={editing.prompt}
            onChange={(e) => setEditing({ ...editing, prompt: e.target.value })}
          />
        </Field>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={() => setEditing(null)}>
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            className="btn-primary"
            disabled={!editing.name.trim() || !editing.prompt.trim()}
          >
            {t('common.save')}
          </button>
        </div>
      </form>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <section>
        <h3 className="label">{t('settings.templates.builtin')}</h3>
        <div className="divide-y divide-zinc-100 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          {builtins.map((tpl) => (
            <div key={tpl.id} className="px-3 py-2.5">
              <button
                className="w-full text-left text-sm font-medium"
                onClick={() => setViewing(viewing === tpl.id ? null : tpl.id)}
              >
                {tpl.name}
              </button>
              {viewing === tpl.id && (
                <pre className="selectable mt-2 font-mono text-xs whitespace-pre-wrap text-zinc-600 dark:text-zinc-400">
                  {tpl.prompt}
                </pre>
              )}
            </div>
          ))}
        </div>
      </section>
      <section>
        <div className="mb-1 flex items-center">
          <h3 className="label mb-0">{t('settings.templates.custom')}</h3>
          <button
            className="btn-secondary ml-auto py-1"
            onClick={() =>
              setEditing({ id: crypto.randomUUID(), name: '', prompt: '', builtin: false })
            }
          >
            {t('settings.templates.new')}
          </button>
        </div>
        {custom.length === 0 ? (
          <p className="py-4 text-sm text-zinc-500">{t('settings.templates.emptyCustom')}</p>
        ) : (
          <div className="mt-2 divide-y divide-zinc-100 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
            {custom.map((tpl) => (
              <div key={tpl.id} className="flex items-center gap-2 px-3 py-2.5">
                <span className="flex-1 truncate text-sm font-medium">{tpl.name}</span>
                <button className="btn-ghost py-1" onClick={() => setEditing(tpl)}>
                  {t('common.edit')}
                </button>
                <button className="btn-danger px-2 py-1" onClick={() => void remove(tpl)}>
                  <TrashIcon size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

export function SettingsDialog(): React.JSX.Element | null {
  const { t } = useTranslation()
  const { settings, settingsOpen, closeSettings, openSettings, updateSettings } = useApp()

  useEffect(() => {
    if (!settingsOpen) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') closeSettings()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [settingsOpen, closeSettings])

  if (!settingsOpen || !settings) return null
  const tab = (TABS as readonly string[]).includes(settingsOpen) ? settingsOpen : 'general'
  const tr = settings.transcription
  const sm = settings.summary

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-6 backdrop-blur-[2px]"
      onMouseDown={closeSettings}
    >
      <div
        className="flex h-[min(680px,90vh)] w-[min(860px,95vw)] overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-zinc-900 dark:ring-1 dark:ring-zinc-800"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <nav className="w-48 shrink-0 border-r border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-950/40">
          <h2 className="px-2 pt-1 pb-3 text-sm font-semibold">{t('settings.title')}</h2>
          {TABS.map((key) => (
            <button
              key={key}
              onClick={() => openSettings(key)}
              className={`mb-0.5 w-full rounded-md px-2 py-1.5 text-left text-sm ${
                tab === key
                  ? 'bg-white font-medium shadow-sm dark:bg-zinc-800'
                  : 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800/60'
              }`}
            >
              {t(`settings.tabs.${key}`)}
            </button>
          ))}
        </nav>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-12 shrink-0 items-center border-b border-zinc-200 px-5 dark:border-zinc-800">
            <h3 className="text-sm font-semibold">{t(`settings.tabs.${tab}`)}</h3>
            <button
              className="btn-ghost ml-auto px-2"
              onClick={closeSettings}
              title={t('common.close')}
            >
              <CloseIcon />
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-5">
            {tab === 'general' && (
              <div className="flex max-w-md flex-col gap-5">
                <Field label={t('settings.general.language')}>
                  <select
                    className="input"
                    value={settings.uiLanguage}
                    onChange={(e) =>
                      void updateSettings({ uiLanguage: e.target.value as 'es' | 'en' })
                    }
                  >
                    <option value="es">Español</option>
                    <option value="en">English</option>
                  </select>
                </Field>
                <Field label={t('settings.general.theme')}>
                  <div className="flex gap-2">
                    {(['system', 'light', 'dark'] as const).map((theme) => (
                      <RadioCard
                        key={theme}
                        checked={settings.theme === theme}
                        onSelect={() => void updateSettings({ theme })}
                        title={t(
                          `settings.general.theme${theme[0].toUpperCase()}${theme.slice(1)}`
                        )}
                      />
                    ))}
                  </div>
                </Field>
              </div>
            )}

            {tab === 'transcription' && (
              <div className="flex flex-col gap-5">
                <Field label={t('settings.transcription.engine')}>
                  <div className="flex gap-2">
                    <RadioCard
                      checked={tr.engine === 'local'}
                      onSelect={() => void updateSettings({ transcription: { engine: 'local' } })}
                      title={t('engine.local')}
                      description={t('settings.transcription.engineLocalDesc')}
                    />
                    <RadioCard
                      checked={tr.engine === 'openai'}
                      onSelect={() => void updateSettings({ transcription: { engine: 'openai' } })}
                      title={t('engine.openai')}
                      description={t('settings.transcription.engineOpenAIDesc')}
                    />
                  </div>
                </Field>

                <Field label={t('settings.transcription.language')}>
                  <select
                    className="input max-w-xs"
                    value={tr.language}
                    onChange={(e) =>
                      void updateSettings({ transcription: { language: e.target.value } })
                    }
                  >
                    {TRANSCRIPTION_LANGUAGES.map((code) => (
                      <option key={code} value={code}>
                        {t(`languages.${code}`)}
                      </option>
                    ))}
                  </select>
                </Field>

                {tr.engine === 'local' ? (
                  <>
                    <Field
                      label={t('settings.transcription.models')}
                      hint={t('settings.transcription.modelsHint')}
                    >
                      <ModelManager />
                    </Field>
                    <div className="flex gap-6">
                      <Field
                        label={t('settings.transcription.threads')}
                        hint={t('settings.transcription.threadsHint')}
                      >
                        <input
                          type="number"
                          min={0}
                          max={64}
                          className="input w-24"
                          value={tr.threads}
                          onChange={(e) =>
                            void updateSettings({
                              transcription: { threads: Math.max(0, Number(e.target.value) || 0) }
                            })
                          }
                        />
                      </Field>
                      <label className="flex items-center gap-2 self-center pt-2 text-sm">
                        <input
                          type="checkbox"
                          checked={tr.useGpu}
                          onChange={(e) =>
                            void updateSettings({ transcription: { useGpu: e.target.checked } })
                          }
                        />
                        {t('settings.transcription.gpu')}
                      </label>
                    </div>
                  </>
                ) : (
                  <Field
                    label={t('settings.transcription.openaiModel')}
                    hint={t('settings.transcription.openaiModelHint')}
                  >
                    <ModelInput
                      value={tr.openaiModel}
                      onCommit={(v) => void updateSettings({ transcription: { openaiModel: v } })}
                      provider="openai"
                      purpose="transcription"
                      defaults={OPENAI_TRANSCRIPTION_MODELS}
                      canLoad={settings.hasOpenAIKey}
                    />
                  </Field>
                )}
              </div>
            )}

            {tab === 'summary' && (
              <div className="flex max-w-xl flex-col gap-5">
                <Field label={t('settings.summary.provider')}>
                  <div className="flex gap-2">
                    {(['anthropic', 'openai'] as const).map((p) => (
                      <RadioCard
                        key={p}
                        checked={sm.provider === p}
                        onSelect={() => void updateSettings({ summary: { provider: p } })}
                        title={t(`provider.${p}`)}
                        description={
                          (p === 'anthropic' ? settings.hasAnthropicKey : settings.hasOpenAIKey)
                            ? undefined
                            : t('settings.summary.noKey')
                        }
                      />
                    ))}
                  </div>
                </Field>
                <Field label={t('settings.summary.model')} hint={t('settings.summary.modelHint')}>
                  {sm.provider === 'anthropic' ? (
                    <ModelInput
                      key="anthropic"
                      value={sm.anthropicModel}
                      onCommit={(v) => void updateSettings({ summary: { anthropicModel: v } })}
                      provider="anthropic"
                      purpose="summary"
                      defaults={['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-4-5']}
                      canLoad={settings.hasAnthropicKey}
                    />
                  ) : (
                    <ModelInput
                      key="openai"
                      value={sm.openaiModel}
                      onCommit={(v) => void updateSettings({ summary: { openaiModel: v } })}
                      provider="openai"
                      purpose="summary"
                      defaults={['gpt-5.5']}
                      canLoad={settings.hasOpenAIKey}
                    />
                  )}
                </Field>
                {sm.provider === 'anthropic' && (
                  <Field
                    label={t('settings.summary.effort')}
                    hint={t('settings.summary.effortHint')}
                  >
                    <select
                      className="input max-w-xs"
                      value={sm.effort}
                      onChange={(e) =>
                        void updateSettings({ summary: { effort: e.target.value as Effort } })
                      }
                    >
                      {EFFORTS.map((level) => (
                        <option key={level} value={level}>
                          {t(`settings.summary.effortLevels.${level}`)}
                        </option>
                      ))}
                    </select>
                  </Field>
                )}
                <Field label={t('settings.summary.outputLanguage')}>
                  <select
                    className="input max-w-xs"
                    value={sm.outputLanguage}
                    onChange={(e) =>
                      void updateSettings({
                        summary: { outputLanguage: e.target.value as 'auto' | 'es' | 'en' }
                      })
                    }
                  >
                    <option value="auto">{t('settings.summary.outputAuto')}</option>
                    <option value="es">{t('languages.es')}</option>
                    <option value="en">{t('languages.en')}</option>
                  </select>
                </Field>
                <Field label={t('settings.summary.defaultTemplate')}>
                  <select
                    className="input max-w-xs"
                    value={sm.defaultTemplateId}
                    onChange={(e) =>
                      void updateSettings({ summary: { defaultTemplateId: e.target.value } })
                    }
                  >
                    {settings.templates.map((tpl) => (
                      <option key={tpl.id} value={tpl.id}>
                        {tpl.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={sm.autoSummarize}
                    onChange={(e) =>
                      void updateSettings({ summary: { autoSummarize: e.target.checked } })
                    }
                  />
                  {t('settings.summary.autoSummarize')}
                </label>
              </div>
            )}

            {tab === 'keys' && (
              <div className="flex max-w-xl flex-col gap-4">
                {!settings.encryptionAvailable && (
                  <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
                    {t('settings.keys.encryptionUnavailable')}
                  </p>
                )}
                <ApiKeyField provider="anthropic" />
                <ApiKeyField provider="openai" />
                <p className="hint">{t('settings.keys.hint')}</p>
              </div>
            )}

            {tab === 'templates' && <TemplatesTab />}
          </div>
        </div>
      </div>
    </div>
  )
}

import { app, safeStorage } from 'electron'
import { readFileSync } from 'fs'
import { rename, writeFile } from 'fs/promises'
import { join } from 'path'
import { AppErrorException } from '@shared/errors'
import type {
  Settings,
  SettingsPatch,
  SettingsView,
  SummaryProvider,
  UiLanguage
} from '@shared/types'
import { DEFAULT_ANTHROPIC_MODEL } from './summary/anthropic'
import { DEFAULT_OPENAI_SUMMARY_MODEL, DEFAULT_OPENAI_TRANSCRIPTION_MODEL } from './summary/openai'
import { allTemplates, DEFAULT_TEMPLATE_ID } from './summary/templates'
import { DEFAULT_LOCAL_MODEL } from './transcription/models'

type EncryptedKeys = Partial<Record<SummaryProvider, string>>

function defaultSettings(): Settings {
  const uiLanguage: UiLanguage = app.getLocale().toLowerCase().startsWith('es') ? 'es' : 'en'
  return {
    uiLanguage,
    theme: 'system',
    transcription: {
      engine: 'local',
      localModel: DEFAULT_LOCAL_MODEL,
      language: 'auto',
      threads: 0,
      useGpu: true,
      openaiModel: DEFAULT_OPENAI_TRANSCRIPTION_MODEL
    },
    summary: {
      provider: 'anthropic',
      anthropicModel: DEFAULT_ANTHROPIC_MODEL,
      openaiModel: DEFAULT_OPENAI_SUMMARY_MODEL,
      effort: 'medium',
      outputLanguage: 'auto',
      defaultTemplateId: DEFAULT_TEMPLATE_ID,
      autoSummarize: true
    },
    customTemplates: [],
    autoCheckUpdates: true
  }
}

function readJsonSync<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T
  } catch {
    return null
  }
}

async function writeJson(path: string, data: unknown): Promise<void> {
  const tmp = `${path}.tmp`
  await writeFile(tmp, JSON.stringify(data, null, 2), 'utf8')
  await rename(tmp, path)
}

/**
 * Ajustes en `settings.json` y API keys cifradas con safeStorage
 * (Keychain en macOS, DPAPI en Windows) en `keys.json`.
 */
export class SettingsStore {
  private settings: Settings
  private keys: EncryptedKeys
  private readonly settingsPath: string
  private readonly keysPath: string

  constructor(
    dir: string,
    private readonly onChange?: (view: SettingsView) => void
  ) {
    this.settingsPath = join(dir, 'settings.json')
    this.keysPath = join(dir, 'keys.json')
    const defaults = defaultSettings()
    const saved = readJsonSync<Partial<Settings>>(this.settingsPath) ?? {}
    this.settings = {
      ...defaults,
      ...saved,
      transcription: { ...defaults.transcription, ...saved.transcription },
      summary: { ...defaults.summary, ...saved.summary },
      customTemplates: saved.customTemplates ?? []
    }
    this.keys = readJsonSync<EncryptedKeys>(this.keysPath) ?? {}
  }

  get(): Settings {
    return structuredClone(this.settings)
  }

  view(): SettingsView {
    const settings = this.get()
    return {
      ...settings,
      templates: allTemplates(settings.uiLanguage, settings.customTemplates),
      hasAnthropicKey: Boolean(this.keys.anthropic),
      hasOpenAIKey: Boolean(this.keys.openai),
      encryptionAvailable: safeStorage.isEncryptionAvailable()
    }
  }

  async update(patch: SettingsPatch): Promise<SettingsView> {
    this.settings = {
      ...this.settings,
      ...patch,
      transcription: { ...this.settings.transcription, ...patch.transcription },
      summary: { ...this.settings.summary, ...patch.summary }
    }
    await writeJson(this.settingsPath, this.settings)
    return this.changed()
  }

  /** Notifica el cambio (tema nativo, aviso al renderer) y devuelve la vista nueva. */
  private changed(): SettingsView {
    const view = this.view()
    this.onChange?.(view)
    return view
  }

  async setApiKey(provider: SummaryProvider, key: string | null): Promise<SettingsView> {
    const trimmed = key?.trim()
    if (trimmed) {
      if (!safeStorage.isEncryptionAvailable())
        throw new AppErrorException('ENCRYPTION_UNAVAILABLE')
      this.keys[provider] = safeStorage.encryptString(trimmed).toString('base64')
    } else {
      delete this.keys[provider]
    }
    await writeJson(this.keysPath, this.keys)

    // Si el proveedor de resumen elegido no tiene clave, pasar al que se acaba de configurar.
    if (trimmed && !this.keys[this.settings.summary.provider]) {
      this.settings = { ...this.settings, summary: { ...this.settings.summary, provider } }
      await writeJson(this.settingsPath, this.settings)
    }
    return this.changed()
  }

  /** La clave en claro; solo se usa en el proceso main, nunca se envía al renderer. */
  getApiKey(provider: SummaryProvider): string | null {
    const stored = this.keys[provider]
    if (!stored) return null
    try {
      return safeStorage.decryptString(Buffer.from(stored, 'base64'))
    } catch {
      return null
    }
  }

  requireApiKey(provider: SummaryProvider): string {
    const key = this.getApiKey(provider)
    if (!key)
      throw new AppErrorException(
        provider === 'anthropic' ? 'NO_API_KEY_ANTHROPIC' : 'NO_API_KEY_OPENAI'
      )
    return key
  }
}

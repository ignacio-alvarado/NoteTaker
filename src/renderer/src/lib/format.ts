import type { UiLanguage } from '@shared/types'

export function formatDate(iso: string, lang: UiLanguage): string {
  return new Date(iso).toLocaleString(lang === 'es' ? 'es-ES' : 'en-US', {
    dateStyle: 'medium',
    timeStyle: 'short'
  })
}

export function formatDuration(sec: number | null): string {
  if (sec === null) return '—'
  const s = Math.round(sec)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = s % 60
  if (h > 0) return `${h} h ${m} min`
  if (m > 0) return `${m} min ${r} s`
  return `${r} s`
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)} GB`
  return `${Math.round(bytes / 1e6)} MB`
}

/** Idiomas que ofrecemos para forzar la transcripción (el resto vía "auto"). */
export const TRANSCRIPTION_LANGUAGES = [
  'auto',
  'es',
  'en',
  'pt',
  'fr',
  'de',
  'it',
  'ca',
  'nl',
  'ja',
  'zh'
]

import { createReadStream } from 'fs'
import OpenAI from 'openai'
import { segmentsToText } from '@shared/format'
import type { Segment, Transcript } from '@shared/types'
import type { AudioChunk } from '../media/ffmpeg'
import { mapOpenAIError } from '../summary/errors'

export interface OpenAITranscribeOptions {
  apiKey: string
  model: string
  chunks: AudioChunk[]
  /** Duración total, para cerrar el último segmento cuando el modelo no da tiempos. */
  durationSec: number | null
  language: string
  signal?: AbortSignal
  onProgress?: (fraction: number) => void
}

export interface ChunkResult {
  offsetSec: number
  language: string | null
  segments: Segment[]
}

/** whisper-1 devuelve el idioma en inglés ("spanish"); lo pasamos a ISO-639-1. */
// prettier-ignore
const LANGUAGE_NAMES: Record<string, string> = {
  spanish: 'es', english: 'en', portuguese: 'pt', french: 'fr', german: 'de',
  italian: 'it', catalan: 'ca', dutch: 'nl', japanese: 'ja', chinese: 'zh',
  korean: 'ko', russian: 'ru', arabic: 'ar', hindi: 'hi', polish: 'pl',
  turkish: 'tr', swedish: 'sv', ukrainian: 'uk', galician: 'gl', basque: 'eu'
}

export function normalizeLanguage(lang: string | null | undefined): string | null {
  if (!lang) return null
  const lower = lang.trim().toLowerCase()
  if (/^[a-z]{2}$/.test(lower)) return lower
  return LANGUAGE_NAMES[lower] ?? lower
}

/** Une los resultados de cada trozo desplazando sus tiempos al audio original. */
export function mergeChunkResults(results: ChunkResult[]): Transcript {
  const segments: Segment[] = []
  for (const result of [...results].sort((a, b) => a.offsetSec - b.offsetSec)) {
    for (const seg of result.segments) {
      const text = seg.text.trim()
      if (!text) continue
      segments.push({ start: seg.start + result.offsetSec, end: seg.end + result.offsetSec, text })
    }
  }
  const language = results.find((r) => r.language)?.language ?? null
  return { language, segments, text: segmentsToText(segments) }
}

/** Solo whisper-1 admite `verbose_json` con segmentos; el resto devuelve texto plano. */
function supportsVerbose(model: string): boolean {
  return model.startsWith('whisper')
}

export async function transcribeOpenAI(opts: OpenAITranscribeOptions): Promise<Transcript> {
  const client = new OpenAI({ apiKey: opts.apiKey, maxRetries: 3 })
  const language = opts.language && opts.language !== 'auto' ? opts.language : undefined
  const results: ChunkResult[] = []

  for (const [i, chunk] of opts.chunks.entries()) {
    const nextOffset = opts.chunks[i + 1]?.offsetSec ?? opts.durationSec ?? chunk.offsetSec
    try {
      if (supportsVerbose(opts.model)) {
        const res = await client.audio.transcriptions.create(
          {
            file: createReadStream(chunk.file),
            model: opts.model,
            response_format: 'verbose_json',
            timestamp_granularities: ['segment'],
            language
          },
          { signal: opts.signal }
        )
        results.push({
          offsetSec: chunk.offsetSec,
          language: normalizeLanguage(res.language),
          segments: (res.segments ?? []).map((s) => ({ start: s.start, end: s.end, text: s.text }))
        })
      } else {
        const res = await client.audio.transcriptions.create(
          {
            file: createReadStream(chunk.file),
            model: opts.model,
            response_format: 'json',
            language
          },
          { signal: opts.signal }
        )
        results.push({
          offsetSec: chunk.offsetSec,
          language: language ?? null,
          segments: [{ start: 0, end: Math.max(0, nextOffset - chunk.offsetSec), text: res.text }]
        })
      }
    } catch (err) {
      throw mapOpenAIError(err)
    }
    opts.onProgress?.((i + 1) / opts.chunks.length)
  }

  return mergeChunkResults(results)
}

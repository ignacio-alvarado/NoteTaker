import { spawn } from 'child_process'
import { access, readFile } from 'fs/promises'
import { cpus } from 'os'
import { AppErrorException } from '@shared/errors'
import { segmentsToText } from '@shared/format'
import type { Segment, Transcript } from '@shared/types'

export interface LocalWhisperOptions {
  binary: string
  modelPath: string
  wavPath: string
  /** Ruta sin extensión; whisper-cli escribe `<outBase>.json`. */
  outBase: string
  /** "auto" o código ISO-639-1. */
  language: string
  /** 0 = automático. */
  threads: number
  useGpu: boolean
  signal?: AbortSignal
  onProgress?: (fraction: number) => void
}

interface WhisperCliJson {
  result?: { language?: string }
  transcription?: Array<{
    offsets?: { from: number; to: number }
    text?: string
  }>
}

const PROGRESS_RE = /progress\s*=\s*(\d+)%/g

export function parseWhisperProgress(text: string): number | null {
  let last: number | null = null
  for (const match of text.matchAll(PROGRESS_RE)) last = Number(match[1])
  return last
}

/** Convierte el JSON de `whisper-cli -oj` a nuestro formato. */
export function parseWhisperJson(raw: string): Transcript {
  const data = JSON.parse(raw) as WhisperCliJson
  const segments: Segment[] = (data.transcription ?? [])
    .map((item) => ({
      start: (item.offsets?.from ?? 0) / 1000,
      end: (item.offsets?.to ?? 0) / 1000,
      text: (item.text ?? '').trim()
    }))
    .filter((seg) => seg.text.length > 0)
  const language = data.result?.language ?? null
  return {
    language: language && language !== 'auto' ? language : null,
    segments,
    text: segmentsToText(segments)
  }
}

export function defaultThreads(): number {
  return Math.max(1, Math.min(8, cpus().length - 1))
}

export async function transcribeLocal(opts: LocalWhisperOptions): Promise<Transcript> {
  try {
    await access(opts.binary)
  } catch {
    throw new AppErrorException('WHISPER_BINARY_MISSING', opts.binary)
  }
  try {
    await access(opts.modelPath)
  } catch {
    throw new AppErrorException('NO_LOCAL_MODEL', opts.modelPath)
  }

  // prettier-ignore
  const args = [
    '-m', opts.modelPath,
    '-f', opts.wavPath,
    '-l', opts.language || 'auto',
    '-t', String(opts.threads > 0 ? opts.threads : defaultThreads()),
    '-oj',
    '-of', opts.outBase,
    '-pp'
  ]
  if (!opts.useGpu) args.push('-ng')

  await new Promise<void>((resolve, reject) => {
    const child = spawn(opts.binary, args, {
      // stdout lleva la transcripción en texto; la descartamos para no llenar el pipe.
      stdio: ['ignore', 'ignore', 'pipe'],
      windowsHide: true,
      signal: opts.signal
    })
    let tail = ''
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      tail = (tail + chunk).slice(-4000)
      const pct = parseWhisperProgress(chunk)
      if (pct !== null) opts.onProgress?.(pct / 100)
    })
    child.on('error', (err) => {
      if (opts.signal?.aborted) reject(new AppErrorException('CANCELLED'))
      else reject(new AppErrorException('WHISPER_FAILED', err.message))
    })
    child.on('close', (code) => {
      if (opts.signal?.aborted) return reject(new AppErrorException('CANCELLED'))
      if (code === 0) return resolve()
      const lastLines = tail.trim().split('\n').slice(-4).join('\n')
      reject(new AppErrorException('WHISPER_FAILED', lastLines || `exit code ${code}`))
    })
  })

  const raw = await readFile(`${opts.outBase}.json`, 'utf8')
  return parseWhisperJson(raw)
}

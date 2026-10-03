import { spawn } from 'child_process'
import { mkdir, readFile } from 'fs/promises'
import { join } from 'path'
import { AppErrorException } from '@shared/errors'

const DURATION_RE = /Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/
const TIME_RE = /time=\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/g

function hmsToSeconds(h: string, m: string, s: string): number {
  return Number(h) * 3600 + Number(m) * 60 + Number(s)
}

/** Lee la duración total que ffmpeg imprime al abrir la entrada. */
export function parseDuration(text: string): number | null {
  const match = DURATION_RE.exec(text)
  return match ? hmsToSeconds(match[1], match[2], match[3]) : null
}

/** Devuelve el último `time=` de un bloque de stderr (posición procesada). */
export function parseProgressTime(text: string): number | null {
  let last: number | null = null
  for (const match of text.matchAll(TIME_RE)) {
    last = hmsToSeconds(match[1], match[2], match[3])
  }
  return last
}

export interface FfmpegRunOptions {
  signal?: AbortSignal
  /** Fracción procesada, de 0 a 1, cuando se conoce la duración. */
  onProgress?: (fraction: number) => void
}

export interface FfmpegRunResult {
  durationSec: number | null
}

export function runFfmpeg(
  ffmpegPath: string,
  args: string[],
  opts: FfmpegRunOptions = {}
): Promise<FfmpegRunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, ['-hide_banner', '-nostdin', '-y', ...args], {
      stdio: ['ignore', 'ignore', 'pipe'],
      windowsHide: true,
      signal: opts.signal
    })

    let durationSec: number | null = null
    let tail = ''

    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      tail = (tail + chunk).slice(-4000)
      if (durationSec === null) durationSec = parseDuration(tail)
      const t = parseProgressTime(chunk)
      if (t !== null && durationSec) opts.onProgress?.(Math.min(1, t / durationSec))
    })

    child.on('error', (err) => {
      if (opts.signal?.aborted) reject(new AppErrorException('CANCELLED'))
      else reject(new AppErrorException('FFMPEG_FAILED', err.message))
    })
    child.on('close', (code) => {
      if (opts.signal?.aborted) return reject(new AppErrorException('CANCELLED'))
      if (code === 0) return resolve({ durationSec })
      const lastLines = tail.trim().split('\n').slice(-3).join('\n')
      reject(new AppErrorException('FFMPEG_FAILED', lastLines || `exit code ${code}`))
    })
  })
}

/** Audio mono 16 kHz PCM, el formato que espera whisper.cpp. */
export function convertToWav16k(
  ffmpegPath: string,
  input: string,
  output: string,
  opts?: FfmpegRunOptions
): Promise<FfmpegRunResult> {
  return runFfmpeg(
    ffmpegPath,
    ['-i', input, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', output],
    opts
  )
}

export interface AudioChunk {
  file: string
  /** Desplazamiento del trozo dentro del audio original, en segundos. */
  offsetSec: number
}

/**
 * MP3 mono de baja tasa partido en trozos, para no superar el límite de
 * 25 MB por petición de la API de OpenAI (32 kbps ≈ 2,4 MB cada 10 min).
 */
export async function convertToMp3Chunks(
  ffmpegPath: string,
  input: string,
  outDir: string,
  segmentSec: number,
  opts?: FfmpegRunOptions
): Promise<{ chunks: AudioChunk[]; durationSec: number | null }> {
  await mkdir(outDir, { recursive: true })
  const listFile = join(outDir, 'chunks.csv')
  const { durationSec } = await runFfmpeg(
    ffmpegPath,
    // prettier-ignore
    [
      '-i', input,
      '-vn', '-ac', '1', '-ar', '16000',
      '-c:a', 'libmp3lame', '-b:a', '32k',
      '-f', 'segment',
      '-segment_time', String(segmentSec),
      '-reset_timestamps', '1',
      '-segment_list', listFile,
      '-segment_list_type', 'csv',
      join(outDir, 'chunk-%03d.mp3')
    ],
    opts
  )
  const csv = await readFile(listFile, 'utf8')
  return { chunks: parseSegmentList(csv, outDir), durationSec }
}

/** Interpreta la lista CSV del muxer `segment`: "archivo,inicio,fin". */
export function parseSegmentList(csv: string, dir: string): AudioChunk[] {
  return csv
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [file, start] = line.split(',')
      return { file: join(dir, file), offsetSec: Number(start) || 0 }
    })
}

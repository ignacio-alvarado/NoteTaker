import { createWriteStream } from 'fs'
import { mkdir, readdir, rename, rm, stat } from 'fs/promises'
import { join } from 'path'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'
import type { ReadableStream as WebReadableStream } from 'stream/web'
import { AppErrorException } from '@shared/errors'
import type { WhisperModelInfo } from '@shared/types'

interface CatalogEntry {
  id: string
  label: string
  sizeMB: number
  recommended?: boolean
}

/** Modelos GGML publicados en huggingface.co/ggerganov/whisper.cpp. */
export const WHISPER_MODELS: CatalogEntry[] = [
  { id: 'tiny', label: 'Tiny', sizeMB: 75 },
  { id: 'base', label: 'Base', sizeMB: 142 },
  { id: 'small', label: 'Small', sizeMB: 466 },
  { id: 'medium', label: 'Medium', sizeMB: 1530 },
  { id: 'large-v3-turbo-q5_0', label: 'Large v3 Turbo (Q5)', sizeMB: 547, recommended: true },
  { id: 'large-v3-turbo', label: 'Large v3 Turbo', sizeMB: 1620 }
]

export const DEFAULT_LOCAL_MODEL = 'large-v3-turbo-q5_0'

const BASE_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main'

export function modelFileName(id: string): string {
  return `ggml-${id}.bin`
}

export function modelPath(dir: string, id: string): string {
  return join(dir, modelFileName(id))
}

function findModel(id: string): CatalogEntry {
  const model = WHISPER_MODELS.find((m) => m.id === id)
  if (!model) throw new AppErrorException('NOT_FOUND', id)
  return model
}

export async function listModels(dir: string): Promise<WhisperModelInfo[]> {
  let files: string[] = []
  try {
    files = await readdir(dir)
  } catch {
    // La carpeta aún no existe: no hay modelos instalados.
  }
  return WHISPER_MODELS.map((m) => ({
    id: m.id,
    label: m.label,
    sizeMB: m.sizeMB,
    recommended: Boolean(m.recommended),
    installed: files.includes(modelFileName(m.id))
  }))
}

export async function isModelInstalled(dir: string, id: string): Promise<boolean> {
  try {
    return (await stat(modelPath(dir, id))).size > 0
  } catch {
    return false
  }
}

export interface DownloadOptions {
  signal?: AbortSignal
  onProgress?: (received: number, total: number | null) => void
}

/** Descarga a `.part` y renombra al terminar, para no dejar modelos a medias. */
export async function downloadModel(
  dir: string,
  id: string,
  opts: DownloadOptions = {}
): Promise<void> {
  findModel(id)
  await mkdir(dir, { recursive: true })
  const finalPath = modelPath(dir, id)
  const partPath = `${finalPath}.part`

  let res: Response
  try {
    res = await fetch(`${BASE_URL}/${modelFileName(id)}`, { signal: opts.signal })
  } catch (err) {
    if (opts.signal?.aborted) throw new AppErrorException('CANCELLED')
    throw new AppErrorException('DOWNLOAD_FAILED', err instanceof Error ? err.message : String(err))
  }
  if (!res.ok || !res.body) {
    throw new AppErrorException('DOWNLOAD_FAILED', `HTTP ${res.status}`)
  }

  const totalHeader = Number(res.headers.get('content-length'))
  const total = Number.isFinite(totalHeader) && totalHeader > 0 ? totalHeader : null
  let received = 0
  let lastEmit = 0

  const body = Readable.fromWeb(res.body as unknown as WebReadableStream<Uint8Array>)
  body.on('data', (chunk: Buffer) => {
    received += chunk.length
    const now = Date.now()
    if (now - lastEmit > 250) {
      lastEmit = now
      opts.onProgress?.(received, total)
    }
  })

  try {
    await pipeline(body, createWriteStream(partPath), { signal: opts.signal })
  } catch (err) {
    await rm(partPath, { force: true })
    if (opts.signal?.aborted) throw new AppErrorException('CANCELLED')
    throw new AppErrorException('DOWNLOAD_FAILED', err instanceof Error ? err.message : String(err))
  }

  if (total !== null && received !== total) {
    await rm(partPath, { force: true })
    throw new AppErrorException('DOWNLOAD_FAILED', `incomplete: ${received}/${total}`)
  }
  await rename(partPath, finalPath)
  opts.onProgress?.(received, total)
}

export async function deleteModel(dir: string, id: string): Promise<void> {
  findModel(id)
  await rm(modelPath(dir, id), { force: true })
}

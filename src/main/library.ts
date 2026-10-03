import { randomUUID } from 'crypto'
import { mkdir, readdir, readFile, rename, writeFile } from 'fs/promises'
import { join } from 'path'
import { AppErrorException } from '@shared/errors'
import type { Entry, EntryMeta, SummaryRecord, Transcript } from '@shared/types'

const META = 'meta.json'
const TRANSCRIPT = 'transcript.json'
const SUMMARIES = 'summaries.json'

async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T
  } catch {
    return null
  }
}

/** Escribe en un temporal y renombra, para no dejar JSON corrupto si la app se cierra a mitad. */
async function writeJson(path: string, data: unknown): Promise<void> {
  const tmp = `${path}.${process.pid}.tmp`
  await writeFile(tmp, JSON.stringify(data, null, 2), 'utf8')
  await rename(tmp, path)
}

/**
 * Historial en disco: una carpeta por entrada con meta, transcripción y resúmenes.
 */
export class Library {
  constructor(private readonly baseDir: string) {}

  entryDir(id: string): string {
    if (!/^[\w-]+$/.test(id)) throw new AppErrorException('NOT_FOUND', id)
    return join(this.baseDir, id)
  }

  async create(
    init: Pick<EntryMeta, 'title' | 'sourceName' | 'sourcePath' | 'isRecording'>
  ): Promise<EntryMeta> {
    const id = randomUUID()
    const meta: EntryMeta = {
      id,
      ...init,
      createdAt: new Date().toISOString(),
      durationSec: null,
      language: null,
      engine: null,
      model: null,
      status: 'queued',
      error: null
    }
    await mkdir(this.entryDir(id), { recursive: true })
    await writeJson(join(this.entryDir(id), META), meta)
    await writeJson(join(this.entryDir(id), SUMMARIES), [])
    return meta
  }

  async list(): Promise<EntryMeta[]> {
    let dirs: string[]
    try {
      dirs = await readdir(this.baseDir)
    } catch {
      return []
    }
    const metas = await Promise.all(
      dirs.map((d) => readJson<EntryMeta>(join(this.baseDir, d, META)))
    )
    return metas
      .filter((m): m is EntryMeta => m !== null)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  async getMeta(id: string): Promise<EntryMeta> {
    const meta = await readJson<EntryMeta>(join(this.entryDir(id), META))
    if (!meta) throw new AppErrorException('NOT_FOUND', id)
    return meta
  }

  async get(id: string): Promise<Entry> {
    const dir = this.entryDir(id)
    const meta = await this.getMeta(id)
    const transcript = await readJson<Transcript>(join(dir, TRANSCRIPT))
    const summaries = (await readJson<SummaryRecord[]>(join(dir, SUMMARIES))) ?? []
    return { meta, transcript, summaries }
  }

  async updateMeta(id: string, patch: Partial<EntryMeta>): Promise<EntryMeta> {
    const meta = { ...(await this.getMeta(id)), ...patch, id }
    await writeJson(join(this.entryDir(id), META), meta)
    return meta
  }

  async saveTranscript(id: string, transcript: Transcript): Promise<void> {
    await writeJson(join(this.entryDir(id), TRANSCRIPT), transcript)
  }

  async getTranscript(id: string): Promise<Transcript | null> {
    return readJson<Transcript>(join(this.entryDir(id), TRANSCRIPT))
  }

  async addSummary(
    id: string,
    summary: Omit<SummaryRecord, 'id' | 'createdAt'>
  ): Promise<SummaryRecord> {
    const path = join(this.entryDir(id), SUMMARIES)
    const list = (await readJson<SummaryRecord[]>(path)) ?? []
    const record: SummaryRecord = {
      ...summary,
      id: randomUUID(),
      createdAt: new Date().toISOString()
    }
    list.unshift(record)
    await writeJson(path, list)
    return record
  }

  async deleteSummary(id: string, summaryId: string): Promise<void> {
    const path = join(this.entryDir(id), SUMMARIES)
    const list = (await readJson<SummaryRecord[]>(path)) ?? []
    await writeJson(
      path,
      list.filter((s) => s.id !== summaryId)
    )
  }

  /** Marca como interrumpidas las entradas que quedaron a medias al cerrar la app. */
  async recoverInterrupted(): Promise<void> {
    for (const meta of await this.list()) {
      if (meta.status === 'queued' || meta.status === 'processing') {
        const hasTranscript = (await this.getTranscript(meta.id)) !== null
        await this.updateMeta(meta.id, { status: hasTranscript ? 'transcribed' : 'cancelled' })
      }
    }
  }
}

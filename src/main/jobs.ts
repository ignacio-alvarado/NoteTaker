import { randomUUID } from 'crypto'
import { mkdir, rm, writeFile } from 'fs/promises'
import { basename, extname, join } from 'path'
import { AppErrorException, toAppError } from '@shared/errors'
import type {
  JobFinished,
  JobKind,
  JobProgress,
  JobStage,
  JobStarted,
  SummaryDelta,
  Transcript
} from '@shared/types'
import type { ChatGPTAccount } from './accounts/chatgpt'
import type { Library } from './library'
import { convertToMp3Chunks, convertToWav16k } from './media/ffmpeg'
import type { SettingsStore } from './settings'
import { summarizeWithAnthropic } from './summary/anthropic'
import { summarizeWithOpenAI } from './summary/openai'
import { buildSummaryPrompt, DEFAULT_TEMPLATE_ID, findTemplate } from './summary/templates'
import { transcribeLocal } from './transcription/local-whisper'
import { isModelInstalled, modelPath } from './transcription/models'
import { transcribeOpenAI } from './transcription/openai-whisper'

/** Trozos de 10 min a 32 kbps ≈ 2,4 MB, muy por debajo del límite de 25 MB de OpenAI. */
const OPENAI_CHUNK_SEC = 600

export interface JobEvents {
  progress(p: JobProgress): void
  delta(d: SummaryDelta): void
  finished(f: JobFinished): void
  libraryChanged(): void
}

export interface JobPaths {
  ffmpeg(): string
  whisperCli(): string
  models(): string
  temp(): string
}

const RECORDING_EXT: Record<string, string> = {
  'audio/webm': '.webm',
  'audio/ogg': '.ogg',
  'audio/mp4': '.m4a',
  'audio/wav': '.wav'
}

export class JobManager {
  private readonly controllers = new Map<string, AbortController>()
  private readonly active = new Map<string, JobProgress>()
  /** Las transcripciones van en serie: whisper local ya usa todos los núcleos. */
  private queue: Promise<void> = Promise.resolve()

  constructor(
    private readonly library: Library,
    private readonly settings: SettingsStore,
    private readonly chatgpt: ChatGPTAccount,
    private readonly paths: JobPaths,
    private readonly events: JobEvents
  ) {}

  activeJobs(): JobProgress[] {
    return [...this.active.values()]
  }

  cancel(jobId: string): void {
    this.controllers.get(jobId)?.abort()
  }

  async startFromFile(path: string): Promise<JobStarted> {
    const name = basename(path)
    const meta = await this.library.create({
      title: basename(name, extname(name)),
      sourceName: name,
      sourcePath: path,
      isRecording: false
    })
    this.events.libraryChanged()
    return this.enqueueTranscription(meta.id, path)
  }

  async startFromRecording(data: ArrayBuffer, mimeType: string): Promise<JobStarted> {
    const lang = this.settings.get().uiLanguage
    const when = new Date().toLocaleString(lang === 'es' ? 'es-ES' : 'en-US', {
      dateStyle: 'medium',
      timeStyle: 'short'
    })
    const ext = RECORDING_EXT[mimeType.split(';')[0]] ?? '.webm'
    const meta = await this.library.create({
      title: `${lang === 'es' ? 'Grabación' : 'Recording'} ${when}`,
      sourceName: `recording${ext}`,
      sourcePath: null,
      isRecording: true
    })
    const file = join(this.library.entryDir(meta.id), `recording${ext}`)
    await writeFile(file, Buffer.from(data))
    await this.library.updateMeta(meta.id, { sourcePath: file })
    this.events.libraryChanged()
    return this.enqueueTranscription(meta.id, file)
  }

  /** Retoma una entrada fallida o cancelada desde su archivo de origen. */
  async retry(entryId: string): Promise<JobStarted> {
    const meta = await this.library.getMeta(entryId)
    if (!meta.sourcePath) throw new AppErrorException('NOT_FOUND', entryId)
    await this.library.updateMeta(entryId, { status: 'queued', error: null })
    this.events.libraryChanged()
    return this.enqueueTranscription(entryId, meta.sourcePath)
  }

  summarize(entryId: string, templateId: string): JobStarted {
    const { jobId, signal } = this.register(entryId, 'summary', 'summarizing')
    void this.runSummary(jobId, entryId, templateId, signal)
    return { jobId, entryId }
  }

  private register(
    entryId: string,
    kind: JobKind,
    stage: JobStage
  ): { jobId: string; signal: AbortSignal } {
    const jobId = randomUUID()
    const controller = new AbortController()
    this.controllers.set(jobId, controller)
    this.emitProgress({ jobId, entryId, kind, stage, percent: null })
    return { jobId, signal: controller.signal }
  }

  private emitProgress(p: JobProgress): void {
    this.active.set(p.jobId, p)
    this.events.progress(p)
  }

  private finish(jobId: string, entryId: string, kind: JobKind, error: JobFinished['error']): void {
    this.controllers.delete(jobId)
    this.active.delete(jobId)
    this.events.finished({ jobId, entryId, kind, error })
  }

  private enqueueTranscription(entryId: string, input: string): JobStarted {
    const { jobId, signal } = this.register(entryId, 'transcription', 'queued')
    this.queue = this.queue.then(() => this.runTranscription(jobId, entryId, input, signal))
    return { jobId, entryId }
  }

  private async runTranscription(
    jobId: string,
    entryId: string,
    input: string,
    signal: AbortSignal
  ): Promise<void> {
    const workDir = join(this.paths.temp(), jobId)
    const progress = (stage: JobStage, fraction: number | null): void =>
      this.emitProgress({
        jobId,
        entryId,
        kind: 'transcription',
        stage,
        percent: fraction === null ? null : Math.round(fraction * 100)
      })

    try {
      if (signal.aborted) throw new AppErrorException('CANCELLED')
      const { transcription: cfg, summary } = this.settings.get()
      const model = cfg.engine === 'local' ? cfg.localModel : cfg.openaiModel

      await this.library.updateMeta(entryId, {
        status: 'processing',
        engine: cfg.engine,
        model,
        error: null
      })
      this.events.libraryChanged()
      await mkdir(workDir, { recursive: true })

      let transcript: Transcript
      let durationSec: number | null
      progress('converting', 0)

      if (cfg.engine === 'local') {
        if (!(await isModelInstalled(this.paths.models(), cfg.localModel))) {
          throw new AppErrorException('NO_LOCAL_MODEL', cfg.localModel)
        }
        const wav = join(workDir, 'audio.wav')
        ;({ durationSec } = await convertToWav16k(this.paths.ffmpeg(), input, wav, {
          signal,
          onProgress: (f) => progress('converting', f)
        }))
        progress('transcribing', 0)
        transcript = await transcribeLocal({
          binary: this.paths.whisperCli(),
          modelPath: modelPath(this.paths.models(), cfg.localModel),
          wavPath: wav,
          outBase: join(workDir, 'transcript'),
          language: cfg.language,
          threads: cfg.threads,
          useGpu: cfg.useGpu,
          signal,
          onProgress: (f) => progress('transcribing', f)
        })
      } else {
        const apiKey = this.settings.requireApiKey('openai')
        const converted = await convertToMp3Chunks(
          this.paths.ffmpeg(),
          input,
          workDir,
          OPENAI_CHUNK_SEC,
          {
            signal,
            onProgress: (f) => progress('converting', f)
          }
        )
        durationSec = converted.durationSec
        progress('transcribing', 0)
        transcript = await transcribeOpenAI({
          apiKey,
          model: cfg.openaiModel,
          chunks: converted.chunks,
          durationSec,
          language: cfg.language,
          signal,
          onProgress: (f) => progress('transcribing', f)
        })
      }

      if (transcript.segments.length === 0) throw new AppErrorException('EMPTY_TRANSCRIPT')
      if (!transcript.language && cfg.language !== 'auto') transcript.language = cfg.language

      await this.library.saveTranscript(entryId, transcript)
      await this.library.updateMeta(entryId, {
        status: 'transcribed',
        durationSec,
        language: transcript.language
      })
      this.events.libraryChanged()
      this.finish(jobId, entryId, 'transcription', null)

      // Sin credencial no se autorresume: el inicio ya avisa y el usuario puede generarlo luego.
      if (summary.autoSummarize && this.settings.hasSummaryCredential(summary.provider)) {
        this.summarize(entryId, summary.defaultTemplateId)
      }
    } catch (err) {
      const error = toAppError(err)
      const cancelled = error.code === 'CANCELLED'
      await this.library
        .updateMeta(entryId, {
          status: cancelled ? 'cancelled' : 'error',
          error: cancelled ? null : error
        })
        .catch(() => undefined)
      this.events.libraryChanged()
      this.finish(jobId, entryId, 'transcription', error)
    } finally {
      await rm(workDir, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  private async runSummary(
    jobId: string,
    entryId: string,
    templateId: string,
    signal: AbortSignal
  ): Promise<void> {
    try {
      const { summary: cfg, uiLanguage, customTemplates } = this.settings.get()
      const transcript = await this.library.getTranscript(entryId)
      if (!transcript) throw new AppErrorException('NOT_FOUND', entryId)

      const template =
        findTemplate(templateId, uiLanguage, customTemplates) ??
        findTemplate(DEFAULT_TEMPLATE_ID, uiLanguage, customTemplates)!
      const prompt = buildSummaryPrompt({
        segments: transcript.segments,
        template,
        outputLanguage: cfg.outputLanguage,
        transcriptLanguage: transcript.language,
        lang: uiLanguage
      })
      const onDelta = (text: string): void => this.events.delta({ jobId, entryId, text })

      let markdown: string
      let model: string
      if (cfg.provider === 'anthropic') {
        model = cfg.anthropicModel
        markdown = await summarizeWithAnthropic({
          apiKey: this.settings.requireApiKey('anthropic'),
          model,
          effort: cfg.effort,
          prompt,
          signal,
          onDelta
        })
      } else if (cfg.openaiAuth === 'account') {
        // Cuenta de ChatGPT: los modelos del plan tienen otros ids; sin elegir, el primero.
        const planModel = cfg.chatgptModel || (await this.chatgpt.listModels())[0]?.slug
        if (!planModel) throw new AppErrorException('API_ERROR', 'no models')
        model = planModel
        markdown = await summarizeWithOpenAI({
          apiKey: await this.chatgpt.getAccessToken(),
          account: true,
          model,
          prompt,
          signal,
          onDelta
        })
      } else {
        model = cfg.openaiModel
        markdown = await summarizeWithOpenAI({
          apiKey: this.settings.requireApiKey('openai'),
          model,
          prompt,
          signal,
          onDelta
        })
      }

      await this.library.addSummary(entryId, {
        templateId: template.id,
        templateName: template.name,
        provider: cfg.provider,
        model,
        markdown
      })
      await this.library.updateMeta(entryId, { status: 'summarized' })
      this.events.libraryChanged()
      this.finish(jobId, entryId, 'summary', null)
    } catch (err) {
      this.finish(jobId, entryId, 'summary', toAppError(err))
    }
  }
}

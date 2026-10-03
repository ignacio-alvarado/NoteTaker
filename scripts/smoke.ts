/**
 * Prueba de humo del pipeline fuera de Electron: ffmpeg → whisper-cli (+ resumen opcional).
 *
 *   npm run smoke -- <archivo de audio/video> [--model base] [--models-dir <dir>] [--summarize]
 *
 * Con --summarize usa ANTHROPIC_API_KEY del entorno para resumir con Claude.
 */
import ffmpegStatic from 'ffmpeg-static'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { formatClock } from '../src/shared/format'
import { convertToMp3Chunks, convertToWav16k } from '../src/main/media/ffmpeg'
import { summarizeWithAnthropic, DEFAULT_ANTHROPIC_MODEL } from '../src/main/summary/anthropic'
import { buildSummaryPrompt, findTemplate } from '../src/main/summary/templates'
import { transcribeLocal } from '../src/main/transcription/local-whisper'
import { downloadModel, isModelInstalled, modelPath } from '../src/main/transcription/models'

const args = process.argv.slice(2)
const flag = (name: string): string | undefined => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}
const input = args.find(
  (a) => !a.startsWith('--') && !['--model', '--models-dir'].includes(args[args.indexOf(a) - 1])
)
if (!input) {
  console.error('Uso: npm run smoke -- <archivo> [--model base] [--models-dir dir] [--summarize]')
  process.exit(1)
}

const root = resolve(__dirname, '..')
const model = flag('--model') ?? 'base'
const modelsDir = resolve(flag('--models-dir') ?? join(root, '.whisper-build', 'models'))
const whisperCli = join(
  root,
  'resources',
  'bin',
  `${process.platform}-${process.arch}`,
  process.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli'
)
const ffmpeg = ffmpegStatic as string

async function main(): Promise<void> {
  if (!(await isModelInstalled(modelsDir, model))) {
    console.log(`Descargando modelo ${model} en ${modelsDir}…`)
    await downloadModel(modelsDir, model, {
      onProgress: (r, t) =>
        process.stdout.write(`\r  ${(r / 1e6).toFixed(1)} / ${t ? (t / 1e6).toFixed(1) : '?'} MB`)
    })
    process.stdout.write('\n')
  }

  const work = await mkdtemp(join(tmpdir(), 'notetaker-smoke-'))
  try {
    const wav = join(work, 'audio.wav')
    const t0 = Date.now()
    const { durationSec } = await convertToWav16k(ffmpeg, resolve(input!), wav)
    console.log(`ffmpeg → wav OK (duración ${durationSec?.toFixed(1)} s, ${Date.now() - t0} ms)`)

    const { chunks } = await convertToMp3Chunks(ffmpeg, resolve(input!), join(work, 'chunks'), 5)
    console.log(
      `ffmpeg → mp3 en trozos de 5 s: ${chunks.map((c) => c.offsetSec.toFixed(2)).join(', ')}`
    )

    const t1 = Date.now()
    let last = -1
    const transcript = await transcribeLocal({
      binary: whisperCli,
      modelPath: modelPath(modelsDir, model),
      wavPath: wav,
      outBase: join(work, 'transcript'),
      language: 'auto',
      threads: 0,
      useGpu: true,
      onProgress: (f) => {
        const pct = Math.round(f * 100)
        if (pct !== last) process.stdout.write(`\r  whisper ${(last = pct)}%`)
      }
    })
    process.stdout.write('\n')
    console.log(`whisper-cli OK (${Date.now() - t1} ms) idioma=${transcript.language}`)
    for (const seg of transcript.segments) console.log(`  [${formatClock(seg.start)}] ${seg.text}`)
    if (transcript.segments.length === 0) throw new Error('Transcripción vacía')

    if (args.includes('--summarize')) {
      const apiKey = process.env.ANTHROPIC_API_KEY
      if (!apiKey) throw new Error('Falta ANTHROPIC_API_KEY')
      const template = findTemplate('key-points', 'es', [])!
      const prompt = buildSummaryPrompt({
        segments: transcript.segments,
        template,
        outputLanguage: 'auto',
        transcriptLanguage: transcript.language,
        lang: 'es'
      })
      console.log(`\nResumen (${DEFAULT_ANTHROPIC_MODEL}):\n`)
      await summarizeWithAnthropic({
        apiKey,
        model: DEFAULT_ANTHROPIC_MODEL,
        effort: 'low',
        prompt,
        onDelta: (d) => process.stdout.write(d)
      })
      process.stdout.write('\n')
    }
  } finally {
    await rm(work, { recursive: true, force: true })
  }
}

main().catch((err) => {
  console.error('\nFALLÓ:', err)
  process.exit(1)
})

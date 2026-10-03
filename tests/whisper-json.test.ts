import { describe, expect, it } from 'vitest'
import { parseWhisperJson, parseWhisperProgress } from '../src/main/transcription/local-whisper'

const sample = JSON.stringify({
  systeminfo: 'AVX = 0',
  params: { model: 'ggml-base.bin', language: 'auto', translate: false },
  result: { language: 'es' },
  transcription: [
    {
      timestamps: { from: '00:00:00,000', to: '00:00:03,200' },
      offsets: { from: 0, to: 3200 },
      text: ' Buenos días.'
    },
    {
      timestamps: { from: '00:00:03,200', to: '00:00:04,000' },
      offsets: { from: 3200, to: 4000 },
      text: '  '
    },
    {
      timestamps: { from: '00:00:04,000', to: '00:00:07,500' },
      offsets: { from: 4000, to: 7500 },
      text: ' Hoy hablamos del presupuesto.'
    }
  ]
})

describe('parseWhisperJson', () => {
  it('converts offsets to seconds and drops empty segments', () => {
    const t = parseWhisperJson(sample)
    expect(t.language).toBe('es')
    expect(t.segments).toEqual([
      { start: 0, end: 3.2, text: 'Buenos días.' },
      { start: 4, end: 7.5, text: 'Hoy hablamos del presupuesto.' }
    ])
    expect(t.text).toBe('Buenos días. Hoy hablamos del presupuesto.')
  })

  it('treats "auto" language as unknown', () => {
    const t = parseWhisperJson(JSON.stringify({ result: { language: 'auto' }, transcription: [] }))
    expect(t.language).toBeNull()
    expect(t.segments).toEqual([])
  })
})

describe('parseWhisperProgress', () => {
  it('returns the last percentage in a chunk', () => {
    const chunk =
      'whisper_print_progress_callback: progress =  10%\nwhisper_print_progress_callback: progress =  15%\n'
    expect(parseWhisperProgress(chunk)).toBe(15)
    expect(parseWhisperProgress('whisper_init_from_file')).toBeNull()
  })
})

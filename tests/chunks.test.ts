import { describe, expect, it } from 'vitest'
import { join } from 'path'
import { parseSegmentList } from '../src/main/media/ffmpeg'
import { mergeChunkResults, normalizeLanguage } from '../src/main/transcription/openai-whisper'

describe('parseSegmentList', () => {
  it('reads file names and start offsets from the segment muxer CSV', () => {
    const csv = 'chunk-000.mp3,0.000000,600.024000\r\nchunk-001.mp3,600.024000,812.5\n'
    expect(parseSegmentList(csv, '/work')).toEqual([
      { file: join('/work', 'chunk-000.mp3'), offsetSec: 0 },
      { file: join('/work', 'chunk-001.mp3'), offsetSec: 600.024 }
    ])
  })
})

describe('mergeChunkResults', () => {
  it('shifts each chunk by its offset and keeps chronological order', () => {
    const t = mergeChunkResults([
      { offsetSec: 600, language: null, segments: [{ start: 1, end: 4, text: ' segunda parte ' }] },
      {
        offsetSec: 0,
        language: 'es',
        segments: [
          { start: 0, end: 2, text: 'primera parte' },
          { start: 2, end: 3, text: '   ' }
        ]
      }
    ])
    expect(t.language).toBe('es')
    expect(t.segments).toEqual([
      { start: 0, end: 2, text: 'primera parte' },
      { start: 601, end: 604, text: 'segunda parte' }
    ])
    expect(t.text).toBe('primera parte segunda parte')
  })
})

describe('normalizeLanguage', () => {
  it('maps whisper-1 language names to ISO codes', () => {
    expect(normalizeLanguage('spanish')).toBe('es')
    expect(normalizeLanguage('EN')).toBe('en')
    expect(normalizeLanguage(null)).toBeNull()
  })
})

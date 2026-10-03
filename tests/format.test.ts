import { describe, expect, it } from 'vitest'
import {
  formatClock,
  formatTimestamp,
  segmentsToText,
  toPlainText,
  toSrt,
  toVtt
} from '../src/shared/format'

const segments = [
  { start: 0, end: 2.5, text: ' Hola a todos.' },
  { start: 2.5, end: 3661.042, text: 'Empezamos la reunión. ' }
]

describe('timestamps', () => {
  it('formats SRT and VTT timestamps', () => {
    expect(formatTimestamp(0, ',')).toBe('00:00:00,000')
    expect(formatTimestamp(3661.042, ',')).toBe('01:01:01,042')
    expect(formatTimestamp(59.9999, '.')).toBe('00:01:00.000')
  })

  it('formats clock labels', () => {
    expect(formatClock(75.5)).toBe('01:15')
    expect(formatClock(3675)).toBe('1:01:15')
  })
})

describe('exports', () => {
  it('renders SRT', () => {
    expect(toSrt(segments)).toBe(
      '1\n00:00:00,000 --> 00:00:02,500\nHola a todos.\n\n2\n00:00:02,500 --> 01:01:01,042\nEmpezamos la reunión.\n'
    )
  })

  it('renders VTT with header', () => {
    const vtt = toVtt(segments)
    expect(vtt.startsWith('WEBVTT\n\n00:00:00.000 --> 00:00:02.500\nHola a todos.')).toBe(true)
  })

  it('renders plain text with and without timestamps', () => {
    expect(segmentsToText(segments)).toBe('Hola a todos. Empezamos la reunión.')
    expect(toPlainText(segments, true)).toBe('[00:00] Hola a todos.\n[00:02] Empezamos la reunión.')
  })
})

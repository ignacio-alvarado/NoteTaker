import type { Segment } from './types'

/** 75.5 → "01:15" (o "1:01:15" si pasa de una hora). */
export function formatClock(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const mm = String(m).padStart(2, '0')
  const ss = String(sec).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

/** Marca de tiempo HH:MM:SS<sep>mmm (SRT usa ",", VTT usa "."). */
export function formatTimestamp(totalSec: number, sep: ',' | '.'): string {
  const ms = Math.max(0, Math.round(totalSec * 1000))
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  const s = Math.floor((ms % 60_000) / 1000)
  const rest = ms % 1000
  const pad = (n: number, w = 2): string => String(n).padStart(w, '0')
  return `${pad(h)}:${pad(m)}:${pad(s)}${sep}${pad(rest, 3)}`
}

export function toSrt(segments: Segment[]): string {
  return segments
    .map(
      (seg, i) =>
        `${i + 1}\n${formatTimestamp(seg.start, ',')} --> ${formatTimestamp(seg.end, ',')}\n${seg.text.trim()}\n`
    )
    .join('\n')
}

export function toVtt(segments: Segment[]): string {
  const body = segments
    .map(
      (seg) =>
        `${formatTimestamp(seg.start, '.')} --> ${formatTimestamp(seg.end, '.')}\n${seg.text.trim()}\n`
    )
    .join('\n')
  return `WEBVTT\n\n${body}`
}

export function toPlainText(segments: Segment[], withTimestamps: boolean): string {
  if (!withTimestamps) return segmentsToText(segments)
  return segments.map((seg) => `[${formatClock(seg.start)}] ${seg.text.trim()}`).join('\n')
}

/** Une los segmentos en texto corrido. */
export function segmentsToText(segments: Segment[]): string {
  return segments
    .map((seg) => seg.text.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

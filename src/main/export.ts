import { BrowserWindow, dialog } from 'electron'
import { writeFile } from 'fs/promises'
import { AppErrorException } from '@shared/errors'
import { toPlainText, toSrt, toVtt } from '@shared/format'
import type { Entry, ExportFormat, ExportTarget } from '@shared/types'

const EXTENSIONS: Record<ExportFormat, string> = {
  md: 'md',
  txt: 'txt',
  'txt-timestamps': 'txt',
  srt: 'srt',
  vtt: 'vtt'
}

/** Quita markdown básico para exportar el resumen como texto plano. */
function stripMarkdown(md: string): string {
  return md
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/(^|[^*])\*(?!\s)(.+?)\*/g, '$1$2')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[(.+?)\]\((.+?)\)/g, '$1 ($2)')
}

export function renderExport(
  entry: Entry,
  target: ExportTarget,
  format: ExportFormat,
  summaryId?: string
): string {
  if (target === 'summary') {
    const summary = entry.summaries.find((s) => s.id === summaryId) ?? entry.summaries[0]
    if (!summary) throw new AppErrorException('NOT_FOUND', 'summary')
    const md = `# ${entry.meta.title}\n\n${summary.markdown}\n`
    return format === 'md' ? md : stripMarkdown(md)
  }
  const segments = entry.transcript?.segments
  if (!segments) throw new AppErrorException('NOT_FOUND', 'transcript')
  switch (format) {
    case 'srt':
      return toSrt(segments)
    case 'vtt':
      return toVtt(segments)
    case 'txt-timestamps':
      return toPlainText(segments, true)
    default:
      return toPlainText(segments, false)
  }
}

function safeFileName(title: string): string {
  return (
    title
      .replace(/[\\/:*?"<>|]+/g, '-')
      .trim()
      .slice(0, 120) || 'notetaker'
  )
}

export async function exportEntry(
  win: BrowserWindow | null,
  entry: Entry,
  target: ExportTarget,
  format: ExportFormat,
  summaryId?: string
): Promise<string | null> {
  const content = renderExport(entry, target, format, summaryId)
  const ext = EXTENSIONS[format]
  const suffix = target === 'summary' ? '' : ' (transcript)'
  const options = {
    defaultPath: `${safeFileName(entry.meta.title)}${suffix}.${ext}`,
    filters: [{ name: ext.toUpperCase(), extensions: [ext] }]
  }
  const { canceled, filePath } = win
    ? await dialog.showSaveDialog(win, options)
    : await dialog.showSaveDialog(options)
  if (canceled || !filePath) return null
  await writeFile(filePath, content, 'utf8')
  return filePath
}

import type { UpdateFileInfo, UpdateInfo } from 'electron-updater'

/** URL absoluta de un archivo del feed (las de latest*.yml son relativas a la base). */
export function resolveFileUrl(base: string, file: string): string {
  if (/^https?:\/\//i.test(file)) return file
  return new URL(file, base.endsWith('/') ? base : `${base}/`).href
}

/** El instalador que descarga el usuario a mano: .dmg en macOS, .exe en Windows. */
export function pickInstallerFile(
  files: readonly Pick<UpdateFileInfo, 'url'>[],
  platform: NodeJS.Platform
): string | null {
  const ext = platform === 'darwin' ? '.dmg' : platform === 'win32' ? '.exe' : null
  if (!ext) return null
  return files.find((f) => f.url.toLowerCase().endsWith(ext))?.url ?? null
}

/** Las notas pueden venir como texto (release-notes.md) o como lista por versión. */
export function releaseNotesToText(notes: UpdateInfo['releaseNotes']): string | undefined {
  if (!notes) return undefined
  if (typeof notes === 'string') return notes.trim() || undefined
  const text = notes
    .filter((n) => n.note)
    .map((n) => `**${n.version}**\n\n${n.note!.trim()}`)
    .join('\n\n')
  return text || undefined
}

/**
 * La app solo puede instalar sola donde el sistema lo permite: Windows siempre;
 * macOS únicamente si está firmada con Developer ID (Squirrel.Mac lo exige).
 */
export function canAutoInstall(platform: NodeJS.Platform, macSigned: boolean): boolean {
  return platform === 'win32' || (platform === 'darwin' && macSigned)
}

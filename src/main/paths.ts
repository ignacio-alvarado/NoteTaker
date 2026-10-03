import { app } from 'electron'
import ffmpegStatic from 'ffmpeg-static'
import { join } from 'path'

export const libraryDir = (): string => join(app.getPath('userData'), 'library')
export const modelsDir = (): string => join(app.getPath('userData'), 'models')
export const tempDir = (): string => join(app.getPath('temp'), 'notetaker')

/** En la app empaquetada ffmpeg vive en `app.asar.unpacked` (ver asarUnpack). */
export function ffmpegPath(): string {
  if (!ffmpegStatic) throw new Error('ffmpeg-static has no binary for this platform')
  return ffmpegStatic.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1')
}

export function whisperCliPath(): string {
  const exe = process.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli'
  if (app.isPackaged) return join(process.resourcesPath, 'bin', exe)
  return join(app.getAppPath(), 'resources', 'bin', `${process.platform}-${process.arch}`, exe)
}

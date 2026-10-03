import { describe, expect, it } from 'vitest'
import {
  canAutoInstall,
  pickInstallerFile,
  releaseNotesToText,
  resolveFileUrl
} from '../src/main/update-utils'

const files = [
  { url: 'NoteTaker-0.2.0-mac-arm64.zip' },
  { url: 'NoteTaker-0.2.0-mac-arm64.dmg' },
  { url: 'NoteTaker-0.2.0-win-x64-setup.exe' }
]

describe('resolveFileUrl', () => {
  it('resolves relative file names against the feed base, with or without trailing slash', () => {
    expect(resolveFileUrl('https://cdn.example.com/notetaker', 'a.dmg')).toBe(
      'https://cdn.example.com/notetaker/a.dmg'
    )
    expect(resolveFileUrl('https://cdn.example.com/notetaker/', 'a.dmg')).toBe(
      'https://cdn.example.com/notetaker/a.dmg'
    )
  })

  it('keeps absolute URLs untouched', () => {
    expect(resolveFileUrl('https://cdn.example.com/x', 'https://other.example.com/b.exe')).toBe(
      'https://other.example.com/b.exe'
    )
  })
})

describe('pickInstallerFile', () => {
  it('picks the dmg on macOS and the exe on Windows', () => {
    expect(pickInstallerFile(files, 'darwin')).toBe('NoteTaker-0.2.0-mac-arm64.dmg')
    expect(pickInstallerFile(files, 'win32')).toBe('NoteTaker-0.2.0-win-x64-setup.exe')
    expect(pickInstallerFile(files, 'linux')).toBeNull()
    expect(pickInstallerFile([{ url: 'only.zip' }], 'darwin')).toBeNull()
  })
})

describe('releaseNotesToText', () => {
  it('accepts a markdown string or a per-version list', () => {
    expect(releaseNotesToText('  - Arreglos  ')).toBe('- Arreglos')
    expect(
      releaseNotesToText([
        { version: '0.2.0', note: 'Nuevo' },
        { version: '0.1.1', note: null }
      ])
    ).toBe('**0.2.0**\n\nNuevo')
    expect(releaseNotesToText(null)).toBeUndefined()
    expect(releaseNotesToText('   ')).toBeUndefined()
  })
})

describe('canAutoInstall', () => {
  it('installs on Windows always and on macOS only when signed', () => {
    expect(canAutoInstall('win32', false)).toBe(true)
    expect(canAutoInstall('darwin', false)).toBe(false)
    expect(canAutoInstall('darwin', true)).toBe(true)
    expect(canAutoInstall('linux', true)).toBe(false)
  })
})

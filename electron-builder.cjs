/**
 * Configuración de electron-builder.
 *
 * Es JS (no YAML) para que el feed de actualizaciones sea opcional: con NOTETAKER_UPDATE_URL
 * se genera latest*.yml + app-update.yml y la app busca versiones nuevas en esa URL; sin ella
 * (builds locales) no hay feed y las actualizaciones quedan desactivadas.
 *
 * @type {import('electron-builder').Configuration}
 */
const updateUrl = process.env.NOTETAKER_UPDATE_URL?.trim()

module.exports = {
  appId: 'com.notetaker.app',
  productName: 'NoteTaker',
  copyright: 'Copyright © 2026 Ignacio Alvarado',
  directories: {
    buildResources: 'build',
    output: 'dist'
  },
  files: ['out/**', 'package.json', '!**/*.map'],
  // ffmpeg-static es un ejecutable: debe quedar fuera del asar para poder lanzarse.
  asarUnpack: ['node_modules/ffmpeg-static/**'],
  // whisper-cli (+ DLLs en Windows), preparado con `npm run whisper:fetch`.
  extraResources: [{ from: 'resources/bin/${platform}-${arch}', to: 'bin', filter: ['**/*'] }],
  npmRebuild: false,

  mac: {
    category: 'public.app-category.productivity',
    // El zip es el formato que usa la actualización automática en macOS (requiere firma);
    // el dmg es el que descarga el usuario.
    target: [
      { target: 'dmg', arch: ['arm64'] },
      { target: 'zip', arch: ['arm64'] }
    ],
    artifactName: '${productName}-${version}-mac-${arch}.${ext}',
    hardenedRuntime: true,
    entitlements: 'build/entitlements.mac.plist',
    entitlementsInherit: 'build/entitlements.mac.plist',
    extendInfo: {
      NSMicrophoneUsageDescription: 'NoteTaker usa el micrófono para grabar audio y transcribirlo.'
    },
    notarize: false
  },

  win: {
    executableName: 'NoteTaker',
    target: [{ target: 'nsis', arch: ['x64'] }]
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    artifactName: '${productName}-${version}-win-${arch}-setup.${ext}',
    shortcutName: '${productName}',
    uninstallDisplayName: '${productName}',
    createDesktopShortcut: 'always'
  },

  // Notas de la versión: si existe build/release-notes.md se incluye en latest*.yml.
  publish: updateUrl ? [{ provider: 'generic', url: updateUrl, channel: 'latest' }] : null
}

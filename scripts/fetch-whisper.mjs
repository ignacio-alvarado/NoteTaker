#!/usr/bin/env node
/**
 * Prepara el binario `whisper-cli` de whisper.cpp en resources/bin/<platform>-<arch>/.
 *
 *  - macOS: compila desde el código fuente (Metal, enlazado estático). Requiere cmake y Xcode CLT.
 *  - Windows: descarga los binarios oficiales del release y extrae whisper-cli.exe + DLLs.
 *
 * Uso: node scripts/fetch-whisper.mjs [--arch arm64|x64] [--force]
 */
import { execFileSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// v1.9.4 y el release de binarios b5130 apuntan al mismo commit (927cfce).
const SOURCE_TAG = 'v1.9.4'
const BINARY_RELEASE = 'b5130'
const REPO = 'https://github.com/ggml-org/whisper.cpp'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const argValue = (name) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}
const platform = process.platform
const arch = argValue('--arch') ?? process.arch
const force = args.includes('--force')
const outDir = join(root, 'resources', 'bin', `${platform}-${arch}`)
const workDir = join(root, '.whisper-build')

function run(cmd, cmdArgs, opts = {}) {
  console.log(`$ ${cmd} ${cmdArgs.join(' ')}`)
  execFileSync(cmd, cmdArgs, { stdio: 'inherit', ...opts })
}

function hasCommand(cmd) {
  try {
    execFileSync(cmd, ['--version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

function buildMac() {
  if (!hasCommand('cmake')) {
    console.error('cmake no está instalado. Instálalo con: brew install cmake')
    process.exit(1)
  }
  const src = join(workDir, `src-${SOURCE_TAG}`)
  if (!existsSync(src)) {
    mkdirSync(workDir, { recursive: true })
    run('git', ['clone', '--depth', '1', '--branch', SOURCE_TAG, `${REPO}.git`, src])
  }
  const build = join(workDir, `build-${arch}`)
  const cmakeArch = arch === 'x64' ? 'x86_64' : 'arm64'
  run('cmake', [
    '-S',
    src,
    '-B',
    build,
    '-DCMAKE_BUILD_TYPE=Release',
    `-DCMAKE_OSX_ARCHITECTURES=${cmakeArch}`,
    '-DCMAKE_OSX_DEPLOYMENT_TARGET=12.0',
    '-DBUILD_SHARED_LIBS=OFF',
    '-DGGML_NATIVE=OFF',
    '-DGGML_METAL=ON',
    '-DGGML_METAL_EMBED_LIBRARY=ON',
    '-DWHISPER_BUILD_TESTS=OFF',
    '-DWHISPER_BUILD_SERVER=OFF',
    '-DWHISPER_SDL2=OFF'
  ])
  run('cmake', ['--build', build, '--config', 'Release', '--target', 'whisper-cli', '-j'])
  mkdirSync(outDir, { recursive: true })
  cpSync(join(build, 'bin', 'whisper-cli'), join(outDir, 'whisper-cli'))
}

function findFiles(dir, predicate, acc = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) findFiles(p, predicate, acc)
    else if (predicate(name)) acc.push(p)
  }
  return acc
}

async function fetchWindows() {
  if (arch !== 'x64') {
    console.error(`Solo hay binarios oficiales de Windows x64 (pedido: ${arch}).`)
    process.exit(1)
  }
  const url = `${REPO}/releases/download/${BINARY_RELEASE}/whisper-bin-x64.zip`
  const zip = join(workDir, `whisper-bin-x64-${BINARY_RELEASE}.zip`)
  mkdirSync(workDir, { recursive: true })
  if (!existsSync(zip)) {
    console.log(`Descargando ${url}`)
    const res = await fetch(url)
    if (!res.ok) throw new Error(`HTTP ${res.status} al descargar ${url}`)
    writeFileSync(zip, Buffer.from(await res.arrayBuffer()))
  }
  const extracted = join(workDir, `win-x64-${BINARY_RELEASE}`)
  rmSync(extracted, { recursive: true, force: true })
  mkdirSync(extracted, { recursive: true })
  // Windows 10+ trae bsdtar, que descomprime zip.
  run('tar', ['-xf', zip, '-C', extracted])
  const files = findFiles(
    extracted,
    (n) => n === 'whisper-cli.exe' || n.toLowerCase().endsWith('.dll')
  )
  if (!files.some((f) => f.endsWith('whisper-cli.exe')))
    throw new Error('whisper-cli.exe no está en el zip')
  mkdirSync(outDir, { recursive: true })
  for (const f of files) cpSync(f, join(outDir, f.split(/[\\/]/).pop()))
}

const exe = platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli'
if (existsSync(join(outDir, exe)) && !force) {
  console.log(`Ya existe ${join(outDir, exe)} (usa --force para regenerarlo).`)
  process.exit(0)
}

if (platform === 'darwin') buildMac()
else if (platform === 'win32') await fetchWindows()
else {
  console.error(`Plataforma no soportada: ${platform}`)
  process.exit(1)
}
console.log(`Listo: ${join(outDir, exe)}`)

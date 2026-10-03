# NoteTaker

App de escritorio (macOS y Windows) para **transcribir audio y video con Whisper** y **resumir la transcripción con Claude u OpenAI**.

- Importa audio o video (MP3, WAV, M4A, FLAC, OGG, MP4, MOV, MKV, WEBM…) arrastrándolo o desde un diálogo, o graba desde el micrófono.
- Transcribe con **Whisper local** ([whisper.cpp](https://github.com/ggml-org/whisper.cpp): gratis, privado, sin conexión, con aceleración Metal en Apple Silicon) o con la **API de OpenAI** (`whisper-1` u otros modelos de transcripción).
- Resume con **Claude** (por defecto `claude-opus-5-5`) u **OpenAI** (por defecto `gpt-5.5`). Hay plantillas incluidas (resumen ejecutivo, minuta de reunión, puntos clave, notas de estudio) y puedes crear las tuyas.
- Guarda un historial local con varias versiones de resumen por grabación.
- Exporta el resumen a `.md`/`.txt` y la transcripción a `.txt`, `.srt` o `.vtt`.
- Interfaz en español e inglés, con tema claro, oscuro o del sistema.

## Requisitos

- Node.js 24+ y npm.
- **macOS:** Xcode Command Line Tools y `cmake` (`brew install cmake`). Hacen falta para compilar whisper.cpp.
- **Windows:** nada extra. Se descargan los binarios oficiales de whisper.cpp.

## Puesta en marcha

```bash
npm install
npm run whisper:fetch   # compila (macOS) o descarga (Windows) whisper-cli en resources/bin/
npm run dev
```

Después, en la app:

1. **Ajustes → API keys:** pega tu clave de Anthropic y/o de OpenAI. Se cifran con el llavero del sistema (Keychain o DPAPI) mediante `safeStorage` y nunca llegan al renderer.
2. **Ajustes → Transcripción:** descarga un modelo de Whisper. «Large v3 Turbo (Q5)», de unos 550 MB, es un buen equilibrio; «Base», de 142 MB, sirve para probar rápido.
3. Arrastra un archivo a la ventana o pulsa **Grabar**.

## Scripts

| Script                                                    | Qué hace                                                                                                     |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `npm run dev`                                             | App en modo desarrollo con recarga en caliente                                                               |
| `npm test`                                                | Tests unitarios y de integración (los SDK de Anthropic y OpenAI contra un servidor simulado)                 |
| `npm run typecheck` / `npm run lint`                      | Comprobación de tipos y ESLint                                                                               |
| `npm run smoke -- <archivo> [--model base] [--summarize]` | Prueba del pipeline real (ffmpeg → whisper-cli) fuera de Electron. Con `--summarize` usa `ANTHROPIC_API_KEY` |
| `npm run dist:mac`                                        | Genera `dist/NoteTaker-<versión>-mac-arm64.dmg`                                                              |
| `npm run dist:win`                                        | Genera el instalador NSIS de Windows x64 (hay que ejecutarlo en Windows)                                     |

Para probar con datos aislados (ajustes, historial y modelos aparte de los tuyos):

```bash
NOTETAKER_USER_DATA=/ruta/temporal npm run dev
```

## Arquitectura

```
renderer (React 19 + Tailwind 4, sandbox)  ──IPC tipado──►  main (Node)
  src/renderer/src/                                            src/main/
    components/  Home, Recorder, EntryView,                      jobs.ts         cola y orquestación del pipeline
                 SummaryPanel, TranscriptPanel,                  media/ffmpeg.ts conversión a WAV 16 kHz / MP3 en trozos
                 SettingsDialog, ModelManager…                   transcription/  whisper.cpp local, OpenAI, gestor de modelos
    lib/         api (Result → excepciones),                     summary/        Claude, OpenAI, plantillas y prompts
                 context/store (estado global)                   library.ts      historial (una carpeta JSON por entrada)
    i18n/        es.json, en.json                                settings.ts     ajustes + API keys cifradas
src/preload/index.ts  → expone window.api (contextBridge)        export.ts       MD/TXT/SRT/VTT
src/shared/           → tipos, canales IPC, formatos (SRT/VTT)
```

**Pipeline:** archivo o grabación → ffmpeg → transcripción → resumen en streaming.

- Con el motor **local**, ffmpeg convierte a WAV mono de 16 kHz y `whisper-cli` lo transcribe.
- Con **OpenAI**, ffmpeg convierte a MP3 de 32 kbps en trozos de 10 minutos (para no pasar del límite de 25 MB por petición) y después se reajustan las marcas de tiempo.

Detalles del resumen con Claude:

- Usa thinking adaptativo y `effort` configurable (por defecto `medium`).
- Activa `fallbacks: "default"`: si el modelo rechaza la petición, el servidor la reintenta con un modelo de respaldo.
- La transcripción va en el `system` con `cache_control`, así que regenerar con otra plantilla reutiliza la caché.

**Datos** (en `userData`: `~/Library/Application Support/NoteTaker` en macOS, `%APPDATA%\NoteTaker` en Windows):

- `settings.json`
- `keys.json`: claves cifradas.
- `models/`: modelos GGML.
- `library/<id>/`: `meta.json`, `transcript.json`, `summaries.json` y `recording.webm`.

Borrar una entrada la mueve a la papelera del sistema.

## Empaquetado y distribución

- `electron-builder.yml` incluye `whisper-cli` desde `resources/bin/<platform>-<arch>` y deja `ffmpeg-static` fuera del asar.
- `ffmpeg-static` descarga el binario de la plataforma donde se ejecuta `npm install`. Por eso el instalador de Windows se genera en Windows. El workflow `.github/workflows/build.yml` lo hace en paralelo (macOS + Windows) al publicar un tag `v*`.
- **Firma y notarización no están configuradas.** En macOS, la primera vez abre la app con clic derecho → Abrir. Para distribuirla, añade un certificado _Developer ID_ (`CSC_LINK`/`CSC_KEY_PASSWORD`) y `notarize: true` con las credenciales de Apple. En Windows, un certificado de firma de código evita el aviso de SmartScreen.
- El build de macOS es solo para **arm64** (Apple Silicon). Para Intel, ejecuta `npm run whisper:fetch -- --arch x64` y genera el paquete en una máquina x64, para que `ffmpeg-static` también sea x64.

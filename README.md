# NoteTaker

App de escritorio (macOS y Windows) para **transcribir audio y video con Whisper** y **resumir la transcripción con Claude u OpenAI**.

- Importa audio o video (MP3, WAV, M4A, FLAC, OGG, MP4, MOV, MKV, WEBM…) arrastrándolo o desde un diálogo, o graba desde el micrófono.
- Transcribe con **Whisper local** ([whisper.cpp](https://github.com/ggml-org/whisper.cpp): gratis, privado, sin conexión, con aceleración Metal en Apple Silicon) o con la **API de OpenAI** (`whisper-1` u otros modelos de transcripción).
- Resume con **Claude** (por defecto `claude-opus-5-5`) u **OpenAI** (por defecto `gpt-5.5`), con API key o, para OpenAI, con tu **cuenta de ChatGPT (Plus/Pro)**. Hay plantillas incluidas (resumen ejecutivo, minuta de reunión, puntos clave, notas de estudio) y puedes crear las tuyas.
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

1. **Ajustes → Cuentas y API keys:** pega tu clave de Anthropic y/o de OpenAI, o conecta tu cuenta de ChatGPT (ver [Usar una cuenta de ChatGPT](#usar-una-cuenta-de-chatgpt)). Las claves y los tokens se cifran con el llavero del sistema (Keychain o DPAPI) mediante `safeStorage` y nunca llegan al renderer.
2. **Ajustes → Transcripción:** descarga un modelo de Whisper. «Large v3 Turbo (Q5)», de unos 550 MB, es un buen equilibrio; «Base», de 142 MB, sirve para probar rápido.
3. Arrastra un archivo a la ventana o pulsa **Grabar**.

## Usar una cuenta de ChatGPT

En vez de una API key de OpenAI, los resúmenes pueden usar tu plan de ChatGPT Plus o Pro. El uso cuenta contra los límites del plan.

- Usa [«Sign in with ChatGPT»](https://developers.openai.com/siwc/token-sharing-open-source) con uso del plan: OAuth con PKCE en el navegador y redirección a `127.0.0.1`. Los tokens se refrescan solos. Desde los ajustes de ChatGPT puedes limitar cuánto usa NoteTaker.
- Este acceso está abierto a apps locales personales o de código abierto. Si NoteTaker pasara a ser un producto de pago, habría que solicitarlo a OpenAI.
- La cuenta solo cubre los resúmenes: la transcripción sigue siendo Whisper local o la API de OpenAI con API key.

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
                 context/store (estado global)                   accounts/       cuenta de ChatGPT (OAuth)
                                                                 library.ts      historial (una carpeta JSON por entrada)
    i18n/        es.json, en.json                                settings.ts     ajustes + API keys cifradas
                                                                 updater.ts      búsqueda de versiones (electron-updater)
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
- `chatgpt-auth.json`: cliente registrado y tokens de ChatGPT (cifrados). `chatgpt-host.json`: identificador de este equipo.
- `models/`: modelos GGML.
- `library/<id>/`: `meta.json`, `transcript.json`, `summaries.json` y `recording.webm`.

Borrar una entrada la mueve a la papelera del sistema.

## Empaquetado y distribución

- `electron-builder.cjs` incluye `whisper-cli` desde `resources/bin/<platform>-<arch>` y deja `ffmpeg-static` fuera del asar. En macOS genera un `.dmg` (el que descarga el usuario) y un `.zip` (el que necesita la actualización automática cuando la app esté firmada).
- `ffmpeg-static` descarga el binario de la plataforma donde se ejecuta `npm install`. Por eso el instalador de Windows se genera en Windows. El workflow `.github/workflows/release.yml` compila macOS y Windows en paralelo.
- **Firma y notarización no están configuradas.** En macOS, la primera vez abre la app con clic derecho → Abrir. En Windows, un certificado de firma de código evita el aviso de SmartScreen.
- El build de macOS es solo para **arm64** (Apple Silicon). Para Intel, ejecuta `npm run whisper:fetch -- --arch x64` y genera el paquete en una máquina x64, para que `ffmpeg-static` también sea x64.

## Publicar una versión y actualizaciones automáticas

### Cómo funciona

1. Al hacer push de un tag `vX.Y.Z`, el workflow `release` comprueba que coincide con la versión de `package.json` y compila macOS y Windows.
2. Cada job sube a `s3://<S3_BUCKET>/<S3_PREFIX>/`:
   - **Primero los instaladores** (`.dmg`, `.zip`, `.exe`, `.blockmap`), cacheables para siempre porque llevan la versión en el nombre.
   - **Al final el manifiesto** (`latest-mac.yml` o `latest.yml`), sin caché. Así ningún cliente ve una versión nueva antes de que sus instaladores estén subidos.
3. La app lee ese manifiesto en `UPDATE_BASE_URL` 10 s después de arrancar y luego cada 4 horas. Se desactiva en Ajustes → General → «Buscar actualizaciones automáticamente», y ahí mismo se puede buscar a mano.
   - **Windows:** descarga la versión nueva en segundo plano y la instala al pulsar «Reiniciar y actualizar» o al cerrar la app.
   - **macOS sin firma:** avisa y abre la descarga del `.dmg` en el navegador. La instalación automática exige que la app esté firmada con un Developer ID de Apple (ver más abajo).
4. Si existe `build/release-notes.md`, su contenido se publica en el manifiesto y la app lo muestra como «Novedades».

Los builds locales (`npm run dist:mac` sin `NOTETAKER_UPDATE_URL`) no incluyen feed: en ellos las actualizaciones aparecen como «no configuradas».

### Publicar

```bash
npm version minor        # 0.1.0 → 0.2.0: actualiza package.json y crea el tag v0.2.0
git push --follow-tags
```

### Configuración en GitHub

En Settings → Secrets and variables → Actions:

| Tipo     | Nombre            | Ejemplo                                                                                              |
| -------- | ----------------- | ---------------------------------------------------------------------------------------------------- |
| Variable | `UPDATE_BASE_URL` | `https://mi-bucket.s3.eu-west-1.amazonaws.com/notetaker` o `https://updates.midominio.com/notetaker` |
| Variable | `S3_BUCKET`       | `mi-bucket`                                                                                          |
| Variable | `S3_PREFIX`       | `notetaker`                                                                                          |
| Variable | `AWS_REGION`      | `eu-west-1`                                                                                          |
| Secret   | `AWS_ROLE_ARN`    | `arn:aws:iam::123456789012:role/notetaker-release`                                                   |

`UPDATE_BASE_URL` es la URL pública desde la que las apps leen el prefijo `S3_PREFIX`. Se compila dentro de la app, así que si la cambias, las versiones ya instaladas seguirán usando la anterior.

### Configuración en AWS (OIDC, sin claves guardadas)

1. **Proveedor de identidad OIDC** (una vez por cuenta). En IAM → Identity providers, añade uno de tipo OpenID Connect con URL `https://token.actions.githubusercontent.com` y audiencia `sts.amazonaws.com`.
2. **Rol `notetaker-release`.** Relación de confianza, limitada a los tags `v*` de tu repositorio:

   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Effect": "Allow",
         "Principal": {
           "Federated": "arn:aws:iam::<CUENTA>:oidc-provider/token.actions.githubusercontent.com"
         },
         "Action": "sts:AssumeRoleWithWebIdentity",
         "Condition": {
           "StringEquals": { "token.actions.githubusercontent.com:aud": "sts.amazonaws.com" },
           "StringLike": {
             "token.actions.githubusercontent.com:sub": "repo:<OWNER>/<REPO>:ref:refs/tags/v*"
           }
         }
       }
     ]
   }
   ```

   Permisos del rol (solo escribir en el prefijo):

   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Effect": "Allow",
         "Action": "s3:PutObject",
         "Resource": "arn:aws:s3:::<BUCKET>/<PREFIJO>/*"
       }
     ]
   }
   ```

3. **Lectura pública del prefijo.** Elige una de estas dos opciones:
   - **Bucket público solo en ese prefijo.** En el bucket, desactiva «Block public access» para las políticas del bucket y añade esta política:

     ```json
     {
       "Version": "2012-10-17",
       "Statement": [
         {
           "Effect": "Allow",
           "Principal": "*",
           "Action": "s3:GetObject",
           "Resource": "arn:aws:s3:::<BUCKET>/<PREFIJO>/*"
         }
       ]
     }
     ```

   - **CloudFront delante de un bucket privado (OAC).** Usa la URL de CloudFront como `UPDATE_BASE_URL`. El manifiesto ya se sube con `Cache-Control: no-cache`, así que CloudFront lo revalida en cada petición.

### Activar la instalación automática en macOS (cuando haya firma)

1. Añade a GitHub los secrets de firma y notarización:
   - `CSC_LINK`: el certificado Developer ID Application, en `.p12` y base64.
   - `CSC_KEY_PASSWORD`.
   - `APPLE_API_KEY`, `APPLE_API_KEY_ID` y `APPLE_API_ISSUER`.
2. En el paso «Build installers» del workflow, pásalos como variables de entorno, quita `CSC_IDENTITY_AUTO_DISCOVERY: false` y añade `NOTETAKER_MAC_AUTO_UPDATE: true`.
3. En `electron-builder.cjs`, pon `notarize: true`.

A partir de esa versión, la app de macOS también descargará el `.zip` e instalará sola. Las versiones sin firma que ya tengan los usuarios seguirán avisando y abriendo el `.dmg`.

### Probar en local

```bash
NOTETAKER_UPDATE_URL=http://127.0.0.1:8787/notetaker npm run dev
```

Sirve en esa URL un `latest-mac.yml` con una versión mayor que la de `package.json`. Con `NOTETAKER_UPDATE_URL` también se puede apuntar una app ya empaquetada a otro feed.

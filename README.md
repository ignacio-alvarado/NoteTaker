# NoteTaker

Desktop app (macOS and Windows) that **transcribes audio and video with Whisper** and **summarizes the transcript with Claude or OpenAI**.

- Import audio or video (MP3, WAV, M4A, FLAC, OGG, MP4, MOV, MKV, WEBM…) by dragging it in or from a file dialog, or record from the microphone.
- Transcribe with **local Whisper** ([whisper.cpp](https://github.com/ggml-org/whisper.cpp): free, private, offline, with Metal acceleration on Apple Silicon) or with the **OpenAI API** (`whisper-1` or other transcription models).
- Summarize with **Claude** (`claude-opus-5-5` by default) or **OpenAI** (`gpt-5.5` by default), using an API key or, for OpenAI, your **ChatGPT account (Plus/Pro)**. Built-in templates are included (executive summary, meeting minutes, key points, study notes) and you can create your own.
- Keeps a local history with several summary versions per recording.
- Exports the summary to `.md`/`.txt` and the transcript to `.txt`, `.srt` or `.vtt`.
- Interface in Spanish and English, with light, dark or system theme.

## Requirements

- Node.js 24+ and npm.
- **macOS:** Xcode Command Line Tools and `cmake` (`brew install cmake`). Both are needed to build whisper.cpp.
- **Windows:** nothing extra. The official whisper.cpp binaries are downloaded.

## Getting started

```bash
npm install
npm run whisper:fetch   # builds (macOS) or downloads (Windows) whisper-cli into resources/bin/
npm run dev
```

Then, in the app:

1. **Settings → Accounts & API keys:** paste your Anthropic and/or OpenAI key, or connect your ChatGPT account (see [Use a ChatGPT account](#use-a-chatgpt-account)). Keys and tokens are encrypted with the system keychain (Keychain or DPAPI) through `safeStorage` and never reach the renderer.
2. **Settings → Transcription:** download a Whisper model. "Large v3 Turbo (Q5)", about 550 MB, is a good balance; "Base", 142 MB, is enough for a quick test.
3. Drag a file onto the window or click **Record**.

## Use a ChatGPT account

Instead of an OpenAI API key, summaries can use your ChatGPT Plus or Pro plan. Usage counts toward the plan's limits.

- It uses ["Sign in with ChatGPT"](https://developers.openai.com/siwc/token-sharing-open-source) with plan usage: OAuth with PKCE in the browser and a redirect to `127.0.0.1`. Tokens refresh automatically. You can cap how much NoteTaker uses from your ChatGPT settings.
- This access is open to personal or open-source local apps. If NoteTaker became a paid product, it would have to be requested from OpenAI.
- The account only covers summaries: transcription still uses local Whisper or the OpenAI API with an API key.

## Scripts

| Script                                                 | What it does                                                                                           |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `npm run dev`                                          | App in development mode with hot reload                                                                |
| `npm test`                                             | Unit and integration tests (the Anthropic and OpenAI SDKs against a mock server)                       |
| `npm run typecheck` / `npm run lint`                   | Type checking and ESLint                                                                               |
| `npm run smoke -- <file> [--model base] [--summarize]` | Runs the real pipeline (ffmpeg → whisper-cli) outside Electron. `--summarize` uses `ANTHROPIC_API_KEY` |
| `npm run dist:mac`                                     | Builds `dist/NoteTaker-<version>-mac-arm64.dmg`                                                        |
| `npm run dist:win`                                     | Builds the Windows x64 NSIS installer (must be run on Windows)                                         |

To test with isolated data (settings, history and models separate from yours):

```bash
NOTETAKER_USER_DATA=/tmp/notetaker-test npm run dev
```

## Architecture

```
renderer (React 19 + Tailwind 4, sandboxed)  ──typed IPC──►  main (Node)
  src/renderer/src/                                             src/main/
    components/  Home, Recorder, EntryView,                       jobs.ts         pipeline queue and orchestration
                 SummaryPanel, TranscriptPanel,                   media/ffmpeg.ts conversion to 16 kHz WAV / chunked MP3
                 SettingsDialog, ModelManager…                    transcription/  local whisper.cpp, OpenAI, model manager
    lib/         api (Result → exceptions),                       summary/        Claude, OpenAI, templates and prompts
                 context/store (global state)                     accounts/       ChatGPT account (OAuth)
                                                                  library.ts      history (one JSON folder per entry)
    i18n/        es.json, en.json                                 settings.ts     settings + encrypted API keys
                                                                  updater.ts      update checks (electron-updater)
src/preload/index.ts  → exposes window.api (contextBridge)        export.ts       MD/TXT/SRT/VTT
src/shared/           → types, IPC channels, formats (SRT/VTT)
```

**Pipeline:** file or recording → ffmpeg → transcription → streamed summary.

- With the **local** engine, ffmpeg converts to 16 kHz mono WAV and `whisper-cli` transcribes it.
- With **OpenAI**, ffmpeg converts to 32 kbps MP3 in 10-minute chunks (to stay under the 25 MB per-request limit) and the timestamps are then realigned.

Claude summary details:

- Uses adaptive thinking and a configurable `effort` (`medium` by default).
- Enables `fallbacks: "default"`: if the model refuses the request, the server retries it with a fallback model.
- The transcript goes in the `system` prompt with `cache_control`, so regenerating with another template reuses the cache.

**Data** (in `userData`: `~/Library/Application Support/NoteTaker` on macOS, `%APPDATA%\NoteTaker` on Windows):

- `settings.json`
- `keys.json`: encrypted keys.
- `chatgpt-auth.json`: registered client and ChatGPT tokens (encrypted). `chatgpt-host.json`: this machine's identifier.
- `models/`: GGML models.
- `library/<id>/`: `meta.json`, `transcript.json`, `summaries.json` and `recording.webm`.

Deleting an entry moves it to the system trash.

## Packaging and distribution

- `electron-builder.cjs` bundles `whisper-cli` from `resources/bin/<platform>-<arch>` and keeps `ffmpeg-static` outside the asar. On macOS it builds a `.dmg` (what users download) and a `.zip` (what auto-update needs once the app is signed).
- `ffmpeg-static` downloads the binary for the platform where `npm install` runs. That's why the Windows installer is built on Windows. The `.github/workflows/release.yml` workflow builds macOS and Windows in parallel.
- **Code signing and notarization are not configured.** On macOS, open the app the first time with right-click → Open. On Windows, a code signing certificate avoids the SmartScreen warning.
- The macOS build is **arm64** only (Apple Silicon). For Intel, run `npm run whisper:fetch -- --arch x64` and build the package on an x64 machine, so that `ffmpeg-static` is x64 too.

## Releasing a version and auto-updates

### How it works

1. When a `vX.Y.Z` tag is pushed, the `release` workflow checks that it matches the version in `package.json` and builds macOS and Windows.
2. Each job uploads to `s3://<S3_BUCKET>/<S3_PREFIX>/`:
   - **The installers first** (`.dmg`, `.zip`, `.exe`, `.blockmap`), cacheable forever because the version is in the file name.
   - **The manifest last** (`latest-mac.yml` or `latest.yml`), with no caching. This way no client sees a new version before its installers are uploaded.
3. The app reads that manifest at `UPDATE_BASE_URL` 10 s after launch and then every 4 hours. It can be turned off in Settings → General → "Check for updates automatically", which is also where you can check manually.
   - **Windows:** downloads the new version in the background and installs it silently, without the installer wizard: when you click "Restart and update" (the app reopens on its own) or when you quit the app. If NoteTaker was installed for all users, Windows still asks for administrator permission (UAC). Versions 0.2.0 and earlier show the wizard one last time on their next update, because the installed version is what launches the installer.
   - **Unsigned macOS:** shows a notice and opens the `.dmg` download in the browser. Automatic installation requires the app to be signed with an Apple Developer ID (see below).
4. If `build/release-notes.md` exists, its content is published in the manifest and the app shows it as "What's new".
5. Once both builds succeed, the workflow creates the GitHub release for the tag with the `.dmg` and the `.exe` attached and auto-generated notes. If the release already exists (e.g. created by hand), it only uploads or replaces the installers.

Local builds (`npm run dist:mac` without `NOTETAKER_UPDATE_URL`) don't include a feed: updates show up as "not configured" in them.

### Publish

```bash
npm version minor        # 0.1.0 → 0.2.0: updates package.json and creates the v0.2.0 tag
git push --follow-tags
```

### GitHub configuration

In Settings → Secrets and variables → Actions:

| Type     | Name              | Example                                                                                              |
| -------- | ----------------- | ---------------------------------------------------------------------------------------------------- |
| Variable | `UPDATE_BASE_URL` | `https://my-bucket.s3.eu-west-1.amazonaws.com/notetaker` or `https://updates.mydomain.com/notetaker` |
| Variable | `S3_BUCKET`       | `my-bucket`                                                                                          |
| Variable | `S3_PREFIX`       | `notetaker`                                                                                          |
| Variable | `AWS_REGION`      | `eu-west-1`                                                                                          |
| Secret   | `AWS_ROLE_ARN`    | `arn:aws:iam::123456789012:role/notetaker-release`                                                   |

`UPDATE_BASE_URL` is the public URL from which the apps read the `S3_PREFIX` prefix. It is compiled into the app, so if you change it, already installed versions will keep using the old one.

### AWS configuration (OIDC, no stored keys)

1. **OIDC identity provider** (once per account). In IAM → Identity providers, add an OpenID Connect provider with URL `https://token.actions.githubusercontent.com` and audience `sts.amazonaws.com`.
2. **`notetaker-release` role.** Trust relationship, limited to the `v*` tags of your repository:

   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Effect": "Allow",
         "Principal": {
           "Federated": "arn:aws:iam::<ACCOUNT>:oidc-provider/token.actions.githubusercontent.com"
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

   Role permissions (write to the prefix only):

   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Effect": "Allow",
         "Action": "s3:PutObject",
         "Resource": "arn:aws:s3:::<BUCKET>/<PREFIX>/*"
       }
     ]
   }
   ```

3. **Public read access to the prefix.** Pick one of these two options:
   - **Bucket public on that prefix only.** On the bucket, turn off "Block public access" for bucket policies and add this policy:

     ```json
     {
       "Version": "2012-10-17",
       "Statement": [
         {
           "Effect": "Allow",
           "Principal": "*",
           "Action": "s3:GetObject",
           "Resource": "arn:aws:s3:::<BUCKET>/<PREFIX>/*"
         }
       ]
     }
     ```

   - **CloudFront in front of a private bucket (OAC).** Use the CloudFront URL as `UPDATE_BASE_URL`. The manifest is already uploaded with `Cache-Control: no-cache`, so CloudFront revalidates it on every request.

### Enabling automatic installation on macOS (once signing is set up)

1. Add the signing and notarization secrets to GitHub:
   - `CSC_LINK`: the Developer ID Application certificate, as a base64-encoded `.p12`.
   - `CSC_KEY_PASSWORD`.
   - `APPLE_API_KEY`, `APPLE_API_KEY_ID` and `APPLE_API_ISSUER`.
2. In the workflow's "Build installers" step, pass them as environment variables, remove `CSC_IDENTITY_AUTO_DISCOVERY: false` and add `NOTETAKER_MAC_AUTO_UPDATE: true`.
3. In `electron-builder.cjs`, set `notarize: true`.

From that version on, the macOS app will also download the `.zip` and install it on its own. Unsigned versions that users already have will keep showing a notice and opening the `.dmg`.

### Testing locally

```bash
NOTETAKER_UPDATE_URL=http://127.0.0.1:8787/notetaker npm run dev
```

Serve a `latest-mac.yml` at that URL with a version higher than the one in `package.json`. `NOTETAKER_UPDATE_URL` can also point an already packaged app at a different feed.

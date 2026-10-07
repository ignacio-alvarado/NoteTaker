# CLAUDE.md

NoteTaker is an Electron desktop app (macOS and Windows) that transcribes audio/video with Whisper and summarizes the transcript with Claude or OpenAI. See [README.md](README.md) for setup, architecture and the release process.

## Language

- **Everything that goes into the repository or GitHub is written in English:** commit messages, PR titles and descriptions, and all documentation (README.md, CLAUDE.md, any other docs). This applies even when the conversation happens in another language.
- Link the related issue in the PR description (e.g. `Closes #5`).
- The UI is bilingual: every user-facing string goes in both `src/renderer/src/i18n/en.json` and `src/renderer/src/i18n/es.json`.
- Code identifiers are in English. Existing code comments are in Spanish; match the surrounding code.

## Commands

```bash
npm run dev         # app in development mode
npm test            # vitest
npm run typecheck
npm run lint
npm run format      # prettier (single quotes, no semicolons, 100 columns)
```

Run `npm run typecheck`, `npm run lint` and `npm test` before committing.

## Branches and PRs

- Work on `feature/<name>` or `fix/<name>` branches created from `develop`, and open PRs against `develop`.
- `develop` is merged into `main` for releases; pushing a `vX.Y.Z` tag triggers the `release` workflow.

## Constraints

- API keys and account tokens live only in the main process (encrypted with `safeStorage`); never expose them to the renderer.
- Vite 7, TypeScript ~6.0 and ESLint 9 are pinned on purpose: electron-vite 5 only supports Vite ≤ 7, typescript-eslint 8 requires TypeScript < 6.1, and eslint-plugin-react doesn't support ESLint 10. Check those peer dependencies before bumping.
- Subscription login is only supported for ChatGPT. Claude is used with an API key only; don't add Claude account login.

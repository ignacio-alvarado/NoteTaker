import type { AppError, ErrorCode } from './types'

/** Error con código estable que viaja por IPC y el renderer traduce. */
export class AppErrorException extends Error {
  readonly code: ErrorCode
  readonly detail?: string

  constructor(code: ErrorCode, detail?: string) {
    super(detail ? `${code}: ${detail}` : code)
    this.name = 'AppErrorException'
    this.code = code
    this.detail = detail
  }

  toJSON(): AppError {
    return { code: this.code, detail: this.detail }
  }
}

export function isAbortError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  return err.name === 'AbortError' || err.name === 'APIUserAbortError'
}

export function toAppError(err: unknown): AppError {
  if (err instanceof AppErrorException) return err.toJSON()
  if (isAbortError(err)) return { code: 'CANCELLED' }
  const detail = err instanceof Error ? err.message : String(err)
  return { code: 'UNKNOWN', detail }
}

import type { PreloadApi } from '@shared/api'
import type { AppError, ErrorCode, Result } from '@shared/types'

/** Error lanzado en el renderer cuando una llamada IPC devuelve `{ ok: false }`. */
export class ApiError extends Error {
  readonly code: ErrorCode
  readonly detail?: string

  constructor(error: AppError) {
    super(error.detail ? `${error.code}: ${error.detail}` : error.code)
    this.code = error.code
    this.detail = error.detail
  }
}

type Unwrapped = {
  [K in keyof PreloadApi]: PreloadApi[K] extends (...args: infer A) => Promise<Result<infer T>>
    ? (...args: A) => Promise<T>
    : PreloadApi[K]
}

function isResult(value: unknown): value is Result<unknown> {
  return typeof value === 'object' && value !== null && 'ok' in value
}

/** `window.api` con los `Result` desenvueltos: las llamadas devuelven el dato o lanzan ApiError. */
export const api = new Proxy({} as Unwrapped, {
  get(_target, prop: keyof PreloadApi) {
    const value = window.api[prop]
    if (typeof value !== 'function') return value
    return (...args: unknown[]) => {
      const out = (value as (...a: unknown[]) => unknown)(...args)
      if (!(out instanceof Promise)) return out
      return out.then((res) => {
        if (!isResult(res)) return res
        if (res.ok) return res.data
        throw new ApiError(res.error)
      })
    }
  }
})

export function asAppError(err: unknown): AppError {
  if (err instanceof ApiError) return { code: err.code, detail: err.detail }
  return { code: 'UNKNOWN', detail: err instanceof Error ? err.message : String(err) }
}

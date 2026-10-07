import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import { AppErrorException } from '@shared/errors'

/** Traduce errores del SDK de Anthropic a códigos de la app (del más específico al más general). */
export function mapAnthropicError(err: unknown): AppErrorException {
  if (err instanceof AppErrorException) return err
  if (err instanceof Anthropic.APIUserAbortError) return new AppErrorException('CANCELLED')
  if (
    err instanceof Anthropic.AuthenticationError ||
    err instanceof Anthropic.PermissionDeniedError
  )
    return new AppErrorException('AUTH_FAILED', err.message)
  if (err instanceof Anthropic.RateLimitError)
    return new AppErrorException('RATE_LIMITED', err.message)
  if (err instanceof Anthropic.APIConnectionError)
    return new AppErrorException('NETWORK', err.message)
  if (err instanceof Anthropic.APIError) return new AppErrorException('API_ERROR', err.message)
  return new AppErrorException('UNKNOWN', err instanceof Error ? err.message : String(err))
}

/**
 * Errores del uso del plan de ChatGPT («Sign in with ChatGPT»). Pueden llegar en `error.code`,
 * en un evento `response.failed` o, antes de abrir el stream, como `{"detail": "..."}`.
 */
export function mapSubscriptionError(
  code: string | null | undefined,
  detail?: string
): AppErrorException | null {
  switch (code) {
    case 'subscription_sharing_usage_limit_exceeded':
      return new AppErrorException('USAGE_LIMIT', detail)
    case 'subscription_sharing_user_not_eligible':
      return new AppErrorException('ACCOUNT_NOT_ELIGIBLE', detail)
    case 'subscription_sharing_invalid_user':
      return new AppErrorException('ACCOUNT_SIGNED_OUT', detail)
    case 'subscription_sharing_usage_unavailable':
      return new AppErrorException('RATE_LIMITED', detail)
    case 'subscription_sharing_unsupported_capability':
    case 'subscription_sharing_route_not_supported':
      return new AppErrorException('API_ERROR', detail ?? code)
    default:
      return null
  }
}

const SUBSCRIPTION_CODE = /subscription_sharing_[a-z_]+/

export function mapOpenAIError(err: unknown): AppErrorException {
  if (err instanceof AppErrorException) return err
  if (err instanceof OpenAI.APIUserAbortError) return new AppErrorException('CANCELLED')
  if (err instanceof OpenAI.APIError) {
    const code =
      (typeof err.code === 'string' ? err.code : null) ?? SUBSCRIPTION_CODE.exec(err.message)?.[0]
    const mapped = mapSubscriptionError(code, err.message)
    if (mapped) return mapped
  }
  if (err instanceof OpenAI.AuthenticationError || err instanceof OpenAI.PermissionDeniedError)
    return new AppErrorException('AUTH_FAILED', err.message)
  if (err instanceof OpenAI.RateLimitError)
    return new AppErrorException('RATE_LIMITED', err.message)
  if (err instanceof OpenAI.APIConnectionError) return new AppErrorException('NETWORK', err.message)
  if (err instanceof OpenAI.APIError) return new AppErrorException('API_ERROR', err.message)
  return new AppErrorException('UNKNOWN', err instanceof Error ? err.message : String(err))
}

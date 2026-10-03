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

export function mapOpenAIError(err: unknown): AppErrorException {
  if (err instanceof AppErrorException) return err
  if (err instanceof OpenAI.APIUserAbortError) return new AppErrorException('CANCELLED')
  if (err instanceof OpenAI.AuthenticationError || err instanceof OpenAI.PermissionDeniedError)
    return new AppErrorException('AUTH_FAILED', err.message)
  if (err instanceof OpenAI.RateLimitError)
    return new AppErrorException('RATE_LIMITED', err.message)
  if (err instanceof OpenAI.APIConnectionError) return new AppErrorException('NETWORK', err.message)
  if (err instanceof OpenAI.APIError) return new AppErrorException('API_ERROR', err.message)
  return new AppErrorException('UNKNOWN', err instanceof Error ? err.message : String(err))
}

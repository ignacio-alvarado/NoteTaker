import Anthropic from '@anthropic-ai/sdk'
import { AppErrorException } from '@shared/errors'
import type { Effort } from '@shared/types'
import type { SummaryPrompt } from './templates'
import { mapAnthropicError } from './errors'

export const DEFAULT_ANTHROPIC_MODEL = 'claude-opus-5-5'

/** Modelos que aceptan `fallbacks: 'default'` (respaldo del lado del servidor ante un rechazo). */
const FALLBACK_MODELS = new Set([
  'claude-fable-5-1',
  'claude-opus-5-5',
  'claude-opus-5',
  'claude-sonnet-5-5'
])

/** Familias con thinking adaptativo y `effort` (Opus/Sonnet 4.6+, Fable, Mythos). */
function supportsAdaptive(model: string): boolean {
  return /^claude-(opus|sonnet)-(4-[6-9]|[5-9])|^claude-(fable|mythos)-/.test(model)
}

function effortFor(model: string, effort: Effort): Effort {
  // `xhigh` llegó con Opus 4.7; los 4.6 solo llegan a `high`/`max`.
  if (effort === 'xhigh' && /-4-6$/.test(model)) return 'high'
  return effort
}

export interface AnthropicSummaryOptions {
  apiKey: string
  model: string
  effort: Effort
  prompt: SummaryPrompt
  signal?: AbortSignal
  onDelta: (text: string) => void
}

export async function summarizeWithAnthropic(opts: AnthropicSummaryOptions): Promise<string> {
  const client = new Anthropic({ apiKey: opts.apiKey, maxRetries: 3 })
  const adaptive = supportsAdaptive(opts.model)
  const withFallbacks = FALLBACK_MODELS.has(opts.model)

  try {
    const stream = client.beta.messages.stream(
      {
        model: opts.model,
        max_tokens: adaptive ? 64000 : 16000,
        // La transcripción va en `system` con cache_control: regenerar con otra plantilla reutiliza la caché.
        system: [{ type: 'text', text: opts.prompt.system, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: opts.prompt.user }],
        ...(adaptive
          ? {
              thinking: { type: 'adaptive' as const },
              output_config: { effort: effortFor(opts.model, opts.effort) }
            }
          : {}),
        ...(withFallbacks
          ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const }
          : {})
      },
      { signal: opts.signal }
    )
    stream.on('text', (delta) => opts.onDelta(delta))
    const message = await stream.finalMessage()

    const text = message.content
      .map((block) => (block.type === 'text' ? block.text : ''))
      .join('')
      .trim()

    if (message.stop_reason === 'refusal') {
      throw new AppErrorException('REFUSAL', message.stop_details?.explanation ?? undefined)
    }
    if (!text && message.stop_reason === 'max_tokens') {
      throw new AppErrorException('OUTPUT_TRUNCATED')
    }
    return text
  } catch (err) {
    throw mapAnthropicError(err)
  }
}

export async function listAnthropicModels(apiKey: string): Promise<string[]> {
  const client = new Anthropic({ apiKey })
  const ids: string[] = []
  try {
    for await (const model of client.models.list({ limit: 100 })) ids.push(model.id)
  } catch (err) {
    throw mapAnthropicError(err)
  }
  return ids
}

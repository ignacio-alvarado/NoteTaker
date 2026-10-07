import OpenAI from 'openai'
import { AppErrorException } from '@shared/errors'
import type { SummaryPrompt } from './templates'
import { mapOpenAIError, mapSubscriptionError } from './errors'

export const DEFAULT_OPENAI_SUMMARY_MODEL = 'gpt-5.5'
export const DEFAULT_OPENAI_TRANSCRIPTION_MODEL = 'whisper-1'

export interface OpenAISummaryOptions {
  /** API key, o el access token de la cuenta de ChatGPT. */
  apiKey: string
  model: string
  /** Uso del plan de ChatGPT: exige `store: false` (y streaming, que ya se usa). */
  account?: boolean
  prompt: SummaryPrompt
  signal?: AbortSignal
  onDelta: (text: string) => void
}

export async function summarizeWithOpenAI(opts: OpenAISummaryOptions): Promise<string> {
  const client = new OpenAI({ apiKey: opts.apiKey, maxRetries: 3 })
  try {
    const stream = client.responses.stream(
      {
        model: opts.model,
        instructions: opts.prompt.system,
        // En forma de lista: el uso del plan de ChatGPT rechaza `input` como texto suelto
        // ("Input must be a list"); la API normal acepta las dos formas.
        input: [{ role: 'user', content: opts.prompt.user }],
        ...(opts.account ? { store: false } : {})
      },
      { signal: opts.signal }
    )
    let streamed = ''
    stream.on('response.output_text.delta', (event) => {
      streamed += event.delta
      opts.onDelta(event.delta)
    })
    const response = await stream.finalResponse()
    if (response.status === 'failed') {
      throw (
        mapSubscriptionError(response.error?.code, response.error?.message) ??
        new AppErrorException('API_ERROR', response.error?.message ?? 'failed')
      )
    }
    // Con `store: false` (cuenta de ChatGPT) el `response.completed` puede llegar sin `output`:
    // el texto es el que llegó por streaming.
    const text = (response.output_text || streamed).trim()
    if (!text)
      throw new AppErrorException('API_ERROR', response.incomplete_details?.reason ?? 'empty')
    return text
  } catch (err) {
    throw mapOpenAIError(err)
  }
}

const NON_TEXT_MODEL =
  /audio|realtime|tts|transcribe|whisper|image|search|embedding|moderation|dall-e|codex|computer|instruct/

/** Modelos de texto (para resumir) o de transcripción, según `purpose`. */
export async function listOpenAIModels(
  apiKey: string,
  purpose: 'summary' | 'transcription'
): Promise<string[]> {
  const client = new OpenAI({ apiKey })
  const ids: string[] = []
  try {
    for await (const model of client.models.list()) ids.push(model.id)
  } catch (err) {
    throw mapOpenAIError(err)
  }
  const filtered =
    purpose === 'transcription'
      ? ids.filter((id) => /whisper|transcribe/.test(id) && !/realtime|diarize/.test(id))
      : ids.filter((id) => /^(gpt-|o\d)/.test(id) && !NON_TEXT_MODEL.test(id))
  return filtered.sort().reverse()
}

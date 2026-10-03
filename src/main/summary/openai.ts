import OpenAI from 'openai'
import { AppErrorException } from '@shared/errors'
import type { SummaryPrompt } from './templates'
import { mapOpenAIError } from './errors'

export const DEFAULT_OPENAI_SUMMARY_MODEL = 'gpt-5.5'
export const DEFAULT_OPENAI_TRANSCRIPTION_MODEL = 'whisper-1'

export interface OpenAISummaryOptions {
  apiKey: string
  model: string
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
        input: opts.prompt.user
      },
      { signal: opts.signal }
    )
    stream.on('response.output_text.delta', (event) => opts.onDelta(event.delta))
    const response = await stream.finalResponse()
    const text = response.output_text.trim()
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

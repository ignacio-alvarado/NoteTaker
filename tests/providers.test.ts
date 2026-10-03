/**
 * Integración con los SDK de Anthropic y OpenAI contra un servidor HTTP local simulado:
 * verifica la forma de las peticiones y el parseo del streaming sin gastar créditos.
 */
import { createServer, type IncomingMessage, type Server } from 'http'
import { mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import type { AddressInfo } from 'net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { summarizeWithAnthropic } from '../src/main/summary/anthropic'
import { summarizeWithOpenAI } from '../src/main/summary/openai'
import { transcribeOpenAI } from '../src/main/transcription/openai-whisper'
import { AppErrorException } from '../src/shared/errors'

interface Captured {
  method?: string
  url?: string
  headers: IncomingMessage['headers']
  body: string
}

let server: Server
let captured: Captured[] = []
let respond: (req: IncomingMessage, res: import('http').ServerResponse, body: string) => void
let workDir: string

function sse(events: Array<{ event?: string; data: unknown }>): string {
  return events
    .map((e) => `${e.event ? `event: ${e.event}\n` : ''}data: ${JSON.stringify(e.data)}\n\n`)
    .join('')
}

beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8')
      captured.push({ method: req.method, url: req.url, headers: req.headers, body })
      respond(req, res, body)
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const { port } = server.address() as AddressInfo
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${port}`
  process.env.OPENAI_BASE_URL = `http://127.0.0.1:${port}/v1`
  workDir = await mkdtemp(join(tmpdir(), 'notetaker-test-'))
})

afterAll(async () => {
  server.close()
  delete process.env.ANTHROPIC_BASE_URL
  delete process.env.OPENAI_BASE_URL
  await rm(workDir, { recursive: true, force: true })
})

const prompt = { system: 'SYSTEM with <transcript>', user: 'Summarize please' }

describe('summarizeWithAnthropic', () => {
  it('streams text and sends adaptive thinking, effort, fallbacks and cached system', async () => {
    captured = []
    respond = (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.end(
        sse([
          {
            event: 'message_start',
            data: {
              type: 'message_start',
              message: {
                id: 'msg_1',
                type: 'message',
                role: 'assistant',
                model: 'claude-opus-5-5',
                content: [],
                stop_reason: null,
                stop_sequence: null,
                usage: { input_tokens: 10, output_tokens: 0 }
              }
            }
          },
          {
            event: 'content_block_start',
            data: {
              type: 'content_block_start',
              index: 0,
              content_block: { type: 'text', text: '' }
            }
          },
          {
            event: 'content_block_delta',
            data: {
              type: 'content_block_delta',
              index: 0,
              delta: { type: 'text_delta', text: '## Resumen\n' }
            }
          },
          {
            event: 'content_block_delta',
            data: {
              type: 'content_block_delta',
              index: 0,
              delta: { type: 'text_delta', text: '- Punto' }
            }
          },
          { event: 'content_block_stop', data: { type: 'content_block_stop', index: 0 } },
          {
            event: 'message_delta',
            data: {
              type: 'message_delta',
              delta: { stop_reason: 'end_turn', stop_sequence: null },
              usage: { output_tokens: 5 }
            }
          },
          { event: 'message_stop', data: { type: 'message_stop' } }
        ])
      )
    }

    const deltas: string[] = []
    const text = await summarizeWithAnthropic({
      apiKey: 'test-key',
      model: 'claude-opus-5-5',
      effort: 'medium',
      prompt,
      onDelta: (d) => deltas.push(d)
    })

    expect(text).toBe('## Resumen\n- Punto')
    expect(deltas.join('')).toBe(text)

    const req = captured[0]
    expect(req.url).toContain('/v1/messages')
    expect(String(req.headers['anthropic-beta'])).toContain('server-side-fallback-2026-07-01')
    const body = JSON.parse(req.body)
    expect(body).toMatchObject({
      model: 'claude-opus-5-5',
      max_tokens: 64000,
      stream: true,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'medium' },
      fallbacks: 'default',
      system: [{ type: 'text', text: prompt.system, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: prompt.user }]
    })
    expect(body.betas).toBeUndefined()
  })

  it('omits thinking/effort/fallbacks for older models', async () => {
    captured = []
    respond = (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.end(
        sse([
          {
            event: 'message_start',
            data: {
              type: 'message_start',
              message: {
                id: 'msg_2',
                type: 'message',
                role: 'assistant',
                model: 'claude-haiku-4-5',
                content: [],
                stop_reason: null,
                stop_sequence: null,
                usage: { input_tokens: 1, output_tokens: 0 }
              }
            }
          },
          {
            event: 'content_block_start',
            data: {
              type: 'content_block_start',
              index: 0,
              content_block: { type: 'text', text: '' }
            }
          },
          {
            event: 'content_block_delta',
            data: {
              type: 'content_block_delta',
              index: 0,
              delta: { type: 'text_delta', text: 'ok' }
            }
          },
          { event: 'content_block_stop', data: { type: 'content_block_stop', index: 0 } },
          {
            event: 'message_delta',
            data: {
              type: 'message_delta',
              delta: { stop_reason: 'end_turn', stop_sequence: null },
              usage: { output_tokens: 1 }
            }
          },
          { event: 'message_stop', data: { type: 'message_stop' } }
        ])
      )
    }
    await summarizeWithAnthropic({
      apiKey: 'test-key',
      model: 'claude-haiku-4-5',
      effort: 'high',
      prompt,
      onDelta: () => {}
    })
    const body = JSON.parse(captured[0].body)
    expect(body.thinking).toBeUndefined()
    expect(body.output_config).toBeUndefined()
    expect(body.fallbacks).toBeUndefined()
    expect(captured[0].headers['anthropic-beta']).toBeUndefined()
  })

  it('maps 401 to AUTH_FAILED', async () => {
    respond = (_req, res) => {
      res.writeHead(401, { 'content-type': 'application/json' })
      res.end(
        JSON.stringify({
          type: 'error',
          error: { type: 'authentication_error', message: 'invalid x-api-key' }
        })
      )
    }
    await expect(
      summarizeWithAnthropic({
        apiKey: 'bad',
        model: 'claude-opus-5-5',
        effort: 'low',
        prompt,
        onDelta: () => {}
      })
    ).rejects.toMatchObject({ code: 'AUTH_FAILED' })
  })

  it('maps a refusal stop reason to REFUSAL', async () => {
    respond = (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.end(
        sse([
          {
            event: 'message_start',
            data: {
              type: 'message_start',
              message: {
                id: 'msg_3',
                type: 'message',
                role: 'assistant',
                model: 'claude-opus-5-5',
                content: [],
                stop_reason: null,
                stop_sequence: null,
                usage: { input_tokens: 1, output_tokens: 0 }
              }
            }
          },
          {
            event: 'message_delta',
            data: {
              type: 'message_delta',
              delta: { stop_reason: 'refusal', stop_sequence: null },
              usage: { output_tokens: 0 }
            }
          },
          { event: 'message_stop', data: { type: 'message_stop' } }
        ])
      )
    }
    const err = await summarizeWithAnthropic({
      apiKey: 'test-key',
      model: 'claude-opus-5-5',
      effort: 'low',
      prompt,
      onDelta: () => {}
    }).catch((e) => e)
    expect(err).toBeInstanceOf(AppErrorException)
    expect(err.code).toBe('REFUSAL')
  })
})

describe('summarizeWithOpenAI', () => {
  it('streams output_text deltas from the Responses API', async () => {
    captured = []
    const message = {
      id: 'msg_1',
      type: 'message',
      role: 'assistant',
      status: 'completed',
      content: [{ type: 'output_text', text: 'Hola mundo', annotations: [] }]
    }
    const base = {
      id: 'resp_1',
      object: 'response',
      created_at: 1,
      model: 'gpt-5.5',
      status: 'in_progress',
      output: [],
      instructions: prompt.system,
      incomplete_details: null,
      error: null,
      tools: [],
      tool_choice: 'auto',
      parallel_tool_calls: true,
      temperature: 1,
      top_p: 1,
      metadata: {}
    }
    respond = (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.end(
        sse([
          {
            event: 'response.created',
            data: { type: 'response.created', sequence_number: 0, response: base }
          },
          {
            event: 'response.output_item.added',
            data: {
              type: 'response.output_item.added',
              sequence_number: 1,
              output_index: 0,
              item: { ...message, status: 'in_progress', content: [] }
            }
          },
          {
            event: 'response.content_part.added',
            data: {
              type: 'response.content_part.added',
              sequence_number: 2,
              item_id: 'msg_1',
              output_index: 0,
              content_index: 0,
              part: { type: 'output_text', text: '', annotations: [] }
            }
          },
          {
            event: 'response.output_text.delta',
            data: {
              type: 'response.output_text.delta',
              sequence_number: 3,
              item_id: 'msg_1',
              output_index: 0,
              content_index: 0,
              delta: 'Hola ',
              logprobs: []
            }
          },
          {
            event: 'response.output_text.delta',
            data: {
              type: 'response.output_text.delta',
              sequence_number: 4,
              item_id: 'msg_1',
              output_index: 0,
              content_index: 0,
              delta: 'mundo',
              logprobs: []
            }
          },
          {
            event: 'response.completed',
            data: {
              type: 'response.completed',
              sequence_number: 5,
              response: { ...base, status: 'completed', output: [message] }
            }
          }
        ])
      )
    }
    const deltas: string[] = []
    const text = await summarizeWithOpenAI({
      apiKey: 'test-key',
      model: 'gpt-5.5',
      prompt,
      onDelta: (d) => deltas.push(d)
    })
    expect(text).toBe('Hola mundo')
    expect(deltas).toEqual(['Hola ', 'mundo'])
    expect(captured[0].url).toBe('/v1/responses')
    expect(JSON.parse(captured[0].body)).toMatchObject({
      model: 'gpt-5.5',
      instructions: prompt.system,
      input: prompt.user,
      stream: true
    })
  })
})

describe('transcribeOpenAI', () => {
  it('uploads each chunk and shifts segments by the chunk offset', async () => {
    captured = []
    const a = join(workDir, 'chunk-000.mp3')
    const b = join(workDir, 'chunk-001.mp3')
    await writeFile(a, 'fake-mp3-a')
    await writeFile(b, 'fake-mp3-b')
    let call = 0
    respond = (_req, res) => {
      call++
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(
        JSON.stringify({
          task: 'transcribe',
          language: 'spanish',
          duration: 600,
          text: `parte ${call}`,
          segments: [
            {
              id: 0,
              seek: 0,
              start: 1,
              end: 3,
              text: ` parte ${call}`,
              tokens: [],
              temperature: 0,
              avg_logprob: 0,
              compression_ratio: 1,
              no_speech_prob: 0
            }
          ]
        })
      )
    }
    const progress: number[] = []
    const transcript = await transcribeOpenAI({
      apiKey: 'test-key',
      model: 'whisper-1',
      chunks: [
        { file: a, offsetSec: 0 },
        { file: b, offsetSec: 600 }
      ],
      durationSec: 1200,
      language: 'es',
      onProgress: (f) => progress.push(f)
    })
    expect(captured).toHaveLength(2)
    expect(captured[0].url).toBe('/v1/audio/transcriptions')
    expect(String(captured[0].headers['content-type'])).toContain('multipart/form-data')
    expect(captured[0].body).toContain('name="model"\r\n\r\nwhisper-1')
    expect(captured[0].body).toContain('name="response_format"\r\n\r\nverbose_json')
    expect(captured[0].body).toContain('name="language"\r\n\r\nes')
    expect(captured[0].body).toContain('fake-mp3-a')
    expect(transcript.language).toBe('es')
    expect(transcript.segments).toEqual([
      { start: 1, end: 3, text: 'parte 1' },
      { start: 601, end: 603, text: 'parte 2' }
    ])
    expect(progress).toEqual([0.5, 1])
  })
})

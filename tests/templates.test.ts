import { describe, expect, it } from 'vitest'
import { buildSummaryPrompt, builtinTemplates, findTemplate } from '../src/main/summary/templates'

const segments = [{ start: 65, end: 70, text: 'Acordamos lanzar en marzo.' }]

describe('builtin templates', () => {
  it('provide name and prompt in both UI languages', () => {
    const es = builtinTemplates('es')
    const en = builtinTemplates('en')
    expect(es.map((t) => t.id)).toEqual(en.map((t) => t.id))
    for (const [i, tpl] of es.entries()) {
      expect(tpl.name).not.toBe(en[i].name)
      expect(tpl.prompt).not.toBe(en[i].prompt)
    }
    expect(findTemplate('meeting', 'es', [])!.prompt).toContain(
      'Tarea | Responsable | Fecha límite'
    )
    expect(findTemplate('meeting', 'en', [])!.prompt).toContain('Task | Owner | Due date')
  })
})

describe('buildSummaryPrompt', () => {
  it('writes the whole prompt in Spanish when the UI is Spanish', () => {
    const template = findTemplate('meeting', 'es', [])!
    const prompt = buildSummaryPrompt({
      segments,
      template,
      outputLanguage: 'auto',
      transcriptLanguage: 'es',
      lang: 'es'
    })
    expect(prompt.system).toContain('reconocimiento automático de voz')
    expect(prompt.system).toContain(
      '<transcript>\n[01:05] Acordamos lanzar en marzo.\n</transcript>'
    )
    expect(prompt.user).toContain('**Tareas**')
    expect(prompt.user).toContain('Escribe el resumen en español, el idioma de la transcripción.')
    expect(prompt.user).toContain('Da formato a la respuesta en Markdown')
  })

  it('writes the whole prompt in English when the UI is English', () => {
    const template = findTemplate('meeting', 'en', [])!
    const prompt = buildSummaryPrompt({
      segments,
      template,
      outputLanguage: 'auto',
      transcriptLanguage: 'es',
      lang: 'en'
    })
    expect(prompt.system).toContain('automatic speech recognition')
    expect(prompt.user).toContain('Action items')
    expect(prompt.user).toContain('Write the summary in Spanish, the language of the transcript.')
  })

  it('honours an explicit output language and custom templates', () => {
    const custom = [{ id: 'c1', name: 'Tweet', prompt: 'Resúmelo en un tuit.', builtin: false }]
    const template = findTemplate('c1', 'es', custom)!
    const prompt = buildSummaryPrompt({
      segments,
      template,
      outputLanguage: 'en',
      transcriptLanguage: 'es',
      lang: 'es'
    })
    expect(prompt.user.startsWith('Resúmelo en un tuit.')).toBe(true)
    expect(prompt.user).toContain('Escribe el resumen en inglés.')
  })

  it('falls back to "same language" when the transcript language is unknown', () => {
    const template = findTemplate('key-points', 'en', [])!
    const prompt = buildSummaryPrompt({
      segments,
      template,
      outputLanguage: 'auto',
      transcriptLanguage: null,
      lang: 'en'
    })
    expect(prompt.user).toContain('Write the summary in the same language as the transcript.')
  })
})

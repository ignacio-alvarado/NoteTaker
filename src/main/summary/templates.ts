import { formatClock } from '@shared/format'
import type { OutputLanguage, Segment, SummaryTemplate, UiLanguage } from '@shared/types'

interface BuiltinTemplate {
  id: string
  name: Record<UiLanguage, string>
  prompt: Record<UiLanguage, string>
}

/** Plantillas incluidas; nombre e instrucciones siguen el idioma de la interfaz. */
const BUILTIN_TEMPLATES: BuiltinTemplate[] = [
  {
    id: 'executive',
    name: { es: 'Resumen ejecutivo', en: 'Executive summary' },
    prompt: {
      es: `Escribe un resumen ejecutivo de la grabación.
- Empieza con una visión general de 2–3 frases: de qué trata y por qué es relevante.
- Después, una sección «Puntos clave» con las ideas, decisiones, cifras y conclusiones más importantes en viñetas.
- Termina con «Próximos pasos» si se mencionaron seguimientos, preguntas abiertas o riesgos; si no, omite esa sección.
Sé conciso y concreto; prioriza los datos específicos (nombres, cifras, fechas) sobre las generalidades.`,
      en: `Write an executive summary of the recording.
- Start with a 2–3 sentence overview of what it is about and why it matters.
- Then a "Key points" section with the most important ideas, decisions, figures and conclusions as bullets.
- End with "Next steps" if any follow-ups, open questions or risks were mentioned; omit the section otherwise.
Be concise and concrete; prefer specifics (names, numbers, dates) over generalities.`
    }
  },
  {
    id: 'meeting',
    name: { es: 'Minuta de reunión', en: 'Meeting minutes' },
    prompt: {
      es: `Redacta la minuta de la reunión con estas secciones:
1. **Participantes** — personas que hablaron o que se mencionan como asistentes (solo si se pueden identificar; si no, omite la sección).
2. **Temas tratados** — un párrafo breve o unas pocas viñetas por tema.
3. **Decisiones** — todas las decisiones que se tomaron.
4. **Tareas** — una tabla Markdown con las columnas: Tarea | Responsable | Fecha límite. Usa «—» cuando no se indicó el responsable o la fecha. Nunca inventes responsables ni fechas.
5. **Preguntas abiertas** — temas sin resolver, si los hay.
Incluye marcas de tiempo como [12:34] junto a las decisiones y tareas cuando la transcripción lo deje claro.`,
      en: `Write meeting minutes from the recording with these sections:
1. **Participants** — people who spoke or were mentioned as attending (only if identifiable; otherwise omit).
2. **Agenda / topics discussed** — one short paragraph or a few bullets per topic.
3. **Decisions** — every decision that was made.
4. **Action items** — a Markdown table with columns: Task | Owner | Due date. Use "—" when the owner or date was not stated. Never invent owners or dates.
5. **Open questions** — unresolved issues, if any.
Include timestamps like [12:34] next to decisions and action items when the transcript makes them clear.`
    }
  },
  {
    id: 'key-points',
    name: { es: 'Puntos clave', en: 'Key points' },
    prompt: {
      es: `Enumera los puntos clave de la grabación en una lista de viñetas concisa y bien organizada, agrupada por temas bajo encabezados breves. Cada viñeta debe ser una idea única y autocontenida. Incluye las cifras, nombres, fechas o citas importantes.`,
      en: `List the key points of the recording as a concise, well-organized bullet list grouped under short headings by topic. Each bullet should be a single, self-contained idea. Include any important numbers, names, dates or quotes.`
    }
  },
  {
    id: 'study',
    name: { es: 'Notas de estudio', en: 'Study notes' },
    prompt: {
      es: `Convierte la grabación en apuntes de estudio, como si fuera una clase o conferencia:
- **Tema principal** y una breve introducción.
- **Conceptos clave**: cada concepto con una explicación clara y los ejemplos que se dieron.
- **Definiciones** de los términos importantes.
- **Resumen** en pocas frases.
- **Preguntas de repaso**: 3–5 preguntas para comprobar la comprensión.`,
      en: `Turn the recording into study notes, as if it were a lecture or class:
- **Main topic** and a short overview.
- **Core concepts**: each concept with a clear explanation and any examples given.
- **Definitions** of important terms.
- **Summary** in a few sentences.
- **Review questions**: 3–5 questions to check understanding.`
    }
  }
]

export const DEFAULT_TEMPLATE_ID = 'executive'

export function builtinTemplates(lang: UiLanguage): SummaryTemplate[] {
  return BUILTIN_TEMPLATES.map((t) => ({
    id: t.id,
    name: t.name[lang],
    prompt: t.prompt[lang],
    builtin: true
  }))
}

export function allTemplates(lang: UiLanguage, custom: SummaryTemplate[]): SummaryTemplate[] {
  return [...builtinTemplates(lang), ...custom.map((t) => ({ ...t, builtin: false }))]
}

export function findTemplate(
  id: string,
  lang: UiLanguage,
  custom: SummaryTemplate[]
): SummaryTemplate | undefined {
  return allTemplates(lang, custom).find((t) => t.id === id)
}

/** Nombre de cada idioma escrito en el idioma del prompt. */
const LANGUAGE_LABELS: Record<UiLanguage, Record<string, string>> = {
  es: { es: 'español', en: 'inglés', pt: 'portugués', fr: 'francés', de: 'alemán', it: 'italiano' },
  en: { es: 'Spanish', en: 'English', pt: 'Portuguese', fr: 'French', de: 'German', it: 'Italian' }
}

/** Texto fijo que envuelve la plantilla, en cada idioma de prompt. */
const PROMPT_TEXT: Record<
  UiLanguage,
  {
    intro: string
    languageOf: (label: string) => string
    sameLanguage: string
    languageIs: (label: string) => string
    format: string
  }
> = {
  es: {
    intro: `Eres un experto tomando notas que convierte grabaciones en resúmenes escritos claros y precisos.

La transcripción siguiente se generó con reconocimiento automático de voz, así que puede tener palabras mal reconocidas, puntuación incompleta y no indica quién habla. Deduce el sentido por el contexto, pero no inventes hechos, nombres, cifras ni compromisos que la transcripción no respalde. Si algo importante no está claro, dilo brevemente.`,
    languageOf: (label) => `Escribe el resumen en ${label}, el idioma de la transcripción.`,
    sameLanguage: 'Escribe el resumen en el mismo idioma que la transcripción.',
    languageIs: (label) => `Escribe el resumen en ${label}.`,
    format:
      'Da formato a la respuesta en Markdown. Empieza directamente con el contenido: sin introducción ni comentarios finales.'
  },
  en: {
    intro: `You are an expert note-taker who turns recordings into clear, accurate written summaries.

The transcript below was produced by automatic speech recognition, so it may contain misheard words, missing punctuation and no speaker labels. Infer the intended meaning from context, but do not invent facts, names, numbers or commitments that are not supported by the transcript. If something important is unclear, say so briefly.`,
    languageOf: (label) => `Write the summary in ${label}, the language of the transcript.`,
    sameLanguage: 'Write the summary in the same language as the transcript.',
    languageIs: (label) => `Write the summary in ${label}.`,
    format:
      'Format the answer in Markdown. Start directly with the content: no preamble and no closing remarks.'
  }
}

/** Transcripción con marcas [mm:ss] para que el modelo pueda citar momentos. */
export function transcriptForPrompt(segments: Segment[]): string {
  return segments.map((seg) => `[${formatClock(seg.start)}] ${seg.text.trim()}`).join('\n')
}

export interface SummaryPrompt {
  /** Estable entre plantillas → se puede cachear. */
  system: string
  /** Instrucciones de la plantilla + idioma de salida. */
  user: string
}

export function buildSummaryPrompt(opts: {
  segments: Segment[]
  template: SummaryTemplate
  outputLanguage: OutputLanguage
  transcriptLanguage: string | null
  /** Idioma en que se escriben las instrucciones (el de la interfaz). */
  lang: UiLanguage
}): SummaryPrompt {
  const text = PROMPT_TEXT[opts.lang]
  const labels = LANGUAGE_LABELS[opts.lang]

  const system = `${text.intro}

<transcript>
${transcriptForPrompt(opts.segments)}
</transcript>`

  let languageRule: string
  if (opts.outputLanguage === 'auto') {
    const label = opts.transcriptLanguage ? labels[opts.transcriptLanguage] : undefined
    languageRule = label ? text.languageOf(label) : text.sameLanguage
  } else {
    languageRule = text.languageIs(labels[opts.outputLanguage])
  }

  const user = `${opts.template.prompt.trim()}

${languageRule} ${text.format}`

  return { system, user }
}

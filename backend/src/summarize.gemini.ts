import { GoogleGenAI } from '@google/genai'
import type { Section, SummarizeInput, Summarizer, SummaryJson } from './summarize.js'

const MODEL = process.env.SUMMARIZER_MODEL ?? 'gemini-3.5-flash-lite'
// hard ceiling per call — Gemini flash-lite normally answers in ~1s, but the
// free tier 503s under load and the SDK would otherwise retry for a long time.
// On timeout the session keeps its current section and retries next cycle.
const CALL_TIMEOUT_MS = 12_000

const SYSTEM = `You take live study notes while a minister teaches (expository preaching).
You are called repeatedly with a rolling window of the most recent transcript.

Return, for THIS window only:
- section.heading + section.bullets: the point being made RIGHT NOW. Bullets must
  be tight and specific to the current argument, not a summary of the whole
  message.
- section.newSection: true only when the speaker has clearly moved to a new point
  compared with the "current section" you are given.
- title: the sermon title only if the speaker names it aloud ("I've called this
  message...", a title read out). Otherwise an empty string.
- illustrations: any personal story/anecdote in this window, each 1-2 sentences,
  including what it was illustrating. Empty array if none.
- references: every scripture reference mentioned, verbatim as spoken. Empty
  array if none.

Do not invent content. If the window is thin, give a brief heading and one bullet.`

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    section: {
      type: 'object',
      properties: {
        heading: { type: 'string' },
        bullets: { type: 'array', items: { type: 'string' }, maxItems: 4 },
        newSection: { type: 'boolean' },
      },
      required: ['heading', 'bullets', 'newSection'],
      propertyOrdering: ['heading', 'bullets', 'newSection'],
    },
    illustrations: { type: 'array', items: { type: 'string' } },
    references: { type: 'array', items: { type: 'string' } },
  },
  required: ['title', 'section', 'illustrations', 'references'],
  propertyOrdering: ['title', 'section', 'illustrations', 'references'],
} as const

interface RawSummary {
  title?: unknown
  section?: { heading?: unknown; bullets?: unknown; newSection?: unknown }
  illustrations?: unknown
  references?: unknown
}

const strArr = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '') : []

export function createGeminiSummarizer(): Summarizer {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })

  return {
    async run(input: SummarizeInput): Promise<SummaryJson> {
      const ctx = input.currentSection
        ? `Current section:\nheading: ${input.currentSection.heading}\nbullets:\n${input.currentSection.bullets
            .map((b) => `- ${b}`)
            .join('\n')}`
        : 'Current section: (none yet — this is the start)'

      const res = await Promise.race([
        ai.models.generateContent({
          model: MODEL,
          contents: `${ctx}\n\n--- recent transcript ---\n${input.transcript}`,
          config: {
            systemInstruction: SYSTEM,
            responseMimeType: 'application/json',
            responseJsonSchema: RESPONSE_SCHEMA,
            temperature: 0.2,
            maxOutputTokens: 2000,
          },
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`gemini call exceeded ${CALL_TIMEOUT_MS}ms`)), CALL_TIMEOUT_MS),
        ),
      ])

      let raw: RawSummary
      try {
        raw = JSON.parse(res.text ?? '') as RawSummary
      } catch {
        throw new Error('gemini summarizer returned no parseable JSON')
      }
      if (!raw.section || typeof raw.section.heading !== 'string') {
        throw new Error('gemini summarizer output missing section.heading')
      }

      const section: Section = {
        heading: raw.section.heading.trim() || 'Teaching',
        bullets: strArr(raw.section.bullets).map((b) => b.trim()).slice(0, 4),
        newSection: raw.section.newSection === true,
      }
      if (section.bullets.length === 0) section.bullets = ['(continuing)']

      const out: SummaryJson = { section, references: strArr(raw.references) }
      const title = typeof raw.title === 'string' ? raw.title.trim() : ''
      if (title) out.title = title
      const illustrations = strArr(raw.illustrations)
      if (illustrations.length) out.illustrations = illustrations
      return out
    },
  }
}

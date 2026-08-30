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
- section.heading + section.bullets: the point being made RIGHT NOW. Each bullet
  is at most 12 words, one idea, no sub-clauses — it has to fit one line on a
  heads-up display. Specific to the current argument, not the whole message.
  When the speaker numbers or names a point ("point one", "first", "secondly"),
  use the SUBSTANCE of that point as the heading in the speaker's own words
  (e.g. "Confess your sin of pride"), never the bare label ("point one").
  Material before the first point is one section headed "Introduction".
- section.newSection: keep this FALSE and keep the SAME heading for as long as the
  speaker is still developing one point — stories, sub-examples, side comments and
  tangents all belong to the current point. Set it TRUE only on an explicit move:
  a new numbered/named point, "secondly", "that brings me to", "moving on". A new
  Bible story alone is NOT a new section.
- title: the overall subject of the whole message, set ONCE. Take it from a named
  title ("I've called this message...") OR from the speaker stating what today's
  message is about ("today, how to fix our pride problem"). Otherwise "".
- illustrations: a story/anecdote/example, each 1-2 sentences, including what it
  illustrates. Only the FIRST time it appears — if the current section already
  covers it, return []. Empty array if none.
- applications: specific things the speaker told listeners to DO (a practice, a
  commitment, a change), first appearance only. Empty array if none.
- prayerRequests: people, needs, or situations named for prayer. Empty array if none.
- references: ONLY passages the speaker actually cites in this window — by name,
  or by chapter and verse. Format as "Book Chapter:Verse" (e.g. "2 Samuel 24:10").
  If they give only chapter and verse ("chapter 24, verse 10", "chapter 12 number
  13"), use the book of the passage under discussion. NEVER add a verse just
  because it is on the same theme or comes to mind. Empty array if none.

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
    applications: { type: 'array', items: { type: 'string' } },
    prayerRequests: { type: 'array', items: { type: 'string' } },
    references: { type: 'array', items: { type: 'string' } },
  },
  required: ['title', 'section', 'illustrations', 'applications', 'prayerRequests', 'references'],
  propertyOrdering: [
    'title',
    'section',
    'illustrations',
    'applications',
    'prayerRequests',
    'references',
  ],
} as const

interface RawSummary {
  title?: unknown
  section?: { heading?: unknown; bullets?: unknown; newSection?: unknown }
  illustrations?: unknown
  applications?: unknown
  prayerRequests?: unknown
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
      const applications = strArr(raw.applications)
      if (applications.length) out.applications = applications
      const prayerRequests = strArr(raw.prayerRequests)
      if (prayerRequests.length) out.prayerRequests = prayerRequests
      return out
    },
  }
}

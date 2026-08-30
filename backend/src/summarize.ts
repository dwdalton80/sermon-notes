import { createClaudeSummarizer } from './summarize.claude.js'
import { createGeminiSummarizer } from './summarize.gemini.js'

/** Incremental summarizer abstraction. Each call digests the recent transcript
 *  and returns the *current point* being made plus any story it heard and the
 *  scripture references. The session turns a run of these into a live "you are
 *  here" view and an accumulating outline for the notes. Stage 3b adds the
 *  Claude-backed implementation. */

export interface Section {
  /** short label for the point being made right now */
  heading: string
  /** up to 4 bullets summarizing the current point (~last 2 minutes) */
  bullets: string[]
  /** true when this is a different point than the previous call */
  newSection: boolean
}

export interface SummaryJson {
  /** the sermon's stated title, if the speaker named one (else omitted) */
  title?: string
  section: Section
  /** personal stories / illustrations, each summarized in 1–2 sentences with
   *  the point it makes */
  illustrations?: string[]
  /** specific things the speaker told listeners to do this week */
  applications?: string[]
  /** needs, people, or situations mentioned for prayer */
  prayerRequests?: string[]
  /** raw reference strings the model spotted, e.g. "Acts 2:38" */
  references: string[]
}

export interface SummarizeInput {
  transcript: string
  /** the section the session is currently tracking, for continuity */
  currentSection: Section | null
}

export interface Summarizer {
  run(input: SummarizeInput): Promise<SummaryJson>
}

/** Coerce/validate an untrusted JSON string into a SummaryJson, or null. */
export function parseSummaryJson(raw: string): SummaryJson | null {
  let obj: unknown
  try {
    obj = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof obj !== 'object' || obj === null) return null
  const o = obj as Record<string, unknown>

  const sec = o['section']
  if (typeof sec !== 'object' || sec === null) return null
  const s = sec as Record<string, unknown>
  if (typeof s['heading'] !== 'string' || !s['heading'].trim()) return null
  if (!Array.isArray(s['bullets'])) return null

  const strArr = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '') : []

  const out: SummaryJson = {
    section: {
      heading: s['heading'].trim(),
      bullets: strArr(s['bullets']).slice(0, 4),
      newSection: s['newSection'] === true,
    },
    references: strArr(o['references']),
  }
  if (out.section.bullets.length === 0) return null
  if (typeof o['title'] === 'string' && o['title'].trim()) out.title = o['title'].trim()
  const illustrations = strArr(o['illustrations'])
  if (illustrations.length) out.illustrations = illustrations
  const applications = strArr(o['applications'])
  if (applications.length) out.applications = applications
  const prayerRequests = strArr(o['prayerRequests'])
  if (prayerRequests.length) out.prayerRequests = prayerRequests
  return out
}

/** Deterministic mock: returns scripted outputs in order; repeats the last one
 *  if called more times than there are scripts. A script entry of `null`
 *  simulates a failure. */
export function createMockSummarizer(scripts: Array<SummaryJson | null>): Summarizer {
  let i = 0
  return {
    async run() {
      const script = scripts[Math.min(i, scripts.length - 1)]
      i++
      if (script === null || script === undefined) throw new Error('mock summarizer failure')
      return script
    },
  }
}

export function createSummarizer(mockScripts: Array<SummaryJson | null>): Summarizer {
  switch (process.env.SUMMARIZER_PROVIDER) {
    case 'claude':
      if (!process.env.ANTHROPIC_API_KEY) {
        throw new Error('SUMMARIZER_PROVIDER=claude but ANTHROPIC_API_KEY is not set')
      }
      return createClaudeSummarizer()
    case 'gemini':
      if (!process.env.GEMINI_API_KEY) {
        throw new Error('SUMMARIZER_PROVIDER=gemini but GEMINI_API_KEY is not set')
      }
      return createGeminiSummarizer()
    default:
      return createMockSummarizer(mockScripts)
  }
}

/** Incremental summarizer abstraction. Given a rolling transcript window and
 *  the previous summary, it returns an updated topic + up to three bullets and
 *  the scripture references it heard (as raw strings — the scripture engine
 *  normalizes and resolves them). Stage 3 adds a Claude-backed implementation. */

export interface SummaryJson {
  topic: string
  bullets: string[]
  /** raw reference strings the model spotted, e.g. "Acts 2:38", "first Corinthians thirteen" */
  references: string[]
}

export interface SummarizeInput {
  transcript: string
  previous: SummaryJson | null
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
  if (typeof o['topic'] !== 'string') return null
  if (!Array.isArray(o['bullets'])) return null
  const bullets = o['bullets'].filter((b): b is string => typeof b === 'string').slice(0, 3)
  if (bullets.length === 0) return null
  const references = Array.isArray(o['references'])
    ? o['references'].filter((r): r is string => typeof r === 'string')
    : []
  return { topic: o['topic'].trim(), bullets, references }
}

/** Deterministic mock: returns scripted outputs in order; repeats the last one
 *  if called more times than there are scripts. Throwing is simulated with a
 *  script entry of `null`. */
export function createMockSummarizer(scripts: Array<SummaryJson | null>): Summarizer {
  let i = 0
  return {
    async run() {
      const script = scripts[Math.min(i, scripts.length - 1)]
      i++
      if (script === null || script === undefined) {
        throw new Error('mock summarizer failure')
      }
      return script
    },
  }
}

export function createSummarizer(mockScripts: Array<SummaryJson | null>): Summarizer {
  // Stage 3: if (process.env.SUMMARIZER_PROVIDER === 'claude') return createClaudeSummarizer()
  return createMockSummarizer(mockScripts)
}

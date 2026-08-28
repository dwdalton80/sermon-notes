import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { z } from 'zod'
import type { Section, SummarizeInput, Summarizer, SummaryJson } from './summarize.js'

// Model is env-overridable — opus-5 is the default; a live sermon fires this
// every ~25s, so cost-sensitive deployments may prefer claude-haiku-4-5 or
// claude-sonnet-5.
const MODEL = process.env.SUMMARIZER_MODEL ?? 'claude-opus-5'

const SummarySchema = z.object({
  title: z
    .string()
    .nullable()
    .describe('The sermon\'s stated title if the speaker named one aloud; otherwise null.'),
  section: z.object({
    heading: z.string().describe('A short label for the point being made right now (max ~6 words).'),
    bullets: z
      .array(z.string())
      .max(4)
      .describe('Up to 4 concise bullets summarizing the CURRENT point (roughly the last 2 minutes).'),
    newSection: z
      .boolean()
      .describe('true if the speaker has moved to a different point than the one shown in the context.'),
  }),
  illustrations: z
    .array(z.string())
    .describe(
      'Personal stories or anecdotes the speaker told, each summarized in 1-2 sentences WITH the point it illustrates. Empty array if none in this window.',
    ),
  references: z
    .array(z.string())
    .describe(
      'Every scripture reference spoken in this window, as heard (e.g. "Acts 2:38", "first Corinthians thirteen"). Empty array if none.',
    ),
})

const SYSTEM = `You take live study notes while a minister teaches (expository preaching).
You are called repeatedly with a rolling window of the most recent transcript.

Return, for THIS window only:
- section.heading + section.bullets: the point being made RIGHT NOW. Each bullet
  is at most 12 words, one idea, no sub-clauses — it has to fit one line on a
  heads-up display. Specific to the current argument, not the whole message.
- section.newSection: true only when the speaker has clearly moved on to a new
  point compared with the "current section" you are given.
- title: only if the speaker actually names the sermon ("I've called this
  message...", a title read aloud). Otherwise null.
- illustrations: any personal story/anecdote in this window, each 1-2 sentences,
  including what it was illustrating.
- references: every scripture reference mentioned, verbatim as spoken.

Do not invent content. If the window is thin, give a brief heading and one bullet.`

export function createClaudeSummarizer(): Summarizer {
  const client = new Anthropic() // reads ANTHROPIC_API_KEY

  return {
    async run(input: SummarizeInput): Promise<SummaryJson> {
      const ctx = input.currentSection
        ? `Current section:\nheading: ${input.currentSection.heading}\nbullets:\n${input.currentSection.bullets
            .map((b) => `- ${b}`)
            .join('\n')}`
        : 'Current section: (none yet — this is the start)'

      const res = await client.messages.parse({
        model: MODEL,
        max_tokens: 2000,
        system: SYSTEM,
        messages: [
          {
            role: 'user',
            content: `${ctx}\n\n--- recent transcript ---\n${input.transcript}`,
          },
        ],
        output_config: { effort: 'low', format: zodOutputFormat(SummarySchema) },
      })

      const parsed = res.parsed_output
      if (!parsed) throw new Error('summarizer returned no parseable output')

      const section: Section = {
        heading: parsed.section.heading.trim() || 'Teaching',
        bullets: parsed.section.bullets.map((b) => b.trim()).filter(Boolean).slice(0, 4),
        newSection: parsed.section.newSection === true,
      }
      if (section.bullets.length === 0) section.bullets = ['(continuing)']

      const out: SummaryJson = {
        section,
        references: parsed.references.map((r) => r.trim()).filter(Boolean),
      }
      const title = parsed.title?.trim()
      if (title) out.title = title
      const illustrations = parsed.illustrations.map((i) => i.trim()).filter(Boolean)
      if (illustrations.length) out.illustrations = illustrations
      return out
    },
  }
}

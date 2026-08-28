import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import type { SummaryJson } from './summarize.js'

export interface Fixture {
  segments: string[]
  summaries: SummaryJson[]
}

/** Load a `.jsonl` fixture of interleaved `{seg}` and `{summary}` lines. */
export function loadFixture(name: string): Fixture {
  const path = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', `${name}.jsonl`)
  const segments: string[] = []
  const summaries: SummaryJson[] = []
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const row = JSON.parse(trimmed) as { seg?: string; summary?: SummaryJson }
    if (typeof row.seg === 'string') segments.push(row.seg)
    else if (row.summary) summaries.push(row.summary)
  }
  return { segments, summaries }
}

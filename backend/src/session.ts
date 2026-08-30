import { parseReferences, osisId } from './scripture/parse.js'
import { resolve, isResolveError } from './scripture/resolve.js'
import type { ServerEvent } from './events.js'
import type { SttStream } from './stt.js'
import type { Section, Summarizer, SummaryJson } from './summarize.js'

export interface SessionConfig {
  /** summarize at least this often (ms of wall clock) */
  summarizeEveryMs: number
  /** ...or once this many new transcript chars have arrived */
  summarizeEveryChars: number
  /** transcript tail sent to the summarizer (~4 chars per token) */
  rollingWindowChars: number
  /** cap verse events emitted in a single summarize cycle */
  maxVersesPerCycle: number
}

export const DEFAULT_CONFIG: SessionConfig = {
  summarizeEveryMs: 25_000,
  summarizeEveryChars: 400,
  rollingWindowChars: 16_000,
  maxVersesPerCycle: 3,
}

export interface SessionDeps {
  stt: SttStream
  summarizer: Summarizer
  now?: () => number
  config?: Partial<SessionConfig>
}

export class Session {
  readonly sessionId: string
  private readonly stt: SttStream
  private readonly summarizer: Summarizer
  private readonly now: () => number
  private readonly cfg: SessionConfig

  private transcript = ''
  private charsSinceSummary = 0
  private parsedUpto = 0
  private lastSummarizeAt = 0
  private summarizing = false
  private finishing = false // finish() called: stop new audio + mid-stream summaries
  private finished = false // finalize complete: stop accepting transcript

  private sermonTitle: string | null = null
  private currentSection: Section | null = null
  private readonly outline: Section[] = [] // finished sections
  private lastEmitted: { heading: string; bullets: string } | null = null
  private readonly illustrations: string[] = []
  private readonly applications: string[] = []
  private readonly prayerRequests: string[] = []
  private readonly seenOsis = new Set<string>()
  private readonly verseCache: Array<Extract<ServerEvent, { type: 'verse' }>> = []
  private lastSummaryEvent: Extract<ServerEvent, { type: 'summary' }> | null = null

  private readonly listeners: Array<(e: ServerEvent) => void> = []

  constructor(sessionId: string, deps: SessionDeps) {
    this.sessionId = sessionId
    this.stt = deps.stt
    this.summarizer = deps.summarizer
    this.now = deps.now ?? Date.now
    this.cfg = { ...DEFAULT_CONFIG, ...deps.config }
    this.lastSummarizeAt = this.now()

    this.stt.onTranscript((seg) => {
      if (!seg.isFinal || this.finished) return
      this.appendTranscript(seg.text)
      void this.maybeSummarize()
    })
    this.stt.onStatus((s) => {
      if (s === 'error') this.emit({ type: 'status', state: 'stt_down' })
    })
  }

  onEvent(cb: (e: ServerEvent) => void): void {
    this.listeners.push(cb)
  }

  pushPcm(frame: Uint8Array): void {
    if (this.finishing || this.finished) return
    this.stt.pushPcm(frame)
  }

  /** Append a marker after a reconnect so gaps are visible in the notes. */
  markGap(): void {
    if (this.transcript && !this.transcript.endsWith('[gap] ')) this.transcript += ' [gap] '
  }

  /** Events a reconnecting client needs to redraw: last summary, then cached verses. */
  replayState(): ServerEvent[] {
    const out: ServerEvent[] = []
    if (this.lastSummaryEvent) out.push(this.lastSummaryEvent)
    if (this.verseCache.length) out.push(this.verseCache[this.verseCache.length - 1]!)
    return out
  }

  get transcriptText(): string {
    return this.transcript
  }

  get verses(): ReadonlyArray<Extract<ServerEvent, { type: 'verse' }>> {
    return this.verseCache
  }

  async finish(): Promise<void> {
    if (this.finishing || this.finished) return
    this.finishing = true
    this.emit({ type: 'status', state: 'saving' })

    // flush STT and wait for trailing results before the final pass; the
    // transcript handler keeps appending during this window (finished still false)
    try {
      await this.stt.finalize()
    } catch {
      /* ignore */
    }
    this.finished = true

    console.log(`[session] finishing — transcript ${this.transcript.length} chars`)
    if (this.transcript) console.log(`[session] transcript: ${this.transcript}`)

    try {
      const s = await this.summarizer.run({
        transcript: this.windowTail(),
        currentSection: this.currentSection,
      })
      this.applySummary(s)
      await this.ingestReferences(s.references, this.transcript)
    } catch (err) {
      console.error('[session] final summarize failed:', err instanceof Error ? err.message : err)
      // still resolve any references straight from the transcript
      await this.ingestReferences([], this.transcript)
    }
    this.emit({ type: 'notes', markdown: this.buildNotes() })
    this.emit({ type: 'status', state: 'ended' })
    this.stt.close()
  }

  // ---- internals -----------------------------------------------------------

  private emit(e: ServerEvent): void {
    for (const cb of this.listeners) cb(e)
  }

  private appendTranscript(text: string): void {
    const t = text.trim()
    if (!t) return
    this.transcript += (this.transcript ? ' ' : '') + t
    this.charsSinceSummary += t.length + 1
  }

  private windowTail(): string {
    return this.transcript.length > this.cfg.rollingWindowChars
      ? this.transcript.slice(-this.cfg.rollingWindowChars)
      : this.transcript
  }

  private dueForSummary(): boolean {
    return (
      this.charsSinceSummary >= this.cfg.summarizeEveryChars ||
      this.now() - this.lastSummarizeAt >= this.cfg.summarizeEveryMs
    )
  }

  private async maybeSummarize(): Promise<void> {
    if (this.summarizing || this.finishing || this.finished || !this.transcript) return
    if (!this.dueForSummary()) return

    this.summarizing = true
    this.lastSummarizeAt = this.now()
    this.charsSinceSummary = 0

    try {
      const s = await this.summarizer.run({
        transcript: this.windowTail(),
        currentSection: this.currentSection,
      })
      this.applySummary(s)

      const delta = this.transcript.slice(this.parsedUpto)
      this.parsedUpto = this.transcript.length
      await this.ingestReferences(s.references, delta)
    } catch (err) {
      console.error('[session] summarize failed:', err instanceof Error ? err.message : err)
      this.emit({ type: 'status', state: 'summarizer_down' })
    } finally {
      this.summarizing = false
    }

    // a burst of transcript may have crossed the threshold again
    if (this.dueForSummary()) void this.maybeSummarize()
  }

  /** Fold one summarizer result into session state and emit a `summary` event
   *  only when the live view (heading or bullets) has materially changed. */
  private applySummary(s: SummaryJson): void {
    if (s.title && !this.sermonTitle) this.sermonTitle = s.title
    this.mergeList(this.illustrations, s.illustrations)
    this.mergeList(this.applications, s.applications)
    this.mergeList(this.prayerRequests, s.prayerRequests)

    if (s.section.newSection && this.currentSection) {
      this.outline.push(this.currentSection)
    }
    this.currentSection = {
      heading: s.section.heading,
      bullets: s.section.bullets.slice(0, 4),
      newSection: false,
    }

    const bulletsKey = this.currentSection.bullets
      .map((b) => b.toLowerCase().replace(/\s+/g, ' ').trim())
      .join(' | ')
    if (
      this.lastEmitted &&
      this.lastEmitted.heading === this.currentSection.heading &&
      this.lastEmitted.bullets === bulletsKey
    ) {
      return // nothing worth redrawing
    }
    this.lastEmitted = { heading: this.currentSection.heading, bullets: bulletsKey }

    const ev: Extract<ServerEvent, { type: 'summary' }> = {
      type: 'summary',
      topic: this.currentSection.heading,
      bullets: this.currentSection.bullets,
      ...(this.sermonTitle ? { title: this.sermonTitle } : {}),
    }
    this.lastSummaryEvent = ev
    this.emit(ev)
  }

  /** Parse references from the summarizer's ref strings and from `deltaText`,
   *  resolve any not seen before, and emit `verse` events (capped per cycle). */
  private async ingestReferences(refStrings: string[], deltaText: string): Promise<void> {
    const candidates = [
      ...refStrings.flatMap((r) => parseReferences(r)),
      ...parseReferences(deltaText),
    ]
    let emitted = 0
    for (const ref of candidates) {
      // whole-chapter mentions ("Acts chapter 2") are topic markers, not verse
      // takeovers — skip them; specific verses still come through.
      if (ref.startVerse == null) continue
      const id = osisId(ref)
      if (this.seenOsis.has(id)) continue
      this.seenOsis.add(id)
      const r = resolve(ref)
      if (isResolveError(r)) continue
      const ev: Extract<ServerEvent, { type: 'verse' }> = {
        type: 'verse',
        ref: r.ref,
        translation: 'KJV',
        text: r.text,
        truncated: r.truncated,
      }
      this.verseCache.push(ev)
      this.emit(ev)
      if (++emitted >= this.cfg.maxVersesPerCycle) break
    }
  }

  /** Accumulate free-text items across cycles, skipping near-duplicates. */
  private mergeList(target: string[], items: string[] | undefined): void {
    if (!items) return
    const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, '').slice(0, 40)
    for (const item of items) {
      const t = item.trim()
      if (!t) continue
      if (target.some((e) => key(e) === key(t))) continue
      target.push(t)
    }
  }

  private buildNotes(): string {
    const lines: string[] = []
    const sections = [...this.outline]
    if (this.currentSection) sections.push(this.currentSection)

    const title = this.sermonTitle?.trim()
    lines.push(`# ${title || 'Study notes'}`, '')

    for (const sec of sections) {
      // skip a redundant "## heading" when it just repeats an untitled doc's
      // single section
      if (!title && sections.length === 1) {
        lines[0] = `# ${sec.heading}`
      } else {
        lines.push(`## ${sec.heading}`, '')
      }
      for (const b of sec.bullets) lines.push(`- ${b}`)
      lines.push('')
    }

    if (this.illustrations.length) {
      lines.push('## Illustrations & stories', '')
      for (const i of this.illustrations) lines.push(`- ${i}`)
      lines.push('')
    }

    if (this.applications.length) {
      lines.push('## This week', '')
      for (const a of this.applications) lines.push(`- ${a}`)
      lines.push('')
    }

    if (this.prayerRequests.length) {
      lines.push('## Prayer', '')
      for (const p of this.prayerRequests) lines.push(`- ${p}`)
      lines.push('')
    }

    if (this.verseCache.length) {
      lines.push('## Scripture references', '')
      for (const v of this.verseCache) {
        lines.push(`**${v.ref}** (${v.translation})`, '', `> ${v.text}`, '')
      }
    }

    if (this.transcript.includes('[gap]')) {
      lines.push('_Note: audio gaps occurred during this session (marked [gap] in the transcript)._', '')
    }
    return lines.join('\n').trimEnd() + '\n'
  }
}

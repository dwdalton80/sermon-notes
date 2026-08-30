import { parseReferences, osisId, type ParseContext } from './scripture/parse.js'
import { BOOK_NAMES } from './scripture/books.js'
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
  // carries the last-named book across summarize cycles so a later bare
  // "chapter 24 verse 10" still resolves
  private readonly parseCtx: ParseContext = {}
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
    this.mergeList(this.illustrations, s.illustrations, 6)
    this.mergeList(this.applications, s.applications, 5)
    this.mergeList(this.prayerRequests, s.prayerRequests, 6)

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

  /** Numbers (digits or number-words, 1..176) actually spoken in the whole
   *  transcript — used to sanity-check references the summarizer proposes. */
  private transcriptNumbers(): Set<number> {
    const s = this.transcript.toLowerCase()
    const out = new Set<number>()
    for (const m of s.matchAll(/\d{1,3}/g)) {
      const n = Number(m[0])
      if (n >= 1 && n <= 176) out.add(n)
    }
    const W: Record<string, number> = {
      one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
      ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
      sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
      twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
    }
    const toks = s.split(/[^a-z]+/)
    for (let i = 0; i < toks.length; i++) {
      const a = W[toks[i]!]
      if (a == null) continue
      const b = W[toks[i + 1]!]
      if (a >= 20 && a % 10 === 0 && b != null && b < 10) {
        out.add(a + b)
        i++
      } else out.add(a)
    }
    return out
  }

  /** A summarizer-proposed reference is trusted only if the passage's book was
   *  named in the transcript, or both its chapter and verse numbers were spoken.
   *  Blocks thematically-associated verses the model sometimes volunteers. */
  private corroborated(ref: ReturnType<typeof parseReferences>[number], nums: Set<number>): boolean {
    const word = (BOOK_NAMES[ref.book] ?? '').replace(/^\d+\s+/, '').toLowerCase()
    if (word && this.transcript.toLowerCase().includes(word)) return true
    return nums.has(ref.startChapter) && (ref.startVerse == null || nums.has(ref.startVerse))
  }

  /** Parse references from the summarizer's ref strings and from `deltaText`,
   *  resolve any not seen before, and emit `verse` events (capped per cycle). */
  private async ingestReferences(refStrings: string[], deltaText: string): Promise<void> {
    // explicit refs from the summarizer first — they seed the book context that
    // a bare "chapter 24 verse 10" later in deltaText resolves against
    const nums = this.transcriptNumbers()
    const fromSummary = refStrings
      .flatMap((r) => parseReferences(r, this.parseCtx))
      .filter((r) => this.corroborated(r, nums))
    for (const r of fromSummary) if (r.book) this.parseCtx.lastRef = r
    const candidates = [...fromSummary, ...parseReferences(deltaText, this.parseCtx)]
    for (const r of candidates) if (r.book) this.parseCtx.lastRef = r

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

  /** Accumulate free-text items across cycles, skipping near-duplicates. The
   *  summarizer re-phrases the same story/point across windows, so two items
   *  collapse when they normalize to the same string, when they retell an event
   *  about the same named people, when the shorter one's content words are
   *  almost all inside the longer (an elaboration), or when a long shared core
   *  survives a reword. Filler words are dropped first so "forgive someone this
   *  week" and "serve someone this week" stay distinct. `cap` bounds the list —
   *  a blunt backstop for when the model keeps rewording past what the fuzzy
   *  match catches. */
  private mergeList(target: string[], items: string[] | undefined, cap = Infinity): void {
    if (!items) return
    const STOP = new Set([
      'this', 'that', 'with', 'your', 'from', 'then', 'they', 'them', 'will', 'have',
      'been', 'what', 'when', 'were', 'would', 'could', 'should', 'about', 'into',
      'than', 'week', 'their', 'there', 'these', 'those', 'also', 'just',
    ])
    // capitalized words that aren't names — sentence starters, deity, generic
    // scripture terms — so the "same named people" test keys on David/Nathan/Gad
    const NAME_STOP = new Set(
      'The This That These Those Then There They Them Their When Where While With What Who Whom Why How After Before Because But And For Nor Yet So His Her Him She He We You Now Also Here Then However Therefore Thus God Lord Jesus Christ Spirit Holy Father Son Bible Scripture Scriptures Gospel Word Testament Psalm Psalms Today Sunday'.split(
        ' ',
      ),
    )
    const norm = (s: string) =>
      s
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim()
    const tokens = (s: string) =>
      new Set(
        norm(s)
          .split(' ')
          .filter((w) => w.length >= 4 && !STOP.has(w)),
      )
    const names = (s: string) =>
      new Set((s.match(/\b[A-Z][a-z]{2,}\b/g) ?? []).filter((w) => !NAME_STOP.has(w)))
    const near = (a: string, b: string): boolean => {
      if (norm(a) === norm(b)) return true
      // same event retold: both name >= 2 of the same people and one name-set
      // sits inside the other (Bathsheba added, say)
      const na = names(a)
      const nb = names(b)
      const nsmall = Math.min(na.size, nb.size)
      if (nsmall >= 2) {
        let ni = 0
        for (const w of na) if (nb.has(w)) ni++
        if (ni === nsmall) return true
      }
      const ta = tokens(a)
      const tb = tokens(b)
      const small = Math.min(ta.size, tb.size)
      if (small === 0) return false
      let inter = 0
      for (const w of ta) if (tb.has(w)) inter++
      const containment = inter / small
      // the shorter item lives almost entirely inside the longer one...
      if (containment >= 0.85) return true
      // ...or both are long and share a big reworded core
      return inter >= 5 && containment >= 0.7
    }
    for (const item of items) {
      const t = item.trim()
      if (!t) continue
      if (target.some((e) => near(e, t))) continue
      if (target.length >= cap) continue
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

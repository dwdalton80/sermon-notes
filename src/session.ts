import { GlassesPage } from './glasses/page.js'
import { MENU, VERSE_PAGE_CHARS } from './glasses/layout.js'
import { paginate } from './paginate.js'
import type { ServerEvent } from './events.js'

export type Phase = 'idle' | 'starting' | 'listening' | 'verse' | 'paused' | 'stopping' | 'saved'

export interface ControllerDeps {
  page: GlassesPage
  /** ask the transport to send {type:'finish'} to the backend */
  requestFinish: () => void
  /** audio capture should follow this (true = paused) */
  onPauseChange?: (paused: boolean) => void
  verseHoldMs?: number
  versePageMs?: number
}

interface QueuedVerse {
  ref: string
  pages: string[]
}

const MAX_QUEUE = 3

export class SessionController {
  phase: Phase = 'idle'

  private readonly page: GlassesPage
  private readonly requestFinish: () => void
  private readonly onPauseChange?: (paused: boolean) => void
  private readonly verseHoldMs: number
  private readonly versePageMs: number

  private title: string | null = null
  private topic = 'Listening...'
  private bullets: string[] = []

  private readonly queue: QueuedVerse[] = []
  private lastVerse: QueuedVerse | null = null
  private seenVerses = 0
  private timers: ReturnType<typeof setTimeout>[] = []

  private notesMarkdown: string | null = null

  constructor(deps: ControllerDeps) {
    this.page = deps.page
    this.requestFinish = deps.requestFinish
    this.onPauseChange = deps.onPauseChange
    this.verseHoldMs = deps.verseHoldMs ?? 8000
    this.versePageMs = deps.versePageMs ?? 4000
  }

  get notes(): string | null {
    return this.notesMarkdown
  }

  private headline(): string {
    // the topic line follows the current point (section heading); the sermon
    // title lives in the notes and the phone panel, not the lens
    return this.topic || this.title || 'Listening...'
  }

  private clearTimers(): void {
    for (const t of this.timers) clearTimeout(t)
    this.timers = []
  }

  private after(ms: number, fn: () => void): void {
    this.timers.push(setTimeout(fn, ms))
  }

  async start(): Promise<void> {
    this.phase = 'starting'
    await this.page.create()
    await this.page.showBullets('Listening...', [])
    this.phase = 'listening'
  }

  /** Rebuild the page and restore the current view after a suspension. */
  async resume(): Promise<void> {
    await this.page.recreate()
    if (this.phase === 'verse') this.phase = 'listening'
    await this.renderBullets()
  }

  handleServerEvent(ev: ServerEvent): void {
    switch (ev.type) {
      case 'summary':
        this.title = ev.title ?? this.title
        this.topic = ev.topic
        this.bullets = ev.bullets.slice(0, 3)
        if (this.phase === 'listening') void this.renderBullets()
        else if (this.phase === 'paused') void this.page.setTopic('Paused')
        break

      case 'verse':
        this.enqueueVerse(ev.ref, ev.text)
        if (this.phase === 'listening') this.playNext()
        break

      case 'status':
        if (ev.state === 'saving') {
          this.phase = 'stopping'
          this.clearTimers()
          void this.page.setTopic('Saving...')
        } else if (ev.state === 'stt_down') {
          void this.page.setTopic('Transcription paused')
        } else if (ev.state === 'summarizer_down') {
          // transient; leave the display as-is
        }
        break

      case 'notes':
        this.notesMarkdown = ev.markdown
        this.phase = 'saved'
        this.clearTimers()
        void this.page.showBullets('Saved', [
          `${this.seenVerses} verses captured`,
          'Double-tap to exit',
        ])
        break

      case 'session':
        break
    }
  }

  onMenu(itemID: number): void {
    if (itemID === MENU.STOP) this.stop()
    else if (itemID === MENU.REPEAT_VERSE) this.repeatLastVerse()
    else if (itemID === MENU.PAUSE) this.togglePause()
  }

  stop(): void {
    if (this.phase === 'stopping' || this.phase === 'saved') return
    this.phase = 'stopping'
    this.clearTimers()
    void this.page.setTopic('Saving...')
    this.requestFinish()
  }

  togglePause(): void {
    if (this.phase === 'paused') {
      this.phase = 'listening'
      this.onPauseChange?.(false)
      void this.renderBullets()
      this.playNext()
    } else if (this.phase === 'listening' || this.phase === 'verse') {
      this.phase = 'paused'
      this.clearTimers()
      this.onPauseChange?.(true)
      void this.page.setTopic('Paused')
    }
  }

  repeatLastVerse(): void {
    if (!this.lastVerse) return
    this.queue.unshift(this.lastVerse)
    this.trimQueue()
    if (this.phase === 'listening') this.playNext()
  }

  // ---- verse playback ----------------------------------------------------

  private enqueueVerse(ref: string, text: string): void {
    const v: QueuedVerse = { ref, pages: paginate(text, VERSE_PAGE_CHARS) }
    this.lastVerse = v
    this.queue.push(v)
    this.trimQueue()
  }

  private trimQueue(): void {
    while (this.queue.length > MAX_QUEUE) this.queue.shift()
  }

  private playNext(): void {
    this.clearTimers()
    const next = this.queue.shift()
    console.log(`[ctrl] playNext phase=${this.phase} next=${next?.ref ?? 'none'} qlen=${this.queue.length}`)
    if (!next) {
      if (this.phase === 'verse') this.phase = 'listening'
      void this.renderBullets()
      return
    }
    this.seenVerses++
    this.phase = 'verse'
    void this.page.showVerse(next.ref, next.pages[0] ?? '')
    this.scheduleVerse(next, 0)
  }

  private scheduleVerse(v: QueuedVerse, pageIndex: number): void {
    const isLast = pageIndex >= v.pages.length - 1
    console.log(`[ctrl] scheduleVerse ${v.ref} page ${pageIndex}/${v.pages.length - 1} isLast=${isLast}`)
    if (isLast) {
      this.after(this.verseHoldMs, () => this.playNext())
    } else {
      this.after(this.versePageMs, () => {
        void this.page.setVersePage(v.pages[pageIndex + 1] ?? '')
        this.scheduleVerse(v, pageIndex + 1)
      })
    }
  }

  private async renderBullets(): Promise<void> {
    await this.page.showBullets(this.headline(), this.bullets)
  }
}

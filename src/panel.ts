import { renderMarkdown } from './md.js'
import { History, formatElapsed, titleFromMarkdown, type SessionRecord } from './history.js'

export type PanelPhase = 'idle' | 'running' | 'saving' | 'saved'

export interface PanelDeps {
  root: HTMLElement
  history: History
  onStart: () => void
  onStop: () => void
}

const WARN_MS = 85 * 60 * 1000
const MAX_MS = 90 * 60 * 1000

export class Panel {
  private readonly root: HTMLElement
  private readonly history: History
  private readonly onStart: () => void
  private readonly onStop: () => void

  private phase: PanelPhase = 'idle'
  private bridgeReady = false
  private status = ''
  private startedAt = 0
  private timerId: ReturnType<typeof setInterval> | null = null
  private notesMarkdown: string | null = null
  private wakeSentinel: { release: () => Promise<void> } | null = null
  private expanded = new Set<string>()

  constructor(deps: PanelDeps) {
    this.root = deps.root
    this.history = deps.history
    this.onStart = deps.onStart
    this.onStop = deps.onStop
    this.render()
  }

  setBridgeReady(ready: boolean): void {
    this.bridgeReady = ready
    this.render()
  }

  setStatus(text: string): void {
    this.status = text
    const el = this.root.querySelector('#pnl-status')
    if (el) el.textContent = text
  }

  setPhase(phase: PanelPhase): void {
    if (phase === this.phase) return
    this.phase = phase
    if (phase === 'running') {
      this.startedAt = Date.now()
      this.notesMarkdown = null
      this.startTimer()
      void this.acquireWake()
    } else {
      this.stopTimer()
      void this.releaseWake()
    }
    this.render()
  }

  /** Called when the backend delivers the finished notes. */
  showNotes(markdown: string): void {
    this.notesMarkdown = markdown
    const record: SessionRecord = {
      id: `${this.startedAt || Date.now()}`,
      startedAt: this.startedAt || Date.now(),
      endedAt: Date.now(),
      title: titleFromMarkdown(markdown),
      markdown,
    }
    this.history.save(record)
    this.expanded.add(record.id)
    this.setPhase('saved')
  }

  // ---- timer ------------------------------------------------------------

  private startTimer(): void {
    this.stopTimer()
    this.timerId = setInterval(() => this.tick(), 1000)
  }
  private stopTimer(): void {
    if (this.timerId) clearInterval(this.timerId)
    this.timerId = null
  }
  private tick(): void {
    const elapsed = Date.now() - this.startedAt
    const t = this.root.querySelector('#pnl-timer')
    if (t) t.textContent = formatElapsed(elapsed / 1000)
    const warn = this.root.querySelector('#pnl-warn')
    if (warn) warn.textContent = elapsed >= WARN_MS ? 'Approaching the 90-minute limit' : ''
    if (elapsed >= MAX_MS) this.onStop()
  }

  // ---- wake lock (best effort) ----------------------------------------

  private async acquireWake(): Promise<void> {
    try {
      const wl = (navigator as { wakeLock?: { request: (t: string) => Promise<unknown> } }).wakeLock
      if (wl) this.wakeSentinel = (await wl.request('screen')) as { release: () => Promise<void> }
    } catch {
      /* not supported / denied — the hint below covers it */
    }
  }
  private async releaseWake(): Promise<void> {
    try {
      await this.wakeSentinel?.release()
    } catch {
      /* ignore */
    }
    this.wakeSentinel = null
  }

  // ---- render ---------------------------------------------------------

  private render(): void {
    const running = this.phase === 'running' || this.phase === 'saving'
    this.root.innerHTML = `
      <main class="wrap">
        <h1>Sermon Notes</h1>
        <div class="bar">
          ${
            running
              ? `<button id="pnl-stop" class="btn stop">Stop &amp; save</button>
                 <span id="pnl-timer" class="timer">00:00</span>`
              : `<button id="pnl-start" class="btn start" ${this.bridgeReady ? '' : 'disabled'}>
                   ${this.phase === 'saved' ? 'New session' : 'Start session'}
                 </button>`
          }
        </div>
        ${
          this.bridgeReady
            ? running
              ? `<p class="hint">Keep the screen on for the whole session.</p><p id="pnl-warn" class="warn"></p>`
              : ''
            : `<p class="hint">Open this in the Even App to run a session.</p>`
        }
        <p id="pnl-status" class="status">${this.status}</p>
        ${this.phase === 'saving' ? '<p class="status">Saving notes…</p>' : ''}
        ${
          this.notesMarkdown
            ? `<section class="notes">${renderMarkdown(this.notesMarkdown)}</section>`
            : ''
        }
        ${this.renderHistory()}
      </main>
    `
    this.root.querySelector('#pnl-start')?.addEventListener('click', () => this.onStart())
    this.root.querySelector('#pnl-stop')?.addEventListener('click', () => this.onStop())
    for (const el of this.root.querySelectorAll<HTMLElement>('[data-toggle]')) {
      el.addEventListener('click', () => {
        const id = el.dataset['toggle']!
        this.expanded.has(id) ? this.expanded.delete(id) : this.expanded.add(id)
        this.render()
      })
    }
    for (const el of this.root.querySelectorAll<HTMLElement>('[data-del]')) {
      el.addEventListener('click', (e) => {
        e.stopPropagation()
        this.history.remove(el.dataset['del']!)
        this.render()
      })
    }
  }

  private renderHistory(): string {
    const records = this.history.list()
    if (records.length === 0) return ''
    const rows = records
      .map((r) => {
        const when = new Date(r.startedAt).toLocaleString([], {
          month: 'short',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
        })
        const open = this.expanded.has(r.id)
        return `
          <li>
            <div class="hrow" data-toggle="${r.id}">
              <span class="htitle">${escapeText(r.title)}</span>
              <span class="hwhen">${when}</span>
              <button class="hdel" data-del="${r.id}" title="Delete">✕</button>
            </div>
            ${open ? `<section class="notes">${renderMarkdown(r.markdown)}</section>` : ''}
          </li>`
      })
      .join('')
    return `<h2>History</h2><ul class="history">${rows}</ul>`
  }
}

function escapeText(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!)
}

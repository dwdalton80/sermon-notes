// Local session history — persists finished notes on the phone (localStorage).

export interface SessionRecord {
  id: string
  startedAt: number
  endedAt: number
  title: string
  markdown: string
}

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

const KEY = 'sermon-notes:history'
const MAX_RECORDS = 100

export class History {
  private readonly storage: StorageLike

  constructor(storage: StorageLike) {
    this.storage = storage
  }

  list(): SessionRecord[] {
    try {
      const raw = this.storage.getItem(KEY)
      if (!raw) return []
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? (parsed as SessionRecord[]) : []
    } catch {
      return []
    }
  }

  save(record: SessionRecord): void {
    const all = [record, ...this.list().filter((r) => r.id !== record.id)].slice(0, MAX_RECORDS)
    this.storage.setItem(KEY, JSON.stringify(all))
  }

  remove(id: string): void {
    this.storage.setItem(KEY, JSON.stringify(this.list().filter((r) => r.id !== id)))
  }
}

/** "mm:ss" or "h:mm:ss" for a running elapsed time. */
export function formatElapsed(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const mm = String(m).padStart(2, '0')
  const ss = String(sec).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

/** Pull the first "# heading" out of the notes markdown for the history label. */
export function titleFromMarkdown(md: string): string {
  const m = md.match(/^#\s+(.+)$/m)
  return m ? m[1]!.trim() : 'Study notes'
}

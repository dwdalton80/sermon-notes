import { describe, it, expect } from 'vitest'
import {
  History,
  formatElapsed,
  matchesQuery,
  shareText,
  titleFromMarkdown,
  type SessionRecord,
  type StorageLike,
} from './history.js'

function fakeStorage(): StorageLike {
  const m = new Map<string, string>()
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
  }
}

const rec = (id: string, startedAt: number, title = 't') => ({
  id,
  startedAt,
  endedAt: startedAt + 1000,
  title,
  markdown: `# ${title}\n`,
})

describe('History', () => {
  it('saves newest-first and round-trips', () => {
    const h = new History(fakeStorage())
    h.save(rec('1', 100))
    h.save(rec('2', 200))
    expect(h.list().map((r) => r.id)).toEqual(['2', '1'])
  })

  it('dedupes by id on save', () => {
    const h = new History(fakeStorage())
    h.save(rec('1', 100, 'old'))
    h.save(rec('1', 100, 'new'))
    expect(h.list()).toHaveLength(1)
    expect(h.list()[0]!.title).toBe('new')
  })

  it('removes by id', () => {
    const h = new History(fakeStorage())
    h.save(rec('1', 100))
    h.save(rec('2', 200))
    h.remove('1')
    expect(h.list().map((r) => r.id)).toEqual(['2'])
  })

  it('updates tag fields without touching id', () => {
    const h = new History(fakeStorage())
    h.save(rec('1', 100))
    h.update('1', { speaker: 'Pastor Kim', church: 'Grace Chapel' })
    const r = h.list()[0]!
    expect(r.id).toBe('1')
    expect(r.speaker).toBe('Pastor Kim')
    expect(r.church).toBe('Grace Chapel')
  })

  it('tolerates corrupt storage', () => {
    const s = fakeStorage()
    s.setItem('sermon-notes:history', 'not json')
    expect(new History(s).list()).toEqual([])
  })
})

describe('formatElapsed', () => {
  it('mm:ss under an hour, h:mm:ss over', () => {
    expect(formatElapsed(0)).toBe('00:00')
    expect(formatElapsed(65)).toBe('01:05')
    expect(formatElapsed(3661)).toBe('1:01:01')
  })
})

describe('titleFromMarkdown', () => {
  it('pulls the first # heading', () => {
    expect(titleFromMarkdown('# When the Wind Came\n\n## x')).toBe('When the Wind Came')
    expect(titleFromMarkdown('no heading here')).toBe('Study notes')
  })
})

const full: SessionRecord = {
  id: '1',
  startedAt: 1_700_000_000_000,
  endedAt: 1_700_000_100_000,
  title: 'When the Wind Came',
  markdown: '# When the Wind Came\n\n## The Spirit comes\n\n- Wind and fire',
  speaker: 'Pastor Kim',
  church: 'Grace Chapel',
}

describe('matchesQuery', () => {
  it('matches title, tags, and notes text, case-insensitively', () => {
    expect(matchesQuery(full, '')).toBe(true)
    expect(matchesQuery(full, 'wind')).toBe(true)
    expect(matchesQuery(full, 'KIM')).toBe(true)
    expect(matchesQuery(full, 'grace chapel')).toBe(true)
    expect(matchesQuery(full, 'fire')).toBe(true) // in the notes body
    expect(matchesQuery(full, 'Romans')).toBe(false)
  })
})

describe('shareText', () => {
  it('produces plain text with a metadata header and no markdown syntax', () => {
    const t = shareText(full)
    expect(t).toContain('Speaker: Pastor Kim')
    expect(t).toContain('Church: Grace Chapel')
    expect(t).toContain('When the Wind Came')
    expect(t).toContain('The Spirit comes')
    expect(t).not.toContain('#')
    expect(t).not.toContain('**')
  })
})

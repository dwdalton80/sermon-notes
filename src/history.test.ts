import { describe, it, expect } from 'vitest'
import { History, formatElapsed, titleFromMarkdown, type StorageLike } from './history.js'

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

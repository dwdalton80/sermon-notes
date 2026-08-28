import { describe, it, expect } from 'vitest'
import { paginate } from './paginate.js'

describe('paginate', () => {
  it('keeps short text on one page', () => {
    expect(paginate('For God so loved the world', 300)).toEqual(['For God so loved the world'])
  })

  it('splits on word boundaries, each page within the limit', () => {
    const text = Array.from({ length: 60 }, (_, i) => `word${i}`).join(' ')
    const pages = paginate(text, 40)
    expect(pages.length).toBeGreaterThan(1)
    for (const p of pages) expect(p.length).toBeLessThanOrEqual(40)
    expect(pages.join(' ').split(/\s+/)).toHaveLength(60)
  })

  it('hard-splits a word longer than the limit', () => {
    const pages = paginate('short ' + 'x'.repeat(25) + ' end', 10)
    for (const p of pages) expect(p.length).toBeLessThanOrEqual(10)
    expect(pages.join('')).toContain('x'.repeat(25))
  })

  it('handles empty input', () => {
    expect(paginate('   ', 50)).toEqual([''])
  })
})

import { describe, it, expect } from 'vitest'
import { OSIS_BOOKS, BOOK_NAMES, nameToOsis } from './books.js'

describe('books', () => {
  it('has 66 books', () => {
    expect(OSIS_BOOKS).toHaveLength(66)
    expect(new Set(OSIS_BOOKS).size).toBe(66)
  })

  it('every display name and OSIS code round-trips', () => {
    for (const osis of OSIS_BOOKS) {
      expect(nameToOsis(BOOK_NAMES[osis]!)).toBe(osis)
      expect(nameToOsis(osis)).toBe(osis)
    }
  })

  it('handles spoken and written ordinals', () => {
    expect(nameToOsis('First Corinthians')).toBe('1Cor')
    expect(nameToOsis('second kings')).toBe('2Kgs')
    expect(nameToOsis('Third John')).toBe('3John')
    expect(nameToOsis('II Timothy')).toBe('2Tim')
    expect(nameToOsis('1 cor')).toBe('1Cor')
    expect(nameToOsis('1cor')).toBe('1Cor')
    expect(nameToOsis('1 Jn')).toBe('1John')
  })

  it('handles Psalm(s), Song variants, Revelation(s)', () => {
    expect(nameToOsis('Psalm')).toBe('Ps')
    expect(nameToOsis('Psalms')).toBe('Ps')
    expect(nameToOsis('Song of Songs')).toBe('Song')
    expect(nameToOsis('Song of Solomon')).toBe('Song')
    expect(nameToOsis('Canticles')).toBe('Song')
    expect(nameToOsis('Revelation')).toBe('Rev')
    expect(nameToOsis('Revelations')).toBe('Rev')
  })

  it('rejects non-books', () => {
    expect(nameToOsis('Hezekiah')).toBeNull()
    expect(nameToOsis('')).toBeNull()
    expect(nameToOsis('The Gospel')).toBeNull()
  })
})

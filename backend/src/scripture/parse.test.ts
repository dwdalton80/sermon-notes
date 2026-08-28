import { describe, it, expect } from 'vitest'
import { parseReferences, displayRef, osisId } from './parse.js'
import type { Ref } from './types.js'

/** compact projection for assertions */
const proj = (r: Ref) => [r.book, r.startChapter, r.startVerse, r.endChapter, r.endVerse]

describe('parseReferences', () => {
  const cases: Array<[string, unknown[][]]> = [
    ['John 3:16', [['John', 3, 16, 3, 16]]],
    ['See John 3:16-18 today', [['John', 3, 16, 3, 18]]],
    ['John 3:16–4:2', [['John', 3, 16, 4, 2]]],
    ['1 Corinthians 13', [['1Cor', 13, null, 13, null]]],
    ['1 Cor 13:4-7', [['1Cor', 13, 4, 13, 7]]],
    ['First Corinthians 13:4', [['1Cor', 13, 4, 13, 4]]],
    ['Psalm 23', [['Ps', 23, null, 23, null]]],
    ['he read Psalm 119 slowly', [['Ps', 119, null, 119, null]]],
    [
      'Turn to Romans 8:28, 38-39.',
      [
        ['Rom', 8, 28, 8, 28],
        ['Rom', 8, 38, 8, 39],
      ],
    ],
    ['Read John chapter 3 verse 16', [['John', 3, 16, 3, 16]]],
    ['Isaiah 53:5', [['Isa', 53, 5, 53, 5]]],
    ['Is 53:5', [['Isa', 53, 5, 53, 5]]],
    ['Matthew 5-7', [['Matt', 5, null, 7, null]]],
    ['2 Timothy 3:16-17', [['2Tim', 3, 16, 3, 17]]],
    ['Revelations 22', [['Rev', 22, null, 22, null]]],
    ['Song of Solomon 2:1', [['Song', 2, 1, 2, 1]]],
    ['1 John 4:8', [['1John', 4, 8, 4, 8]]],
    ['Hebrews 11', [['Heb', 11, null, 11, null]]],
    [
      'Acts 2:38 and also Acts 2:42',
      [
        ['Acts', 2, 38, 2, 38],
        ['Acts', 2, 42, 2, 42],
      ],
    ],
    ['Luke 4:18 through 19', [['Luke', 4, 18, 4, 19]]],
    ['Philippians 4:6-7', [['Phil', 4, 6, 4, 7]]],
    ['Jude 3', [['Jude', 1, 3, 1, 3]]],
    ['Jude 3-5', [['Jude', 1, 3, 1, 5]]],
    ['Philemon 6', [['Phlm', 1, 6, 1, 6]]],
    // spoken audio: "through" ranges and number words
    ['Ephesians 8:5 through 10', [['Eph', 8, 5, 8, 10]]],
    ['Ephesians chapter four verse five through ten', [['Eph', 4, 5, 4, 10]]],
    ['John chapter three verse sixteen', [['John', 3, 16, 3, 16]]],
    ['Acts two verse thirty eight', [['Acts', 2, 38, 2, 38]]],
    ['first Corinthians chapter thirteen', [['1Cor', 13, null, 13, null]]],
    ['he read Psalm one hundred nineteen', [['Ps', 119, null, 119, null]]],
    ['Romans eight verse twenty eight through thirty nine', [['Rom', 8, 28, 8, 39]]],
    // no bare-space number pairing: "Genesis one one" is just chapter 1
    ['Genesis one one', [['Gen', 1, null, 1, null]]],
    // number words with no book are not a reference
    ['two verse eight', []],
    // negatives
    ['it is 5 degrees outside', []],
    ['the meeting starts at 3:16 pm', []],
    ['God is love', []],
    ['point 1, point 2, and point 3', []],
    // dedupe
    ['John 3:16 ... and again John 3:16', [['John', 3, 16, 3, 16]]],
  ]

  for (const [input, expected] of cases) {
    it(JSON.stringify(input), () => {
      expect(parseReferences(input).map(proj)).toEqual(expected)
    })
  }

  it('resolves bare "verse N" against context', () => {
    const ctx = { lastRef: parseReferences('Ephesians 2:1')[0]! }
    expect(parseReferences('as we see in verses 3-5', ctx).map(proj)).toEqual([['Eph', 2, 3, 2, 5]])
  })

  it('carries context within a single string', () => {
    const refs = parseReferences('Look at John 3:16. Now verse 17 says more.')
    expect(refs.map(proj)).toEqual([
      ['John', 3, 16, 3, 16],
      ['John', 3, 17, 3, 17],
    ])
  })

  it('formats display + osis', () => {
    const [a] = parseReferences('John 3:16-18')
    expect(displayRef(a!)).toBe('John 3:16-18')
    expect(osisId(a!)).toBe('John.3.16-John.3.18')
    const [b] = parseReferences('Psalm 23')
    expect(displayRef(b!)).toBe('Psalm 23')
    const [c] = parseReferences('John 3:16-4:2')
    expect(displayRef(c!)).toBe('John 3:16-4:2')
  })
})

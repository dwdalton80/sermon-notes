import { BOOK_NAMES, SINGLE_CHAPTER, nameToOsis } from './books.js'
import type { Ref } from './types.js'

/** Context carried between calls (or across sentences) so bare "verse 12"
 *  references can be resolved to the last-seen book + chapter. */
export interface ParseContext {
  lastRef?: Ref
}

// number words, so spoken audio like "chapter two verse eight" or
// "verse five through ten" still parses (chapter/verse values top out at 176).
// The grammar only accepts real numbers — "one" / "twenty eight" /
// "one hundred nineteen" — not bare unit runs like "three sixteen" (that means
// 3:16, not 19). toInt() evaluates the matched token.
// longest-first so "sixteen" wins over "six"; \b so "six" can't match inside "sixteen"
const U19 =
  'nineteen|eighteen|seventeen|sixteen|fifteen|fourteen|thirteen|twelve|eleven|ten|nine|eight|seven|six|five|four|three|two|one'
const U9 = 'nine|eight|seven|six|five|four|three|two|one'
const T = 'twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety'
// 1-99
const T2 = String.raw`(?:(?:${T})(?:[\s-]+(?:${U9}))?\b|(?:${U19})\b)`
const NUMWORD = String.raw`(?:(?:${U9})\b[\s-]+hundred\b(?:[\s-]+(?:and[\s-]+)?${T2})?|hundred\b(?:[\s-]+(?:and[\s-]+)?${T2})?|${T2})`
// a number, as digits or words
const NUM = String.raw`(?:\d+|${NUMWORD})`

// verse separator: ":" / "." (no spaces) / the words "verse(s)" / "v."
const SEP = String.raw`(?:\s*:\s*|\.(?=\d)|\s+verses?\s+|\s+v\.?\s+)`
// range separator: hyphen / en / em dash / "through" / "to" / "thru"
const DASH = String.raw`(?:\s*[-–—]\s*|\s+(?:through|thru|to)\s+)`

// optional leading book numeral: "1" / "II" / "First"
const ORD = String.raw`(?:([1-3])\s*|(I{1,3})\s+|(first|second|third)\s+)`
// book name: one word, optionally "<word> of <word>" (Song of Solomon/Songs)
const NAME = String.raw`([A-Za-z]+(?:\s+of\s+[A-Za-z]+)?)`

const PRIMARY = new RegExp(
  String.raw`(?<![A-Za-z])` +
    ORD +
    `?` +
    NAME +
    String.raw`\.?\s*(?:chapters?\s+)?(${NUM})` + // chapter  (g5)
    `(?:` + SEP + String.raw`(${NUM}))?` + //         verse    (g6)
    `(?:` +
    DASH +
    String.raw`(?:(${NUM})` +
    SEP +
    String.raw`)?(${NUM}))?`, // range end chapter (g7) + end number (g8)
  'gi',
)

// continuation list item, e.g. the ", 38-39" in "Romans 8:28, 38-39".
// Only meaningful immediately after a primary/continuation match.
const CONT = new RegExp(
  String.raw`\s*,\s*(${NUM})(?:` + DASH + String.raw`(${NUM}))?`,
  'yi',
)

// bare verse pointer, e.g. "verse 12" / "verses 3-5" / "vv. 3-5"
const BARE = new RegExp(
  String.raw`(?<![A-Za-z])(?:verses?|vv?\.?)\s+(${NUM})(?:` + DASH + String.raw`(${NUM}))?`,
  'gi',
)

const UNITS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
  sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
}
const TENS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
}

/** Parse a chapter/verse token (digits or number words) to an int, or null. */
function toInt(tok: string | undefined): number | null {
  if (!tok) return null
  const t = tok.trim().toLowerCase()
  if (/^\d+$/.test(t)) {
    const n = Number(t)
    return n >= 1 && n <= 200 ? n : null
  }
  let total = 0
  let current = 0
  for (const w of t.replace(/-/g, ' ').split(/\s+/)) {
    if (w === '' || w === 'and') continue
    if (w in UNITS) current += UNITS[w]!
    else if (w in TENS) current += TENS[w]!
    else if (w === 'hundred') current = (current || 1) * 100
    else return null
  }
  total += current
  return total >= 1 && total <= 200 ? total : null
}

const WORD_ORD: Record<string, string> = { first: '1', second: '2', third: '3' }

function ordToDigit(g1?: string, g2?: string, g3?: string): string | null {
  if (g1) return g1
  if (g2) return String(g2.length) // I / II / III
  if (g3) return WORD_ORD[g3.toLowerCase()] ?? null
  return null
}

function isStrong(token: string, hadOrdinal: boolean): boolean {
  return hadOrdinal || /\s/.test(token) || token.replace(/[^a-z]/gi, '').length >= 4
}

function eq(a: Ref, b: Ref): boolean {
  return (
    a.book === b.book &&
    a.startChapter === b.startChapter &&
    a.startVerse === b.startVerse &&
    a.endChapter === b.endChapter &&
    a.endVerse === b.endVerse
  )
}

/** Extract scripture references from free text, in reading order. */
export function parseReferences(text: string, ctx: ParseContext = {}): Ref[] {
  const out: Ref[] = []
  const spans: number[] = [] // end index of out[i], parallel array
  const covered: Array<[number, number]> = []

  const push = (ref: Ref, endIndex: number) => {
    if (out.some((r) => eq(r, ref))) return
    out.push(ref)
    spans.push(endIndex)
  }

  PRIMARY.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = PRIMARY.exec(text))) {
    const ordDigit = ordToDigit(m[1], m[2], m[3])
    const token = (ordDigit ? ordDigit + ' ' : '') + m[4]!
    const book = nameToOsis(token)
    if (!book) continue

    const startChapter = toInt(m[5])
    if (startChapter == null) continue
    const startVerse = m[6] != null ? toInt(m[6]) : null
    const rangeEndChapter = m[7] != null ? toInt(m[7]) : null
    const rangeEndNum = m[8] != null ? toInt(m[8]) : null

    let endChapter = startChapter
    let endVerse = startVerse
    if (rangeEndNum != null) {
      if (rangeEndChapter != null) {
        endChapter = rangeEndChapter
        endVerse = rangeEndNum
      } else if (startVerse != null) {
        endVerse = rangeEndNum // "3:16-18"
      } else {
        endChapter = rangeEndNum // "3-4" whole-chapter range
        endVerse = null
      }
    }

    const hasSep = m[6] != null || m[0].includes(':')
    if (!isStrong(token, ordDigit != null) && !hasSep) continue

    let ref: Ref = { raw: m[0], book, startChapter, startVerse, endChapter, endVerse }
    // "Jude 3" / "Philemon 6" — the number is a verse in the book's only chapter.
    if (SINGLE_CHAPTER.has(book) && startVerse == null) {
      ref = {
        raw: m[0],
        book,
        startChapter: 1,
        startVerse: startChapter,
        endChapter: 1,
        endVerse: endChapter !== startChapter ? endChapter : startChapter,
      }
    }
    push(ref, PRIMARY.lastIndex)
    covered.push([m.index, PRIMARY.lastIndex])

    // consume any ", N" / ", N-N" continuation items that follow immediately
    let base = ref
    CONT.lastIndex = PRIMARY.lastIndex
    let c: RegExpExecArray | null
    while (base.startVerse != null && (c = CONT.exec(text))) {
      const v1 = toInt(c[1])
      if (v1 == null) break
      const v2 = c[2] != null ? toInt(c[2]) : null
      const cont: Ref = {
        raw: c[0].trim(),
        book: base.book,
        startChapter: base.endChapter,
        startVerse: v1,
        endChapter: base.endChapter,
        endVerse: v2 ?? v1,
      }
      push(cont, CONT.lastIndex)
      covered.push([c.index, CONT.lastIndex])
      base = cont
      PRIMARY.lastIndex = CONT.lastIndex
      CONT.lastIndex = PRIMARY.lastIndex
    }
  }

  // bare "verse N" — needs a book+chapter from earlier in the text or ctx
  BARE.lastIndex = 0
  while ((m = BARE.exec(text))) {
    const idx = m.index
    if (covered.some(([s, e]) => idx >= s && idx < e)) continue
    let baseRef: Ref | undefined = ctx.lastRef
    for (let i = 0; i < out.length; i++) {
      if (spans[i]! <= idx) baseRef = out[i]
    }
    if (!baseRef) continue
    const v1 = toInt(m[1])
    if (v1 == null) continue
    const v2 = m[2] != null ? toInt(m[2]) : null
    push(
      {
        raw: m[0],
        book: baseRef.book,
        startChapter: baseRef.endChapter,
        startVerse: v1,
        endChapter: baseRef.endChapter,
        endVerse: v2 ?? v1,
      },
      BARE.lastIndex,
    )
  }

  // return in reading order
  return out
}

/** Human-readable reference, e.g. "John 3:16-18", "Psalm 23", "John 3:16-4:2". */
export function displayRef(ref: Ref): string {
  const name = ref.book === 'Ps' ? 'Psalm' : BOOK_NAMES[ref.book]!
  const { startChapter: sc, startVerse: sv, endChapter: ec, endVerse: ev } = ref
  // single-chapter books are cited verse-only: "Jude 3", "Jude 3-5"
  if (SINGLE_CHAPTER.has(ref.book) && sc === 1 && ec === 1 && sv != null) {
    return ev != null && ev !== sv ? `${name} ${sv}-${ev}` : `${name} ${sv}`
  }
  if (sv == null) return ec === sc ? `${name} ${sc}` : `${name} ${sc}-${ec}`
  if (ec === sc) return ev != null && ev !== sv ? `${name} ${sc}:${sv}-${ev}` : `${name} ${sc}:${sv}`
  return `${name} ${sc}:${sv}-${ec}:${ev != null ? ev : ''}`.replace(/:\s*$/, '')
}

/** Stable OSIS-style id for de-duplication, e.g. "John.3.16-John.3.18". */
export function osisId(ref: Ref): string {
  const start = `${ref.book}.${ref.startChapter}${ref.startVerse != null ? '.' + ref.startVerse : ''}`
  const end = `${ref.book}.${ref.endChapter}${ref.endVerse != null ? '.' + ref.endVerse : ''}`
  return start === end ? start : `${start}-${end}`
}

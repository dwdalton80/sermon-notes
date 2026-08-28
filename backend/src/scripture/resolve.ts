import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { displayRef, osisId } from './parse.js'
import type { Ref, ResolvedVerse, ResolveError } from './types.js'

type Bible = Record<string, Record<string, Record<string, string>>>

let cache: Bible | null = null
function bible(): Bible {
  if (!cache) {
    const p = join(dirname(fileURLToPath(import.meta.url)), 'kjv.json')
    cache = JSON.parse(readFileSync(p, 'utf8')) as Bible
  }
  return cache
}

function lastVerse(chapter: Record<string, string>): number {
  return Math.max(...Object.keys(chapter).map(Number))
}

/** Resolve a parsed reference to its KJV text. Ranges are expanded (including
 *  cross-chapter); a request that runs past the end of a chapter/book is
 *  clamped and flagged `truncated`. */
export function resolve(ref: Ref): ResolvedVerse | ResolveError {
  const label = displayRef(ref)
  const book = bible()[ref.book]
  if (!book) return { ref: label, error: 'unknown-book' }

  const startChapter = ref.startChapter
  const startVerse = ref.startVerse ?? 1
  const endChapter = ref.endChapter

  const firstCh = book[String(startChapter)]
  if (!firstCh) return { ref: label, error: 'no-such-chapter' }
  if (!firstCh[String(startVerse)]) return { ref: label, error: 'no-such-verse' }

  const verses: ResolvedVerse['verses'] = []
  let truncated = false

  for (let ch = startChapter; ch <= endChapter; ch++) {
    const chObj = book[String(ch)]
    if (!chObj) {
      truncated = true
      break
    }
    const maxV = lastVerse(chObj)
    const from = ch === startChapter ? startVerse : 1
    let to = ch === endChapter ? (ref.endVerse ?? maxV) : maxV
    if (to > maxV) {
      to = maxV
      truncated = true
    }
    for (let v = from; v <= to; v++) {
      const text = chObj[String(v)]
      if (!text) {
        truncated = true
        break
      }
      verses.push({ chapter: ch, verse: v, text })
    }
  }

  // requested an end chapter the book doesn't have
  if (endChapter > startChapter && !book[String(endChapter)]) truncated = true
  if (verses.length === 0) return { ref: label, error: 'no-such-verse' }

  return {
    ref: label,
    osis: osisId(ref),
    translation: 'KJV',
    text: verses.map((v) => v.text).join(' '),
    verses,
    truncated,
  }
}

export function isResolveError(x: ResolvedVerse | ResolveError): x is ResolveError {
  return 'error' in x
}

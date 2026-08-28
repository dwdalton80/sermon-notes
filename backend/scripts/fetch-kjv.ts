/**
 * Build backend/src/scripture/kjv.json from a public-domain KJV source.
 *
 * Source: https://github.com/aruljohn/Bible-kjv  (per-book JSON, plain text,
 * no translator-italics braces). Public domain in the United States.
 *
 * Output shape: { [osisBook]: { [chapter]: { [verse]: "text" } } }
 * Run: npm --prefix backend run fetch-kjv
 */
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { OSIS_BOOKS } from '../src/scripture/books.js'

const RAW = 'https://raw.githubusercontent.com/aruljohn/Bible-kjv/master'
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'scripture', 'kjv.json')

interface SrcBook {
  book: string
  chapters: { chapter: string; verses: { verse: string; text: string }[] }[]
}

async function getJson<T>(url: string, tries = 4): Promise<T> {
  for (let i = 1; i <= tries; i++) {
    try {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return (await res.json()) as T
    } catch (err) {
      if (i === tries) throw err
      await new Promise((r) => setTimeout(r, 500 * i))
    }
  }
  throw new Error('unreachable')
}

function cleanText(s: string): string {
  return s
    .replace(/\{|\}/g, '') // drop any translator-italics braces if present
    .replace(/[‘’‚‛]/g, "'") // curly single quotes -> '
    .replace(/[“”„‟]/g, '"') // curly double quotes -> "
    .replace(/[–—]/g, '-') // en/em dash -> -
    .replace(/…/g, '...') // ellipsis
    .replace(/\s+/g, ' ')
    .trim()
}

async function main() {
  const names = await getJson<string[]>(`${RAW}/Books.json`)
  if (names.length !== 66) throw new Error(`expected 66 books, got ${names.length}`)

  const bible: Record<string, Record<string, Record<string, string>>> = {}
  let verseCount = 0

  for (let i = 0; i < names.length; i++) {
    const name = names[i]!
    const osis = OSIS_BOOKS[i]!
    // aruljohn filenames strip all spaces: "1 Samuel" -> "1Samuel.json".
    const src = await getJson<SrcBook>(`${RAW}/${name.replace(/\s+/g, '')}.json`)
    const outBook: Record<string, Record<string, string>> = {}
    for (const ch of src.chapters) {
      const outCh: Record<string, string> = {}
      for (const v of ch.verses) {
        outCh[String(Number(v.verse))] = cleanText(v.text)
        verseCount++
      }
      outBook[String(Number(ch.chapter))] = outCh
    }
    bible[osis] = outBook
    process.stdout.write(`\r${i + 1}/66  ${osis.padEnd(6)} `)
  }

  writeFileSync(OUT, JSON.stringify(bible))
  process.stdout.write('\n')
  console.log(`wrote ${OUT}`)
  console.log(`books: ${Object.keys(bible).length}, verses: ${verseCount}`)
  if (verseCount < 31000 || verseCount > 31200) {
    throw new Error(`verse count ${verseCount} outside expected KJV range (~31102)`)
  }
}

main().catch((err) => {
  console.error('\nfetch-kjv failed:', err)
  process.exit(1)
})

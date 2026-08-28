/** A scripture reference extracted from text. Verse fields are null for a
 *  whole-chapter reference ("Psalm 23"). */
export interface Ref {
  /** exact substring that produced this reference */
  raw: string
  /** OSIS book code, e.g. "1Cor" */
  book: string
  startChapter: number
  /** null = from verse 1 of startChapter (whole-chapter start) */
  startVerse: number | null
  endChapter: number
  /** null = through the last verse of endChapter */
  endVerse: number | null
}

export interface ResolvedVerse {
  /** display reference, e.g. "John 3:16-18" or "Psalm 23" */
  ref: string
  /** OSIS range id, e.g. "John.3.16-John.3.18" */
  osis: string
  translation: 'KJV'
  /** verses joined by a single space, no verse numbers — for the glasses */
  text: string
  /** individual verses with numbers — for the study notes */
  verses: { chapter: number; verse: number; text: string }[]
  /** true if the requested range ran past the end of the book/chapter and was clamped */
  truncated: boolean
}

export interface ResolveError {
  ref: string
  error: 'unknown-book' | 'no-such-chapter' | 'no-such-verse'
}

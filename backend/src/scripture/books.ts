// Canonical 66-book table for KJV, in standard Protestant / OSIS order.
// `resolve.ts` derives chapter/verse bounds from the actual data, so no
// chapter-count table is kept here — the data is the single source of truth.

/** [osisCode, displayName, ...aliases] — aliases are matched case- and
 *  punctuation-insensitively, after spoken ordinals ("First") are folded to
 *  digits ("1"). Include forms a minister is likely to say or a transcriber
 *  likely to write. */
const TABLE: ReadonlyArray<readonly [string, string, ...string[]]> = [
  ['Gen', 'Genesis', 'gen', 'ge', 'gn'],
  ['Exod', 'Exodus', 'exod', 'exo', 'ex'],
  ['Lev', 'Leviticus', 'lev', 'le', 'lv'],
  ['Num', 'Numbers', 'num', 'nu', 'nm', 'nb'],
  ['Deut', 'Deuteronomy', 'deut', 'de', 'dt'],
  ['Josh', 'Joshua', 'josh', 'jos', 'jsh'],
  ['Judg', 'Judges', 'judg', 'jdg', 'jg', 'jdgs'],
  ['Ruth', 'Ruth', 'rth', 'ru'],
  ['1Sam', '1 Samuel', '1 samuel', '1samuel', '1 sam', '1sam', '1 sa', '1sa', '1 s', 'first samuel'],
  ['2Sam', '2 Samuel', '2 samuel', '2samuel', '2 sam', '2sam', '2 sa', '2sa', '2 s', 'second samuel'],
  ['1Kgs', '1 Kings', '1 kings', '1kings', '1 kgs', '1kgs', '1 ki', '1ki', '1 kin', 'first kings'],
  ['2Kgs', '2 Kings', '2 kings', '2kings', '2 kgs', '2kgs', '2 ki', '2ki', '2 kin', 'second kings'],
  ['1Chr', '1 Chronicles', '1 chronicles', '1chronicles', '1 chron', '1chron', '1 chr', '1chr', '1 ch', 'first chronicles'],
  ['2Chr', '2 Chronicles', '2 chronicles', '2chronicles', '2 chron', '2chron', '2 chr', '2chr', '2 ch', 'second chronicles'],
  ['Ezra', 'Ezra', 'ezr', 'ez'],
  ['Neh', 'Nehemiah', 'neh', 'ne'],
  ['Esth', 'Esther', 'esth', 'est', 'es'],
  ['Job', 'Job', 'jb'],
  ['Ps', 'Psalms', 'psalms', 'psalm', 'pslm', 'psa', 'psm', 'pss', 'ps'],
  ['Prov', 'Proverbs', 'prov', 'pro', 'prv', 'pr'],
  ['Eccl', 'Ecclesiastes', 'eccl', 'ecc', 'eccles', 'qoh', 'ec'],
  ['Song', 'Song of Solomon', 'song of solomon', 'song of songs', 'song', 'sos', 'so', 'canticles', 'cant'],
  ['Isa', 'Isaiah', 'isa', 'is'],
  ['Jer', 'Jeremiah', 'jer', 'je', 'jr'],
  ['Lam', 'Lamentations', 'lam', 'la'],
  ['Ezek', 'Ezekiel', 'ezek', 'eze', 'ezk'],
  ['Dan', 'Daniel', 'dan', 'da', 'dn'],
  ['Hos', 'Hosea', 'hos', 'ho'],
  ['Joel', 'Joel', 'jl', 'joe'],
  ['Amos', 'Amos', 'am', 'amo'],
  ['Obad', 'Obadiah', 'obad', 'oba', 'ob'],
  ['Jonah', 'Jonah', 'jnh', 'jon'],
  ['Mic', 'Micah', 'mic', 'mc'],
  ['Nah', 'Nahum', 'nah', 'na'],
  ['Hab', 'Habakkuk', 'hab', 'hb'],
  ['Zeph', 'Zephaniah', 'zeph', 'zep', 'zp'],
  ['Hag', 'Haggai', 'hag', 'hg'],
  ['Zech', 'Zechariah', 'zech', 'zec', 'zc'],
  ['Mal', 'Malachi', 'mal', 'ml'],
  ['Matt', 'Matthew', 'matt', 'mat', 'mt'],
  ['Mark', 'Mark', 'mrk', 'mar', 'mk', 'mr'],
  ['Luke', 'Luke', 'luk', 'lk'],
  ['John', 'John', 'joh', 'jhn', 'jn'],
  ['Acts', 'Acts', 'act', 'ac'],
  ['Rom', 'Romans', 'rom', 'ro', 'rm'],
  ['1Cor', '1 Corinthians', '1 corinthians', '1corinthians', '1 cor', '1cor', '1 co', '1co', 'first corinthians'],
  ['2Cor', '2 Corinthians', '2 corinthians', '2corinthians', '2 cor', '2cor', '2 co', '2co', 'second corinthians'],
  ['Gal', 'Galatians', 'gal', 'ga'],
  ['Eph', 'Ephesians', 'eph', 'ephes'],
  ['Phil', 'Philippians', 'phil', 'php', 'pp', 'philip'],
  ['Col', 'Colossians', 'col', 'co'],
  ['1Thess', '1 Thessalonians', '1 thessalonians', '1thessalonians', '1 thess', '1thess', '1 thes', '1 th', '1th', 'first thessalonians'],
  ['2Thess', '2 Thessalonians', '2 thessalonians', '2thessalonians', '2 thess', '2thess', '2 thes', '2 th', '2th', 'second thessalonians'],
  ['1Tim', '1 Timothy', '1 timothy', '1timothy', '1 tim', '1tim', '1 ti', '1ti', 'first timothy'],
  ['2Tim', '2 Timothy', '2 timothy', '2timothy', '2 tim', '2tim', '2 ti', '2ti', 'second timothy'],
  ['Titus', 'Titus', 'tit', 'ti'],
  ['Phlm', 'Philemon', 'phlm', 'philem', 'phm', 'pm'],
  ['Heb', 'Hebrews', 'heb'],
  ['Jas', 'James', 'jas', 'jm', 'jms'],
  ['1Pet', '1 Peter', '1 peter', '1peter', '1 pet', '1pet', '1 pe', '1pe', '1 pt', 'first peter'],
  ['2Pet', '2 Peter', '2 peter', '2peter', '2 pet', '2pet', '2 pe', '2pe', '2 pt', 'second peter'],
  ['1John', '1 John', '1 john', '1john', '1 jn', '1jn', '1 jhn', '1 jo', 'first john'],
  ['2John', '2 John', '2 john', '2john', '2 jn', '2jn', '2 jhn', '2 jo', 'second john'],
  ['3John', '3 John', '3 john', '3john', '3 jn', '3jn', '3 jhn', '3 jo', 'third john'],
  ['Jude', 'Jude', 'jud', 'jd'],
  ['Rev', 'Revelation', 'revelation', 'revelations', 'rev', 're', 'apocalypse', 'the revelation'],
]

/** OSIS codes in canonical order. */
export const OSIS_BOOKS: readonly string[] = TABLE.map((r) => r[0])

/** Books with a single chapter — a lone number after these is a verse
 *  ("Jude 3" = Jude verse 3), never a chapter. */
export const SINGLE_CHAPTER: ReadonlySet<string> = new Set([
  'Obad',
  'Phlm',
  '2John',
  '3John',
  'Jude',
])

/** OSIS code -> human display name (e.g. `1Cor` -> "1 Corinthians"). */
export const BOOK_NAMES: Readonly<Record<string, string>> = Object.fromEntries(
  TABLE.map((r) => [r[0], r[1]]),
)

const ALIAS_TO_OSIS = new Map<string, string>()
for (const [osis, name, ...aliases] of TABLE) {
  ALIAS_TO_OSIS.set(norm(name), osis)
  ALIAS_TO_OSIS.set(norm(osis), osis)
  for (const a of aliases) ALIAS_TO_OSIS.set(norm(a), osis)
}

function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/\./g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Fold spoken/written ordinals to digits: "First John" -> "1 john". */
function foldOrdinals(s: string): string {
  return s
    .replace(/^(first|1st)\s+/i, '1 ')
    .replace(/^(second|2nd)\s+/i, '2 ')
    .replace(/^(third|3rd)\s+/i, '3 ')
    .replace(/^i\s+(?=samuel|kings|chronicles|corinthians|thessalonians|timothy|peter|john)/i, '1 ')
    .replace(/^ii\s+(?=samuel|kings|chronicles|corinthians|thessalonians|timothy|peter|john)/i, '2 ')
    .replace(/^iii\s+(?=john)/i, '3 ')
}

/** Resolve a book name/abbreviation/spoken form to its OSIS code, or null. */
export function nameToOsis(raw: string): string | null {
  const key = norm(foldOrdinals(norm(raw)))
  return ALIAS_TO_OSIS.get(key) ?? null
}

/** All aliases (normalized), longest first — used to build the parser regex. */
export function bookAliasesForRegex(): string[] {
  return [...ALIAS_TO_OSIS.keys()].sort((a, b) => b.length - a.length)
}

/** Split text into pages of at most `maxChars`, breaking on word boundaries.
 *  A single word longer than `maxChars` is hard-split. */
export function paginate(text: string, maxChars: number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return ['']
  const pages: string[] = []
  let line = ''
  for (let word of words) {
    while (word.length > maxChars) {
      if (line) {
        pages.push(line)
        line = ''
      }
      pages.push(word.slice(0, maxChars))
      word = word.slice(maxChars)
    }
    if (!line) {
      line = word
    } else if (line.length + 1 + word.length <= maxChars) {
      line += ' ' + word
    } else {
      pages.push(line)
      line = word
    }
  }
  if (line) pages.push(line)
  return pages
}

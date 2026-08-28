// Tiny, safe Markdown -> HTML for the notes preview. Handles only what the
// backend emits: # / ## headings, - bullets, > blockquotes, **bold**.

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
}

function inline(s: string): string {
  return esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
}

export function renderMarkdown(md: string): string {
  const out: string[] = []
  let list = false
  const closeList = () => {
    if (list) {
      out.push('</ul>')
      list = false
    }
  }
  for (const raw of md.split('\n')) {
    const line = raw.trimEnd()
    if (line === '') {
      closeList()
      continue
    }
    if (line.startsWith('## ')) {
      closeList()
      out.push(`<h4>${inline(line.slice(3))}</h4>`)
    } else if (line.startsWith('# ')) {
      closeList()
      out.push(`<h3>${inline(line.slice(2))}</h3>`)
    } else if (line.startsWith('> ')) {
      closeList()
      out.push(`<blockquote>${inline(line.slice(2))}</blockquote>`)
    } else if (line.startsWith('- ')) {
      if (!list) {
        out.push('<ul>')
        list = true
      }
      out.push(`<li>${inline(line.slice(2))}</li>`)
    } else {
      closeList()
      out.push(`<p>${inline(line)}</p>`)
    }
  }
  closeList()
  return out.join('\n')
}

import { describe, it, expect } from 'vitest'
import { renderMarkdown } from './md.js'

describe('renderMarkdown', () => {
  it('renders headings, bullets, blockquotes, bold', () => {
    const html = renderMarkdown(
      '# When the Wind Came\n\n## The Spirit comes\n\n- Wind and fire\n- All are filled\n\n**Acts 2:38** (KJV)\n\n> Then Peter said',
    )
    expect(html).toContain('<h3>When the Wind Came</h3>')
    expect(html).toContain('<h4>The Spirit comes</h4>')
    expect(html).toContain('<ul>\n<li>Wind and fire</li>\n<li>All are filled</li>\n</ul>')
    expect(html).toContain('<strong>Acts 2:38</strong>')
    expect(html).toContain('<blockquote>Then Peter said</blockquote>')
  })

  it('escapes HTML in content', () => {
    expect(renderMarkdown('- <script>alert(1)</script>')).toContain(
      '<li>&lt;script&gt;alert(1)&lt;/script&gt;</li>',
    )
  })

  it('closes an open list at end of input', () => {
    const html = renderMarkdown('- one\n- two')
    expect(html.endsWith('</ul>')).toBe(true)
  })
})

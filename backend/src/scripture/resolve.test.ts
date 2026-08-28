import { describe, it, expect } from 'vitest'
import { parseReferences } from './parse.js'
import { resolve, isResolveError } from './resolve.js'
import type { Ref } from './types.js'

const ref = (s: string): Ref => {
  const r = parseReferences(s)[0]
  if (!r) throw new Error(`no ref parsed from ${s}`)
  return r
}

describe('resolve', () => {
  it('single verse', () => {
    const r = resolve(ref('John 3:16'))
    if (isResolveError(r)) throw new Error(r.error)
    expect(r.ref).toBe('John 3:16')
    expect(r.translation).toBe('KJV')
    expect(r.verses).toHaveLength(1)
    expect(r.text).toMatch(/^For God so loved the world/)
    expect(r.truncated).toBe(false)
  })

  it('same-chapter range', () => {
    const r = resolve(ref('John 3:16-18'))
    if (isResolveError(r)) throw new Error(r.error)
    expect(r.verses.map((v) => v.verse)).toEqual([16, 17, 18])
    expect(r.text).toContain('condemned')
  })

  it('cross-chapter range', () => {
    const r = resolve(ref('John 3:35-4:2'))
    if (isResolveError(r)) throw new Error(r.error)
    expect(r.verses.map((v) => `${v.chapter}:${v.verse}`)).toEqual(['3:35', '3:36', '4:1', '4:2'])
  })

  it('whole chapter', () => {
    const r = resolve(ref('Psalm 117'))
    if (isResolveError(r)) throw new Error(r.error)
    expect(r.verses).toHaveLength(2)
    expect(r.ref).toBe('Psalm 117')
  })

  it('multi-chapter span', () => {
    const r = resolve(ref('Matthew 5-7'))
    if (isResolveError(r)) throw new Error(r.error)
    expect(r.verses).toHaveLength(48 + 34 + 29)
  })

  it('one-chapter book', () => {
    const r = resolve(ref('Jude 3'))
    if (isResolveError(r)) throw new Error(r.error)
    expect(r.verses).toHaveLength(1)
    expect(r.text).toContain('earnestly contend for the faith')
  })

  it('clamps a range past the end of the chapter', () => {
    const r = resolve(ref('Revelation 22:20-25'))
    if (isResolveError(r)) throw new Error(r.error)
    expect(r.verses.map((v) => v.verse)).toEqual([20, 21])
    expect(r.truncated).toBe(true)
  })

  it('errors on a chapter the book does not have', () => {
    const r = resolve(ref('3 John 2:1'))
    expect(isResolveError(r) && r.error).toBe('no-such-chapter')
  })

  it('errors on a verse the chapter does not have', () => {
    const r = resolve(ref('John 3:99'))
    expect(isResolveError(r) && r.error).toBe('no-such-verse')
  })
})

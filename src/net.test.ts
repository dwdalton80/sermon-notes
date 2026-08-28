import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createWsTransport, type WsLike } from './net.js'
import type { ServerEvent } from './events.js'

class FakeWs implements WsLike {
  sent: Array<string | ArrayBufferView> = []
  closed = false
  onopen: ((ev?: unknown) => void) | null = null
  onmessage: ((ev: { data: unknown }) => void) | null = null
  onclose: ((ev?: unknown) => void) | null = null
  onerror: ((ev?: unknown) => void) | null = null
  readonly url: string
  constructor(url: string) {
    this.url = url
  }
  send(d: string | ArrayBufferView) {
    this.sent.push(d)
  }
  close() {
    this.closed = true
    this.onclose?.()
  }
  open() {
    this.onopen?.()
  }
  message(data: unknown) {
    this.onmessage?.({ data })
  }
}

function setup(opts: { failSessions?: number } = {}) {
  const sockets: FakeWs[] = []
  let sessionCount = 0
  let failLeft = opts.failSessions ?? 0
  const fetchFn = vi.fn(async () => {
    sessionCount++
    if (failLeft > 0) {
      failLeft--
      return { ok: false, status: 503, json: async () => ({}) } as unknown as Response
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ sessionId: `s${sessionCount}`, wsUrl: 'ignored' }),
    } as unknown as Response
  })
  const events: ServerEvent[] = []
  const t = createWsTransport({
    baseUrl: 'http://host:8787',
    fetchFn: fetchFn as unknown as typeof fetch,
    wsFactory: (url) => {
      const w = new FakeWs(url)
      sockets.push(w)
      return w
    },
    reconnectDelays: [1000, 2000],
    newSessionAfter: 3,
  })
  t.onEvent((e) => events.push(e))
  return { t, sockets, events, fetchFn }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('createWsTransport', () => {
  it('creates a session and connects a ws to /ws/<id>', async () => {
    const { t, sockets, fetchFn } = setup()
    await t.start()
    expect(fetchFn).toHaveBeenCalledWith('http://host:8787/sessions', { method: 'POST' })
    expect(sockets).toHaveLength(1)
    expect(sockets[0]!.url).toBe('ws://host:8787/ws/s1')
    expect(t.sessionId).toBe('s1')
  })

  it('buffers pcm until open, then flushes; sends directly after', async () => {
    const { t, sockets } = setup()
    await t.start()
    t.sendPcm(new Uint8Array([1]))
    t.sendPcm(new Uint8Array([2]))
    expect(sockets[0]!.sent).toHaveLength(0)
    sockets[0]!.open()
    expect(sockets[0]!.sent).toHaveLength(2)
    t.sendPcm(new Uint8Array([3]))
    expect(sockets[0]!.sent).toHaveLength(3)
  })

  it('parses inbound JSON into ServerEvents', async () => {
    const { t, sockets, events } = setup()
    await t.start()
    sockets[0]!.open()
    sockets[0]!.message(JSON.stringify({ type: 'verse', ref: 'John 3:16', translation: 'KJV', text: 'x', truncated: false }))
    expect(events.some((e) => e.type === 'verse' && e.ref === 'John 3:16')).toBe(true)
  })

  it('reconnects with backoff, reusing the session', async () => {
    const { t, sockets, events } = setup()
    await t.start()
    sockets[0]!.open()
    sockets[0]!.close() // drop
    expect(events.some((e) => e.type === 'status' && e.state === 'reconnecting')).toBe(true)
    await vi.advanceTimersByTimeAsync(1000)
    expect(sockets).toHaveLength(2)
    expect(sockets[1]!.url).toBe('ws://host:8787/ws/s1') // same session
  })

  it('asks for a fresh session after repeated failures', async () => {
    const { t, sockets, fetchFn } = setup()
    await t.start()
    sockets[0]!.open()
    sockets[0]!.close()
    // attempt 1, 2 reuse s1; attempt 3 crosses newSessionAfter -> new session
    await vi.advanceTimersByTimeAsync(1000)
    sockets[1]!.close()
    await vi.advanceTimersByTimeAsync(2000)
    sockets[2]!.close()
    await vi.advanceTimersByTimeAsync(2000)
    expect(fetchFn).toHaveBeenCalledTimes(2)
    expect(t.sessionId).toBe('s2')
  })

  it('stop halts reconnection', async () => {
    const { t, sockets } = setup()
    await t.start()
    sockets[0]!.open()
    t.stop()
    sockets[0]!.close()
    await vi.advanceTimersByTimeAsync(5000)
    expect(sockets).toHaveLength(1)
  })

  it('finish sends a finish control frame', async () => {
    const { t, sockets } = setup()
    await t.start()
    sockets[0]!.open()
    t.finish()
    expect(sockets[0]!.sent).toContain(JSON.stringify({ type: 'finish' }))
  })
})

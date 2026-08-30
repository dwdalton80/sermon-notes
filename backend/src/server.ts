import { randomUUID } from 'node:crypto'
import type { IncomingMessage } from 'node:http'

// Load backend/.env if present (gitignored; holds provider API keys).
try {
  process.loadEnvFile(new URL('../.env', import.meta.url))
} catch {
  /* no .env — rely on the ambient environment */
}

import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serve } from '@hono/node-server'
import { WebSocketServer, type WebSocket } from 'ws'
import { Session } from './session.js'
import { createStt } from './stt.js'
import { createSummarizer } from './summarize.js'
import { loadFixture } from './fixture.js'
import { WavCapture } from './capture.js'
import { encode, type ClientMessage } from './events.js'

const PORT = Number(process.env.PORT ?? 8787)
const FIXTURE = process.env.FIXTURE ?? 'acts2'
const CAPTURE_WAV = process.env.CAPTURE_WAV === '1'

interface Entry {
  session: Session
  sockets: Set<WebSocket>
  capture?: WavCapture
  audio?: Buffer // finished WAV, available after a `finish` message
}
const sessions = new Map<string, Entry>()

function newSession(sessionId: string): Session {
  // Stage 2: mock providers seeded from a fixture. Stage 3 swaps in real ones.
  const fx = loadFixture(FIXTURE)
  const session = new Session(sessionId, {
    stt: createStt(fx.segments),
    summarizer: createSummarizer(fx.summaries),
  })
  session.onEvent((ev) => {
    const entry = sessions.get(sessionId)
    if (!entry) return
    for (const ws of entry.sockets) {
      if (ws.readyState === ws.OPEN) ws.send(encode(ev))
    }
  })
  return session
}

const app = new Hono()
app.use('*', cors())
app.get('/healthz', (c) => c.json({ ok: true, sessions: sessions.size }))
app.post('/sessions', (c) => {
  const sessionId = randomUUID()
  sessions.set(sessionId, {
    session: newSession(sessionId),
    sockets: new Set(),
    capture: CAPTURE_WAV ? new WavCapture() : undefined,
  })
  const wsUrl = `${wsBase(c.req.header('host'))}/ws/${sessionId}`
  return c.json({ sessionId, wsUrl })
})

// Debug (CAPTURE_WAV=1): the raw glasses audio for a finished session, as a
// 16 kHz mono WAV — drop it in backend/fixtures/ and replay with `npm run feed`.
app.get('/sessions/:id/audio.wav', (c) => {
  const entry = sessions.get(c.req.param('id'))
  if (!entry?.audio) return c.text('no capture for this session', 404)
  return new Response(new Uint8Array(entry.audio), {
    status: 200,
    headers: {
      'content-type': 'audio/wav',
      'content-disposition': `attachment; filename="${c.req.param('id')}.wav"`,
    },
  })
})

function wsBase(host?: string): string {
  const h = host ?? `localhost:${PORT}`
  const scheme = h.startsWith('localhost') || h.startsWith('127.') ? 'ws' : 'wss'
  return `${scheme}://${h}`
}

const server = serve({ fetch: app.fetch, port: PORT, hostname: '0.0.0.0' }, (info) => {
  const stt = process.env.STT_PROVIDER === 'deepgram' ? 'deepgram' : 'MOCK'
  const sum =
    process.env.SUMMARIZER_PROVIDER === 'gemini'
      ? 'gemini'
      : process.env.SUMMARIZER_PROVIDER === 'claude'
        ? 'claude'
        : 'MOCK'
  console.log(`sermon-notes backend on :${info.port}  stt=${stt}  summarizer=${sum}`)
  if (stt === 'MOCK' || sum === 'MOCK') {
    console.warn(
      '[config] a provider is MOCK — set STT_PROVIDER=deepgram / SUMMARIZER_PROVIDER=gemini (+ their API keys) for real output',
    )
  }
})

const wss = new WebSocketServer({ noServer: true })

server.on('upgrade', (req: IncomingMessage, socket, head) => {
  const m = /^\/ws\/([0-9a-f-]{36})$/.exec(new URL(req.url ?? '', 'http://x').pathname)
  const entry = m ? sessions.get(m[1]!) : undefined
  if (!entry) {
    socket.destroy()
    return
  }
  wss.handleUpgrade(req, socket, head, (ws) => attach(ws, m![1]!, entry))
})

function attach(ws: WebSocket, sessionId: string, entry: Entry): void {
  const reconnect = entry.sockets.size > 0 || entry.session.transcriptText.length > 0
  entry.sockets.add(ws)
  ws.send(encode({ type: 'session', sessionId, resumed: reconnect }))

  if (reconnect) {
    entry.session.markGap()
    for (const ev of entry.session.replayState()) ws.send(encode(ev))
  }

  ws.on('message', (data: Buffer, isBinary: boolean) => {
    if (isBinary) {
      const frame = new Uint8Array(data)
      entry.capture?.write(frame)
      entry.session.pushPcm(frame)
      return
    }
    let msg: ClientMessage
    try {
      msg = JSON.parse(data.toString()) as ClientMessage
    } catch {
      return
    }
    if (msg.type === 'finish') {
      void entry.session.finish()
      if (entry.capture) {
        entry.audio = entry.capture.toWav()
        console.log(
          `[capture] session ${sessionId}: ${entry.capture.seconds.toFixed(0)}s, ` +
            `${(entry.audio.length / 1e6).toFixed(1)} MB` +
            `${entry.capture.truncated ? ' (truncated at cap)' : ''} — ` +
            `download GET /sessions/${sessionId}/audio.wav`,
        )
      }
    }
  })

  ws.on('close', () => {
    entry.sockets.delete(ws)
    // keep the session in memory so a reconnect can resume; hold it much longer
    // when a capture is waiting to be downloaded
    const ttl = entry.audio ? 30 * 60_000 : 60_000
    setTimeout(() => {
      const e = sessions.get(sessionId)
      if (e && e.sockets.size === 0) sessions.delete(sessionId)
    }, ttl).unref()
  })
}

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
import { encode, type ClientMessage } from './events.js'

const PORT = Number(process.env.PORT ?? 8787)
const FIXTURE = process.env.FIXTURE ?? 'acts2'

interface Entry {
  session: Session
  sockets: Set<WebSocket>
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
  sessions.set(sessionId, { session: newSession(sessionId), sockets: new Set() })
  const wsUrl = `${wsBase(c.req.header('host'))}/ws/${sessionId}`
  return c.json({ sessionId, wsUrl })
})

function wsBase(host?: string): string {
  const h = host ?? `localhost:${PORT}`
  const scheme = h.startsWith('localhost') || h.startsWith('127.') ? 'ws' : 'wss'
  return `${scheme}://${h}`
}

const server = serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`sermon-notes backend on :${info.port}  (fixture: ${FIXTURE})`)
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
      entry.session.pushPcm(new Uint8Array(data))
      return
    }
    let msg: ClientMessage
    try {
      msg = JSON.parse(data.toString()) as ClientMessage
    } catch {
      return
    }
    if (msg.type === 'finish') void entry.session.finish()
  })

  ws.on('close', () => {
    entry.sockets.delete(ws)
    // keep the session in memory briefly so a reconnect can resume
    setTimeout(() => {
      const e = sessions.get(sessionId)
      if (e && e.sockets.size === 0) sessions.delete(sessionId)
    }, 60_000).unref()
  })
}

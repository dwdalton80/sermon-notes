import type { Feed } from './feed.js'
import type { ServerEvent } from './events.js'

export interface Transport extends Feed {
  start(): Promise<void>
  sendPcm(frame: Uint8Array): void
  readonly sessionId: string | null
}

export interface WsLike {
  send(data: string | ArrayBufferView): void
  close(): void
  onopen: ((ev?: unknown) => void) | null
  onmessage: ((ev: { data: unknown }) => void) | null
  onclose: ((ev?: unknown) => void) | null
  onerror: ((ev?: unknown) => void) | null
}

export interface TransportOpts {
  /** e.g. http://192.168.1.50:8787 */
  baseUrl: string
  fetchFn?: typeof fetch
  wsFactory?: (url: string) => WsLike
  reconnectDelays?: number[]
  /** consecutive reconnect failures before asking for a fresh session */
  newSessionAfter?: number
  /** cap on PCM frames buffered while disconnected (~250ms each) */
  maxPendingFrames?: number
}

const DEFAULT_DELAYS = [1000, 2000, 4000, 8000, 15000]

export function createWsTransport(opts: TransportOpts): Transport {
  const fetchFn = opts.fetchFn ?? fetch
  const wsFactory = opts.wsFactory ?? ((url: string) => new WebSocket(url) as unknown as WsLike)
  const delays = opts.reconnectDelays ?? DEFAULT_DELAYS
  const newSessionAfter = opts.newSessionAfter ?? 4
  const maxPending = opts.maxPendingFrames ?? 240

  const cbs: Array<(ev: ServerEvent) => void> = []
  const pending: Uint8Array[] = []
  let ws: WsLike | null = null
  let wsOpen = false
  let sessionId: string | null = null
  let stopped = false
  let attempt = 0
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null

  const emit = (ev: ServerEvent) => cbs.forEach((cb) => cb(ev))

  async function createSession(): Promise<void> {
    const res = await fetchFn(`${opts.baseUrl}/sessions`, { method: 'POST' })
    if (!res.ok) throw new Error(`POST /sessions -> ${res.status}`)
    const body = (await res.json()) as { sessionId: string }
    sessionId = body.sessionId
  }

  function wsUrl(): string {
    return `${opts.baseUrl.replace(/^http/, 'ws')}/ws/${sessionId}`
  }

  function connect(): void {
    if (stopped || !sessionId) return
    const sock = wsFactory(wsUrl())
    ws = sock

    sock.onopen = () => {
      attempt = 0
      wsOpen = true
      for (const f of pending.splice(0)) sock.send(f)
      emit({ type: 'status', state: 'listening' })
    }
    sock.onmessage = (ev) => {
      let parsed: ServerEvent
      try {
        parsed = JSON.parse(String(ev.data)) as ServerEvent
      } catch {
        return
      }
      emit(parsed)
    }
    sock.onerror = () => sock.close()
    sock.onclose = () => {
      if (ws === sock) {
        ws = null
        wsOpen = false
      }
      scheduleReconnect()
    }
  }

  function scheduleReconnect(): void {
    if (stopped || reconnectTimer) return
    emit({ type: 'status', state: 'reconnecting' })
    const delay = delays[Math.min(attempt, delays.length - 1)]!
    reconnectTimer = setTimeout(async () => {
      reconnectTimer = null
      attempt++
      try {
        if (attempt >= newSessionAfter) {
          await createSession()
          attempt = 0
        }
        connect()
      } catch {
        scheduleReconnect()
      }
    }, delay)
  }

  return {
    get sessionId() {
      return sessionId
    },
    async start() {
      stopped = false
      await createSession()
      connect()
    },
    sendPcm(frame) {
      if (ws && wsOpen && !stopped) {
        try {
          ws.send(frame)
          return
        } catch {
          /* fall through to buffering */
        }
      }
      pending.push(frame)
      while (pending.length > maxPending) pending.shift()
    },
    onEvent(cb) {
      cbs.push(cb)
    },
    finish() {
      try {
        ws?.send(JSON.stringify({ type: 'finish' }))
      } catch {
        /* ignore */
      }
    },
    stop() {
      stopped = true
      wsOpen = false
      if (reconnectTimer) {
        clearTimeout(reconnectTimer)
        reconnectTimer = null
      }
      try {
        ws?.close()
      } catch {
        /* ignore */
      }
      ws = null
    },
  }
}

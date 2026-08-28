import { DeepgramClient } from '@deepgram/sdk'
import type { SttStream, TranscriptSegment } from './stt.js'

/** Real streaming STT over Deepgram (SDK v5, `listen.v1` websocket).
 *  Audio in is PCM 16 kHz / s16le / mono — exactly what the glasses deliver.
 *  The SDK's socket reconnects on its own; we surface status changes upward. */
export function createDeepgramStt(apiKey: string): SttStream {
  const dg = new DeepgramClient({ apiKey })
  const transcriptCbs: Array<(s: TranscriptSegment) => void> = []
  const statusCbs: Array<(s: 'open' | 'closed' | 'error') => void> = []

  let socket: Awaited<ReturnType<typeof dg.listen.v1.createConnection>> | null = null
  let isOpen = false
  let closed = false
  const pending: Uint8Array[] = []
  let awaitingFinalize: (() => void) | null = null

  const emitStatus = (s: 'open' | 'closed' | 'error') => statusCbs.forEach((cb) => cb(s))

  dg.listen.v1
    .createConnection({
      model: 'nova-3',
      language: 'en',
      encoding: 'linear16',
      sample_rate: 16000,
      channels: 1,
      interim_results: 'true',
      smart_format: 'true',
      punctuate: 'true',
      numerals: 'true', // "chapter two verse eight" -> "chapter 2 verse 8"
    })
    .then((s) => {
      if (closed) {
        s.close()
        return
      }
      socket = s
      s.on('open', () => {
        isOpen = true
        console.log(`[deepgram] connected (${pending.length} frames buffered)`)
        for (const f of pending.splice(0)) s.sendMedia(f)
        emitStatus('open')
      })
      s.on('message', (msg: unknown) => {
        const r = msg as {
          type?: string
          is_final?: boolean
          channel?: { alternatives?: Array<{ transcript?: string }> }
        }
        if (r.type !== 'Results') return
        const rf = msg as { from_finalize?: boolean }
        const text = r.channel?.alternatives?.[0]?.transcript ?? ''
        if (text) {
          if (r.is_final === true) console.log(`[deepgram] «${text}»`)
          transcriptCbs.forEach((cb) => cb({ text, isFinal: r.is_final === true }))
        }
        if (rf.from_finalize && awaitingFinalize) {
          const done = awaitingFinalize
          awaitingFinalize = null
          done()
        }
      })
      s.on('error', (err) => {
        console.error('[deepgram] error:', err instanceof Error ? err.message : err)
        emitStatus('error')
      })
      s.on('close', () => {
        isOpen = false
        console.log('[deepgram] closed')
        emitStatus('closed')
      })
      s.connect()
    })
    .catch(() => emitStatus('error'))

  const keepAlive = setInterval(() => {
    if (isOpen && socket) {
      try {
        socket.sendKeepAlive({ type: 'KeepAlive' } as never)
      } catch {
        /* ignore */
      }
    }
  }, 8000)
  keepAlive.unref?.()

  return {
    pushPcm(frame) {
      if (closed) return
      if (isOpen && socket) socket.sendMedia(frame)
      else pending.push(frame)
    },
    onTranscript(cb) {
      transcriptCbs.push(cb)
    },
    onStatus(cb) {
      statusCbs.push(cb)
      if (isOpen) cb('open')
    },
    finalize() {
      if (closed || !isOpen || !socket) return Promise.resolve()
      for (const f of pending.splice(0)) socket.sendMedia(f)
      return new Promise<void>((res) => {
        const timer = setTimeout(() => {
          awaitingFinalize = null
          res()
        }, 3000)
        timer.unref?.()
        awaitingFinalize = () => {
          clearTimeout(timer)
          res()
        }
        try {
          socket!.sendFinalize({ type: 'Finalize' })
        } catch {
          clearTimeout(timer)
          awaitingFinalize = null
          res()
        }
      })
    },
    close() {
      closed = true
      clearInterval(keepAlive)
      try {
        socket?.sendCloseStream({ type: 'CloseStream' } as never)
      } catch {
        /* ignore */
      }
      try {
        socket?.close()
      } catch {
        /* ignore */
      }
    },
  }
}

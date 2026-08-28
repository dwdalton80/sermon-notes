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
    })
    .then((s) => {
      if (closed) {
        s.close()
        return
      }
      socket = s
      s.on('open', () => {
        isOpen = true
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
        const text = r.channel?.alternatives?.[0]?.transcript ?? ''
        if (!text) return
        transcriptCbs.forEach((cb) => cb({ text, isFinal: r.is_final === true }))
      })
      s.on('error', () => emitStatus('error'))
      s.on('close', () => {
        isOpen = false
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

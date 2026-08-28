/** Streaming speech-to-text abstraction. The mock is driven by a script of
 *  segments (one emitted per PCM frame pushed) so tests stay deterministic and
 *  offline. `stt.deepgram.ts` provides the real implementation. */
import { createDeepgramStt } from './stt.deepgram.js'

export interface TranscriptSegment {
  text: string
  isFinal: boolean
}

export interface SttStream {
  pushPcm(frame: Uint8Array): void
  onTranscript(cb: (seg: TranscriptSegment) => void): void
  onStatus(cb: (s: 'open' | 'closed' | 'error') => void): void
  /** Flush any buffered audio and resolve once trailing results have arrived
   *  (or a short timeout). Called before the final summary pass. */
  finalize(): Promise<void>
  close(): void
}

export function createMockStt(finalSegments: string[]): SttStream {
  const queue = [...finalSegments]
  const transcriptCbs: Array<(s: TranscriptSegment) => void> = []
  const statusCbs: Array<(s: 'open' | 'closed' | 'error') => void> = []
  let open = true

  queueMicrotask(() => statusCbs.forEach((cb) => cb('open')))

  return {
    pushPcm() {
      if (!open) return
      const next = queue.shift()
      if (next === undefined) return
      transcriptCbs.forEach((cb) => cb({ text: next, isFinal: true }))
    },
    onTranscript(cb) {
      transcriptCbs.push(cb)
    },
    onStatus(cb) {
      statusCbs.push(cb)
      if (open) cb('open')
    },
    async finalize() {
      // mock has nothing in flight
    },
    close() {
      open = false
      statusCbs.forEach((cb) => cb('closed'))
    },
  }
}

/** Provider factory. `STT_PROVIDER=deepgram` uses real streaming STT; anything
 *  else replays `mockSegments` (the fixture) one per PCM frame. */
export function createStt(mockSegments: string[]): SttStream {
  if (process.env.STT_PROVIDER === 'deepgram') {
    const key = process.env.DEEPGRAM_API_KEY
    if (!key) throw new Error('STT_PROVIDER=deepgram but DEEPGRAM_API_KEY is not set')
    return createDeepgramStt(key)
  }
  return createMockStt(mockSegments)
}

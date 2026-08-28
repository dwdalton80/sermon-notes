/** Streaming speech-to-text abstraction. The mock is driven by a script of
 *  segments (one emitted per PCM frame pushed) so tests stay deterministic and
 *  offline. Stage 3 adds a Deepgram-backed implementation behind the same
 *  interface. */

export interface TranscriptSegment {
  text: string
  isFinal: boolean
}

export interface SttStream {
  pushPcm(frame: Uint8Array): void
  onTranscript(cb: (seg: TranscriptSegment) => void): void
  onStatus(cb: (s: 'open' | 'closed' | 'error') => void): void
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
    close() {
      open = false
      statusCbs.forEach((cb) => cb('closed'))
    },
  }
}

/** Provider factory. Stage 2 only has the mock; the fixture supplies its script. */
export function createStt(mockSegments: string[]): SttStream {
  // Stage 3: if (process.env.STT_PROVIDER === 'deepgram') return createDeepgramStt()
  return createMockStt(mockSegments)
}

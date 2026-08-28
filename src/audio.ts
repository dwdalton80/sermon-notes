// Glasses-mic capture. The G2 four-mic array delivers PCM 16 kHz / signed
// 16-bit LE / mono as `event.audioEvent.audioPcm` (Uint8Array) through
// onEvenHubEvent, in whatever chunk sizes the host sends. We re-batch it into
// fixed ~250 ms frames before handing it to the transport.

const SAMPLE_RATE = 16000
const BYTES_PER_SAMPLE = 2
const FRAME_MS = 250
export const FRAME_BYTES = (SAMPLE_RATE * BYTES_PER_SAMPLE * FRAME_MS) / 1000 // 8000

/** Accumulates arbitrary byte chunks and emits fixed-size frames. */
export class FrameBatcher {
  private buf = new Uint8Array(0)
  private readonly frameBytes: number
  private readonly onFrame: (frame: Uint8Array) => void

  constructor(onFrame: (frame: Uint8Array) => void, frameBytes = FRAME_BYTES) {
    this.onFrame = onFrame
    this.frameBytes = frameBytes
  }

  push(chunk: Uint8Array): void {
    if (chunk.length === 0) return
    const merged = new Uint8Array(this.buf.length + chunk.length)
    merged.set(this.buf, 0)
    merged.set(chunk, this.buf.length)
    this.buf = merged
    while (this.buf.length >= this.frameBytes) {
      this.onFrame(this.buf.slice(0, this.frameBytes))
      this.buf = this.buf.slice(this.frameBytes)
    }
  }

  /** Emit whatever is left (called on stop), padded to a whole sample. */
  flush(): void {
    if (this.buf.length >= BYTES_PER_SAMPLE) {
      const n = this.buf.length - (this.buf.length % BYTES_PER_SAMPLE)
      this.onFrame(this.buf.slice(0, n))
    }
    this.buf = new Uint8Array(0)
  }
}

// Minimal bridge surface for audio; the real EvenAppBridge satisfies it.
export interface AudioBridge {
  audioControl(isOpen: boolean, source?: unknown): Promise<boolean>
  onEvenHubEvent(cb: (event: { audioEvent?: { audioPcm?: Uint8Array } }) => void): unknown
}

export interface AudioCapture {
  start(): Promise<void>
  pause(): Promise<void>
  resume(): Promise<void>
  stop(): Promise<void>
}

/** Wire glasses-mic audio into `onFrame`. `glassesSource` is the SDK's
 *  AudioInputSource.Glasses value, passed through opaquely. */
export function createAudioCapture(
  bridge: AudioBridge,
  onFrame: (frame: Uint8Array) => void,
  glassesSource: unknown,
): AudioCapture {
  const batcher = new FrameBatcher(onFrame)
  let capturing = false

  bridge.onEvenHubEvent((event) => {
    const pcm = event.audioEvent?.audioPcm
    if (capturing && pcm && pcm.length) batcher.push(pcm)
  })

  return {
    async start() {
      capturing = true
      await bridge.audioControl(true, glassesSource)
    },
    async pause() {
      capturing = false
      await bridge.audioControl(false)
    },
    async resume() {
      capturing = true
      await bridge.audioControl(true, glassesSource)
    },
    async stop() {
      capturing = false
      await bridge.audioControl(false)
      batcher.flush()
    },
  }
}

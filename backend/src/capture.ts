/** Debug-only: tee the incoming PCM stream into an in-memory WAV so a real
 *  glasses recording can be pulled back and replayed through `npm run feed`
 *  for tuning. Enabled with CAPTURE_WAV=1 — never leave it on for real users,
 *  it holds the whole session's audio in memory until the session is dropped
 *  (~1.9 MB/min of s16le mono). */
const SAMPLE_RATE = 16_000
const BYTES_PER_SEC = SAMPLE_RATE * 2
const MAX_BYTES = BYTES_PER_SEC * 60 * 100 // ~100 min safety cap

export class WavCapture {
  private readonly chunks: Buffer[] = []
  private len = 0
  private capped = false

  write(frame: Uint8Array): void {
    if (this.len + frame.length > MAX_BYTES) {
      this.capped = true
      return
    }
    const b = Buffer.from(frame)
    this.chunks.push(b)
    this.len += b.length
  }

  get seconds(): number {
    return this.len / BYTES_PER_SEC
  }

  /** true if audio was dropped after hitting the safety cap */
  get truncated(): boolean {
    return this.capped
  }

  toWav(): Buffer {
    const header = Buffer.alloc(44)
    header.write('RIFF', 0, 'ascii')
    header.writeUInt32LE(36 + this.len, 4)
    header.write('WAVE', 8, 'ascii')
    header.write('fmt ', 12, 'ascii')
    header.writeUInt32LE(16, 16) // fmt chunk size
    header.writeUInt16LE(1, 20) // PCM
    header.writeUInt16LE(1, 22) // mono
    header.writeUInt32LE(SAMPLE_RATE, 24)
    header.writeUInt32LE(BYTES_PER_SEC, 28) // byte rate
    header.writeUInt16LE(2, 32) // block align
    header.writeUInt16LE(16, 34) // bits per sample
    header.write('data', 36, 'ascii')
    header.writeUInt32LE(this.len, 40)
    return Buffer.concat([header, ...this.chunks], 44 + this.len)
  }
}

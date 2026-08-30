import { describe, it, expect } from 'vitest'
import { WavCapture } from './capture.js'

/** n samples of arbitrary s16le mono audio */
function s16(n: number): Uint8Array {
  const b = Buffer.alloc(n * 2)
  for (let i = 0; i < n; i++) b.writeInt16LE(((i * 7) % 1000) - 500, i * 2)
  return new Uint8Array(b)
}

describe('WavCapture', () => {
  it('emits a valid 16 kHz mono s16le WAV', () => {
    const c = new WavCapture()
    c.write(s16(16_000)) // 1s
    c.write(s16(16_000)) // 1s
    const w = c.toWav()
    const dataLen = 16_000 * 2 * 2

    expect(w.toString('ascii', 0, 4)).toBe('RIFF')
    expect(w.readUInt32LE(4)).toBe(36 + dataLen)
    expect(w.toString('ascii', 8, 12)).toBe('WAVE')
    expect(w.toString('ascii', 12, 16)).toBe('fmt ')
    expect(w.readUInt16LE(20)).toBe(1) // PCM
    expect(w.readUInt16LE(22)).toBe(1) // mono
    expect(w.readUInt32LE(24)).toBe(16_000) // sample rate
    expect(w.readUInt32LE(28)).toBe(32_000) // byte rate
    expect(w.readUInt16LE(32)).toBe(2) // block align
    expect(w.readUInt16LE(34)).toBe(16) // bits
    expect(w.toString('ascii', 36, 40)).toBe('data')
    expect(w.readUInt32LE(40)).toBe(dataLen)
    expect(w.length).toBe(44 + dataLen)
    expect(c.seconds).toBeCloseTo(2, 5)
    expect(c.truncated).toBe(false)
  })

  it('preserves the PCM bytes after the 44-byte header', () => {
    const c = new WavCapture()
    const frame = s16(4000)
    c.write(frame)
    const w = c.toWav()
    expect(Buffer.from(w.subarray(44)).equals(Buffer.from(frame))).toBe(true)
  })
})

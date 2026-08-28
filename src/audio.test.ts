import { describe, it, expect, vi } from 'vitest'
import { FrameBatcher, FRAME_BYTES, createAudioCapture, type AudioBridge } from './audio.js'

describe('FrameBatcher', () => {
  it('emits fixed-size frames and keeps the remainder', () => {
    const frames: number[] = []
    const b = new FrameBatcher((f) => frames.push(f.length), 100)
    b.push(new Uint8Array(60))
    expect(frames).toEqual([]) // not enough yet
    b.push(new Uint8Array(60))
    expect(frames).toEqual([100]) // 120 in → one 100-frame, 20 buffered
    b.push(new Uint8Array(180))
    expect(frames).toEqual([100, 100, 100]) // 20 + 180 = 200 → two more
  })

  it('flush emits the tail rounded to whole samples', () => {
    const frames: number[] = []
    const b = new FrameBatcher((f) => frames.push(f.length), 100)
    b.push(new Uint8Array(45))
    b.flush()
    expect(frames).toEqual([44]) // odd byte dropped
  })

  it('default frame size is 250ms of 16k mono s16le', () => {
    expect(FRAME_BYTES).toBe(8000)
  })
})

describe('createAudioCapture', () => {
  function fakeBridge() {
    let handler: ((e: { audioEvent?: { audioPcm?: Uint8Array } }) => void) | null = null
    const calls: Array<[boolean, unknown]> = []
    const bridge: AudioBridge = {
      async audioControl(open, source) {
        calls.push([open, source])
        return true
      },
      onEvenHubEvent(cb) {
        handler = cb as typeof handler
        return undefined
      },
    }
    return { bridge, calls, emit: (pcm: Uint8Array) => handler?.({ audioEvent: { audioPcm: pcm } }) }
  }

  it('opens the glasses mic on start and batches incoming audio', async () => {
    const { bridge, calls, emit } = fakeBridge()
    const frames: Uint8Array[] = []
    const cap = createAudioCapture(bridge, (f) => frames.push(f), 'GLASSES')
    await cap.start()
    expect(calls[0]).toEqual([true, 'GLASSES'])

    emit(new Uint8Array(5000))
    emit(new Uint8Array(5000))
    expect(frames).toHaveLength(1)
    expect(frames[0]!.length).toBe(8000)
  })

  it('ignores audio while paused, resumes after', async () => {
    const { bridge, calls, emit } = fakeBridge()
    const frames: Uint8Array[] = []
    const cap = createAudioCapture(bridge, (f) => frames.push(f), 'GLASSES')
    await cap.start()
    await cap.pause()
    expect(calls.at(-1)).toEqual([false, undefined])
    emit(new Uint8Array(16000)) // dropped
    expect(frames).toHaveLength(0)
    await cap.resume()
    emit(new Uint8Array(16000))
    expect(frames).toHaveLength(2)
  })

  it('stop closes the mic and flushes the tail', async () => {
    const { bridge, calls, emit } = fakeBridge()
    const frames: Uint8Array[] = []
    const cap = createAudioCapture(bridge, (f) => frames.push(f), 'GLASSES')
    await cap.start()
    emit(new Uint8Array(2000))
    await cap.stop()
    expect(calls.at(-1)).toEqual([false, undefined])
    expect(frames).toHaveLength(1)
    expect(frames[0]!.length).toBe(2000)
    void vi
  })
})

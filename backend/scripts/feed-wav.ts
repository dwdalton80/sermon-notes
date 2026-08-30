/**
 * Stream a WAV file to a running backend as if it were live glasses audio.
 * The WAV must be PCM 16-bit, 16 kHz, mono (what the G2 mics deliver).
 *
 *   npm --prefix backend run dev            # in one terminal (STT_PROVIDER=deepgram)
 *   npm --prefix backend run feed -- sermon.wav [http://localhost:8787]
 *
 * Convert an arbitrary recording first, e.g.:
 *   ffmpeg -i input.m4a -ac 1 -ar 16000 -sample_fmt s16 sermon.wav
 */
import { readFileSync } from 'node:fs'
import WebSocket from 'ws'

const file = process.argv[2]
const base = process.argv[3] ?? 'http://localhost:8787'
if (!file) {
  console.error('usage: feed-wav <file.wav> [baseUrl]')
  process.exit(1)
}

function pcmFromWav(buf: Buffer): Buffer {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('not a WAV file')
  }
  let off = 12
  let fmt: { channels: number; rate: number; bits: number } | null = null
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4)
    const size = buf.readUInt32LE(off + 4)
    const body = off + 8
    if (id === 'fmt ') {
      fmt = {
        channels: buf.readUInt16LE(body + 2),
        rate: buf.readUInt32LE(body + 4),
        bits: buf.readUInt16LE(body + 14),
      }
    } else if (id === 'data') {
      if (!fmt) throw new Error('data chunk before fmt chunk')
      if (fmt.channels !== 1 || fmt.rate !== 16000 || fmt.bits !== 16) {
        throw new Error(
          `need 16 kHz mono 16-bit; got ${fmt.rate} Hz, ${fmt.channels}ch, ${fmt.bits}-bit`,
        )
      }
      return buf.subarray(body, body + size)
    }
    off = body + size + (size % 2)
  }
  throw new Error('no data chunk')
}

const pcm = pcmFromWav(readFileSync(file))
const FRAME = 16000 * 2 * 0.25 // 250 ms of s16le mono
// FEED_SPEED=3 sends frames 3x faster than real time (e.g. to replay a long
// recording quickly). Summaries are mostly char-threshold driven so the shape
// of the output holds up; keep it <=6 so Deepgram's stream stays happy.
const SPEED = Math.max(1, Number(process.env.FEED_SPEED ?? 1))
const FRAME_MS = 250 / SPEED

const { sessionId, wsUrl } = await (await fetch(`${base}/sessions`, { method: 'POST' })).json()
console.log(`session ${sessionId}`)
const ws = new WebSocket(wsUrl)

ws.on('message', (d) => {
  const ev = JSON.parse(d.toString())
  if (ev.type === 'summary') console.log(`\n[summary] ${ev.topic}\n  - ${ev.bullets.join('\n  - ')}`)
  else if (ev.type === 'verse') console.log(`\n[verse] ${ev.ref}\n  ${ev.text}`)
  else if (ev.type === 'notes') console.log(`\n[notes]\n${ev.markdown}`)
  else if (ev.type === 'status') console.log(`[status] ${ev.state}${ev.detail ? ' ' + ev.detail : ''}`)
})

ws.on('open', async () => {
  console.log(`streaming ${(pcm.length / (16000 * 2)).toFixed(1)}s of audio at ${SPEED}x...`)
  for (let i = 0; i < pcm.length; i += FRAME) {
    ws.send(pcm.subarray(i, Math.min(i + FRAME, pcm.length)))
    await new Promise((r) => setTimeout(r, FRAME_MS))
  }
  console.log('...audio sent, finishing')
  ws.send(JSON.stringify({ type: 'finish' }))
  await new Promise((r) => setTimeout(r, 20000))
  ws.close()
  process.exit(0)
})
ws.on('error', (e) => {
  console.error(e)
  process.exit(1)
})

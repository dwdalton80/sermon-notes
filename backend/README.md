# sermon-notes-backend

Backend for the live sermon study-notes glasses app. Streams PCM audio in over a
WebSocket, transcribes it (Deepgram), summarizes incrementally (Claude — Stage 3),
resolves scripture references against a bundled KJV, and pushes `summary` /
`verse` / `notes` events back to the phone WebView.

See `../docs/plans/2026-08-28-glasses-sermon-notes-design.md`.

## Setup

```bash
npm --prefix backend install
cp backend/.env.example backend/.env      # then fill in keys
npm --prefix backend run fetch-kjv        # one-time: builds src/scripture/kjv.json
```

`backend/.env` is gitignored. Providers are selected per-service:

| var | values | effect |
| --- | --- | --- |
| `STT_PROVIDER` | `deepgram` \| anything | real streaming STT, or mock fixture |
| `DEEPGRAM_API_KEY` | — | required when `STT_PROVIDER=deepgram` |
| `SUMMARIZER_PROVIDER` | `claude` \| anything | real summarizer (Stage 3), or mock fixture |
| `ANTHROPIC_API_KEY` | — | required when `SUMMARIZER_PROVIDER=claude` |
| `PORT` | default `8787` | |
| `FIXTURE` | default `acts2` | fixture used for any mocked provider |

## Run

```bash
npm --prefix backend run dev      # http://localhost:8787
npm --prefix backend test         # vitest
npm --prefix backend run typecheck
```

## Manual end-to-end test

Stream a recording as if it were live glasses audio (WAV must be 16 kHz mono
16-bit — `ffmpeg -i in.m4a -ac 1 -ar 16000 -sample_fmt s16 out.wav`):

```bash
# terminal 1
npm --prefix backend run dev
# terminal 2
npm --prefix backend run feed -- fixtures/sample-16k.wav
```

With `STT_PROVIDER=deepgram` set in `.env`, that same command exercises the real
transcription path.

## HTTP / WS surface

- `GET /healthz` → `{ ok, sessions }`
- `POST /sessions` → `{ sessionId, wsUrl }`
- `WS /ws/:sessionId`
  - client → server: binary frames = PCM; `{"type":"finish"}` to end
  - server → client: `session`, `summary`, `verse`, `status`, `notes` (see `src/events.ts`)
  - reconnecting to a live session replays the last `summary` + `verse` and
    inserts a `[gap]` marker in the transcript

# sermon-notes-backend

Backend for the live sermon study-notes glasses app. Streams PCM audio in over a
WebSocket, transcribes it (Deepgram), summarizes incrementally (Gemini or
Claude), resolves scripture references against a bundled KJV, and pushes
`summary` / `verse` / `notes` events back to the phone WebView.

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
| `SUMMARIZER_PROVIDER` | `gemini` \| `claude` \| anything | real summarizer, or mock fixture |
| `GEMINI_API_KEY` | — | required when `SUMMARIZER_PROVIDER=gemini` |
| `ANTHROPIC_API_KEY` | — | required when `SUMMARIZER_PROVIDER=claude` |
| `SUMMARIZER_MODEL` | — | optional model override (default `gemini-3.5-flash-lite` / `claude-opus-5`) |
| `PORT` | default `8787` | Fly sets `8080` |
| `FIXTURE` | default `acts2` | fixture used for any mocked provider |

## Run

```bash
npm --prefix backend run dev      # http://localhost:8787
npm --prefix backend test         # vitest
npm --prefix backend run typecheck
npm --prefix backend run build    # -> dist/ (compiled; kjv.json copied in)
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

## Deploy (Fly.io)

`fly.toml` and `Dockerfile` are in this directory. Fly builds remotely, so you
don't need Docker locally — just the `fly` CLI (`brew install flyctl`) and a
Fly account.

```bash
cd backend
fly auth login
fly launch --no-deploy --copy-config --name sermon-notes-backend   # first time
fly secrets set \
  STT_PROVIDER=deepgram        DEEPGRAM_API_KEY=... \
  SUMMARIZER_PROVIDER=gemini   GEMINI_API_KEY=...
fly deploy
```

`fly deploy` prints the app URL, e.g. `https://sermon-notes-backend.fly.dev`.
Then:

1. Verify: `curl https://sermon-notes-backend.fly.dev/healthz` → `{"ok":true,...}`
2. Point the glasses app at it — build with
   `VITE_BACKEND_URL=https://sermon-notes-backend.fly.dev npm run build`
   (from the repo root), or set it in a root `.env`.
3. Add the host to `app.json` → `permissions` → `network` → `whitelist`
   (both `https://…` and `wss://…`), replacing `REPLACE_WITH_BACKEND_HOST`.

WebSockets work over Fly's HTTP service with no extra config.
`auto_stop_machines = "suspend"` keeps idle cost near zero; the first request
after idle wakes the machine in ~1 s.

Render / Railway work the same way — point them at this `Dockerfile` and set the
same env vars.

## HTTP / WS surface

- `GET /healthz` → `{ ok, sessions }`
- `POST /sessions` → `{ sessionId, wsUrl }`
- `WS /ws/:sessionId`
  - client → server: binary frames = PCM; `{"type":"finish"}` to end
  - server → client: `session`, `summary`, `verse`, `status`, `notes` (see `src/events.ts`)
  - reconnecting to a live session replays the last `summary` + `verse` and
    inserts a `[gap]` marker in the transcript

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

## Deploy (Render — free, no card)

Render deploys from a connected Git repo, so the code needs to be on GitHub /
GitLab / Bitbucket (a **private** repo is fine). The Blueprint lives at the repo
root: [`render.yaml`](../render.yaml).

1. Push this repo to GitHub (see the repo root `README.md`).
2. In the Render dashboard: **New → Blueprint**, pick the repo. It reads
   `render.yaml` and creates `sermon-notes-backend` (Docker, free plan,
   health-checked at `/healthz`).
3. Open the service → **Environment** → add:
   - `DEEPGRAM_API_KEY` = your Deepgram key
   - `GEMINI_API_KEY` = your Google AI Studio key
   (`STT_PROVIDER=deepgram` and `SUMMARIZER_PROVIDER=gemini` come from the
   Blueprint.)
4. First deploy runs automatically. You get a URL like
   `https://sermon-notes-backend.onrender.com`.

Then:

1. Verify: `curl https://<your-app>.onrender.com/healthz` → `{"ok":true,...}`
2. Point the glasses app at it — build from the repo root with
   `VITE_BACKEND_URL=https://<your-app>.onrender.com npm run build`, or put that
   line in a repo-root `.env`.
3. Add the host to `app.json` → `permissions` → `network` → `whitelist`
   (both `https://…` and `wss://…`), replacing `REPLACE_WITH_BACKEND_HOST`.

Render's free web service **sleeps after ~15 min idle** and takes ~50 s to wake
on the next request. During a session there's continuous audio traffic so it
won't sleep mid-sermon — you just eat the wake-up on the first connect. Hitting
`/healthz` a minute before the service (or from the panel on open) avoids it.
Render sets `PORT` itself; the server honours it.

### Alternative: Fly.io (needs a card)

`fly.toml` + `Dockerfile` are set up. `brew install flyctl`, then:

```bash
cd backend && fly auth login
fly launch --no-deploy --copy-config --name sermon-notes-backend
fly secrets set STT_PROVIDER=deepgram DEEPGRAM_API_KEY=... SUMMARIZER_PROVIDER=gemini GEMINI_API_KEY=...
fly deploy
```

Fly deploys from the local folder (no Git repo needed) but requires a payment
method on file even for the near-zero idle tier.

## HTTP / WS surface

- `GET /healthz` → `{ ok, sessions }`
- `POST /sessions` → `{ sessionId, wsUrl }`
- `WS /ws/:sessionId`
  - client → server: binary frames = PCM; `{"type":"finish"}` to end
  - server → client: `session`, `summary`, `verse`, `status`, `notes` (see `src/events.ts`)
  - reconnecting to a live session replays the last `summary` + `verse` and
    inserts a `[gap]` marker in the transcript

# Sermon Notes — Even Realities G2

Live study notes on **Even Realities G2** smart glasses. During a message the
lens shows a rolling outline of the current point, and each scripture reference
takes over the screen briefly with its King James Version text. When the session
ends, the phone keeps a structured set of notes.

An Even app is a web app that runs inside the Even App WebView on the phone; the
glasses are the display. This repo has two parts:

| Path | What it is |
| --- | --- |
| `src/`, `app.json` | the glasses client (Vite + TS + `@evenrealities/even_hub_sdk`) |
| `backend/` | a Node/TS service: Deepgram STT → Gemini summarizer → scripture resolver → notes, over a WebSocket |
| `docs/plans/` | design + staged implementation plan |
| `docs/PRIVACY.md` | fill-in privacy policy for submission |

## Run it locally

```bash
# 1. deps
npm install
npm --prefix backend install

# 2. one-time: build the bundled KJV
npm --prefix backend run fetch-kjv

# 3. backend keys — see backend/.env.example
cp backend/.env.example backend/.env   # add DEEPGRAM_API_KEY + GEMINI_API_KEY

# 4. run: three terminals
npm --prefix backend run dev           # backend on :8787
npm run dev                            # Vite client on :5173
npm run sim                            # evenhub simulator
```

Without a backend the client falls back to a canned demo feed, so the glasses
UI still works for layout iteration.

## Tests

```bash
npm test                 # client (35)
npm --prefix backend test # backend (62)
```

## Deploy the backend

Free, no credit card: **Render**. See [`backend/README.md`](backend/README.md)
for the walkthrough. In short: push this repo to GitHub → Render **New →
Blueprint** picks up [`render.yaml`](render.yaml) → set `DEEPGRAM_API_KEY` and
`GEMINI_API_KEY` in the dashboard → you get a `https://…onrender.com` URL.

Then build the client against it and finish `app.json`:

```bash
VITE_BACKEND_URL=https://<your-app>.onrender.com npm run build
```

- Put the host in `app.json` → `permissions` → `network` → `whitelist`
  (both `https://…` and `wss://…`), replacing `REPLACE_WITH_BACKEND_HOST`.
- Publish `docs/PRIVACY.md` at a stable URL and link it in the submission.

## Package & submit

```bash
evenhub login
VITE_BACKEND_URL=https://<your-app>.onrender.com npm run build
evenhub pack app.json dist -o sermon-notes.ehpk -c
```

Upload the `.ehpk` at <https://hub.evenrealities.com> following the App
Submission & QA guidelines. Bump `version` in `app.json` per build.

## Push this repo to GitHub

The project is a local git repo with no remote yet. To deploy on Render you need
it on GitHub (a private repo is fine):

```bash
# option A: GitHub CLI
brew install gh && gh auth login
gh repo create sermon-notes --private --source=. --push

# option B: create the repo at github.com, then
git remote add origin git@github.com:<you>/sermon-notes.git
git push -u origin main
```

## Design constraints (G2)

- Display: 576 × 288 px per eye, monochrome green, 16 brightness levels
- No camera or speaker on the glasses; 4-mic array in, 16 kHz PCM
- Input: temple touchpads + optional R1 ring (tap / swipe / long-press)
- BLE 5.2 — keep payloads small
- Switch glasses "views" with `textContainerUpgrade` only; `rebuildPageContainer`
  flickers
- Root-page double-tap must call `shutDownPageContainer(1)`

## Docs

- Even Hub overview: <https://hub.evenrealities.com/docs/get-started/overview>
- Design: [`docs/plans/2026-08-28-glasses-sermon-notes-design.md`](docs/plans/2026-08-28-glasses-sermon-notes-design.md)
- Implementation plan: [`docs/plans/2026-08-28-sermon-notes-implementation-plan.md`](docs/plans/2026-08-28-sermon-notes-implementation-plan.md)

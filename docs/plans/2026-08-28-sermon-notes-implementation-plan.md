# Implementation Plan — Live Sermon Study-Notes (Even G2)

Date: 2026-08-28
Branch: `feat/sermon-notes`
Design: `docs/plans/2026-08-28-glasses-sermon-notes-design.md`

Work proceeds in stages. Each stage ends at a checkpoint that must pass before
the next begins. Each stage is one or more commits on the branch.

Repo shape: the existing Vite app stays at the repo root (`src/`, `app.json`,
`vite.config.ts`). The backend is a self-contained project in `backend/` with
its own `package.json`, `node_modules`, and `tsconfig.json` — no npm workspace
wiring for v1. Run backend scripts with `npm --prefix backend <script>`.

External accounts are needed only from Stage 3 onward.

---

## Stage 0 — Backend skeleton

- `backend/package.json` — `type: module`; dev deps `typescript`, `tsx`,
  `vitest`, `@types/node`; scripts `dev`, `build`, `test`, `typecheck`.
- `backend/tsconfig.json` — NodeNext, strict, `outDir dist`.
- `backend/src/index.ts` — placeholder.
- `.gitignore` — add `backend/node_modules`, `backend/dist`.

**Checkpoint:** `npm --prefix backend install` then `npm --prefix backend test`
runs (0 tests, exit 0); `npm --prefix backend run typecheck` clean.

---

## Stage 1 — Scripture engine (no network at runtime)

Location: `backend/src/scripture/`.

1. **KJV data acquisition.** `backend/scripts/fetch-kjv.mjs` downloads a
   public-domain KJV JSON (primary source: `scrollmapper` / `aruljohn Bible-kjv`
   / `thiagobodruk/bible`; the script tries sources in order), normalizes to
   `{ [osisBook]: { [chapter]: { [verse]: "text" } } }`, strips trailing
   pilcrows/formatting, and writes `backend/src/scripture/kjv.json`
   (committed to the repo — ~4.5 MB). Script is idempotent and re-runnable.

2. **`books.ts`** — canonical OSIS book list (66) with per-book chapter counts;
   `nameToOsis(input): string | null` accepting:
   - full names ("Genesis", "Song of Solomon", "Song of Songs", "Psalms",
     "Psalm", "Revelation", "Revelations")
   - common abbreviations ("Gen", "Ps", "1 Cor", "1Cor", "Jn", "Matt", "Mt",
     "Rom", "Rev", "Phil", "Philem", …)
   - spoken ordinals ("First Corinthians", "Second Kings", "Third John")
   - case- and punctuation-insensitive.

3. **`parse.ts`** — `parseReferences(text, ctx?): Ref[]`,
   `Ref = { raw, osisStart, osisEnd }` (OSIS `Book.Chapter.Verse`).
   Must handle:
   - `John 3:16`, `John 3:16-18`, `John 3:16–4:2` (en/em dash, cross-chapter)
   - `1 Corinthians 13`, `1 Cor 13:4-7`, `First Corinthians 13:4`
   - whole chapter (`Psalm 23`) → `Ps.23.1`..end-of-chapter
   - list continuation `Romans 8:28, 38-39` (same book+chapter)
   - bare `verse 16` / `v. 16` / `verses 16-18` using `ctx.lastRef`
   - reject false positives: clock times, "chapter 5" with no book, page refs,
     numbers with no book context and no `lastRef`.
   Returns refs in text order; de-dupes exact duplicates within one call.

4. **`resolve.ts`** — `resolve(ref): ResolvedVerse | { ref, error }` where
   `ResolvedVerse = { ref: "John 3:16-18", osis, translation: "KJV",
   text, verses: [{ n, text }] }`. Expands ranges including cross-chapter;
   clamps to real chapter/verse bounds and records `truncated: true` if it had
   to; whole-chapter supported. `text` joins verses with a single space and no
   verse numbers (for the glasses); `verses[]` keeps numbers for the notes.

**Tests** (`vitest`):
- `books.test.ts` — every OSIS book round-trips; ordinals; Psalm(s); Song
  variants; Revelation(s); junk → null.
- `parse.test.ts` — ~30 cases including every negative above.
- `resolve.test.ts` — single / range / cross-chapter / whole-chapter /
  out-of-range clamp / unknown book.

**Checkpoint:** `npm --prefix backend test` green; `kjv.json` committed;
no network access during tests.

---

## Stage 2 — Backend with mocked STT + LLM

- `backend/src/server.ts` — Hono + `ws`:
  `POST /sessions` → `{ sessionId, wsUrl }`; `GET /healthz`;
  `WS /ws/:sessionId` (binary in = PCM, JSON out = events).
- `backend/src/session.ts` — `Map<sessionId, SessionState>`; transcript buffer;
  summarize trigger (≥25 s OR ≥400 new chars, single-flight); ref dedupe vs
  `seenRefs`; verse cache; `[gap]` marker hook.
- `backend/src/stt.ts` — `interface SttStream { push(pcm), onFinal(cb),
  onInterim(cb), close() }`; `createMockStt(fixture)` emits timed segments.
- `backend/src/summarize.ts` — `interface Summarizer { run(input):
  Promise<SummaryJson> }`; `createMockSummarizer(fixture)` deterministic;
  `SummaryJson` schema + validator (bad JSON → caller keeps last).
- `backend/src/events.ts` — typed encode/decode for `summary`, `verse`,
  `status`, `notes`, plus control (`session_unknown`, replay).
- `backend/fixtures/acts2.jsonl` — timed transcript segments + expected events.

**Tests:** contract test feeds the fixture through mock STT + mock summarizer +
real scripture engine → asserts ordered `summary` + `verse` events, dedupe,
cadence.

**Checkpoint:** `npm --prefix backend test` green; `npm --prefix backend run
dev` serves; a scripted PCM sender over `wscat`/a script sees events.

---

## Stage 3 — Real STT + LLM providers

- `backend/src/stt.deepgram.ts` — streaming client (`@deepgram/sdk` or raw WS),
  `nova-3`, `linear16` / 16 kHz / mono, interim on; reconnect 3× then
  `status:"stt_down"`.
- `backend/src/summarize.claude.ts` — `@anthropic-ai/sdk`, model
  `claude-sonnet-5`, strict-JSON system prompt, rolling ~4 000-token transcript
  window + `lastSummary`; invalid JSON → throw → caller keeps `lastSummary`.
- Provider chosen by env (`STT_PROVIDER`, `SUMMARIZER_PROVIDER`); mocks stay for
  tests.
- `backend/Dockerfile`, `backend/fly.toml`, deploy notes in `backend/README.md`.
- `backend/scripts/feed-wav.mjs` — streams a local WAV as 250 ms PCM frames to
  the WS for end-to-end local testing.

**Accounts required:** Deepgram, Anthropic API, Fly.io.

**Checkpoint:** local run with real keys against a recorded sermon WAV produces
coherent rolling notes and correct verse events; deployed `GET /healthz` OK.

---

## Stage 4 — Glasses page + views (simulator)

- `src/glasses/page.ts` — `createPage()` builds the 7-container layout (topic,
  bullet1-3, verse-ref, verse-body, capture) with `zOrderIndex` on all, plus
  `menuObject` (`1 Stop & save`, `2 Repeat last verse`, `3 Pause/Resume`);
  `recreatePage()` for resume.
- `src/glasses/views.ts` — `showBullets({topic,bullets})`,
  `showVerse({ref,text})` with >~450-char pagination (page 1 → page 2 at 4 s),
  `clearVerse()`. All via `textContainerUpgrade`; never `rebuildPageContainer`.
- `src/session.ts` — client state machine (idle/starting/listening/verse/
  paused/stopping/saved); verse queue (max 3); 8 s auto-return timers;
  "repeat last verse" from cache.
- `src/main.ts` — bridge boot, `onEvenHubEvent` routing (menu clicks; `sysEvent`
  tap/double-tap), double-tap → `shutDownPageContainer(1)`.

**Tests:** `views` pagination + blank/restore keeps bullet text intact;
`session` transitions + queue behavior (pure logic, no DOM/SDK).

**Simulator:** `scripts/sim-drive.mjs` drives the automation API to screenshot a
bullets frame and a verse takeover; manual visual check. Fed by a local fake
event source or the Stage 3 backend in replay.

**Checkpoint:** simulator shows bullets updating and a verse takeover that
auto-returns.

---

## Stage 5 — Audio capture + WS on hardware

- `src/audio.ts` — `onEvenHubEvent` audioEvent → accumulate `audioPcm` → 250 ms
  frames → `net.send`. Starts only after `createPage()` + `audioControl(true,
  AudioInputSource.Glasses)`.
- `src/net.ts` — WS client: binary frames up, JSON down; exponential backoff
  reconnect (1→2→4→…15 s) reusing the same `sessionId`; on reconnect apply
  replayed `summary` + last `verse`; on `session_unknown` create a fresh
  session and continue.
- `app.json` — add permissions: `g2-microphone` (desc: "Captures the speaker's
  voice to transcribe study notes. Audio is streamed, not stored."),
  `network` (desc + `whitelist: ["wss://<backend-host>"]`). Keep `name`
  "G2 Starter" or rename (≤20 chars, no "Even") — decide before submission.
- `vite.config.ts` — set `server.hmr.host` to the LAN IP when sideloading.

**Checkpoint:** QR sideload to glasses; speech produces notes on the lens;
toggling Wi-Fi briefly triggers a clean reconnect.

---

## Stage 6 — Phone panel + history

- `src/panel.ts` — Start/Stop, elapsed timer + 85 min warn / 90 min auto-stop,
  live interim-transcript tail, running-notes preview, "Keep screen on" hint +
  `navigator.wakeLock` attempt (degrade silently), post-session full notes
  render, `localStorage` session history (list, view, delete). Preview mode when
  no bridge.

**Checkpoint:** full end-to-end session; notes persisted; reload shows history.

---

## Stage 7 — Resilience + submission readiness

- 5-minute locked-phone test on hardware; close resume gaps; confirm `[gap]`
  markers land in notes.
- Confirm root-page double-tap fires `shutDownPageContainer(1)` and the phone
  WebView closes.
- `evenhub login` then `evenhub pack app.json dist -o sermon-notes.ehpk -c`;
  fix any manifest/icon errors; write a real changelog line.
- Short privacy policy markdown covering `g2-microphone` and `network`; mirror
  it in the permission `desc` strings.
- Walk the QA pre-submission 5-step loop from `docs/ship/app-submission`.

**Checkpoint:** passes the QA loop; private/beta build installs and runs.

---

## Non-goals for v1

Licensed translations; email / Google Doc / Notion export; speaker separation
via `speakerRole`; i18n of UI strings; multi-user note sharing.

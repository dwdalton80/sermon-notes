# Live Sermon Study-Notes for Even G2 — Design

Date: 2026-08-28
Status: Validated, ready for implementation planning

## Goal

While a minister teaches, the Even G2 glasses show a live, rolling summary of
the message. When a scripture reference is spoken it briefly takes over the
lens with the verse text (KJV). When the session ends, the phone keeps a full
set of study notes: the summary plus every scripture reference with its verse
text, saved to a local history.

## Decisions (from brainstorming)

| Question | Decision |
| --- | --- |
| Relationship to the existing app being emulated | User is only a user of it; build from scratch. |
| Live view on the glasses | Hybrid: 2–3 rolling summary bullets; a detected scripture takes over the screen ~8s then returns. |
| Bible translation | KJV (public domain). Verse text **bundled as JSON in the backend** — no Bible API. |
| Backend | Thin proxy, we deploy it. Single Node/TS service (Hono + `ws`) on Fly.io. Holds all API keys. |
| Notes output | Full notes render in the phone-side WebView panel; local session history in `localStorage`. No email / Docs / Notion in v1. |
| Session control | Start/Stop from the phone panel. Capture source = glasses four-mic array. Glasses contextual menu also has Stop / Repeat verse / Pause. |
| Phone during teaching | Screen-on recommended. Backend is source of truth so the client resyncs after any WebView suspension. |

## Platform facts this design relies on (from hub.evenrealities.com/docs)

- The app is a web page in the phone's Even App WebView. The glasses run no app
  logic — display + input only. All SDK calls go through `EvenAppBridge`.
- `audioControl(true, AudioInputSource.Glasses)` needs permission
  `g2-microphone` and requires `createStartUpPageContainer` to have run first.
  Audio arrives as `event.audioEvent.audioPcm` (`Uint8Array`), **PCM 16 kHz,
  signed 16-bit little-endian, mono**, via `onEvenHubEvent`. No documented
  frame size/cadence or BLE bandwidth figure — tune on hardware.
- `rebuildPageContainer` flickers on hardware and there is no flicker-free
  layout swap. `textContainerUpgrade` is flicker-free. Therefore: one
  persistent page layout, switch "views" by text updates only.
- `rebuildPageContainer` clears the contextual menu unless `menuObject` is
  re-sent every time.
- Root-page double-tap must call `shutDownPageContainer(1)` (QA requirement;
  mode 0 / custom exit UI on the root page is rejected).
- WebSockets are allowed, subject to the same `app.json` `network` whitelist as
  `fetch`; expect drops when the WebView backgrounds.
- Android Chromium WebView may be suspended in the background (audio capture
  stops, in-memory state may be lost — treat resume as a cold start). iOS
  WKWebView keeps running. `localStorage` always survives.
- Display: 576×288, 4-bit greyscale rendered green, no background fill. Max 4
  image + 8 other containers per page; exactly one `isEventCapture: 1`. If any
  container sets `zOrderIndex`, all must; values unique; higher = front.
- `app.json` `name` ≤ 20 chars and must not contain "Even".

## Architecture

Two deliverables: the glasses client (this repo, `src/`) and a backend
(`backend/`) the user deploys.

```
G2 mics ──BLE──> phone WebView ──WS(PCM frames)──> backend ──> Deepgram (streaming STT)
                                                      │
                                          running transcript buffer
                                                      │
                                   every ~25s OR ~400 new chars
                                                      ▼
                                        Claude (claude-sonnet-5)
                                   → { topic, bullets[3], references[] }
                                                      │
                              resolve refs → bundled KJV JSON → verse text
                                                      ▼
                        WS events → phone WebView → glasses textContainerUpgrade
```

The glasses never contact the backend directly. Every event travels through the
phone WebView's WebSocket.

### Backend

- One Node/TS process: Hono HTTP + `ws`. Stateless except an in-memory
  `Map<sessionId, SessionState>` (note history lives on the phone; no DB in v1).
- Deploy: Fly.io. Env: `DEEPGRAM_API_KEY`, `ANTHROPIC_API_KEY`, `ALLOWED_ORIGIN`.
- Endpoints:
  - `POST /sessions` → `{ sessionId, wsUrl }`
  - `WS /ws/:sessionId` → client sends binary PCM; server sends JSON events
    `summary`, `verse`, `status`, `notes`.
- `SessionState`: `{ transcript, lastSummary:{topic,bullets[3]}, seenRefs:Set,
  verseCache:[], lastSummarizeAt, pcmSinceSummary }`.

### STT

On WS open the backend opens a Deepgram streaming socket (`nova-3`,
`encoding=linear16`, `sample_rate=16000`, `interim_results=true`,
`smart_format=true`). Client PCM frames pipe straight through. Final segments
append to `transcript`; interim text is shown in the phone panel only.

### Summarization cadence

Trigger a Claude call when **either** ≥ 25 s elapsed **or** ≥ 400 new
transcript chars since the last call — never more than one in flight. Prompt:
system role ("study-note taker for expository preaching") + `lastSummary` for
continuity + a rolling window of the last ~4 000 tokens of transcript. Strict
JSON out:

```json
{ "title": "When the Wind Came",
  "topic": "Acts 2 - the church begins",
  "bullets": ["…", "…", "…"],
  "illustrations": ["The pastor's boyhood barn-roof storm, picturing the Spirit's power."],
  "references": ["Acts 2:38", "first Corinthians thirteen"] }
```

- **`title`** — the sermon's stated title if the speaker names one ("I've called
  this message …", a title read aloud). Omitted until heard; the session locks
  the first non-empty value and shows it on the glasses topic line.
- **`topic`** — always present; short label for the current section.
- **`bullets`** — up to 3 key points so far.
- **`illustrations`** — personal stories / anecdotes, each summarized in 1–2
  sentences **with the point it illustrates**. Accumulated across cycles
  (near-duplicate suppressed) for the notes.
- **`references`** — raw reference strings; the scripture engine resolves them.

Invalid JSON → keep `lastSummary`, retry next cycle. Rolling window keeps cost
bounded regardless of session length.

### Scripture resolution

Two passes: (1) `scripture/parse.ts` over the new transcript; (2) Claude's
`references` strings. Both go through the same parser, which handles spoken
forms: `John 3:16`, ranges incl. `Ephesians 8:5 through 10` →
`Ephesians 8:5-10`, number words (`Acts two verse thirty eight`,
`Psalm one hundred nineteen` — real numbers only, so `John three sixteen` stays
chapter 3), `Romans 8:28, 38-39` lists, bare `verse 17` via context,
single-chapter books (`Jude 3` = v3). Deepgram runs with `numerals: true` so
most numbers arrive as digits; the word grammar is the safety net. Normalize to
OSIS, dedupe against `seenOsis`, resolve against bundled KJV JSON (single verse,
ranges, cross-chapter, clamp overruns). Whole-chapter mentions are topic markers
— recorded but no verse takeover. Unresolvable ref → skipped.

### Notes layout

```
# <title, or topic if none given>
_<topic, shown under the title when both exist>_

## Key points
- …

## Illustrations & stories
- <1–2 sentence summary tying the story to its point>

## Scripture references
**John 3:16** (KJV)
> For God so loved…
```

## Glasses UI

Persistent layout, one `createStartUpPageContainer` call. All containers set
`zOrderIndex`.

```
topic       y8   h28   "● Acts 2 — the church begins"
bullet1     y44  h48   wrapped ~2 lines
bullet2     y96  h48
bullet3     y148 h48
verse-ref   y44  h28   (blank in bullets view)
verse-body  y76  h200  (blank in bullets view)
capture     full screen, isEventCapture:1, zOrder behind everything
```

7 of 8 "other" containers. Bullets and verse containers overlap; only one set
holds text at a time. Blank = `textContainerUpgrade` with `content: ''`.

Contextual menu (`menuObject`, re-sent on any rebuild):
`1 Stop & save`, `2 Repeat last verse`, `3 Pause / Resume`.

### State machine

```
idle → starting → listening ⇄ verse (overlay, ~8s auto-return)
                     ⇅
                   paused
listening/paused → stopping → saved → (double-tap) exit
```

- **starting:** create page + menu → `audioControl(true, Glasses)` → topic
  "Listening…".
- **listening:** `summary` event → `textContainerUpgrade` topic + 3 bullets.
  `verse` event → enter **verse**: blank bullets, fill verse-ref + verse-body;
  if text > ~450 chars paginate (page 1, swap to page 2 at 4s); 8s timer →
  restore bullets. Overlapping verses queue (max 3). "Repeat last verse"
  re-shows most recent from `verseCache`.
- **paused:** `audioControl(false)`, page frozen, topic "Paused".
- **stopping:** `audioControl(false)`, close WS, topic "Saving…", await `notes`.
- **saved:** topic "Saved — N notes, M verses"; body shows exit hint. Root-page
  double-tap → `shutDownPageContainer(1)`.

Event routing: menu clicks via `menuItemClickEvent`; taps / double-tap via
`sysEvent`.

## Resilience, errors, limits

### WebView suspension

Backend is source of truth. Client:

- WS drop → exponential backoff reconnect (1→2→4→…max 15 s) reusing the same
  `sessionId`.
- On reconnect the backend re-sends current `summary` + last verse.
- On resume, re-run `waitForEvenAppBridge()`; if the page is gone, re-create it
  before resuming audio.
- Audio lost during suspension is gone; backend marks `[gap]` in the transcript
  so notes are honest.
- Panel shows a persistent "Keep screen on" hint; attempt Screen Wake Lock,
  degrade silently if denied.

### Failure handling

| Failure | Response |
| --- | --- |
| No bridge (plain browser) | Panel runs in preview mode; Start disabled with "Open in the Even App" |
| Deepgram error/close | `status:"stt_down"`; topic shows "Transcription paused"; backend retries connect 3× |
| Claude error/timeout/bad JSON | Keep `lastSummary`; retry next cycle; never blocks audio |
| Verse not found | Recorded in notes with `?`; no takeover |
| WS won't reconnect (60 s) | Client stops audio; "Disconnected — tap to retry" |
| Backend restart | Session Map lost → `session_unknown` → client auto-creates a new session and continues; prior notes already on phone |

### Limits / cost

- Hard session cap 90 min (warn 85, auto-stop 90). Panel shows elapsed time.
- Rolling transcript window bounds LLM cost regardless of length.
- Deepgram ~$0.0043/min; Claude a few cents per session.

### Privacy

Audio is streamed, never stored server-side. Transcript and notes are held only
in memory during the session and discarded on stop. `app.json` `desc` strings
state this. Notes persist only on the phone.

## Repo layout

```
src/
  main.ts                wiring
  session.ts             state machine
  audio.ts               PCM capture → 250 ms frames → net
  net.ts                 WS client + reconnect
  glasses/page.ts        create layout, menu
  glasses/views.ts       bullets ⇄ verse via textContainerUpgrade
  panel.ts               phone-side UI: start/stop, transcript, notes, history
backend/
  server.ts              Hono + ws
  stt.ts                 Deepgram stream
  summarize.ts           Claude call + JSON schema
  scripture/parse.ts     written + spoken → OSIS
  scripture/resolve.ts   OSIS → KJV text (ranges, cross-chapter)
  scripture/kjv.json     bundled
  fixtures/              sample transcripts + expected refs
app.json                 permissions: g2-microphone, network (whitelist: backend origin)
```

## Testing

- **Backend unit (vitest):** `parse.ts` — "1 Cor 13:4-7", "John 3:16",
  "first Corinthians thirteen", "verse 16" (context carry), garbage → null.
  `resolve.ts` — single / range / cross-chapter / out-of-bounds.
  `summarize.ts` — bad JSON → fallback.
- **Backend contract:** mock Deepgram WS + mock Claude → feed
  `fixtures/acts2.txt` → assert ordered `summary` + `verse` events.
- **Client unit:** `views.ts` — verse > 450 chars paginates; blank/restore
  leaves bullet text intact. `net.ts` — reconnect reuses sessionId; replays
  summary.
- **Simulator:** `evenhub-simulator --aid <device>` fed a recorded sermon via a
  virtual audio cable; automation API screenshots assert topic/bullets render
  and the verse takeover appears and auto-returns.
- **Hardware:** QR sideload into a real teaching; verify verse timing, menu
  Stop, notes saved; run the 5-minute lock test.

## Build order

1. `scripture/` parse + resolve + KJV JSON, fully tested, no network.
2. Backend with mocked STT/LLM; contract test green.
3. Wire real Deepgram + Claude.
4. Glasses page + views in the simulator.
5. Audio capture + WS on hardware.
6. Panel notes / history.
7. Resilience + lock test.

## Open items for later (not v1)

- Licensed translations (NIV/ESV/CSB) via API.Bible.
- Export to email / Google Doc / Notion.
- Speaker separation (ignore congregation cross-talk) using `speakerRole`.
- Internationalisation of UI strings.

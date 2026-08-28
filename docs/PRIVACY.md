# Sermon Notes — Privacy Policy

_Template. Fill in the bracketed fields, publish it at a stable URL, and link
that URL in the Even Hub submission._

- **App:** Sermon Notes (`com.dwdalton.sermonnotes`)
- **Provider:** [your name / ministry name]
- **Contact:** [email address]
- **Effective date:** [date]

## What the app does

Sermon Notes listens to a spoken message through the glasses microphone,
transcribes it, and produces study notes — a running outline plus every
scripture reference with its King James Version text. The notes are shown on the
glasses during the message and saved on your phone afterward.

## Data the app handles, and why

### Microphone audio (`g2-microphone` permission)

While a session is running, audio from the glasses microphone is streamed to the
app's backend service for transcription. Capture happens **only** while a
session is active (you started it and have not stopped it). No audio is captured
when a session is not running.

- Audio is **streamed, not recorded.** It is not written to disk on the backend
  and is not retained after the session ends.
- Audio is sent to the following third-party service for speech-to-text:
  **Deepgram, Inc.** (`api.deepgram.com`). See Deepgram's privacy policy at
  <https://deepgram.com/privacy>. The app is configured so Deepgram does not
  retain audio for model training.

### Network (`network` permission)

The app communicates only with:

- **The app's own backend:** `[https://your-backend-host]` (and `wss://` for the
  live session). This service runs the transcription and summarization pipeline
  and is operated by the app provider named above. It holds no user accounts and
  stores no session data after a session ends.
- **Deepgram** (`api.deepgram.com`) — speech-to-text, as described above.
- **Google (Gemini API)** (`generativelanguage.googleapis.com`) — the running
  transcript text (not audio) is sent to Google's Gemini model to generate the
  outline, illustration summaries, and scripture-reference list. See Google's
  API terms at <https://ai.google.dev/gemini-api/terms> and privacy information
  at <https://policies.google.com/privacy>. Content sent to the paid Gemini API
  tier is not used to train Google's models.

Transcript text and generated notes exist only in the backend's memory during
the session and are discarded when the session ends or the connection closes.

### On your phone

The finished notes for each session are stored **only on your phone**, in the
app's local browser storage (`localStorage`), so you can review past sessions.
You can delete any saved session from the app's History list. Uninstalling the
app removes this data. Nothing in the History is sent anywhere.

## What the app does not do

- No user accounts, sign-in, or profiles.
- No analytics, advertising, tracking, or third-party SDKs beyond those listed
  above.
- No access to your contacts, photos, location, calendar, or other apps' data.
- No camera access (the glasses have no camera).
- No audio or transcript retention on the backend after a session.

## Children

The app is not directed to children under 13 and collects no personal
information from them.

## Changes

If this policy changes, the updated version will be posted at the same URL with
a new effective date.

## Contact

Questions: [email address].

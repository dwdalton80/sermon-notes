// Wire contract with sermon-notes-backend (mirror of backend/src/events.ts).
// The two projects don't share code, so keep this in sync by hand.

export type ServerEvent =
  | { type: 'session'; sessionId: string; resumed: boolean }
  | { type: 'summary'; topic: string; bullets: string[]; title?: string }
  | { type: 'verse'; ref: string; translation: 'KJV'; text: string; truncated: boolean }
  | { type: 'status'; state: SessionStatusState; detail?: string }
  | { type: 'notes'; markdown: string }

export type SessionStatusState =
  | 'listening'
  | 'connecting' // client-only: still reaching the backend (free-tier cold start)
  | 'reconnecting' // client-only: transport lost the socket
  | 'stt_down'
  | 'summarizer_down'
  | 'saving'
  | 'ended'

export type ClientMessage = { type: 'finish' } | { type: 'resume' }

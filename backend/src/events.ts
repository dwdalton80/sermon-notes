/** Events the backend sends to the phone WebView over the session WebSocket.
 *  The client forwards the relevant ones to the glasses. */
export type ServerEvent =
  | { type: 'session'; sessionId: string; resumed: boolean }
  | { type: 'summary'; topic: string; bullets: string[]; title?: string }
  | {
      type: 'verse'
      ref: string
      translation: 'KJV'
      text: string
      truncated: boolean
    }
  | { type: 'status'; state: SessionStatusState; detail?: string }
  | { type: 'notes'; markdown: string }

export type SessionStatusState =
  | 'listening'
  | 'stt_down'
  | 'summarizer_down'
  | 'saving'
  | 'ended'

/** Messages the client sends back (JSON control frames; PCM is sent as binary). */
export type ClientMessage = { type: 'finish' } | { type: 'resume' }

export function encode(ev: ServerEvent): string {
  return JSON.stringify(ev)
}

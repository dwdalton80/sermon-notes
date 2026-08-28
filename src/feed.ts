import type { ServerEvent } from './events.js'

export interface Feed {
  onEvent(cb: (ev: ServerEvent) => void): void
  /** ask the source to wrap up (backend: send {type:'finish'}) */
  finish(): void
  stop(): void
}

/** Canned event source for simulator / browser dev with no backend running.
 *  Stage 5 replaces this with a real WebSocket transport. */
export function createFakeFeed(): Feed {
  const cbs: Array<(ev: ServerEvent) => void> = []
  const timers: Array<ReturnType<typeof setTimeout>> = []
  const emit = (ev: ServerEvent) => cbs.forEach((cb) => cb(ev))

  const longPsalm =
    'Blessed are the undefiled in the way, who walk in the law of the LORD. ' +
    'Blessed are they that keep his testimonies, and that seek him with the whole heart. ' +
    'They also do no iniquity: they walk in his ways. ' +
    'Thou hast commanded us to keep thy precepts diligently. ' +
    'O that my ways were directed to keep thy statutes! ' +
    'Then shall I not be ashamed, when I have respect unto all thy commandments.'

  const script: Array<[number, ServerEvent]> = [
    [800, { type: 'session', sessionId: 'fake', resumed: false }],
    [
      1500,
      {
        type: 'summary',
        title: 'When the Wind Came',
        topic: 'Acts 2 - the church begins',
        bullets: ['The Spirit is poured out at Pentecost', 'The crowd hears their own languages'],
      },
    ],
    [
      3500,
      { type: 'verse', ref: 'Joel 2:28', translation: 'KJV', truncated: false,
        text: 'And it shall come to pass afterward, that I will pour out my spirit upon all flesh.' },
    ],
    [
      6000,
      {
        type: 'summary',
        title: 'When the Wind Came',
        topic: 'Acts 2 - the call to repent',
        bullets: [
          'Peter preaches the risen Christ as Lord',
          'The crowd is cut to the heart',
          'Acts 2:38 - repent and be baptized',
        ],
      },
    ],
    [
      8000,
      { type: 'verse', ref: 'Acts 2:38', translation: 'KJV', truncated: false,
        text: 'Then Peter said unto them, Repent, and be baptized every one of you in the name of Jesus Christ for the remission of sins.' },
    ],
    [
      11000,
      { type: 'verse', ref: 'Psalm 119:1-6', translation: 'KJV', truncated: false, text: longPsalm },
    ],
  ]

  let t = 0
  for (const [delay, ev] of script) {
    t += delay
    timers.push(setTimeout(() => emit(ev), t))
  }

  return {
    onEvent(cb) {
      cbs.push(cb)
    },
    finish() {
      emit({ type: 'status', state: 'saving' })
      setTimeout(() => {
        emit({
          type: 'notes',
          markdown:
            '# When the Wind Came\n\n_Acts 2 - the church begins_\n\n' +
            '## Key points\n- The Spirit is poured out at Pentecost\n' +
            '- Peter preaches the risen Christ\n- Acts 2:38 - repent and be baptized\n\n' +
            '## Scripture references\n**Joel 2:28** (KJV)\n\n> And it shall come to pass afterward...\n\n' +
            '**Acts 2:38** (KJV)\n\n> Then Peter said unto them, Repent...\n',
        })
        emit({ type: 'status', state: 'ended' })
      }, 400)
    },
    stop() {
      for (const t of timers) clearTimeout(t)
    },
  }
}

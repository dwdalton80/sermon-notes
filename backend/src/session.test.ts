import { describe, it, expect } from 'vitest'
import { Session, type SessionConfig } from './session.js'
import { createMockStt } from './stt.js'
import { createMockSummarizer, type SummaryJson } from './summarize.js'
import type { ServerEvent } from './events.js'

const frame = new Uint8Array(8)
const flush = () => new Promise((r) => setTimeout(r, 5))

function harness(
  segments: string[],
  summaries: Array<SummaryJson | null>,
  cfg: Partial<SessionConfig> = {},
) {
  const events: ServerEvent[] = []
  const session = new Session('11111111-1111-4111-8111-111111111111', {
    stt: createMockStt(segments),
    summarizer: createMockSummarizer(summaries),
    now: () => 0,
    config: { summarizeEveryChars: 1, summarizeEveryMs: 1e12, ...cfg },
  })
  session.onEvent((e) => events.push(e))
  return { session, events }
}

const S = (
  topic: string,
  bullets: string[],
  references: string[],
  extra: Partial<SummaryJson> = {},
): SummaryJson => ({ topic, bullets, references, ...extra })

describe('Session orchestration', () => {
  it('emits summary then new verses, and de-dupes repeated references', async () => {
    const segments = [
      'Peter explains this fulfils what the prophet Joel spoke.',
      'Then in Acts 2 verse 38 he says repent and be baptized.',
      'This is grace, as Paul writes in Ephesians 2 verse 8.',
    ]
    const summaries = [
      S('Acts 2', ['Spirit poured out', 'Joel is fulfilled', 'Peter preaches'], ['Joel 2:28']),
      S('Acts 2', ['Peter preaches Christ', 'Crowd convicted', 'Acts 2:38 repent'], [
        'Acts 2:38',
        'Joel 2:28',
      ]),
      S('Acts 2', ['Grace through faith', 'Three thousand added', 'Devoted to teaching'], [
        'Acts 2:38',
        'Ephesians 2:8',
        'Acts 2:42',
      ]),
    ]
    const { session, events } = harness(segments, summaries)

    for (const _ of segments) {
      session.pushPcm(frame)
      await flush()
    }

    const kinds = events.map((e) =>
      e.type === 'verse' ? `verse:${e.ref}` : e.type === 'summary' ? `summary:${e.topic}` : e.type,
    )
    expect(kinds).toEqual([
      'summary:Acts 2',
      'verse:Joel 2:28',
      'summary:Acts 2',
      'verse:Acts 2:38',
      'summary:Acts 2',
      'verse:Ephesians 2:8',
      'verse:Acts 2:42',
    ])

    const joel = events.find((e) => e.type === 'verse' && e.ref === 'Joel 2:28')
    expect(joel && joel.type === 'verse' && joel.text).toMatch(/pour out my spirit/i)
  })

  it('keeps going when the summarizer fails', async () => {
    const { session, events } = harness(['Something about Romans 5 verse 8.'], [null])
    session.pushPcm(frame)
    await flush()
    expect(events.some((e) => e.type === 'status' && e.state === 'summarizer_down')).toBe(true)
    expect(events.some((e) => e.type === 'summary')).toBe(false)
    // still resolves references seen in the transcript delta on the next cycle
  })

  it('replayState returns the last summary and last verse', async () => {
    const { session, events } = harness(
      ['In Acts 2 verse 38 Peter says repent.', 'And Ephesians 2 verse 8, by grace.'],
      [S('Acts 2', ['a', 'b'], ['Acts 2:38']), S('Acts 2', ['a', 'b', 'c'], ['Ephesians 2:8'])],
    )
    session.pushPcm(frame)
    await flush()
    session.pushPcm(frame)
    await flush()

    const replay = session.replayState()
    expect(replay.map((e) => e.type)).toEqual(['summary', 'verse'])
    const v = replay[1]
    expect(v && v.type === 'verse' && v.ref).toBe('Ephesians 2:8')
    void events
  })

  it('finish emits saving, notes markdown, then ended', async () => {
    const { session, events } = harness(
      ['Acts 2 verse 38 says repent and be baptized.'],
      [S('Acts 2 - the church begins', ['Repent and be baptized', 'Forgiveness offered'], ['Acts 2:38'])],
    )
    session.pushPcm(frame)
    await flush()
    await session.finish()

    const tail = events.slice(-3).map((e) => (e.type === 'status' ? `status:${e.state}` : e.type))
    expect(tail).toEqual(['status:saving', 'notes', 'status:ended'])
    const notes = events.find((e) => e.type === 'notes')
    expect(notes && notes.type === 'notes' && notes.markdown).toContain('# Acts 2 - the church begins')
    expect(notes && notes.type === 'notes' && notes.markdown).toContain('**Acts 2:38** (KJV)')
    expect(notes && notes.type === 'notes' && notes.markdown).toMatch(/Repent, and be baptized/i)
  })

  it('carries sermon title into summary events and notes; accumulates illustrations', async () => {
    const { session, events } = harness(
      ['We are in Acts 2. Acts 2 verse 38 says repent.', 'This is grace, Ephesians 2 verse 8.'],
      [
        S('Acts 2', ['Peter preaches', 'Crowd convicted'], ['Acts 2:38'], {
          title: 'When the Wind Came',
          illustrations: ['A boyhood barn-roof storm, picturing the Spirit’s power.'],
        }),
        S('Acts 2', ['Grace through faith', 'Church devoted to prayer'], ['Ephesians 2:8'], {
          title: 'When the Wind Came',
          illustrations: ['A boyhood barn-roof storm, picturing the Spirit’s power.'],
        }),
      ],
    )
    session.pushPcm(frame)
    await flush()
    session.pushPcm(frame)
    await flush()
    await session.finish()

    const firstSummary = events.find((e) => e.type === 'summary')
    expect(firstSummary && firstSummary.type === 'summary' && firstSummary.title).toBe(
      'When the Wind Came',
    )
    const notes = events.find((e) => e.type === 'notes')
    const md = notes && notes.type === 'notes' ? notes.markdown : ''
    expect(md).toContain('# When the Wind Came')
    expect(md).toContain('## Key points')
    expect(md).toContain('## Illustrations & stories')
    expect(md).toContain('barn-roof storm')
    // one illustration, not two, despite appearing in both cycles
    expect(md.split('barn-roof storm').length - 1).toBe(1)
  })

  it('uses the time threshold when char threshold is not met', async () => {
    let t = 0
    const events: ServerEvent[] = []
    const session = new Session('22222222-2222-4222-8222-222222222222', {
      stt: createMockStt(['first line here', 'second line here']),
      summarizer: createMockSummarizer([S('T', ['x'], []), S('T', ['x', 'y'], [])]),
      now: () => t,
      config: { summarizeEveryChars: 1e9, summarizeEveryMs: 1000 },
    })
    session.onEvent((e) => events.push(e))

    session.pushPcm(frame)
    await flush()
    expect(events.some((e) => e.type === 'summary')).toBe(false) // t=0, not due

    t = 1000
    session.pushPcm(frame)
    await flush()
    expect(events.filter((e) => e.type === 'summary')).toHaveLength(1)
  })
})

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
  heading: string,
  bullets: string[],
  references: string[],
  extra: Partial<Omit<SummaryJson, 'section' | 'references'>> & { newSection?: boolean } = {},
): SummaryJson => {
  const { newSection, ...rest } = extra
  return { section: { heading, bullets, newSection: newSection ?? false }, references, ...rest }
}

describe('Session orchestration', () => {
  it('emits summary then new verses, and de-dupes repeated references', async () => {
    const segments = [
      'Peter explains this fulfils what the prophet Joel spoke.',
      'Then in Acts 2 verse 38 he says repent and be baptized.',
      'This is grace, as Paul writes in Ephesians 2 verse 8.',
    ]
    const summaries = [
      S('The Spirit comes', ['Spirit poured out', 'Joel is fulfilled'], ['Joel 2:28']),
      S('Peter preaches', ['Christ crucified and raised', 'Crowd convicted'], ['Acts 2:38', 'Joel 2:28'], {
        newSection: true,
      }),
      S('The church is born', ['Grace through faith', 'Three thousand added'], [
        'Acts 2:38',
        'Ephesians 2:8',
        'Acts 2:42',
      ], { newSection: true }),
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
      'summary:The Spirit comes',
      'verse:Joel 2:28',
      'summary:Peter preaches',
      'verse:Acts 2:38',
      'summary:The church is born',
      'verse:Ephesians 2:8',
      'verse:Acts 2:42',
    ])

    const joel = events.find((e) => e.type === 'verse' && e.ref === 'Joel 2:28')
    expect(joel && joel.type === 'verse' && joel.text).toMatch(/pour out my spirit/i)
  })

  it('does not re-emit a summary when the point has not changed', async () => {
    const same = S('The Spirit comes', ['Wind and fire', 'All are filled'], [])
    const { session, events } = harness(
      ['line one here', 'line two here', 'line three here'],
      [same, same, S('Peter preaches', ['Christ is Lord'], [], { newSection: true })],
    )
    for (let i = 0; i < 3; i++) {
      session.pushPcm(frame)
      await flush()
    }
    const headings = events.filter((e) => e.type === 'summary').map((e) => (e.type === 'summary' ? e.topic : ''))
    expect(headings).toEqual(['The Spirit comes', 'Peter preaches'])
  })

  it('keeps going when the summarizer fails', async () => {
    const { session, events } = harness(['Something about Romans 5 verse 8.'], [null])
    session.pushPcm(frame)
    await flush()
    expect(events.some((e) => e.type === 'status' && e.state === 'summarizer_down')).toBe(true)
    expect(events.some((e) => e.type === 'summary')).toBe(false)
  })

  it('replayState returns the last summary and last verse', async () => {
    const { session } = harness(
      ['In Acts 2 verse 38 Peter says repent.', 'And Ephesians 2 verse 8, by grace.'],
      [
        S('Peter preaches', ['a', 'b'], ['Acts 2:38']),
        S('The church is born', ['c', 'd'], ['Ephesians 2:8'], { newSection: true }),
      ],
    )
    session.pushPcm(frame)
    await flush()
    session.pushPcm(frame)
    await flush()

    const replay = session.replayState()
    expect(replay.map((e) => e.type)).toEqual(['summary', 'verse'])
    const v = replay[1]
    expect(v && v.type === 'verse' && v.ref).toBe('Ephesians 2:8')
  })

  it('finish emits saving, an outline of notes, then ended', async () => {
    const { session, events } = harness(
      ['We are in Acts 2. Acts 2 verse 38 says repent.', 'This is grace, Ephesians 2 verse 8.'],
      [
        S('Peter preaches the risen Christ', ['Repent and be baptized', 'Forgiveness offered'], ['Acts 2:38'], {
          title: 'When the Wind Came',
          illustrations: ['A boyhood barn-roof storm, picturing the Spirit power.'],
          applications: ['Repent and be baptized this week'],
          prayerRequests: ['The three thousand new believers'],
        }),
        S('The church is born', ['Grace through faith', 'Three thousand added'], ['Ephesians 2:8'], {
          newSection: true,
          illustrations: ['A boyhood barn-roof storm, picturing the Spirit power.'],
          applications: ['Repent and be baptized this week'],
        }),
      ],
    )
    session.pushPcm(frame)
    await flush()
    session.pushPcm(frame)
    await flush()
    await session.finish()

    const tail = events.slice(-3).map((e) => (e.type === 'status' ? `status:${e.state}` : e.type))
    expect(tail).toEqual(['status:saving', 'notes', 'status:ended'])

    const notes = events.find((e) => e.type === 'notes')
    const md = notes && notes.type === 'notes' ? notes.markdown : ''
    expect(md).toContain('# When the Wind Came')
    expect(md).toContain('## Peter preaches the risen Christ')
    expect(md).toContain('## The church is born')
    expect(md).toContain('## Illustrations & stories')
    expect(md).toContain('## This week\n\n- Repent and be baptized this week')
    expect(md).toContain('## Prayer\n\n- The three thousand new believers')
    // application appears once despite being in both cycles
    expect(md.split('Repent and be baptized this week').length - 1).toBe(1)
    expect(md).toContain('**Acts 2:38** (KJV)')
    expect(md).toMatch(/Repent, and be baptized/i)
    // one illustration despite appearing in both cycles
    expect(md.split('barn-roof storm').length - 1).toBe(1)
  })

  it('carries the sermon title into the first summary event', async () => {
    const { session, events } = harness(
      ['Acts 2 verse 38 says repent.'],
      [S('Peter preaches', ['Repent'], ['Acts 2:38'], { title: 'When the Wind Came' })],
    )
    session.pushPcm(frame)
    await flush()
    const first = events.find((e) => e.type === 'summary')
    expect(first && first.type === 'summary' && first.title).toBe('When the Wind Came')
    expect(first && first.type === 'summary' && first.topic).toBe('Peter preaches')
  })

  it('uses the time threshold when the char threshold is not met', async () => {
    let t = 0
    const events: ServerEvent[] = []
    const session = new Session('22222222-2222-4222-8222-222222222222', {
      stt: createMockStt(['first line here', 'second line here']),
      summarizer: createMockSummarizer([S('A', ['x'], []), S('B', ['y'], [], { newSection: true })]),
      now: () => t,
      config: { summarizeEveryChars: 1e9, summarizeEveryMs: 1000 },
    })
    session.onEvent((e) => events.push(e))

    session.pushPcm(frame)
    await flush()
    expect(events.some((e) => e.type === 'summary')).toBe(false)

    t = 1000
    session.pushPcm(frame)
    await flush()
    expect(events.filter((e) => e.type === 'summary')).toHaveLength(1)
  })
})

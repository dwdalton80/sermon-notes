import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { GlassesPage, type CreatePayload, type GlassesBridge, type TextUpgrade } from './glasses/page.js'
import { C } from './glasses/layout.js'
import { SessionController } from './session.js'
import type { ServerEvent } from './events.js'

class FakeBridge implements GlassesBridge {
  containers = new Map<number, string>()
  upgrades: Array<[number, string]> = []
  created = 0
  rebuilt = 0
  shutdownMode: number | null = null

  async createStartUpPageContainer(c: CreatePayload): Promise<number> {
    this.created++
    for (const t of c.textObject) this.containers.set(t.containerID, t.content)
    return 0
  }
  async rebuildPageContainer(c: CreatePayload): Promise<boolean> {
    this.rebuilt++
    for (const t of c.textObject) this.containers.set(t.containerID, t.content)
    return true
  }
  async textContainerUpgrade(c: TextUpgrade): Promise<boolean> {
    this.containers.set(c.containerID, c.content)
    this.upgrades.push([c.containerID, c.content])
    return true
  }
  async shutDownPageContainer(mode?: number): Promise<boolean> {
    this.shutdownMode = mode ?? 0
    return true
  }
  text(id: number): string {
    return this.containers.get(id) ?? ''
  }
}

const settle = () => vi.advanceTimersByTimeAsync(0)

function harness() {
  const bridge = new FakeBridge()
  const page = new GlassesPage(bridge)
  let finishCalls = 0
  const pauseStates: boolean[] = []
  const ctrl = new SessionController({
    page,
    requestFinish: () => finishCalls++,
    onPauseChange: (p) => pauseStates.push(p),
    verseHoldMs: 8000,
    versePageMs: 4000,
  })
  return { bridge, page, ctrl, pauseStates, finishCalls: () => finishCalls }
}

const summary = (topic: string, bullets: string[], title?: string): ServerEvent => ({
  type: 'summary',
  topic,
  bullets,
  ...(title ? { title } : {}),
})
const verse = (ref: string, text: string): ServerEvent => ({
  type: 'verse',
  ref,
  translation: 'KJV',
  text,
  truncated: false,
})

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('SessionController', () => {
  it('start builds the page and enters listening', async () => {
    const { bridge, ctrl } = harness()
    await ctrl.start()
    expect(bridge.created).toBe(1)
    expect(ctrl.phase).toBe('listening')
    expect(bridge.text(C.TOPIC)).toBe('Listening...')
  })

  it('topic line shows the current section heading, not the sermon title', async () => {
    const { bridge, ctrl } = harness()
    await ctrl.start()
    ctrl.handleServerEvent(summary('The Spirit comes with power', ['a', 'b', 'c', 'd'], 'When the Wind Came'))
    await settle()
    expect(bridge.text(C.TOPIC)).toBe('The Spirit comes with power')
    expect(bridge.text(C.BULLET1)).toBe('a')
    expect(bridge.text(C.BULLET3)).toBe('c')
  })

  it('verse takes over, then auto-returns to bullets after the hold', async () => {
    const { bridge, ctrl } = harness()
    await ctrl.start()
    ctrl.handleServerEvent(summary('Acts 2', ['point one', 'point two']))
    await settle()
    ctrl.handleServerEvent(verse('John 3:16', 'For God so loved the world.'))
    await settle()

    expect(ctrl.phase).toBe('verse')
    expect(bridge.text(C.VERSE_REF)).toBe('John 3:16')
    expect(bridge.text(C.VERSE_BODY)).toContain('For God so loved')
    expect(bridge.text(C.BULLET1)).toBe('') // bullets blanked

    await vi.advanceTimersByTimeAsync(8000)
    expect(ctrl.phase).toBe('listening')
    expect(bridge.text(C.VERSE_REF)).toBe('')
    expect(bridge.text(C.BULLET1)).toBe('point one') // restored
  })

  it('queues multiple verses and plays them in order, capped at 3', async () => {
    const { bridge, ctrl } = harness()
    await ctrl.start()
    for (const r of ['A 1:1', 'B 2:2', 'C 3:3', 'D 4:4', 'E 5:5']) {
      ctrl.handleServerEvent(verse(r, `text of ${r}`))
    }
    await settle()
    const shown: string[] = [bridge.text(C.VERSE_REF)]
    for (let i = 0; i < 5; i++) {
      await vi.advanceTimersByTimeAsync(8000)
      if (ctrl.phase === 'verse') shown.push(bridge.text(C.VERSE_REF))
    }
    // A plays immediately; B is dropped when E arrives (queue cap 3)
    expect(shown).toEqual(['A 1:1', 'C 3:3', 'D 4:4', 'E 5:5'])
  })

  it('paginates a long verse across pages, then returns to bullets', async () => {
    const { bridge, ctrl } = harness()
    await ctrl.start()
    const long = Array.from({ length: 120 }, (_, i) => `word${i}`).join(' ')
    ctrl.handleServerEvent(verse('Ps 119:1-8', long))
    await settle()
    const firstPage = bridge.text(C.VERSE_BODY)
    expect(ctrl.phase).toBe('verse')

    await vi.advanceTimersByTimeAsync(4000)
    expect(bridge.text(C.VERSE_BODY)).not.toBe(firstPage) // advanced a page

    // run out any remaining pages + the final hold
    await vi.advanceTimersByTimeAsync(60000)
    expect(ctrl.phase).toBe('listening')
    expect(bridge.text(C.VERSE_REF)).toBe('')
  })

  it('menu: stop requests finish and shows Saving', async () => {
    const { bridge, ctrl, finishCalls } = harness()
    await ctrl.start()
    ctrl.onMenu(1)
    await settle()
    expect(finishCalls()).toBe(1)
    expect(ctrl.phase).toBe('stopping')
    expect(bridge.text(C.TOPIC)).toBe('Saving...')
  })

  it('menu: pause toggles capture and topic', async () => {
    const { bridge, ctrl, pauseStates } = harness()
    await ctrl.start()
    ctrl.handleServerEvent(summary('Acts 2', ['keep me']))
    await settle()
    ctrl.onMenu(3)
    await settle()
    expect(ctrl.phase).toBe('paused')
    expect(pauseStates).toEqual([true])
    expect(bridge.text(C.TOPIC)).toBe('Paused')
    ctrl.onMenu(3)
    await settle()
    expect(ctrl.phase).toBe('listening')
    expect(pauseStates).toEqual([true, false])
    expect(bridge.text(C.TOPIC)).toBe('Acts 2')
  })

  it('menu: repeat last verse re-shows it', async () => {
    const { bridge, ctrl } = harness()
    await ctrl.start()
    ctrl.handleServerEvent(verse('John 3:16', 'For God so loved.'))
    await settle()
    await vi.advanceTimersByTimeAsync(8000) // back to bullets
    expect(ctrl.phase).toBe('listening')
    ctrl.onMenu(2)
    await settle()
    expect(ctrl.phase).toBe('verse')
    expect(bridge.text(C.VERSE_REF)).toBe('John 3:16')
  })

  it('draws the audio meter while listening and blanks it when paused', async () => {
    const { bridge, ctrl } = harness()
    await ctrl.start()
    expect(bridge.text(C.METER)).toBe('') // nothing until audio flows

    ctrl.onAudioLevel(1)
    await settle()
    expect(bridge.text(C.METER)).toBe('[##########]')

    ctrl.onAudioLevel(0)
    await settle()
    expect(bridge.text(C.METER)).not.toBe('[##########]') // eased down
    expect(bridge.text(C.METER)).toMatch(/^\[#*-*\]$/) // still a bar, just quieter

    ctrl.onMenu(3) // pause
    await settle()
    expect(bridge.text(C.METER)).toBe('') // blanked
  })

  it('ignores audio levels before listening and after stop', async () => {
    const { bridge, ctrl } = harness()
    ctrl.onAudioLevel(1) // phase idle
    await settle()
    expect(bridge.text(C.METER)).toBe('')

    await ctrl.start()
    ctrl.onMenu(1) // stop -> stopping
    ctrl.onAudioLevel(1)
    await settle()
    expect(bridge.text(C.METER)).toBe('')
  })

  it('coalesces a burst of audio frames into one meter write', async () => {
    const { bridge, ctrl } = harness()
    await ctrl.start()
    ctrl.onAudioLevel(0.1)
    ctrl.onAudioLevel(0.5)
    ctrl.onAudioLevel(1)
    await settle()
    const meterWrites = bridge.upgrades.filter(([id]) => id === C.METER)
    expect(meterWrites).toHaveLength(1)
    expect(bridge.text(C.METER)).toBe('[##########]') // last level wins
  })

  it('notes event moves to saved', async () => {
    const { bridge, ctrl } = harness()
    await ctrl.start()
    ctrl.handleServerEvent(verse('John 3:16', 'x'))
    await settle()
    ctrl.handleServerEvent({ type: 'status', state: 'saving' })
    ctrl.handleServerEvent({ type: 'notes', markdown: '# Notes\n' })
    await settle()
    expect(ctrl.phase).toBe('saved')
    expect(ctrl.notes).toBe('# Notes\n')
    expect(bridge.text(C.TOPIC)).toBe('Saved')
  })
})

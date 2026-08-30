import './style.css'
import {
  waitForEvenAppBridge,
  OsEventTypeList,
  AudioInputSource,
  CreateStartUpPageContainer,
  RebuildPageContainer,
  TextContainerProperty,
  TextContainerUpgrade,
  MenuContainerProperty,
  MenuItemProperty,
} from '@evenrealities/even_hub_sdk'
import type { EvenAppBridge, EvenHubEvent } from '@evenrealities/even_hub_sdk'
import { GlassesPage } from './glasses/page.js'
import type { CreatePayload, GlassesBridge, TextUpgrade } from './glasses/page.js'
import { SessionController } from './session.js'
import { createFakeFeed } from './feed.js'
import type { Feed } from './feed.js'
import { createWsTransport } from './net.js'
import { createAudioCapture, frameLevel } from './audio.js'
import { Panel } from './panel.js'
import { History } from './history.js'

const BACKEND_URL =
  (import.meta.env.VITE_BACKEND_URL as string | undefined) ?? 'http://localhost:8787'

const root = document.querySelector<HTMLDivElement>('#app')!
const history = new History(window.localStorage)
const log = (m: string) => console.log('[app]', m)

// Adapt the real EvenAppBridge to the small GlassesBridge our page needs,
// wrapping plain option objects in the SDK's container classes.
function toContainers(c: CreatePayload) {
  return {
    containerTotalNum: c.containerTotalNum,
    textObject: c.textObject.map((t) => new TextContainerProperty(t)),
    menuObject: new MenuContainerProperty({
      menuItems: c.menuObject.menuItems.map((m) => new MenuItemProperty(m)),
    }),
  }
}
function adapt(bridge: EvenAppBridge): GlassesBridge {
  return {
    createStartUpPageContainer: (c) =>
      bridge.createStartUpPageContainer(new CreateStartUpPageContainer(toContainers(c))),
    rebuildPageContainer: (c) =>
      bridge.rebuildPageContainer(new RebuildPageContainer(toContainers(c))),
    textContainerUpgrade: (c: TextUpgrade) =>
      bridge.textContainerUpgrade(new TextContainerUpgrade(c)),
    shutDownPageContainer: (mode) => bridge.shutDownPageContainer(mode),
  }
}

// One live session's wiring.
interface Live {
  ctrl: SessionController
  feed: Feed
  audio: ReturnType<typeof createAudioCapture> | null
  stop: () => void
}

async function startSession(bridge: EvenAppBridge, panel: Panel): Promise<Live> {
  const page = new GlassesPage(adapt(bridge))

  let feed: Feed
  let audio: ReturnType<typeof createAudioCapture> | null = null
  const transport = createWsTransport({ baseUrl: BACKEND_URL })
  try {
    await transport.start()
    audio = createAudioCapture(
      bridge,
      (f) => {
        transport.sendPcm(f)
        ctrl.onAudioLevel(frameLevel(f))
      },
      AudioInputSource.Glasses,
    )
    feed = transport
    log(`connected to ${BACKEND_URL} (session ${transport.sessionId})`)
  } catch (err) {
    transport.stop()
    feed = createFakeFeed()
    log(`no backend at ${BACKEND_URL} — canned feed (${err instanceof Error ? err.message : err})`)
    panel.setStatus('No backend — running a demo feed')
  }

  const ctrl = new SessionController({
    page,
    requestFinish: () => {
      feed.finish()
      void audio?.stop()
      panel.setPhase('saving')
    },
    onPauseChange: (paused) => void (paused ? audio?.pause() : audio?.resume()),
  })

  feed.onEvent((ev) => {
    if (ev.type === 'summary') panel.setStatus(`${ev.topic}`)
    else if (ev.type === 'verse') panel.setStatus(`scripture: ${ev.ref}`)
    else if (ev.type === 'status' && ev.state === 'reconnecting') panel.setStatus('Reconnecting…')
    else if (ev.type === 'status' && ev.state === 'stt_down') panel.setStatus('Transcription paused')
    else if (ev.type === 'notes') panel.showNotes(ev.markdown)
    ctrl.handleServerEvent(ev)
  })

  await ctrl.start()
  await audio?.start()
  panel.setPhase('running')
  panel.setStatus('Listening…')

  return {
    ctrl,
    feed,
    audio,
    stop: () => {
      feed.stop()
      void audio?.stop()
    },
  }
}

async function boot() {
  // wake a sleeping (Render free-tier) backend while the user reads the panel
  void fetch(`${BACKEND_URL}/healthz`).catch(() => {})

  let bridge: EvenAppBridge | null = null
  try {
    bridge = await Promise.race([
      waitForEvenAppBridge(),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('no bridge')), 4000)),
    ])
  } catch {
    log('no Even App bridge')
  }

  let live: Live | null = null

  const panel = new Panel({
    root,
    history,
    onStart: () => {
      if (!bridge || live) return
      void startSession(bridge, panel).then((l) => {
        live = l
      })
    },
    onStop: () => {
      live?.ctrl.stop()
    },
  })
  panel.setBridgeReady(bridge !== null)

  // dev/test affordance: ?autostart begins a session without a tap
  if (bridge && new URLSearchParams(location.search).has('autostart')) {
    void startSession(bridge, panel).then((l) => {
      live = l
    })
  }

  if (bridge) {
    bridge.onEvenHubEvent((event: EvenHubEvent) => {
      if (event.menuItemClickEvent?.itemID != null) {
        live?.ctrl.onMenu(event.menuItemClickEvent.itemID)
        return
      }
      const et =
        event.listEvent?.eventType ?? event.textEvent?.eventType ?? event.sysEvent?.eventType
      if (et === OsEventTypeList.DOUBLE_CLICK_EVENT) {
        // root-page exit must use mode 1 (QA requirement)
        void bridge!.shutDownPageContainer(1)
      }
    })
  }
}

void boot()

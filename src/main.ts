import './style.css'
import {
  waitForEvenAppBridge,
  OsEventTypeList,
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

// ---------------------------------------------------------------------------
// Phone-side panel — minimal for now; the full session-control + history UI
// is Stage 6. Shows connection state, an event log, and the finished notes.
// ---------------------------------------------------------------------------

const app = document.querySelector<HTMLDivElement>('#app')!
app.innerHTML = `
  <main class="wrap">
    <h1>Sermon Notes</h1>
    <p class="sub">Live study notes on the glasses. The lens is the display.</p>
    <dl class="kv"><dt>Bridge</dt><dd id="bridge">connecting…</dd>
      <dt>Phase</dt><dd id="phase">—</dd></dl>
    <h2>Event log</h2>
    <ul id="log" class="log"></ul>
    <div id="notes"></div>
  </main>
`
const el = (id: string) => document.getElementById(id)!
const log = (m: string) => {
  console.log('[app]', m)
  const li = document.createElement('li')
  li.textContent = `${new Date().toLocaleTimeString()}  ${m}`
  el('log').prepend(li)
}

// ---------------------------------------------------------------------------
// Adapt the real EvenAppBridge to the small GlassesBridge our page needs,
// wrapping plain option objects in the SDK's container classes.
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

async function boot() {
  let bridge: EvenAppBridge
  try {
    bridge = await Promise.race([
      waitForEvenAppBridge(),
      new Promise<never>((_, rej) =>
        setTimeout(() => rej(new Error('no Even App bridge')), 4000),
      ),
    ])
  } catch {
    el('bridge').textContent = 'not connected — open in the Even App or simulator'
    log('running without a bridge; glasses view unavailable')
    return
  }
  el('bridge').textContent = 'connected'
  log('bridge connected')

  const page = new GlassesPage(adapt(bridge))
  const feed: Feed = createFakeFeed()

  const ctrl = new SessionController({
    page,
    requestFinish: () => feed.finish(),
    onPauseChange: (paused) => log(paused ? 'audio paused' : 'audio resumed'),
  })

  feed.onEvent((ev) => {
    if (ev.type === 'summary') log(`summary: ${ev.topic}${ev.title ? ` (${ev.title})` : ''}`)
    else if (ev.type === 'verse') log(`verse: ${ev.ref}`)
    else if (ev.type === 'status') log(`status: ${ev.state}`)
    else if (ev.type === 'notes') {
      log('notes received')
      el('notes').innerHTML = `<h2>Notes</h2><pre>${escapeHtml(ev.markdown)}</pre>`
    }
    ctrl.handleServerEvent(ev)
    el('phase').textContent = ctrl.phase
  })

  bridge.onEvenHubEvent((event: EvenHubEvent) => {
    if (event.menuItemClickEvent?.itemID != null) {
      log(`menu ${event.menuItemClickEvent.itemID}`)
      ctrl.onMenu(event.menuItemClickEvent.itemID)
      el('phase').textContent = ctrl.phase
      return
    }
    const et =
      event.listEvent?.eventType ?? event.textEvent?.eventType ?? event.sysEvent?.eventType
    if (et === OsEventTypeList.DOUBLE_CLICK_EVENT) {
      // root-page exit must use mode 1 (QA requirement)
      log('double-tap → exit')
      void bridge.shutDownPageContainer(1)
    }
  })

  await ctrl.start()
  el('phase').textContent = ctrl.phase
  log('listening')
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!)
}

void boot()

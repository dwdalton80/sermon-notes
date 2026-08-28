import './style.css'
import {
  waitForEvenAppBridge,
  StartUpPageCreateResult,
  OsEventTypeList,
  CreateStartUpPageContainer,
  TextContainerProperty,
  TextContainerUpgrade,
  MenuContainerProperty,
  MenuItemProperty,
} from '@evenrealities/even_hub_sdk'
import type {
  EvenAppBridge,
  EvenHubEvent,
  LaunchSource,
} from '@evenrealities/even_hub_sdk'

// ---------------------------------------------------------------------------
// Phone-side preview panel
// Everything you build runs in the Even App WebView on the phone; the glasses
// are only the display. This panel is what a developer sees in the browser /
// simulator while iterating. On real hardware the user looks at the glasses.
// ---------------------------------------------------------------------------

const app = document.querySelector<HTMLDivElement>('#app')!
app.innerHTML = `
  <main class="wrap">
    <h1>Even Hub Demo</h1>
    <p class="sub">Phone-side WebView. The glasses render the start-up page container.</p>
    <dl class="kv">
      <dt>Bridge</dt><dd id="bridge">connecting…</dd>
      <dt>Launch source</dt><dd id="launch">—</dd>
      <dt>User</dt><dd id="user">—</dd>
      <dt>Device</dt><dd id="device">—</dd>
    </dl>
    <h2>Event log</h2>
    <ul id="log" class="log"></ul>
  </main>
`

const $ = (id: string) => document.getElementById(id)!
const log = (msg: string) => {
  const li = document.createElement('li')
  li.textContent = `${new Date().toLocaleTimeString()}  ${msg}`
  $('log').prepend(li)
}

// ---------------------------------------------------------------------------
// Glasses page
// ---------------------------------------------------------------------------

// Coordinate origin is top-left; each eye is 576 x 288 px, monochrome green.
const TEXT_CONTAINER_ID = 1

const MENU = new MenuContainerProperty({
  menuItems: [
    new MenuItemProperty({ itemName: 'Say hello', itemID: 1 }),
    new MenuItemProperty({ itemName: 'Say bye', itemID: 2 }),
  ],
})

async function buildGlassesPage(bridge: EvenAppBridge, greeting: string) {
  const result = await bridge.createStartUpPageContainer(
    new CreateStartUpPageContainer({
      containerTotalNum: 1,
      textObject: [
        new TextContainerProperty({
          xPosition: 40,
          yPosition: 110,
          width: 496,
          height: 60,
          containerID: TEXT_CONTAINER_ID,
          containerName: 'greeting',
          content: greeting,
          isEventCapture: 1,
        }),
      ],
      menuObject: MENU,
    }),
  )

  if (result === StartUpPageCreateResult.success) {
    log(`glasses page created — "${greeting}"`)
  } else {
    log(`createStartUpPageContainer failed: ${StartUpPageCreateResult[result]}`)
  }
}

function setGreeting(bridge: EvenAppBridge, text: string) {
  return bridge.textContainerUpgrade(
    new TextContainerUpgrade({
      containerID: TEXT_CONTAINER_ID,
      containerName: 'greeting',
      content: text,
    }),
  )
}

// ---------------------------------------------------------------------------
// Event wiring
// ---------------------------------------------------------------------------

function handleEvent(bridge: EvenAppBridge, event: EvenHubEvent) {
  if (event.menuItemClickEvent) {
    const id = event.menuItemClickEvent.itemID
    log(`menu item ${id}`)
    if (id === 1) void setGreeting(bridge, 'Hello 👋')
    if (id === 2) void setGreeting(bridge, 'Goodbye 👋')
    return
  }

  const eventType =
    event.listEvent?.eventType ??
    event.textEvent?.eventType ??
    event.sysEvent?.eventType

  if (eventType === OsEventTypeList.LONG_PRESS_EVENT) log('long press')
  else if (eventType === OsEventTypeList.LONG_PRESS_RELEASE_EVENT) log('long press released')
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

async function boot() {
  let bridge: EvenAppBridge
  try {
    // Race so a plain browser tab (no Even App WebView) still shows the panel.
    bridge = await Promise.race([
      waitForEvenAppBridge(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('no Even App bridge (running outside the WebView?)')), 4000),
      ),
    ])
  } catch (err) {
    $('bridge').textContent = String(err instanceof Error ? err.message : err)
    log('bridge unavailable — open in the Even App or simulator to drive the glasses')
    return
  }

  $('bridge').textContent = 'connected'
  log('bridge connected')

  // Register the launch-source listener early: the host pushes it once after load.
  bridge.onLaunchSource((source: LaunchSource) => {
    $('launch').textContent = source
    log(`launch source: ${source}`)
  })

  bridge.onEvenHubEvent((event) => handleEvent(bridge, event))

  bridge.onDeviceStatusChanged((status) => {
    log(`device status: ${status.connectType} · battery ${status.batteryLevel ?? '—'}`)
  })

  try {
    const user = await bridge.getUserInfo()
    $('user').textContent = `${user.name} (${user.country})`
    const device = await bridge.getDeviceInfo()
    $('device').textContent = device ? `${device.model} · ${device.sn}` : 'not connected'

    await buildGlassesPage(bridge, `Hello, ${user.name || 'world'}`)
  } catch (err) {
    log(`error: ${err instanceof Error ? err.message : String(err)}`)
  }
}

void boot()

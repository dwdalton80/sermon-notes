import { BOXES, BULLET_IDS, C, MENU_ITEMS, NAMES } from './layout.js'

// Minimal shape of the Even Hub bridge calls this app makes. The real
// EvenAppBridge is adapted to this in main.ts (wrapping args in the SDK's
// container classes); tests pass a fake.
export interface TextBox {
  xPosition: number
  yPosition: number
  width: number
  height: number
  containerID: number
  containerName: string
  zOrderIndex: number
  content: string
  isEventCapture: number
}
export interface CreatePayload {
  containerTotalNum: number
  textObject: TextBox[]
  menuObject: { menuItems: Array<{ itemName: string; itemID: number }> }
}
export interface TextUpgrade {
  containerID: number
  containerName: string
  content: string
}
export interface GlassesBridge {
  createStartUpPageContainer(c: CreatePayload): Promise<number>
  rebuildPageContainer(c: CreatePayload): Promise<boolean>
  textContainerUpgrade(c: TextUpgrade): Promise<boolean>
  shutDownPageContainer(mode?: number): Promise<boolean>
}

export type View = 'bullets' | 'verse'

/** Owns the persistent glasses layout and switches views with text updates only. */
export class GlassesPage {
  private view: View = 'bullets'
  private readonly bridge: GlassesBridge
  // All page mutations run one chain at a time. Concurrent textContainerUpgrade
  // chains interleave over the bridge and leave the display in a mixed state.
  private chain: Promise<unknown> = Promise.resolve()

  constructor(bridge: GlassesBridge) {
    this.bridge = bridge
  }

  get currentView(): View {
    return this.view
  }

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn)
    this.chain = run.catch(() => {})
    return run
  }

  private payload(): CreatePayload {
    return {
      containerTotalNum: BOXES.length,
      textObject: BOXES.map((b) => ({
        xPosition: b.x,
        yPosition: b.y,
        width: b.w,
        height: b.h,
        containerID: b.id,
        containerName: NAMES[b.id]!,
        zOrderIndex: b.z,
        content: '',
        isEventCapture: b.capture ? 1 : 0,
      })),
      menuObject: { menuItems: MENU_ITEMS.map((m) => ({ itemName: m.itemName, itemID: m.itemID })) },
    }
  }

  /** First build at launch. Returns true on success. */
  async create(): Promise<boolean> {
    const r = await this.bridge.createStartUpPageContainer(this.payload())
    return r === 0 // StartUpPageCreateResult.success
  }

  /** Rebuild after a WebView suspension wiped the page. */
  async recreate(): Promise<boolean> {
    return this.bridge.rebuildPageContainer(this.payload())
  }

  private up(id: number, content: string): Promise<boolean> {
    return this.bridge.textContainerUpgrade({ containerID: id, containerName: NAMES[id]!, content })
  }

  /** Keep a bullet to ~one line on the 576px canvas. */
  private clampBullet(s: string): string {
    const MAX = 58
    if (s.length <= MAX) return s
    const cut = s.slice(0, MAX)
    const sp = cut.lastIndexOf(' ')
    return (sp > 30 ? cut.slice(0, sp) : cut).trimEnd() + '…'
  }

  setTopic(text: string): Promise<void> {
    return this.enqueue(async () => {
      await this.up(C.TOPIC, text)
    })
  }

  showBullets(topic: string, bullets: string[]): Promise<void> {
    return this.enqueue(async () => {
      await this.up(C.VERSE_REF, '')
      await this.up(C.VERSE_BODY, '')
      await this.up(C.TOPIC, topic)
      for (let i = 0; i < BULLET_IDS.length; i++) {
        const b = bullets[i]
        await this.up(BULLET_IDS[i]!, b ? this.clampBullet(b) : '')
      }
      this.view = 'bullets'
    })
  }

  showVerse(ref: string, bodyPage: string): Promise<void> {
    return this.enqueue(async () => {
      for (const id of BULLET_IDS) await this.up(id, '')
      await this.up(C.VERSE_REF, ref)
      await this.up(C.VERSE_BODY, bodyPage)
      this.view = 'verse'
    })
  }

  /** Swap just the verse body (pagination), keeping the ref line. */
  setVersePage(bodyPage: string): Promise<void> {
    return this.enqueue(async () => {
      await this.up(C.VERSE_BODY, bodyPage)
    })
  }
}

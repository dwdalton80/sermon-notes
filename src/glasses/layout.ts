// Persistent glasses page layout. One createStartUpPageContainer call builds
// all seven containers; "views" are switched afterwards with textContainerUpgrade
// only (rebuild flickers on hardware — see docs/build/page-lifecycle).
//
// Canvas is 576 x 288, origin top-left, monochrome. Bullets and verse containers
// overlap by design; only one set holds text at a time.

export const C = {
  TOPIC: 1,
  BULLET1: 2,
  BULLET2: 3,
  BULLET3: 4,
  VERSE_REF: 5,
  VERSE_BODY: 6,
  CAPTURE: 7,
} as const

export const BULLET_IDS = [C.BULLET1, C.BULLET2, C.BULLET3] as const

export const NAMES: Record<number, string> = {
  [C.TOPIC]: 'topic',
  [C.BULLET1]: 'bullet1',
  [C.BULLET2]: 'bullet2',
  [C.BULLET3]: 'bullet3',
  [C.VERSE_REF]: 'verse-ref',
  [C.VERSE_BODY]: 'verse-body',
  [C.CAPTURE]: 'capture',
}

interface Box {
  id: number
  x: number
  y: number
  w: number
  h: number
  z: number
  capture?: boolean
}

// zOrderIndex: capture at the back, verse containers in front of bullets.
export const BOXES: Box[] = [
  { id: C.CAPTURE, x: 0, y: 0, w: 576, h: 288, z: 1, capture: true },
  { id: C.TOPIC, x: 20, y: 8, w: 536, h: 28, z: 2 },
  { id: C.BULLET1, x: 20, y: 44, w: 536, h: 48, z: 3 },
  { id: C.BULLET2, x: 20, y: 96, w: 536, h: 48, z: 4 },
  { id: C.BULLET3, x: 20, y: 148, w: 536, h: 48, z: 5 },
  { id: C.VERSE_REF, x: 20, y: 44, w: 536, h: 28, z: 6 },
  { id: C.VERSE_BODY, x: 20, y: 76, w: 536, h: 200, z: 7 },
]

export const MENU_ITEMS = [
  { itemName: 'Stop & save', itemID: 1 },
  { itemName: 'Repeat last verse', itemID: 2 },
  { itemName: 'Pause / Resume', itemID: 3 },
] as const

export const MENU = {
  STOP: 1,
  REPEAT_VERSE: 2,
  PAUSE: 3,
} as const

/** Rough char budget for one verse-body page (536x200, ~6 lines in the baked
 *  LVGL font). Conservative; pixel-accurate measurement is a later refinement. */
export const VERSE_PAGE_CHARS = 240

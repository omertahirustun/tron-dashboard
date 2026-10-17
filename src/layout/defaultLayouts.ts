import type { Layout } from 'react-grid-layout'
import type { WidgetId } from '../widgets/registry'

type Item = Omit<Layout, 'i'> & { i: WidgetId }

export const BREAKPOINTS = { lg: 1280, md: 900, sm: 0 }
export const COLS = { lg: 12, md: 8, sm: 1 }
export type Breakpoint = keyof typeof BREAKPOINTS
/**
 * lg and md always fill the window exactly: the grid has ROWS rows and the row
 * height is worked out from the window height, so the page never scrolls.
 * sm (narrow browser windows only; the app's minimum width is 900) scrolls.
 */
export const ROWS = 24
export const SM_ROW_HEIGHT = 32

// lg: three columns, every column exactly ROWS tall
//  ┌explorer┐┌──agents.live───┐┌telemetry┐
//  │        │├────topology────┤├claude───┤
//  ├github──┤│   (graphify)   ││         │
//  ├music───┤│                │├network──┤
//  │        ││                │├todo─────┤
//  └────────┘└────────────────┘└─────────┘
const lg: Item[] = [
  { i: 'explorer', x: 0, y: 0, w: 3, h: 10, minW: 2, minH: 4 },
  { i: 'github', x: 0, y: 10, w: 3, h: 7, minW: 2, minH: 4 },
  { i: 'music', x: 0, y: 17, w: 3, h: 7, minW: 2, minH: 5 },
  { i: 'agents', x: 3, y: 0, w: 6, h: 6, minW: 3, minH: 4 },
  { i: 'topology', x: 3, y: 6, w: 6, h: 18, minW: 3, minH: 6 },
  { i: 'telemetry', x: 9, y: 0, w: 3, h: 5, minW: 2, minH: 4 },
  { i: 'claude', x: 9, y: 5, w: 3, h: 6, minW: 2, minH: 5 },
  { i: 'network', x: 9, y: 11, w: 3, h: 6, minW: 2, minH: 3 },
  { i: 'todo', x: 9, y: 17, w: 3, h: 7, minW: 2, minH: 4 },
]

// md: agents and graph on the left, everything else in two narrower columns
const md: Item[] = [
  { i: 'agents', x: 0, y: 0, w: 4, h: 6 },
  { i: 'topology', x: 0, y: 6, w: 4, h: 10 },
  { i: 'explorer', x: 0, y: 16, w: 2, h: 8 },
  { i: 'todo', x: 2, y: 16, w: 2, h: 8 },
  { i: 'telemetry', x: 4, y: 0, w: 4, h: 5 },
  { i: 'claude', x: 4, y: 5, w: 2, h: 7 },
  { i: 'network', x: 6, y: 5, w: 2, h: 7 },
  { i: 'github', x: 4, y: 12, w: 2, h: 12 },
  { i: 'music', x: 6, y: 12, w: 2, h: 12 },
]

const smOrder: WidgetId[] = ['agents', 'telemetry', 'explorer', 'topology', 'todo', 'claude', 'network', 'github', 'music']
const smHeights: Record<WidgetId, number> = {
  agents: 7, todo: 8, telemetry: 5, explorer: 8, topology: 12, claude: 7, network: 6, github: 7, music: 6,
}
let y = 0
const sm: Item[] = smOrder.map((i) => {
  const item = { i, x: 0, y, w: 1, h: smHeights[i] }
  y += item.h
  return item
})

export const DEFAULT_LAYOUTS: Record<Breakpoint, Layout[]> = { lg, md, sm }

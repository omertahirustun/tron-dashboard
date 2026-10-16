import type { Layout } from 'react-grid-layout'
import type { WidgetId } from '../widgets/registry'

type Item = Omit<Layout, 'i'> & { i: WidgetId }

export const BREAKPOINTS = { lg: 1280, md: 900, sm: 0 }
export const COLS = { lg: 12, md: 8, sm: 1 }
export type Breakpoint = keyof typeof BREAKPOINTS
export const ROW_HEIGHT = 32

// lg: three columns over a full-width command center
//  ┌explorer┐┌────topology────┐┌telemetry┐
//  ├github──┤│                │├claude───┤
//  ├music───┤│                │├network──┤
//  └────────┘└────────────────┘└tasks────┘
//  ┌──────────────terminal──────────────┐
const lg: Item[] = [
  { i: 'explorer', x: 0, y: 0, w: 3, h: 9, minW: 2, minH: 4 },
  { i: 'github', x: 0, y: 9, w: 3, h: 8, minW: 2, minH: 4 },
  { i: 'music', x: 0, y: 17, w: 3, h: 7, minW: 2, minH: 5 },
  { i: 'topology', x: 3, y: 0, w: 6, h: 24, minW: 3, minH: 6 },
  { i: 'telemetry', x: 9, y: 0, w: 3, h: 8, minW: 2, minH: 7 },
  { i: 'claude', x: 9, y: 8, w: 3, h: 7, minW: 2, minH: 6 },
  { i: 'network', x: 9, y: 15, w: 3, h: 4, minW: 2, minH: 3 },
  { i: 'tasks', x: 9, y: 19, w: 3, h: 5, minW: 2, minH: 3 },
  { i: 'terminal', x: 0, y: 24, w: 12, h: 10, minW: 4, minH: 6 },
]

const md: Item[] = [
  { i: 'topology', x: 0, y: 0, w: 8, h: 12 },
  { i: 'explorer', x: 0, y: 12, w: 4, h: 8 },
  { i: 'telemetry', x: 4, y: 12, w: 4, h: 8 },
  { i: 'github', x: 0, y: 20, w: 4, h: 7 },
  { i: 'claude', x: 4, y: 20, w: 4, h: 7 },
  { i: 'music', x: 0, y: 27, w: 4, h: 6 },
  { i: 'network', x: 4, y: 27, w: 4, h: 4 },
  { i: 'tasks', x: 4, y: 31, w: 4, h: 5 },
  { i: 'terminal', x: 0, y: 36, w: 8, h: 11 },
]

const smOrder: WidgetId[] = ['terminal', 'telemetry', 'explorer', 'topology', 'claude', 'tasks', 'network', 'github', 'music']
const smHeights: Record<WidgetId, number> = {
  terminal: 12, telemetry: 8, explorer: 8, topology: 10, claude: 7, tasks: 5, network: 4, github: 7, music: 6,
}
let y = 0
const sm: Item[] = smOrder.map((i) => {
  const item = { i, x: 0, y, w: 1, h: smHeights[i] }
  y += item.h
  return item
})

export const DEFAULT_LAYOUTS: Record<Breakpoint, Layout[]> = { lg, md, sm }

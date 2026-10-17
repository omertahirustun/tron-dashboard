import { motion } from 'framer-motion'
import { Bell, BellOff, Gamepad2, Lock, RotateCcw, SquareTerminal, Unlock } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react'
import GridLayout, { type Layout } from 'react-grid-layout'
import { IdentityDisc, LightCycles } from '../components/TronChrome'
import { TronButton } from '../components/TronButton'
import { LightCycleGame } from '../game/LightCycleGame'
import { chime } from '../lib/chime'
import { sfx } from '../lib/sfx'
import { native } from '../native/api'
import { useNativeSync } from '../native/useNativeSync'
import { AgentConsoleHost } from '../widgets/agents/AgentConsole'
import { WIDGETS, type WidgetId } from '../widgets/registry'
import { DashboardContext, type DashboardControls } from './DashboardContext'
import { BREAKPOINTS, COLS, DEFAULT_LAYOUTS, ROWS, SM_ROW_HEIGHT, type Breakpoint } from './defaultLayouts'

// v6: fixed-height grid that fills the window (older layouts were taller than it)
const STORAGE_KEY = 'aod.layouts.v6'
const LOCK_KEY = 'aod.locked.v1'

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // storage unavailable (private mode); layout just won't persist
  }
}

/** Saved layouts plus any panel added since they were saved (placed below everything else on sm). */
function withNewWidgets(saved: Partial<Record<Breakpoint, Layout[]>>): Record<Breakpoint, Layout[]> {
  const out = { ...DEFAULT_LAYOUTS }
  for (const bp of Object.keys(DEFAULT_LAYOUTS) as Breakpoint[]) {
    const mine = saved[bp]
    if (!mine) continue
    const kept = mine.filter((l) => l.i in WIDGETS)
    const bottom = Math.max(0, ...kept.map((l) => l.y + l.h))
    const missing = DEFAULT_LAYOUTS[bp].filter((d) => !kept.some((l) => l.i === d.i))
    // the window-filling grids have no room below: a new panel means the default layout
    if (bp !== 'sm' && (missing.length || bottom > ROWS)) continue
    out[bp] = [...kept, ...missing.map((d) => ({ ...d, y: bottom }))]
  }
  return out
}

function breakpointFor(width: number): Breakpoint {
  if (width >= BREAKPOINTS.lg) return 'lg'
  if (width >= BREAKPOINTS.md) return 'md'
  return 'sm'
}

/** Content size of an element, tracked with ResizeObserver (0 until measured). */
function useElementSize<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) =>
      setSize({ width: Math.floor(entry.contentRect.width), height: Math.floor(entry.contentRect.height) }),
    )
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, size] as const
}

const MARGIN = 10
const PADDING = 10

function Clock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])
  return <time className="app-clock tabular-nums">{now.toLocaleTimeString('en-GB', { hour12: false })}</time>
}

/** Mute / unmute the permission and finished-turn chimes; unmuting plays a sample. */
function SoundToggle() {
  const { muted } = useSyncExternalStore(chime.subscribe, chime.get)
  return (
    <TronButton
      sfxSource="toolbar.sound"
      onClick={() => {
        chime.set({ muted: !muted })
        if (muted) chime.play('permission')
      }}
      aria-pressed={!muted}
      aria-label={muted ? 'Unmute agent sounds' : 'Mute agent sounds'}
      title="Sound when an agent asks for permission or finishes its turn"
    >
      {muted ? <BellOff size={12} /> : <Bell size={12} />}
    </TronButton>
  )
}

export function Dashboard() {
  const [containerRef, { width, height }] = useElementSize<HTMLElement>()
  useNativeSync()
  const [layouts, setLayouts] = useState<Record<Breakpoint, Layout[]>>(() => withNewWidgets(load(STORAGE_KEY, {})))
  // Breakpoint is picked here and the grid remounts per breakpoint, so the column
  // count and the layout can never disagree. (RGL v2's Responsive mixed them up
  // and its drag lost pointer movement, putting the placeholder far from the cursor.)
  const bp = breakpointFor(width)
  // lg/md: ROWS rows that exactly fill the space under the header
  const fit = bp !== 'sm'
  const rowHeight = fit ? Math.max(8, (height - 2 * PADDING - (ROWS - 1) * MARGIN) / ROWS) : SM_ROW_HEIGHT
  const [resetCount, setResetCount] = useState(0)
  const [locked, setLockedState] = useState(() => load(LOCK_KEY, false))
  const [gameOpen, setGameOpen] = useState(false)

  const controls = useMemo<DashboardControls>(
    () => ({
      locked,
      setLocked: (next) => {
        setLockedState(next)
        save(LOCK_KEY, next)
        sfx.emit('toggle', { source: 'layout.lock', locked: next })
      },
      resetLayout: () => {
        setLayouts(DEFAULT_LAYOUTS)
        save(STORAGE_KEY, DEFAULT_LAYOUTS)
        setResetCount((n) => n + 1)
      },
    }),
    [locked],
  )

  return (
    <DashboardContext.Provider value={controls}>
      <div className="grid-floor" aria-hidden>
        <div className="grid-floor-view">
          <div className="grid-plane" />
        </div>
      </div>
      <div className={`relative z-10 flex flex-col ${fit ? 'h-screen overflow-hidden' : 'min-h-screen'} ${locked ? 'layout-locked' : ''}`}>
        <header className="app-header relative flex h-12 items-center gap-3 border-b border-cyan-line/60 bg-void/70 px-4 backdrop-blur-md">
          <IdentityDisc />
          <h1 lang="en" className="app-wordmark">
            Tron<span className="text-cyan">//</span>Dashboard
          </h1>
          <span className="hidden text-[11px] text-dim sm:inline">
            {locked ? 'layout locked' : 'drag a panel by its header, resize from the corner'}
          </span>
          <div className="ml-auto flex items-center gap-1 text-[12px]">
            {native && (
              <TronButton sfxSource="toolbar.terminal" onClick={() => void native?.openTerminalWindow()} aria-label="Open the terminal window" title="Tiled terminals in their own window">
                <SquareTerminal size={12} />
                <span className="hidden sm:inline">Terminals</span>
              </TronButton>
            )}
            <TronButton sfxSource="toolbar.game" onClick={() => setGameOpen(true)} aria-label="Play light cycles" title="Light cycles on the Grid">
              <Gamepad2 size={12} />
              <span className="hidden sm:inline">Grid game</span>
            </TronButton>
            <TronButton
              sfxSource="toolbar.lock"
              variant={locked ? 'solid' : 'ghost'}
              onClick={() => controls.setLocked(!locked)}
              aria-pressed={locked}
              aria-label={locked ? 'Unlock layout' : 'Lock layout'}
            >
              {locked ? <Lock size={12} /> : <Unlock size={12} />}
              <span className="hidden sm:inline">{locked ? 'Unlock layout' : 'Lock layout'}</span>
            </TronButton>
            <TronButton sfxSource="toolbar.reset" onClick={controls.resetLayout} disabled={locked} aria-label="Reset layout">
              <RotateCcw size={12} />
              <span className="hidden sm:inline">Reset layout</span>
            </TronButton>
            <SoundToggle />
            <span className="mx-2 h-4 w-px bg-cyan-line" aria-hidden />
            <Clock />
          </div>
        </header>
        <LightCycles />

        <main ref={containerRef} className={`min-h-0 flex-1 ${fit ? 'overflow-hidden' : ''}`}>
          {width > 0 && height > 0 && (
            <GridLayout
              key={`${bp}-${resetCount}`}
              width={width}
              layout={layouts[bp]}
              cols={COLS[bp]}
              rowHeight={rowHeight}
              maxRows={fit ? ROWS : Infinity}
              margin={[MARGIN, MARGIN]}
              containerPadding={[PADDING, PADDING]}
              // free placement: a panel lands where it is dropped and pushes whatever it
              // hits downward. Vertical compaction instead threw a panel dragged sideways
              // onto the tall topology panel to below it, far from the cursor.
              compactType={null}
              isDraggable={!locked}
              isResizable={!locked}
              draggableHandle=".widget-handle"
              draggableCancel=".no-drag"
              resizeHandles={['se', 'e', 's']}
              onLayoutChange={(layout) => {
                setLayouts((prev) => {
                  const next = { ...prev, [bp]: layout }
                  save(STORAGE_KEY, next)
                  return next
                })
              }}
              onDragStart={(_, item) => sfx.emit('drag-start', { source: 'layout', widget: item.i })}
              onDragStop={(_, __, item) => sfx.emit('drag-stop', { source: 'layout', widget: item.i })}
              onResizeStop={(_, __, item) => sfx.emit('resize-stop', { source: 'layout', widget: item.i })}
            >
              {(Object.keys(WIDGETS) as WidgetId[]).map((id, i) => {
                const Component = WIDGETS[id]
                return (
                  <div key={id}>
                    {/* staggered boot-up: each panel fades in and rises slightly */}
                    <motion.div
                      className="h-full"
                      style={{ '--boot-delay': `${0.35 + i * 0.07}s` } as CSSProperties}
                      initial={{ opacity: 0, y: 16 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.08 + i * 0.07, duration: 0.45, ease: [0.2, 0.8, 0.2, 1] }}
                    >
                      <Component />
                    </motion.div>
                  </div>
                )
              })}
            </GridLayout>
          )}
        </main>
      </div>
      <AgentConsoleHost />
      {gameOpen && <LightCycleGame onClose={() => setGameOpen(false)} />}
    </DashboardContext.Provider>
  )
}

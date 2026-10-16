import { motion } from 'framer-motion'
import { Lock, RotateCcw, Unlock } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import GridLayout, { type Layout } from 'react-grid-layout'
import { TronButton } from '../components/TronButton'
import { sfx } from '../lib/sfx'
import { useNativeSync } from '../native/useNativeSync'
import { useLogSimulator } from '../services/logs'
import { WIDGETS, type WidgetId } from '../widgets/registry'
import { DashboardContext, type DashboardControls } from './DashboardContext'
import { BREAKPOINTS, COLS, DEFAULT_LAYOUTS, ROW_HEIGHT, type Breakpoint } from './defaultLayouts'

// v1 layouts could be saved with the wrong column count; start fresh
const STORAGE_KEY = 'aod.layouts.v5'
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

function breakpointFor(width: number): Breakpoint {
  if (width >= BREAKPOINTS.lg) return 'lg'
  if (width >= BREAKPOINTS.md) return 'md'
  return 'sm'
}

/** Content width of an element, tracked with ResizeObserver (0 until measured). */
function useElementWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, width] as const
}

function Clock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])
  return <time className="tabular-nums text-ink">{now.toLocaleTimeString('en-GB', { hour12: false })}</time>
}

export function Dashboard() {
  const [containerRef, width] = useElementWidth<HTMLElement>()
  useLogSimulator()
  useNativeSync()
  const [layouts, setLayouts] = useState<Record<Breakpoint, Layout[]>>(() => ({
    ...DEFAULT_LAYOUTS,
    ...load(STORAGE_KEY, {}),
  }))
  // Breakpoint is picked here and the grid remounts per breakpoint, so the column
  // count and the layout can never disagree. (RGL v2's Responsive mixed them up
  // and its drag lost pointer movement, putting the placeholder far from the cursor.)
  const bp = breakpointFor(width)
  const [resetCount, setResetCount] = useState(0)
  const [locked, setLockedState] = useState(() => load(LOCK_KEY, false))

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
      <div className={`relative z-10 flex min-h-screen flex-col ${locked ? 'layout-locked' : ''}`}>
        <header className="flex h-11 items-center gap-3 border-b border-cyan-line/60 bg-void/70 px-4 backdrop-blur-md">
          <span className="size-2 rotate-45 bg-cyan shadow-[0_0_10px_var(--color-cyan)]" aria-hidden />
          <h1 className="whitespace-nowrap text-[13px] font-bold tracking-wide text-white">agent office</h1>
          <span className="hidden text-[11px] text-dim sm:inline">
            {locked ? 'layout locked' : 'drag a panel by its header, resize from the corner'}
          </span>
          <div className="ml-auto flex items-center gap-1 text-[12px]">
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
            <span className="mx-2 h-4 w-px bg-cyan-line" aria-hidden />
            <Clock />
          </div>
        </header>

        <main ref={containerRef} className="flex-1 px-1 pb-6">
          {width > 0 && (
            <GridLayout
              key={`${bp}-${resetCount}`}
              width={width}
              layout={layouts[bp]}
              cols={COLS[bp]}
              rowHeight={ROW_HEIGHT}
              margin={[12, 12]}
              containerPadding={[12, 12]}
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
    </DashboardContext.Provider>
  )
}

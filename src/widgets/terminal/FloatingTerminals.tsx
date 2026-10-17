import { AnimatePresence, motion } from 'framer-motion'
import { GripVertical, Maximize2, Minimize2, SquareTerminal, X, ZoomIn, ZoomOut } from 'lucide-react'
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { TronButton } from '../../components/TronButton'
import { sfx } from '../../lib/sfx'
import { termFont } from '../../lib/termFont'
import { native } from '../../native/api'
import { useConsoleRect, type Gesture } from '../agents/useConsoleRect'
import { useFloatTerms, type FloatTerm } from './floatingTerms'
import { ShellView } from './ShellView'

// Shells in windows over the dashboard, like the agent console but as many as
// wanted and without a backdrop: the dashboard stays usable around them.
// Alt+T or Ctrl+Shift+Enter opens one, Alt+E or Ctrl+Shift+W closes the focused one; Esc
// goes to the shell (vim, less…).

const SPRING = { type: 'spring', duration: 0.5, bounce: 0.14 } as const
const GRIPS: Gesture[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']

const isNewKey = (e: KeyboardEvent) =>
  e.type === 'keydown' &&
  ((e.ctrlKey && e.shiftKey && e.key === 'Enter') || (e.altKey && !e.ctrlKey && !e.shiftKey && !e.metaKey && e.code === 'KeyT'))
const isCloseKey = (e: KeyboardEvent) =>
  e.type === 'keydown' &&
  ((e.ctrlKey && e.shiftKey && e.code === 'KeyW') || (e.altKey && !e.ctrlKey && !e.shiftKey && !e.metaKey && e.code === 'KeyE'))
const isWindowKey = (e: KeyboardEvent) => isNewKey(e) || isCloseKey(e)

function FloatingTerminal({ term, z, focused }: { term: FloatTerm; z: number; focused: boolean }) {
  const { close, raise, setGeometry } = useFloatTerms.getState()
  const { rect: end, maximized, ref, begin, toggleMaximized } = useConsoleRect({
    load: () => term.geometry,
    save: (g) => setGeometry(term.id, g),
  })
  const fontSize = useSyncExternalStore(termFont.subscribe, termFont.get)
  const [ready, setReady] = useState(false)
  const onFocus = useCallback(() => raise(term.id), [raise, term.id])

  // FLIP out of the toolbar button; windows restored after a reload just fade in
  const from = term.origin
  const collapsed = from
    ? { x: from.x - end.x, y: from.y - end.y, scaleX: from.width / end.width, scaleY: from.height / end.height, opacity: 0.4 }
    : { x: 0, y: 12, scaleX: 0.97, scaleY: 0.97, opacity: 0 }

  useEffect(() => {
    sfx.emit('open', { source: 'terminal.float' })
  }, [])

  return (
    <motion.section
      role="dialog"
      aria-label={`Shell ${term.n}`}
      ref={ref}
      data-maximized={maximized || undefined}
      data-focused={focused || undefined}
      className="agent-console float-term pointer-events-auto fixed flex flex-col overflow-hidden border"
      style={{ left: end.x, top: end.y, width: end.width, height: end.height, zIndex: z, originX: 0, originY: 0 }}
      initial={collapsed}
      animate={{ x: 0, y: 0, scaleX: 1, scaleY: 1, opacity: 1 }}
      exit={{ ...collapsed, opacity: 0, transition: { duration: 0.25, ease: [0.4, 0, 0.6, 1] } }}
      transition={SPRING}
      onAnimationComplete={() => setReady(true)}
      onPointerDownCapture={onFocus}
    >
      {/* the widgets' frame: HUD brackets on the two square corners */}
      <span className="hud-corner" data-at="tr" aria-hidden />
      <span className="hud-corner" data-at="bl" aria-hidden />
      <header
        className="relative flex h-8 shrink-0 cursor-grab items-center gap-2 pr-1.5 pl-3 text-[12px] select-none active:cursor-grabbing"
        onPointerDown={(e) => {
          if (!(e.target as Element).closest('button')) begin('move', e)
        }}
        onDoubleClick={(e) => {
          if (!(e.target as Element).closest('button')) toggleMaximized()
        }}
      >
        <GripVertical size={13} className="text-dim" aria-hidden />
        <SquareTerminal size={13} className={focused ? 'text-cyan' : 'text-dim'} aria-hidden />
        <h2 lang="en" className={`widget-title ${focused ? '' : 'opacity-60'}`}>
          shell.{String(term.n).padStart(2, '0')}
        </h2>
        <span className="ml-auto flex items-center" aria-label="Font size">
          <TronButton sfxSource="terminal.font-down" onClick={() => termFont.step(-1)} aria-label="Smaller text" title="Smaller text (Ctrl+-, Ctrl+wheel)">
            <ZoomOut size={12} />
          </TronButton>
          <button
            type="button"
            onClick={termFont.reset}
            className="w-6 text-center text-[10px] tabular-nums text-dim hover:text-cyan"
            title="Reset text size (Ctrl+0)"
          >
            {fontSize}
          </button>
          <TronButton sfxSource="terminal.font-up" onClick={() => termFont.step(1)} aria-label="Larger text" title="Larger text (Ctrl+=, Ctrl+wheel)">
            <ZoomIn size={12} />
          </TronButton>
        </span>
        <TronButton
          sfxSource="terminal.maximize"
          onClick={toggleMaximized}
          aria-label={maximized ? 'Restore size' : 'Maximize'}
          title={maximized ? 'Restore size (double-click the title bar)' : 'Maximize (double-click the title bar)'}
        >
          {maximized ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
        </TronButton>
        <TronButton sfxSource="terminal.close" onClick={() => close(term.id)} aria-label="Close terminal" title="Close and end this shell (Alt+E)">
          <X size={13} />
        </TronButton>
        <span className="widget-rule" aria-hidden />
      </header>
      <div className="min-h-0 flex-1 pb-2">
        {ready && <ShellView id={term.id} focused={focused} isWindowKey={isWindowKey} onFocus={onFocus} />}
      </div>
      {ready && !maximized && GRIPS.map((g) => <div key={g} className="console-grip" data-edge={g} onPointerDown={(e) => begin(g, e)} aria-hidden />)}
    </motion.section>
  )
}

/** All floating terminals, in one stacking context between the dashboard and the agent console. */
export function FloatingTerminals() {
  const terms = useFloatTerms((s) => s.terms)
  const focused = useFloatTerms((s) => s.focused)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isNewKey(e)) {
        e.preventDefault()
        useFloatTerms.getState().open()
      } else if (isCloseKey(e) && document.activeElement?.closest('.float-term')) {
        e.preventDefault()
        const id = useFloatTerms.getState().focused
        if (id) useFloatTerms.getState().close(id)
      }
    }
    window.addEventListener('keydown', onKey)
    // `exit` or Ctrl+D in a shell closes its window
    const off = native?.onShellExit((e) => useFloatTerms.getState().drop(e.id))
    return () => {
      window.removeEventListener('keydown', onKey)
      off?.()
    }
  }, [])

  // rendered in opening order, stacked by z: raising a window must not move its
  // DOM node (xterm would lose focus and its textarea)
  const opened = [...terms].sort((a, b) => (a.id < b.id ? -1 : 1))
  if (!native) return null
  return (
    <div className="pointer-events-none fixed inset-0 isolate z-30">
      <AnimatePresence>
        {opened.map((t) => (
          <FloatingTerminal key={t.id} term={t} z={terms.indexOf(t) + 1} focused={t.id === focused} />
        ))}
      </AnimatePresence>
    </div>
  )
}

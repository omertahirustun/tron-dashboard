import { AnimatePresence, motion } from 'framer-motion'
import { GitBranch, GripVertical, Maximize2, Minimize2, Play, Power, TerminalSquare, X, ZoomIn, ZoomOut } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { TronButton } from '../../components/TronButton'
import { sfx } from '../../lib/sfx'
import { termFont } from '../../lib/termFont'
import { native, type LiveSession, type TranscriptLine } from '../../native/api'
import { useSessions } from '../../native/useSessions'
import { useOfficeStore, type AgentConsoleTarget } from '../../store/useOfficeStore'
import { ShellView } from '../terminal/ShellView'
import { PermissionPrompt } from './PermissionPrompt'
import { useConsoleRect, type Gesture } from './useConsoleRect'

// The agent console: grows out of the clicked agents.live card into a big
// terminal over the dashboard. A session running in a dashboard PTY is shown
// live (talk to it right there); one running in another terminal shows its
// transcript and can be resumed here.

// a soft spring with a hint of overshoot; transform + opacity only, so the
// compositor runs it without relayout or repaint of the panels underneath
const SPRING = { type: 'spring', duration: 0.55, bounce: 0.14 } as const
// Esc closes the console; Shift+Esc goes through to claude (its "interrupt")
const isCloseKey = (e: KeyboardEvent) =>
  e.type === 'keydown' &&
  ((e.key === 'Escape' && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) || (e.ctrlKey && e.shiftKey && e.code === 'KeyW'))

const GRIPS: Gesture[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']

function modelLabel(id: string | null | undefined) {
  const m = id?.replace(/^claude-/, '').match(/^([a-z]+)-(\d+)-(\d+)/)
  return m ? `${m[1]} ${m[2]}.${m[3]}` : (id?.replace(/^claude-/, '') ?? null)
}

/** Read-only, live conversation of a session that runs somewhere else */
function Transcript({ sessionId }: { sessionId: string }) {
  const [log, setLog] = useState<TranscriptLine[]>([])
  const box = useRef<HTMLDivElement>(null)
  const stick = useRef(true)

  useEffect(() => {
    if (!native) return
    const api = native
    let alive = true
    const load = () => void api.getTranscript(sessionId).then((t) => alive && setLog(t.log))
    load()
    const id = setInterval(load, 2000)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [sessionId])

  // follow new lines unless the user scrolled up to read
  useEffect(() => {
    const el = box.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [log])

  return (
    <div
      ref={box}
      className="h-full space-y-2 overflow-y-auto px-4 py-3 text-[12px] leading-relaxed"
      onScroll={(e) => {
        const el = e.currentTarget
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
      }}
    >
      {log.length === 0 && <p className="text-dim">No conversation yet.</p>}
      {log.map((l, i) =>
        l.kind === 'user' ? (
          <p key={i} className="whitespace-pre-wrap border-l-2 border-cyan pl-2 text-cyan">
            › {l.text}
          </p>
        ) : l.kind === 'text' ? (
          <p key={i} className="whitespace-pre-wrap text-ink">
            {l.text}
          </p>
        ) : l.kind === 'tool' ? (
          <p key={i} className="truncate text-[11px] text-dim">
            <span className="text-orange/80">◆</span> {l.text}
          </p>
        ) : (
          <p key={i} className="truncate text-[11px] text-crit/80">
            ✕ {l.text}
          </p>
        ),
      )}
    </div>
  )
}

const working = (s: LiveSession | undefined) => s?.activity.state === 'thinking' || s?.activity.state === 'tool'
const errorText = (e: Error) => e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

/** Bottom bar while the session can't be shown live yet: why, and what to do. */
function ActionBar({ text, children }: { text: string; children: React.ReactNode }) {
  return (
    <div className="flex shrink-0 items-center gap-3 border-t border-cyan-line/60 bg-[#03080a] px-4 py-2 text-[11px]">
      <p className="min-w-0 flex-1 text-dim">{text}</p>
      {children}
    </div>
  )
}

/**
 * Opening a card shows the session's Claude Code terminal. Already in a dashboard
 * PTY: attach. Not running: `claude --resume` here. Open in another terminal:
 * moved here (that claude is stopped first), right away when it is idle, or
 * when it finishes / on request when it is mid-turn.
 */
function ConsoleBody({ target, session, loaded }: { target: AgentConsoleTarget; session: LiveSession | undefined; loaded: boolean }) {
  const openConsole = useOfficeStore((s) => s.openConsole)
  const pane = session?.pane ?? target.pane ?? null
  const [error, setError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const [moveWhenDone, setMoveWhenDone] = useState(false)
  const tried = useRef(false)
  const elsewhere = session?.host === 'terminal'
  const busy = working(session)

  // only async state updates in here: it also runs from effects
  const launch = useCallback(
    (takeOver: boolean) => {
      native?.startAgent({ sessionId: target.sessionId, cwd: session?.cwd ?? target.cwd, takeOver }).then(
        (r) => openConsole({ ...target, pane: r.pane, stopped: false }),
        (e: Error) => {
          setError(errorText(e))
          setStarting(false)
          setMoveWhenDone(false)
        },
      )
    },
    [openConsole, session?.cwd, target],
  )
  const start = (takeOver: boolean) => {
    tried.current = true
    setError(null)
    setStarting(true)
    launch(takeOver)
  }

  // open → straight into the terminal, unless that would cut a running turn short
  // (or the user just stopped it with ■); "move when done" waits for the turn to end
  const auto = !pane && loaded && !target.stopped && !error && (!(elsewhere && busy) || moveWhenDone)
  useEffect(() => {
    if (!native || tried.current || !auto || (elsewhere && busy)) return
    tried.current = true
    launch(elsewhere)
  }, [auto, elsewhere, busy, launch])
  const showStarting = starting || (auto && !(elsewhere && busy))

  if (!native)
    return <p className="p-4 text-[12px] text-dim">The agent console runs in the desktop app (npm run app).</p>
  if (pane)
    return (
      <div className="min-h-0 flex-1 pt-1 pb-3">
        <ShellView id={pane} focused isWindowKey={isCloseKey} onFocus={() => {}} />
      </div>
    )
  return (
    <>
      <div className="min-h-0 flex-1">
        <Transcript sessionId={target.sessionId} />
      </div>
      {error && <p className="px-4 py-1 text-[11px] text-crit">{error}</p>}
      {showStarting ? (
        <ActionBar text={elsewhere ? 'Moving the session here: closing it in the other terminal…' : 'Starting claude…'}>
          <span className="agent-pulse size-1.5 rotate-45 bg-orange" aria-hidden />
        </ActionBar>
      ) : elsewhere ? (
        <ActionBar
          text={
            moveWhenDone
              ? 'Moves here as soon as this turn ends.'
              : busy
                ? 'Working in another terminal. Moving it here stops it there and cuts this turn short.'
                : 'Open in another terminal. Moving it here closes it there; the conversation continues.'
          }
        >
          {busy && !moveWhenDone && (
            <TronButton sfxSource="agents.move-later" variant="solid" onClick={() => setMoveWhenDone(true)} className="shrink-0">
              <Play size={12} /> move when done
            </TronButton>
          )}
          <TronButton sfxSource="agents.move" variant={busy ? 'alert' : 'solid'} onClick={() => start(true)} className="shrink-0">
            <Play size={12} /> move now
          </TronButton>
        </ActionBar>
      ) : (
        <ActionBar text="Not running.">
          <TronButton sfxSource="agents.resume" variant="solid" onClick={() => start(false)} className="shrink-0">
            <Play size={12} /> continue here
          </TronButton>
        </ActionBar>
      )}
    </>
  )
}

export function AgentConsole({ target }: { target: AgentConsoleTarget }) {
  const openConsole = useOfficeStore((s) => s.openConsole)
  const permissions = useOfficeStore((s) => s.permissions)
  const snapshot = useSessions()
  const session = snapshot?.sessions.find((s) => s.id === target.sessionId)
  const asks = permissions.filter((p) => p.sessionId === target.sessionId)
  const [ready, setReady] = useState(false)
  // the frame is laid out at its final size and only transformed while it opens/closes
  const { rect: end, maximized, ref, begin, toggleMaximized } = useConsoleRect()
  const fontSize = useSyncExternalStore(termFont.subscribe, termFont.get)
  const from = target.origin ?? { x: end.x + end.width / 2 - 60, y: end.y + 60, width: 120, height: 60 }
  // FLIP: the transform that puts the final frame onto the card
  const collapsed = {
    x: from.x - end.x,
    y: from.y - end.y,
    scaleX: from.width / end.width,
    scaleY: from.height / end.height,
  }
  const close = useCallback(() => openConsole(null), [openConsole])

  useEffect(() => {
    sfx.emit('open', { source: 'agents.console' })
    const onKey = (e: KeyboardEvent) => {
      if (isCloseKey(e)) {
        e.preventDefault()
        close()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close])

  const stop = () => {
    if (!native) return
    void native.stopAgent(target.sessionId).then(() => openConsole({ ...target, pane: null, stopped: true }))
  }

  const state = session?.activity.state
  const pane = session?.pane ?? target.pane

  return (
    <>
      <motion.div
        className="fixed inset-0 z-40 bg-black/55"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.3 }}
        onClick={close}
        aria-hidden
      />
      <motion.section
        role="dialog"
        aria-label={`Agent console: ${session?.project ?? 'new agent'}`}
        ref={ref}
        data-maximized={maximized || undefined}
        className="agent-console fixed z-50 flex flex-col overflow-hidden border"
        style={{ left: end.x, top: end.y, width: end.width, height: end.height, originX: 0, originY: 0 }}
        initial={{ ...collapsed, opacity: 0.4 }}
        animate={{ x: 0, y: 0, scaleX: 1, scaleY: 1, opacity: 1 }}
        exit={{ ...collapsed, opacity: 0, transition: { duration: 0.3, ease: [0.4, 0, 0.6, 1] } }}
        transition={SPRING}
        onAnimationComplete={() => setReady(true)}
      >
        {/* the widgets' frame: HUD brackets on the two square corners */}
        <span className="hud-corner" data-at="tr" aria-hidden />
        <span className="hud-corner" data-at="bl" aria-hidden />
        {/* light sweep down the frame as it opens */}
        <motion.span
          className="agent-console-scan"
          initial={{ y: 0, opacity: 1 }}
          animate={{ y: end.height, opacity: 0 }}
          transition={{ delay: 0.25, duration: 0.6, ease: [0.5, 0, 0.75, 0] }}
          aria-hidden
        />
        <motion.div
          className="flex min-h-0 flex-1 flex-col"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.1 } }}
          transition={{ delay: 0.28, duration: 0.22 }}
        >
          {/* drag to move, double-click to maximize */}
          <header
            className="relative flex h-8 shrink-0 cursor-grab items-center gap-2 pr-1.5 pl-3 text-[12px] select-none active:cursor-grabbing"
            onPointerDown={(e) => {
              if (!(e.target as Element).closest('button')) begin('move', e)
            }}
            onDoubleClick={(e) => {
              if (!(e.target as Element).closest('button')) toggleMaximized()
            }}
          >
            <GripVertical size={13} className="shrink-0 text-dim" aria-hidden />
            <TerminalSquare size={13} className={`shrink-0 ${state === 'thinking' || state === 'tool' ? 'text-orange' : 'text-cyan'}`} aria-hidden />
            <h2 lang="en" className="widget-title min-w-0 truncate">
              {session?.project ?? target.cwd?.split('/').pop() ?? 'agent'}
            </h2>
            {session?.branch && session.branch !== 'HEAD' && (
              <span className="flex items-center gap-0.5 text-[11px] text-dim">
                <GitBranch size={11} aria-hidden />
                {session.branch}
              </span>
            )}
            {session?.model && <span className="text-[11px] text-dim">{modelLabel(session.model)}</span>}
            <span className="min-w-0 truncate text-[11px] text-dim/80">{session?.title}</span>
            <span className="ml-auto shrink-0 text-[11px] text-dim">
              {pane ? 'live here' : session?.host === 'terminal' ? 'in another terminal' : 'not running'}
            </span>
            {pane && (
              <span className="flex items-center" aria-label="Font size">
                <TronButton sfxSource="agents.font-down" onClick={() => termFont.step(-1)} aria-label="Smaller text" title="Smaller text (Ctrl+-, Ctrl+wheel)">
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
                <TronButton sfxSource="agents.font-up" onClick={() => termFont.step(1)} aria-label="Larger text" title="Larger text (Ctrl+=, Ctrl+wheel)">
                  <ZoomIn size={12} />
                </TronButton>
              </span>
            )}
            <TronButton
              sfxSource="agents.maximize"
              onClick={toggleMaximized}
              aria-label={maximized ? 'Restore size' : 'Maximize'}
              title={maximized ? 'Restore size (double-click the title bar)' : 'Maximize (double-click the title bar)'}
            >
              {maximized ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
            </TronButton>
            {pane && (
              <TronButton sfxSource="agents.stop" onClick={stop} aria-label="Stop this claude" title="Stop this claude (the session stays resumable)">
                <Power size={12} />
              </TronButton>
            )}
            <TronButton sfxSource="agents.close" onClick={close} aria-label="Close console" title="Close (Esc); the agent keeps running. Shift+Esc interrupts claude">
              <X size={13} />
            </TronButton>
            <span className="widget-rule" aria-hidden />
          </header>
          {asks.length > 0 && (
            <div className="shrink-0 space-y-1.5 border-b border-orange/40 p-2">
              {asks.map((r) => (
                <PermissionPrompt key={r.id} request={r} />
              ))}
            </div>
          )}
          {ready && <ConsoleBody target={target} session={session} loaded={snapshot != null} />}
        </motion.div>
        {/* resize from every edge and corner */}
        {ready && !maximized && GRIPS.map((g) => <div key={g} className="console-grip" data-edge={g} onPointerDown={(e) => begin(g, e)} aria-hidden />)}
      </motion.section>
    </>
  )
}

/** Mounts the console for the selected agent; subscribes on its own so opening it doesn't re-render the dashboard. */
export function AgentConsoleHost() {
  const target = useOfficeStore((s) => s.agentConsole)
  return <AnimatePresence>{target && <AgentConsole key={target.sessionId} target={target} />}</AnimatePresence>
}

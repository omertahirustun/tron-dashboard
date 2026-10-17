import { Columns2, Maximize2, Minimize2, Plus, Rows2, SquareTerminal, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { TronButton } from '../components/TronButton'
import { native } from '../native/api'
import { ShellView } from '../widgets/terminal/ShellView'

// The terminal window: shells tiled like Hyprland's dwindle layout. Each new
// terminal splits the focused one along its longer side; closing one gives its
// space back to its sibling. Dividers drag to resize. The tree is remembered,
// and the shells live in the main process, so a reload reattaches to them.

type Tile =
  | { kind: 'leaf'; id: string }
  /** row: a | b side by side, col: a over b */
  | { kind: 'split'; id: string; dir: 'row' | 'col'; ratio: number; a: Tile; b: Tile }

const STORAGE_KEY = 'aod.terminals.v1'
const GAP = 6

const newId = () => `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

function loadTree(): Tile | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as Tile) : null
  } catch {
    return null
  }
}

function saveTree(tree: Tile | null) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tree))
  } catch {
    // storage blocked: the layout just isn't remembered
  }
}

const leaves = (t: Tile | null): string[] => (!t ? [] : t.kind === 'leaf' ? [t.id] : [...leaves(t.a), ...leaves(t.b)])

/** Replace the node with id `target` by what `fn` returns (null removes it). */
function mapTile(t: Tile, target: string, fn: (t: Tile) => Tile | null): Tile | null {
  if (t.id === target) return fn(t)
  if (t.kind === 'leaf') return t
  const a = mapTile(t.a, target, fn)
  const b = mapTile(t.b, target, fn)
  // a child went away: the other one takes the split's place
  if (!a) return b
  if (!b) return a
  return a === t.a && b === t.b ? t : { ...t, a, b }
}

function parentOf(t: Tile, id: string): Extract<Tile, { kind: 'split' }> | null {
  if (t.kind === 'leaf') return null
  if (t.a.id === id || t.b.id === id) return t
  return parentOf(t.a, id) ?? parentOf(t.b, id)
}

const paneRect = (id: string) => document.querySelector(`[data-pane="${id}"]`)?.getBoundingClientRect() ?? null

type Dir = 'left' | 'right' | 'up' | 'down'
const ARROWS: Record<string, Dir> = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' }

/** Nearest pane in a direction, measured between pane centres (like Hyprland's movefocus). */
function neighbour(ids: string[], from: string, dir: Dir) {
  const r = paneRect(from)
  if (!r) return null
  const cx = r.left + r.width / 2
  const cy = r.top + r.height / 2
  let best: string | null = null
  let bestScore = Infinity
  for (const id of ids) {
    if (id === from) continue
    const o = paneRect(id)
    if (!o) continue
    const dx = o.left + o.width / 2 - cx
    const dy = o.top + o.height / 2 - cy
    const along = dir === 'left' ? -dx : dir === 'right' ? dx : dir === 'up' ? -dy : dy
    const across = dir === 'left' || dir === 'right' ? Math.abs(dy) : Math.abs(dx)
    if (along <= 1) continue
    const score = along + across * 2
    if (score < bestScore) {
      bestScore = score
      best = id
    }
  }
  return best
}

/** Ctrl+Shift+… keys the window handles; xterm lets them through. */
function windowAction(e: KeyboardEvent) {
  if (!e.ctrlKey || !e.shiftKey || e.altKey || e.metaKey) return null
  if (e.key === 'Enter') return 'new'
  if (e.code === 'KeyW') return 'close'
  if (e.code === 'KeyT') return 'toggle'
  if (e.code === 'KeyF') return 'full'
  if (e.key in ARROWS) return ARROWS[e.key]
  return null
}
const isWindowKey = (e: KeyboardEvent) => windowAction(e) !== null

export function TerminalWindow() {
  const [tree, setTree] = useState<Tile | null>(() => loadTree() ?? { kind: 'leaf', id: newId() })
  const [focused, setFocused] = useState<string | null>(() => leaves(tree)[0] ?? null)
  const [full, setFull] = useState(false)
  const ids = leaves(tree)
  const current = focused && ids.includes(focused) ? focused : (ids[0] ?? null)

  useEffect(() => saveTree(tree), [tree])
  useEffect(() => {
    document.title = `Terminals (${ids.length}) · Agent Office Grid`
  }, [ids.length])

  const add = useCallback(() => {
    const id = newId()
    setTree((t) => {
      if (!t) return { kind: 'leaf', id }
      const target = current ?? leaves(t)[0]
      const r = paneRect(target)
      // dwindle: split along the longer side (terminal cells are tall, so favour columns)
      const dir = !r || r.width >= r.height * 1.2 ? 'row' : 'col'
      return mapTile(t, target, (leaf) => ({ kind: 'split', id: newId(), dir, ratio: 0.5, a: leaf, b: { kind: 'leaf', id } }))
    })
    setFocused(id)
    setFull(false)
  }, [current])

  const close = useCallback(
    (id: string) => {
      native?.killShell(id)
      setTree((t) => {
        if (!t) return t
        const next = mapTile(t, id, () => null)
        // focus the pane that took the space
        const sibling = parentOf(t, id)
        const heir = sibling ? (sibling.a.id === id ? sibling.b : sibling.a) : null
        setFocused(heir ? leaves(heir)[0] : (leaves(next)[0] ?? null))
        return next
      })
      setFull(false)
    },
    [],
  )

  const toggleSplit = useCallback(() => {
    if (!current) return
    setTree((t) => {
      const parent = t && parentOf(t, current)
      if (!t || !parent) return t
      return mapTile(t, parent.id, (p) => (p.kind === 'split' ? { ...p, dir: p.dir === 'row' ? 'col' : 'row' } : p))
    })
  }, [current])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const action = windowAction(e)
      if (!action) return
      e.preventDefault()
      e.stopPropagation()
      if (action === 'new') add()
      else if (action === 'close') {
        if (current) close(current)
      }
      else if (action === 'toggle') toggleSplit()
      else if (action === 'full') setFull((f) => !f)
      else if (current) {
        const next = neighbour(ids, current, action)
        if (next) {
          setFocused(next)
          setFull(false)
        }
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [add, close, toggleSplit, current, ids])

  const setRatio = useCallback((splitId: string, ratio: number) => {
    setTree((t) => t && mapTile(t, splitId, (s) => (s.kind === 'split' ? { ...s, ratio } : s)))
  }, [])

  const renderTile = (t: Tile): ReactNode => {
    if (t.kind === 'leaf') {
      const active = t.id === current
      const hidden = full && !active
      return (
        <div
          key={t.id}
          data-pane={t.id}
          className={`term-pane ${active ? 'is-active' : ''}`}
          style={hidden ? { display: 'none' } : full ? { position: 'absolute', inset: 0 } : { flex: 1, minWidth: 0, minHeight: 0 }}
        >
          <header className="flex h-6 shrink-0 items-center gap-2 border-b border-cyan-line/50 px-2 text-[11px]">
            <SquareTerminal size={11} className={active ? 'text-cyan' : 'text-dim'} aria-hidden />
            <span className={active ? 'text-ink' : 'text-dim'}>shell {ids.indexOf(t.id) + 1}</span>
            <button type="button" onClick={() => close(t.id)} aria-label="Close terminal" className="ml-auto text-dim hover:text-crit">
              <X size={12} />
            </button>
          </header>
          <div className="min-h-0 flex-1">
            <ShellView id={t.id} focused={active} isWindowKey={isWindowKey} onFocus={() => setFocused(t.id)} />
          </div>
        </div>
      )
    }
    return (
      <Split key={t.id} tile={t} onRatio={setRatio}>
        {renderTile(t.a)}
        {renderTile(t.b)}
      </Split>
    )
  }

  return (
    <div className="flex h-screen flex-col bg-void">
      <header className="flex h-9 shrink-0 items-center gap-2 border-b border-cyan-line/60 px-3 text-[12px]">
        <span className="size-2 rotate-45 bg-cyan shadow-[0_0_10px_var(--color-cyan)]" aria-hidden />
        <h1 className="font-bold text-white">terminals</h1>
        <span className="text-dim tabular-nums">{ids.length}</span>
        <span className="hidden truncate text-[11px] text-dim md:inline">
          Ctrl+Shift+Enter new · Ctrl+Shift+W close · Ctrl+Shift+arrows focus · Ctrl+Shift+T flip split · Ctrl+Shift+F fullscreen
        </span>
        <div className="ml-auto flex items-center gap-1">
          <TronButton sfxSource="terminals.new" onClick={add} title="New terminal (Ctrl+Shift+Enter)">
            <Plus size={12} /> new
          </TronButton>
          <TronButton sfxSource="terminals.toggle" onClick={toggleSplit} disabled={ids.length < 2} title="Flip the split of the focused terminal (Ctrl+Shift+T)">
            {parentOf(tree ?? { kind: 'leaf', id: '' }, current ?? '')?.dir === 'col' ? <Columns2 size={12} /> : <Rows2 size={12} />}
          </TronButton>
          <TronButton sfxSource="terminals.full" variant={full ? 'solid' : 'ghost'} onClick={() => setFull((f) => !f)} disabled={ids.length < 2} title="Fullscreen the focused terminal (Ctrl+Shift+F)">
            {full ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
          </TronButton>
        </div>
      </header>
      <main className="relative min-h-0 flex-1" style={{ padding: GAP * 1.5 }}>
        {tree ? (
          <div className="relative flex h-full">{renderTile(tree)}</div>
        ) : (
          <div className="flex h-full items-center justify-center">
            <TronButton sfxSource="terminals.new" variant="solid" onClick={add}>
              <Plus size={12} /> new terminal
            </TronButton>
          </div>
        )}
      </main>
    </div>
  )
}

// In fullscreen the focused pane is positioned over the whole area and the
// others are hidden; the split boxes stay so no terminal is remounted.
function Split({ tile, onRatio, children }: { tile: Extract<Tile, { kind: 'split' }>; onRatio: (id: string, r: number) => void; children: [ReactNode, ReactNode] }) {
  const box = useRef<HTMLDivElement>(null)
  const row = tile.dir === 'row'
  const drag = (e: ReactPointerEvent<HTMLDivElement>) => {
    const el = box.current
    if (!el) return
    e.preventDefault()
    const handle = e.currentTarget
    handle.setPointerCapture(e.pointerId)
    const move = (ev: PointerEvent) => {
      const r = el.getBoundingClientRect()
      const pos = row ? (ev.clientX - r.left) / r.width : (ev.clientY - r.top) / r.height
      onRatio(tile.id, Math.min(0.85, Math.max(0.15, pos)))
    }
    const up = () => {
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', up)
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', up)
  }
  return (
    <div ref={box} className={`flex min-h-0 min-w-0 ${row ? 'flex-row' : 'flex-col'}`} style={{ flex: 1 }}>
      <div className="flex min-h-0 min-w-0" style={{ flex: `${tile.ratio} 1 0` }}>
        {children[0]}
      </div>
      <div
        role="separator"
        aria-orientation={row ? 'vertical' : 'horizontal'}
        onPointerDown={drag}
        className={`term-divider shrink-0 ${row ? 'cursor-col-resize' : 'cursor-row-resize'}`}
        style={row ? { width: GAP } : { height: GAP }}
      />
      <div className="flex min-h-0 min-w-0" style={{ flex: `${1 - tile.ratio} 1 0` }}>
        {children[1]}
      </div>
    </div>
  )
}

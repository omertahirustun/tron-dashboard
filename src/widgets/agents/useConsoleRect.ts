import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'

// Where a console sits: dragged by its header, resized from any edge or corner,
// maximized to the whole window. The agent console remembers its own across
// openings; floating terminals pass in where each one keeps its geometry.

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}
/** n, s, e, w, ne, nw, se, sw; or "move" */
export type Gesture = 'move' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

export interface ConsoleGeometry {
  rect: Rect
  maximized: boolean
}

const KEY = 'aod.console.v1'
const MIN_W = 420
const MIN_H = 240

function defaultRect(): Rect {
  const width = Math.min(1180, window.innerWidth - 64)
  const top = 60
  return { x: (window.innerWidth - width) / 2, y: top, width, height: window.innerHeight - top - 24 }
}

const fullRect = (): Rect => ({ x: 0, y: 0, width: window.innerWidth, height: window.innerHeight })

export function clamp(r: Rect): Rect {
  const width = Math.min(Math.max(r.width, MIN_W), window.innerWidth)
  const height = Math.min(Math.max(r.height, MIN_H), window.innerHeight)
  // wholly on screen, so every edge and the corner grip stay within reach
  return {
    width,
    height,
    x: Math.min(Math.max(r.x, 0), window.innerWidth - width),
    y: Math.min(Math.max(r.y, 0), window.innerHeight - height),
  }
}

function load(): ConsoleGeometry {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null')
    if (saved?.rect) return { rect: clamp(saved.rect), maximized: Boolean(saved.maximized) }
  } catch {
    // unreadable: defaults
  }
  return { rect: defaultRect(), maximized: false }
}

function save(state: ConsoleGeometry) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state))
  } catch {
    // not persisted
  }
}

/**
 * Geometry of the console. During a drag the element is moved directly (no
 * React render per pointer move); the result is committed on release.
 */
export function useConsoleRect(store: { load: () => ConsoleGeometry; save: (g: ConsoleGeometry) => void } = { load, save }) {
  const [state, setState] = useState(store.load)
  const persist = useRef(store.save)
  const el = useRef<HTMLElement | null>(null)
  const shown = state.maximized ? fullRect() : state.rect

  // the window got smaller: keep the console reachable (a maximized one just follows)
  useEffect(() => {
    const onResize = () => setState((s) => ({ ...s, rect: clamp(s.rect) }))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const commit = useCallback((next: ConsoleGeometry) => {
    setState(next)
    persist.current(next)
  }, [])

  const toggleMaximized = useCallback(() => {
    setState((s) => {
      const next = { ...s, maximized: !s.maximized }
      persist.current(next)
      return next
    })
  }, [])

  const begin = useCallback(
    (gesture: Gesture, e: ReactPointerEvent) => {
      const node = el.current
      if (!node || e.button !== 0) return
      e.preventDefault()
      const sx = e.clientX
      const sy = e.clientY
      let start = state.maximized ? fullRect() : state.rect
      let maximized = state.maximized
      let current = start
      const target = e.currentTarget as HTMLElement
      target.setPointerCapture(e.pointerId)
      document.body.classList.add('console-gesture')

      const apply = (r: Rect) => {
        node.style.left = `${r.x}px`
        node.style.top = `${r.y}px`
        node.style.width = `${r.width}px`
        node.style.height = `${r.height}px`
      }

      const move = (ev: PointerEvent) => {
        const dx = ev.clientX - sx
        const dy = ev.clientY - sy
        if (gesture === 'move' && maximized) {
          // dragging a maximized console restores it, under the pointer
          if (Math.abs(dx) + Math.abs(dy) < 6) return
          maximized = false
          const r = state.rect
          const fx = sx / window.innerWidth
          start = { ...r, x: sx - r.width * fx, y: Math.max(0, sy - 18) }
        }
        let { x, y, width, height } = start
        if (gesture === 'move') {
          x += dx
          y += dy
        } else {
          if (gesture.includes('e')) width = start.width + dx
          if (gesture.includes('s')) height = start.height + dy
          if (gesture.includes('w')) {
            width = Math.max(MIN_W, start.width - dx)
            x = start.x + start.width - width
          }
          if (gesture.includes('n')) {
            height = Math.max(MIN_H, start.height - dy)
            y = start.y + start.height - height
          }
        }
        current = clamp({ x, y, width, height })
        apply(current)
      }
      const end = () => {
        target.removeEventListener('pointermove', move)
        target.removeEventListener('pointerup', end)
        target.removeEventListener('pointercancel', end)
        document.body.classList.remove('console-gesture')
        if (maximized) return // a click on the header of a maximized console
        commit({ rect: current, maximized: false })
      }
      target.addEventListener('pointermove', move)
      target.addEventListener('pointerup', end)
      target.addEventListener('pointercancel', end)
    },
    [state, commit],
  )

  return { rect: shown, maximized: state.maximized, ref: el, begin, toggleMaximized }
}

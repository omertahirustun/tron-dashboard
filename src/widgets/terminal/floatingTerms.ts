import { create } from 'zustand'
import { native } from '../../native/api'
import { clamp, type ConsoleGeometry, type Rect } from '../agents/useConsoleRect'

// Terminals floating over the dashboard, as many as wanted. The list is the
// stacking order (last = on top) and is remembered; the shells live in the PTY
// host, so after a reload each window reattaches to its shell.

export interface FloatTerm {
  id: string
  /** shown as "shell n"; the lowest free number */
  n: number
  geometry: ConsoleGeometry
  /** the rect it grows out of (the toolbar button); only for windows opened this session */
  origin?: Rect
}

interface FloatTermsState {
  terms: FloatTerm[]
  focused: string | null
  open: (origin?: Rect) => void
  /** close the window and end its shell */
  close: (id: string) => void
  /** the shell ended by itself (exit, Ctrl+D): just drop the window */
  drop: (id: string) => void
  raise: (id: string) => void
  setGeometry: (id: string, g: ConsoleGeometry) => void
}

const KEY = 'aod.floatTerms.v1'
const CASCADE = 28

const newId = () => `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

function load(): FloatTerm[] {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '[]') as FloatTerm[]
    return Array.isArray(saved)
      ? saved.map((t) => ({ id: t.id, n: t.n, geometry: { rect: clamp(t.geometry.rect), maximized: Boolean(t.geometry.maximized) } }))
      : []
  } catch {
    return []
  }
}

function save(terms: FloatTerm[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(terms.map(({ id, n, geometry }) => ({ id, n, geometry }))))
  } catch {
    // not remembered
  }
}

/** a new window: centred under the header, each one stepped down-right from the last */
function placeNew(count: number): Rect {
  // room for fastfetch's logo + info box at the default 16 px font
  const width = Math.min(1180, window.innerWidth - 64)
  const height = Math.min(660, window.innerHeight - 120)
  const step = (count % 8) * CASCADE
  return clamp({ x: (window.innerWidth - width) / 2 - 3.5 * CASCADE + step, y: 72 + step, width, height })
}

const top = (terms: FloatTerm[]) => terms.at(-1)?.id ?? null

export const useFloatTerms = create<FloatTermsState>((set) => {
  const initial = load()
  const update = (fn: (s: FloatTermsState) => Partial<FloatTermsState>) =>
    set((s) => {
      const next = fn(s)
      if (next.terms) save(next.terms)
      return next
    })

  return {
    terms: initial,
    focused: top(initial),
    open: (origin) =>
      update((s) => {
        const used = new Set(s.terms.map((t) => t.n))
        let n = 1
        while (used.has(n)) n++
        const term: FloatTerm = { id: newId(), n, geometry: { rect: placeNew(s.terms.length), maximized: false }, origin }
        return { terms: [...s.terms, term], focused: term.id }
      }),
    close: (id) => {
      native?.killShell(id)
      useFloatTerms.getState().drop(id)
    },
    drop: (id) =>
      update((s) => {
        if (!s.terms.some((t) => t.id === id)) return {}
        const terms = s.terms.filter((t) => t.id !== id)
        return { terms, focused: s.focused === id ? top(terms) : s.focused }
      }),
    raise: (id) =>
      update((s) => {
        const term = s.terms.find((t) => t.id === id)
        if (!term) return {}
        if (top(s.terms) === id) return s.focused === id ? {} : { focused: id }
        return { terms: [...s.terms.filter((t) => t.id !== id), term], focused: id }
      }),
    setGeometry: (id, geometry) => update((s) => ({ terms: s.terms.map((t) => (t.id === id ? { ...t, geometry } : t)) })),
  }
})

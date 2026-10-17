// Terminal font size, shared by every ShellView (agent console and terminal
// window) and remembered. Ctrl+= / Ctrl+- / Ctrl+0 or Ctrl+wheel change it.

const KEY = 'aod.termFont.v1'
// foot's 12 pt (dpi-aware=no) is 16 px
export const FONT_DEFAULT = 16
const MIN = 8
const MAX = 28

function load() {
  try {
    const n = Number(localStorage.getItem(KEY))
    return n >= MIN && n <= MAX ? n : FONT_DEFAULT
  } catch {
    return FONT_DEFAULT
  }
}

let size = load()
const listeners = new Set<() => void>()

export const termFont = {
  get: () => size,
  set(next: number) {
    const clamped = Math.min(MAX, Math.max(MIN, Math.round(next)))
    if (clamped === size) return
    size = clamped
    try {
      localStorage.setItem(KEY, String(size))
    } catch {
      // not persisted
    }
    listeners.forEach((l) => l())
  },
  step: (delta: number) => termFont.set(size + delta),
  reset: () => termFont.set(FONT_DEFAULT),
  subscribe(listener: () => void) {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },
}

/** Ctrl+= / Ctrl++ / Ctrl+- / Ctrl+0: true when the key was a zoom key (and was handled). */
export function handleZoomKey(e: KeyboardEvent) {
  if (e.type !== 'keydown' || !e.ctrlKey || e.altKey || e.metaKey) return false
  if (e.key === '=' || e.key === '+') termFont.step(1)
  else if (e.key === '-' && !e.shiftKey) termFont.step(-1)
  else if (e.key === '0' && !e.shiftKey) termFont.reset()
  else return false
  e.preventDefault()
  return true
}

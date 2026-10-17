// One slow clock for everything that animates on its own (the backdrop, the
// graph's auto-spin, the music ring). Every frame anything changes on screen,
// the compositor re-blurs every glass panel, so the cost is per frame, not per
// animation: loops that tick on the same grid land in the same frame and cost
// one frame instead of one each. Between ticks they sleep on a timer instead
// of waking at every display refresh (144 Hz) only to skip it.
//
// The slow loops rest (the scene freezes where it is) while the window is in
// the background, since on X11 Chromium can't tell that the window is covered
// and would keep drawing what nobody sees, and after IDLE_MS without mouse or
// keyboard. They pick up on focus / the first input.

export const SLOW_FPS = 15
const IDLE_MS = 60_000

let focused = typeof document === 'undefined' || document.hasFocus()
let idle = false
let idleTimer: ReturnType<typeof setTimeout> | 0 = 0
const waiting = new Set<() => void>()

const wakeAll = () => {
  if (!focused || idle) return
  const resume = [...waiting]
  waiting.clear()
  resume.forEach((f) => f())
}
const activity = () => {
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = setTimeout(() => {
    idle = true
  }, IDLE_MS)
  if (idle) {
    idle = false
    wakeAll()
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('focus', () => {
    focused = true
    activity()
    wakeAll()
  })
  window.addEventListener('blur', () => {
    focused = false
  })
  // capture: xterm and the canvases stop some events from bubbling
  for (const type of ['pointermove', 'pointerdown', 'keydown', 'wheel'] as const) {
    window.addEventListener(type, activity, { capture: true, passive: true })
  }
  activity()
}

/** false while the window is in the background or nobody touched it for a while */
export const motionAllowed = () => focused && !idle

export interface FrameLoop {
  /** run on the next display frame (dragging, easing toward a target) */
  soon(): void
  /** run on the next tick of the shared grid (15 fps unless fps is given; use a multiple of 15) */
  slow(fps?: number): void
  stop(): void
}

/** keepWhenIdle: still runs while nobody touches the window (the music visualizer) */
export function frameLoop(cb: (now: number) => void, { keepWhenIdle = false } = {}): FrameLoop {
  let raf = 0
  let timer: ReturnType<typeof setTimeout> | 0 = 0
  let stopped = false
  let slowFps = SLOW_FPS
  const run = (now: number) => {
    raf = 0
    if (!stopped) cb(now)
  }
  const resume = () => loop.slow(slowFps)
  const loop: FrameLoop = {
    soon() {
      if (stopped || raf) return
      if (timer) clearTimeout(timer)
      timer = 0
      raf = requestAnimationFrame(run)
    },
    slow(fps = SLOW_FPS) {
      if (stopped || raf || timer) return
      if (!focused || (idle && !keepWhenIdle)) {
        slowFps = fps
        waiting.add(resume)
        return
      }
      const period = 1000 / fps
      // wake just before the grid line, so every loop asks for the same display frame
      const wait = period - (performance.now() % period)
      timer = setTimeout(
        () => {
          timer = 0
          if (!stopped) raf = requestAnimationFrame(run)
        },
        Math.max(0, wait - 3),
      )
    },
    stop() {
      stopped = true
      waiting.delete(resume)
      cancelAnimationFrame(raf)
      if (timer) clearTimeout(timer)
    },
  }
  return loop
}

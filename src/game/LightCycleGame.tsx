import { X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { chime } from '../lib/chime'

/**
 * Light cycles on the Grid: you (cyan) against a program (orange). Each cycle
 * leaves a wall of light; touch a wall or the arena's edge and you derezz.
 * First to 3 rounds. Arrows / WASD steer, Space starts, P pauses, Esc leaves.
 *
 * The simulation runs on a fixed tick; the canvas redraws only while the
 * overlay is open, and stops between rounds.
 */

const CELL = 10
const WIN_ROUNDS = 3
const BEST_KEY = 'aod.lightcycle.v1'

type Dir = 0 | 1 | 2 | 3 // up right down left
const DX = [0, 1, 0, -1]
const DY = [-1, 0, 1, 0]

interface Cycle {
  x: number
  y: number
  dir: Dir
  trail: { x: number; y: number }[]
  alive: boolean
  hue: number
}

interface Spark {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  hue: number
}

type Phase = 'ready' | 'countdown' | 'running' | 'paused' | 'roundOver' | 'matchOver'

// ── sound: tiny synth blips, silent when the dashboard sounds are muted ──
let ac: AudioContext | null = null
function blip(freq: number, dur: number, type: OscillatorType = 'square', gain = 0.06, slide = 0) {
  if (chime.get().muted) return
  try {
    ac ??= new AudioContext()
    if (ac.state === 'suspended') void ac.resume()
    const t = ac.currentTime
    const o = ac.createOscillator()
    const g = ac.createGain()
    o.type = type
    o.frequency.setValueAtTime(freq, t)
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur)
    g.gain.setValueAtTime(gain, t)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    o.connect(g).connect(ac.destination)
    o.start(t)
    o.stop(t + dur + 0.02)
  } catch {
    // no audio device
  }
}
const sfx = {
  count: () => blip(440, 0.12, 'square', 0.05),
  go: () => blip(880, 0.25, 'square', 0.06),
  turn: () => blip(1300, 0.03, 'triangle', 0.025),
  crash: () => {
    blip(220, 0.5, 'sawtooth', 0.08, -180)
    blip(90, 0.6, 'square', 0.05, -50)
  },
  win: () => [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => blip(f, 0.16, 'square', 0.05), i * 110)),
}

function loadBest(): number {
  try {
    return Number(localStorage.getItem(BEST_KEY)) || 0
  } catch {
    return 0
  }
}

export function LightCycleGame({ onClose }: { onClose: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [phase, setPhase] = useState<Phase>('ready')
  const [score, setScore] = useState({ you: 0, cpu: 0 })
  const [count, setCount] = useState(3)
  const [best, setBest] = useState(loadBest)
  const [streak, setStreak] = useState(0)
  const [message, setMessage] = useState('')

  // everything the loop touches lives in one ref so key handlers and the loop agree
  const game = useRef({
    cols: 0,
    rows: 0,
    grid: new Uint8Array(0), // 0 free, 1 you, 2 cpu
    you: null as Cycle | null,
    cpu: null as Cycle | null,
    queue: [] as Dir[],
    sparks: [] as Spark[],
    tickMs: 70,
    acc: 0,
    phase: 'ready' as Phase,
    ticks: 0,
  })
  const setPhaseBoth = (p: Phase) => {
    game.current.phase = p
    setPhase(p)
  }

  // ── round setup ──
  const newRound = () => {
    const g = game.current
    const cv = canvasRef.current!
    g.cols = Math.floor(cv.clientWidth / CELL)
    g.rows = Math.floor(cv.clientHeight / CELL)
    g.grid = new Uint8Array(g.cols * g.rows)
    const y = Math.floor(g.rows / 2)
    g.you = { x: Math.floor(g.cols * 0.2), y, dir: 1, trail: [], alive: true, hue: 187 }
    g.cpu = { x: Math.floor(g.cols * 0.8), y, dir: 3, trail: [], alive: true, hue: 32 }
    for (const c of [g.you, g.cpu]) {
      c.trail.push({ x: c.x, y: c.y })
      g.grid[c.y * g.cols + c.x] = c === g.you ? 1 : 2
    }
    g.queue = []
    g.sparks = []
    g.tickMs = 70
    g.acc = 0
    g.ticks = 0
    setMessage('')
    setCount(3)
    setPhaseBoth('countdown')
    sfx.count()
  }

  const startMatch = () => {
    setScore({ you: 0, cpu: 0 })
    newRound()
  }

  // countdown 3-2-1-GO
  useEffect(() => {
    if (phase !== 'countdown') return
    const id = setInterval(() => {
      setCount((c) => {
        if (c <= 1) {
          clearInterval(id)
          sfx.go()
          setPhaseBoth('running')
          return 0
        }
        sfx.count()
        return c - 1
      })
    }, 650)
    return () => clearInterval(id)
  }, [phase])

  // ── keys ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const g = game.current
      const keyDir: Record<string, Dir> = {
        ArrowUp: 0, KeyW: 0, ArrowRight: 1, KeyD: 1, ArrowDown: 2, KeyS: 2, ArrowLeft: 3, KeyA: 3,
      }
      if (e.code === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onClose()
        return
      }
      if (e.code in keyDir) {
        e.preventDefault()
        e.stopPropagation()
        if (g.phase !== 'running' && g.phase !== 'countdown') return
        const d = keyDir[e.code]
        const last = g.queue.length ? g.queue[g.queue.length - 1] : g.you!.dir
        // no reversing into your own wall, no repeats; buffer two turns for quick zig-zags
        if (d !== last && (d + 2) % 4 !== last && g.queue.length < 2) g.queue.push(d)
        return
      }
      if (e.code === 'Space' || e.code === 'Enter') {
        e.preventDefault()
        e.stopPropagation()
        if (g.phase === 'ready' || g.phase === 'matchOver') startMatch()
        else if (g.phase === 'roundOver') newRound()
        else if (g.phase === 'paused') setPhaseBoth('running')
        return
      }
      if (e.code === 'KeyP') {
        e.preventDefault()
        e.stopPropagation()
        if (g.phase === 'running') setPhaseBoth('paused')
        else if (g.phase === 'paused') setPhaseBoth('running')
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  // ── simulation + drawing ──
  useEffect(() => {
    const cv = canvasRef.current!
    const ctx = cv.getContext('2d')!
    let raf = 0
    let last = performance.now()
    let dpr = 1

    const resize = () => {
      dpr = Math.min(2, window.devicePixelRatio || 1)
      cv.width = Math.round(cv.clientWidth * dpr)
      cv.height = Math.round(cv.clientHeight * dpr)
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(cv)

    const free = (x: number, y: number) => {
      const g = game.current
      return x >= 0 && y >= 0 && x < g.cols && y < g.rows && g.grid[y * g.cols + x] === 0
    }

    /** cells reachable from (x,y), capped: how much room a move leaves */
    const room = (sx: number, sy: number, cap: number) => {
      const g = game.current
      if (!free(sx, sy)) return 0
      const seen = new Uint8Array(g.cols * g.rows)
      const stack = [sx, sy]
      seen[sy * g.cols + sx] = 1
      let n = 0
      while (stack.length && n < cap) {
        const y = stack.pop()!
        const x = stack.pop()!
        n++
        for (let d = 0; d < 4; d++) {
          const nx = x + DX[d], ny = y + DY[d]
          if (free(nx, ny) && !seen[ny * g.cols + nx]) {
            seen[ny * g.cols + nx] = 1
            stack.push(nx, ny)
          }
        }
      }
      return n
    }

    /** the program: keep the most room, prefer straight lines, cut toward the player */
    const think = (c: Cycle, foe: Cycle) => {
      const options = [c.dir, ((c.dir + 1) % 4) as Dir, ((c.dir + 3) % 4) as Dir]
      let bestDir = c.dir
      let bestScore = -Infinity
      for (const d of options) {
        const nx = c.x + DX[d], ny = c.y + DY[d]
        if (!free(nx, ny)) continue
        const space = room(nx, ny, 500)
        // look ahead a few cells: walls coming up soon are bad
        let run = 0
        while (run < 12 && free(c.x + DX[d] * (run + 1), c.y + DY[d] * (run + 1))) run++
        const dist = Math.abs(nx + DX[foe.dir] * 4 - foe.x) + Math.abs(ny + DY[foe.dir] * 4 - foe.y)
        const s = space * 4 + run * 2 - dist * 0.6 + (d === c.dir ? 3 : 0) + Math.random() * 6
        if (s > bestScore) {
          bestScore = s
          bestDir = d
        }
      }
      if (bestDir !== c.dir) c.dir = bestDir
    }

    const derezz = (c: Cycle) => {
      const g = game.current
      c.alive = false
      for (let i = 0; i < 70; i++) {
        const a = Math.random() * Math.PI * 2
        const v = 40 + Math.random() * 220
        g.sparks.push({ x: c.x * CELL + CELL / 2, y: c.y * CELL + CELL / 2, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.6 + Math.random() * 0.8, hue: c.hue })
      }
      // the trail falls apart too
      for (let i = 0; i < c.trail.length; i += 3) {
        const p = c.trail[i]
        g.sparks.push({ x: p.x * CELL + CELL / 2, y: p.y * CELL + CELL / 2, vx: (Math.random() - 0.5) * 30, vy: (Math.random() - 0.5) * 30, life: 0.3 + Math.random() * 0.5, hue: c.hue })
      }
    }

    const endRound = () => {
      const g = game.current
      const you = g.you!, cpu = g.cpu!
      sfx.crash()
      let winner: 'you' | 'cpu' | null = null
      if (you.alive && !cpu.alive) winner = 'you'
      else if (cpu.alive && !you.alive) winner = 'cpu'
      setScore((s) => {
        const next = winner ? { ...s, [winner]: s[winner] + 1 } : s
        if (next.you >= WIN_ROUNDS || next.cpu >= WIN_ROUNDS) {
          const won = next.you >= WIN_ROUNDS
          setMessage(won ? 'USER WINS' : 'PROGRAM WINS')
          if (won) {
            setTimeout(sfx.win, 400)
            setStreak((k) => {
              const n = k + 1
              setBest((b) => {
                const nb = Math.max(b, n)
                try {
                  localStorage.setItem(BEST_KEY, String(nb))
                } catch {
                  /* no storage */
                }
                return nb
              })
              return n
            })
          } else setStreak(0)
          setPhaseBoth('matchOver')
        } else {
          setMessage(winner === 'you' ? 'PROGRAM DEREZZED' : winner === 'cpu' ? 'YOU DEREZZED' : 'DOUBLE DEREZZ')
          setPhaseBoth('roundOver')
        }
        return next
      })
    }

    const step = () => {
      const g = game.current
      const you = g.you!, cpu = g.cpu!
      const turn = g.queue.shift()
      if (turn !== undefined && turn !== you.dir) {
        you.dir = turn
        sfx.turn()
      }
      think(cpu, you)
      const moves = [you, cpu].map((c) => ({ c, x: c.x + DX[c.dir], y: c.y + DY[c.dir] }))
      // head-on into the same cell: both go down
      const clash = moves[0].x === moves[1].x && moves[0].y === moves[1].y
      for (const m of moves) {
        if (clash || !free(m.x, m.y)) derezz(m.c)
      }
      for (const m of moves) {
        if (!m.c.alive) continue
        m.c.x = m.x
        m.c.y = m.y
        m.c.trail.push({ x: m.x, y: m.y })
        g.grid[m.y * g.cols + m.x] = m.c === you ? 1 : 2
      }
      g.ticks++
      // speed up slowly: 70 ms → 38 ms per cell
      g.tickMs = Math.max(38, 70 - g.ticks * 0.06)
      if (!you.alive || !cpu.alive) endRound()
    }

    const drawTrail = (c: Cycle) => {
      if (c.trail.length < 1) return
      const path = () => {
        ctx.beginPath()
        c.trail.forEach((p, i) => {
          const px = p.x * CELL + CELL / 2, py = p.y * CELL + CELL / 2
          if (i === 0) ctx.moveTo(px, py)
          else ctx.lineTo(px, py)
        })
      }
      ctx.lineJoin = 'miter'
      ctx.lineCap = 'square'
      path()
      ctx.strokeStyle = `hsl(${c.hue} 100% 55% / 0.22)`
      ctx.lineWidth = CELL * 0.9
      ctx.stroke()
      path()
      ctx.strokeStyle = `hsl(${c.hue} 100% 62% / 0.95)`
      ctx.lineWidth = 2.5
      ctx.stroke()
      if (c.alive) {
        // the bike: a bright head with a glow
        const hx = c.x * CELL + CELL / 2, hy = c.y * CELL + CELL / 2
        const grad = ctx.createRadialGradient(hx, hy, 0, hx, hy, CELL * 2.2)
        grad.addColorStop(0, `hsl(${c.hue} 100% 90% / 0.9)`)
        grad.addColorStop(1, `hsl(${c.hue} 100% 55% / 0)`)
        ctx.fillStyle = grad
        ctx.fillRect(hx - CELL * 2.2, hy - CELL * 2.2, CELL * 4.4, CELL * 4.4)
        ctx.fillStyle = '#fff'
        ctx.fillRect(hx - 3, hy - 3, 6, 6)
      }
    }

    const draw = (dt: number) => {
      const g = game.current
      const w = cv.clientWidth, h = cv.clientHeight
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.fillStyle = '#030708'
      ctx.fillRect(0, 0, w, h)
      // arena grid
      ctx.strokeStyle = 'rgb(13 230 255 / 0.07)'
      ctx.lineWidth = 1
      ctx.beginPath()
      for (let x = 0; x <= g.cols; x += 4) {
        ctx.moveTo(x * CELL + 0.5, 0)
        ctx.lineTo(x * CELL + 0.5, g.rows * CELL)
      }
      for (let y = 0; y <= g.rows; y += 4) {
        ctx.moveTo(0, y * CELL + 0.5)
        ctx.lineTo(g.cols * CELL, y * CELL + 0.5)
      }
      ctx.stroke()
      // arena wall
      ctx.strokeStyle = 'rgb(13 230 255 / 0.6)'
      ctx.lineWidth = 2
      ctx.strokeRect(1, 1, g.cols * CELL - 2, g.rows * CELL - 2)

      ctx.globalCompositeOperation = 'lighter'
      if (g.you) drawTrail(g.you)
      if (g.cpu) drawTrail(g.cpu)
      for (const s of g.sparks) {
        s.x += s.vx * dt
        s.y += s.vy * dt
        s.vx *= 0.96
        s.vy *= 0.96
        s.life -= dt
        ctx.fillStyle = `hsl(${s.hue} 100% 65% / ${Math.max(0, Math.min(1, s.life))})`
        ctx.fillRect(s.x - 1.5, s.y - 1.5, 3, 3)
      }
      g.sparks = g.sparks.filter((s) => s.life > 0)
      ctx.globalCompositeOperation = 'source-over'
    }

    const frame = (now: number) => {
      const g = game.current
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      if (g.phase === 'running') {
        g.acc += dt * 1000
        while (g.acc >= g.tickMs && g.phase === 'running') {
          g.acc -= g.tickMs
          step()
        }
      }
      draw(dt)
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
  }, [])

  // an empty arena behind the title screen
  useEffect(() => {
    const g = game.current
    const cv = canvasRef.current!
    g.cols = Math.floor(cv.clientWidth / CELL)
    g.rows = Math.floor(cv.clientHeight / CELL)
  }, [])

  return (
    <div className="lc-overlay" role="dialog" aria-label="Light cycle game" lang="en">
      <div className="lc-frame">
        <header className="lc-header">
          <span className="lc-title">Light Cycles</span>
          <span className="lc-score">
            <span className="text-cyan">USER {score.you}</span>
            <span className="text-dim"> · </span>
            <span className="text-orange">{score.cpu} PROGRAM</span>
          </span>
          <span className="ml-auto text-[10px] tracking-widest text-dim">
            STREAK {streak} · BEST {best}
          </span>
          <button type="button" className="lc-close" onClick={onClose} aria-label="Close the game">
            <X size={14} />
          </button>
        </header>
        <div className="relative min-h-0 flex-1">
          <canvas ref={canvasRef} className="block size-full" />
          {phase !== 'running' && (
            <div className="lc-center">
              {phase === 'countdown' && <span className="lc-big">{count || 'GO'}</span>}
              {phase === 'ready' && (
                <>
                  <span className="lc-big">THE GRID</span>
                  <span className="lc-hint">first to {WIN_ROUNDS} · arrows / WASD steer · P pause · Esc leave</span>
                  <span className="lc-cta">press SPACE</span>
                </>
              )}
              {phase === 'paused' && (
                <>
                  <span className="lc-big">PAUSED</span>
                  <span className="lc-cta">P or SPACE to resume</span>
                </>
              )}
              {(phase === 'roundOver' || phase === 'matchOver') && (
                <>
                  <span className="lc-big" data-tone={message.startsWith('USER') || message.startsWith('PROGRAM DEREZZED') ? 'win' : 'lose'}>
                    {message}
                  </span>
                  <span className="lc-cta">{phase === 'matchOver' ? 'SPACE for a new match' : 'SPACE for the next round'}</span>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

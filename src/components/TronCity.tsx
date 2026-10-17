import { useEffect, useRef } from 'react'
import cityUrl from '../assets/tron-city.webp'
import { frameLoop } from '../lib/frameClock'
import { useSessions } from '../native/useSessions'

/**
 * The backdrop: the city skyline (a static image that rises out of the horizon on
 * boot) over a perspective grid floor that runs toward the viewer, with a little
 * life on top: flying cars, aircraft beacons, energy pulses climbing the tower,
 * lightning in the clouds and light cycles riding the floor lanes (orange while
 * an agent works).
 *
 * Everything that moves is drawn into ONE canvas on the shared 15 fps clock
 * (lib/frameClock), in the same frames as the other slow loops: each frame of
 * motion re-renders the glass blur of every panel. What doesn't move (the fog,
 * the lanes) is drawn once per resize into a canvas underneath, and each frame
 * strokes the moving lines in a few batched paths, not one call per line.
 */

const HORIZON = 0.46 // horizon height, fraction of the window
const RISE_MS = 2600 // city rise on boot (CSS, .tron-city-img)

// skyline image: 2400×820, its own horizon sits at 97.3% of its height
const IMG_W = 2400
const IMG_H = 820
const IMG_HORIZON = 0.973

// floor camera: y = horizon + K / z, x = cx + F * X / z (K = window below horizon)
const CELL = 0.25 // world units per fine cell; a major line every 4 cells
const CAM_H = 0.68
const Z_NEAR = 1
const Z_FAR = 14
const FLOOR_SPEED = 0.16 // world units per second

// points on the skyline image, as fractions of its size
const TOWER_X = 0.5
const TOWER_BASE = 0.93
const TOWER_TOP = 0.07
const BEACONS: { x: number; y: number; period: number; phase: number }[] = [
  { x: 0.5, y: 0.035, period: 2.4, phase: 0 },
  { x: 0.016, y: 0.48, period: 1.9, phase: 0.7 },
  { x: 0.034, y: 0.57, period: 2.7, phase: 1.3 },
  { x: 0.982, y: 0.34, period: 2.2, phase: 0.4 },
  { x: 0.667, y: 0.775, period: 3.1, phase: 1.9 },
  { x: 0.381, y: 0.84, period: 2.9, phase: 2.4 },
]

const CYAN = '13 230 255'
const ORANGE = '255 140 0'

type Car = { x: number; y: number; vx: number; depth: number; bob: number; tone: string }
type Cycle = { lane: number; z: number; vz: number; tone: string }
type Pulse = { start: number }
type Flash = { start: number; x: number; y: number }

const rand = (a: number, b: number) => a + Math.random() * (b - a)

/** a soft round glow, pre-rendered once so each car/pulse is a cheap drawImage */
function glowSprite(rgb: string) {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')!
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32)
  grad.addColorStop(0, 'rgb(255 255 255 / 1)')
  grad.addColorStop(0.18, `rgb(${rgb} / 0.9)`)
  grad.addColorStop(0.45, `rgb(${rgb} / 0.25)`)
  grad.addColorStop(1, `rgb(${rgb} / 0)`)
  g.fillStyle = grad
  g.fillRect(0, 0, 64, 64)
  return c
}

export function TronCity() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const staticRef = useRef<HTMLCanvasElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)
  const snapshot = useSessions()
  const busyRef = useRef(false)
  busyRef.current = snapshot?.sessions.some((s) => s.activity.state === 'thinking' || s.activity.state === 'tool') ?? false

  useEffect(() => {
    const canvas = canvasRef.current!
    const img = imgRef.current!
    const ctx = canvas.getContext('2d')!
    const base = staticRef.current!
    const bctx = base.getContext('2d')!
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const sprites: Record<string, HTMLCanvasElement> = {
      [CYAN]: glowSprite(CYAN),
      [ORANGE]: glowSprite(ORANGE),
      red: glowSprite('255 46 77'),
    }

    let W = 0
    let H = 0
    let hz = 0
    // where the skyline image sits on screen
    let ix = 0
    let iy = 0
    let iw = 0
    let ih = 0

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5)
      W = window.innerWidth
      H = window.innerHeight
      hz = Math.round(H * HORIZON)
      canvas.width = Math.round(W * dpr)
      canvas.height = Math.round(H * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      base.width = canvas.width
      base.height = canvas.height
      bctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      // cover the band above the horizon; the image's horizon lands on ours
      iw = Math.max(W, (hz / IMG_HORIZON) * (IMG_W / IMG_H))
      ih = iw * (IMG_H / IMG_W)
      ix = (W - iw) / 2
      iy = hz - ih * IMG_HORIZON
      Object.assign(img.style, { left: `${ix}px`, top: `${iy}px`, width: `${iw}px`, height: `${ih}px` })
      img.parentElement!.style.height = `${hz + 2}px`
      drawStatic()
    }

    const px = (fx: number) => ix + fx * iw
    const py = (fy: number) => iy + fy * ih

    const born = performance.now()
    let cars: Car[] = []
    let cycles: Cycle[] = []
    let pulses: Pulse[] = []
    let flashes: Flash[] = []
    let nextCar = born + RISE_MS
    let nextCycle = born + 1200
    let nextPulse = born + RISE_MS + 400
    let nextFlash = born + rand(6000, 14000)

    const spawnCar = (now: number) => {
      const depth = rand(0.25, 1)
      const dir = Math.random() < 0.5 ? 1 : -1
      // nearer cars fly lower in the frame and faster
      const y = rand(0.32, 0.62) + depth * 0.28
      const tone = Math.random() < 0.12 ? ORANGE : CYAN
      const n = Math.random() < 0.25 ? 3 : 1 // sometimes a convoy
      for (let i = 0; i < n; i++) {
        cars.push({
          x: dir > 0 ? -40 - i * 26 * depth : W + 40 + i * 26 * depth,
          y: y + i * 0.004,
          vx: dir * (28 + 95 * depth),
          depth,
          bob: rand(0, Math.PI * 2),
          tone,
        })
      }
      nextCar = now + rand(1800, 5200)
    }

    const spawnCycle = (now: number) => {
      const busy = busyRef.current
      const toward = Math.random() < 0.7
      cycles.push({
        lane: Math.round(rand(-14, 14)) || 1,
        z: toward ? Z_FAR : Z_NEAR * 0.7,
        vz: toward ? -rand(2.2, 3.4) : rand(1.6, 2.4),
        tone: busy && Math.random() < 0.75 ? ORANGE : CYAN,
      })
      nextCycle = now + (busy ? rand(1500, 3500) : rand(5000, 11000))
    }

    /** the floor's still parts: the fog and the lanes running to the vanishing point */
    function drawStatic() {
      const K = H - hz
      const F = K / CAM_H
      const cx = W / 2
      bctx.clearRect(0, 0, W, H)

      // the city's fog spilling over the horizon onto the floor
      const haze = bctx.createLinearGradient(0, hz - 40, 0, hz + K * 0.22)
      haze.addColorStop(0, 'rgb(40 110 125 / 0)')
      haze.addColorStop(0.3, 'rgb(40 110 125 / 0.28)')
      haze.addColorStop(1, 'rgb(40 110 125 / 0)')
      bctx.fillStyle = haze
      bctx.fillRect(0, hz - 40, W, K * 0.22 + 40)

      // vertical lanes, fading toward the horizon
      const fade = bctx.createLinearGradient(0, hz, 0, H)
      fade.addColorStop(0, `rgb(${CYAN} / 0)`)
      fade.addColorStop(0.25, `rgb(${CYAN} / 0.5)`)
      fade.addColorStop(1, `rgb(${CYAN} / 1)`)
      const reach = Math.ceil((W / 2 / F) * Z_FAR * 0.35 / CELL)
      bctx.strokeStyle = fade
      for (let pass = 0; pass < 2; pass++) {
        for (let j = -reach; j <= reach; j++) {
          const major = j % 4 === 0
          const lane = Math.abs(j) === 1 || Math.abs(j) === 2
          bctx.globalAlpha = pass === 0 ? (lane ? 0.14 : major ? 0.08 : 0) : lane ? 0.85 : major ? 0.42 : 0.16
          if (bctx.globalAlpha === 0) continue
          bctx.lineWidth = pass === 0 ? 5 : lane ? 1.6 : major ? 1.3 : 1
          bctx.beginPath()
          bctx.moveTo(cx, hz)
          bctx.lineTo(cx + F * j * CELL, H)
          bctx.stroke()
        }
      }
      bctx.globalAlpha = 1
    }

    // cross-line alpha is quantised into a few levels so each frame strokes
    // a handful of paths instead of one per line
    const LEVELS = 10
    const drawFloor = (t: number) => {
      const K = H - hz
      const F = K / CAM_H
      const cx = W / 2

      // cross lines running toward the viewer
      const phase = (t * FLOOR_SPEED) % (CELL * 4)
      const paths = Array.from({ length: 2 * LEVELS }, () => new Path2D())
      for (let k = 0; ; k++) {
        const z = Z_NEAR + k * CELL - phase
        if (z > Z_FAR) break
        if (z < Z_NEAR * 0.9) continue
        const y = hz + K / z
        const major = Math.round((z + phase) / CELL) % 4 === 0
        const level = Math.min(LEVELS - 1, Math.floor(Math.pow(1 - z / Z_FAR, 1.6) * LEVELS))
        const path = paths[(major ? LEVELS : 0) + level]
        path.moveTo(0, y)
        path.lineTo(W, y)
      }
      ctx.strokeStyle = `rgb(${CYAN})`
      paths.forEach((path, i) => {
        const major = i >= LEVELS
        ctx.globalAlpha = (((i % LEVELS) + 0.5) / LEVELS) * (major ? 0.5 : 0.18)
        ctx.lineWidth = major ? 1.4 : 1
        ctx.stroke(path)
      })
      ctx.globalAlpha = 1

      // light cycles: a bright head and a fading ribbon along a lane
      for (const c of cycles) {
        const X = c.lane * CELL
        const head = { x: cx + (F * X) / c.z, y: hz + K / c.z }
        const tz = c.z - Math.sign(c.vz) * 1.6
        const tail = { x: cx + (F * X) / Math.max(tz, 0.3), y: hz + K / Math.max(tz, 0.3) }
        const grad = ctx.createLinearGradient(tail.x, tail.y, head.x, head.y)
        grad.addColorStop(0, `rgb(${c.tone} / 0)`)
        grad.addColorStop(1, `rgb(${c.tone} / 0.95)`)
        const near = 1 - c.z / Z_FAR
        ctx.strokeStyle = grad
        ctx.lineWidth = 1 + near * 4
        ctx.beginPath()
        ctx.moveTo(tail.x, tail.y)
        ctx.lineTo(head.x, head.y)
        ctx.stroke()
        const s = 6 + near * 26
        ctx.drawImage(sprites[c.tone], head.x - s / 2, head.y - s / 2, s, s)
      }
    }

    const drawCity = (t: number, now: number) => {
      ctx.globalCompositeOperation = 'lighter'

      // lightning: a double flicker lighting a patch of cloud
      for (const f of flashes) {
        const e = (now - f.start) / 600
        const i = Math.max(0, Math.sin(e * Math.PI * 3)) * (1 - e)
        const r = iw * 0.22
        const g = ctx.createRadialGradient(px(f.x), py(f.y), 0, px(f.x), py(f.y), r)
        g.addColorStop(0, `rgb(170 245 255 / ${0.22 * i})`)
        g.addColorStop(1, 'rgb(170 245 255 / 0)')
        ctx.fillStyle = g
        ctx.fillRect(px(f.x) - r, py(f.y) - r, r * 2, r * 2)
      }

      // energy climbing the tower's spine; the spire flares when it arrives
      const tx = px(TOWER_X)
      for (const p of pulses) {
        const e = (now - p.start) / 2600
        if (e < 1) {
          const k = e * e * (3 - 2 * e)
          const y = py(TOWER_BASE + (TOWER_TOP - TOWER_BASE) * k)
          const s = iw * 0.012
          ctx.globalAlpha = 0.9
          ctx.drawImage(sprites[CYAN], tx - s / 2, y - s / 2, s, s)
          ctx.globalAlpha = 0.35
          ctx.drawImage(sprites[CYAN], tx - s * 1.5, y - s * 1.5, s * 3, s * 3)
        } else {
          const f = 1 - (e - 1) / 0.25
          const s = iw * 0.05 * f
          ctx.globalAlpha = 0.6 * f
          ctx.drawImage(sprites[CYAN], tx - s / 2, py(TOWER_TOP) - s / 2, s, s)
        }
      }

      // aircraft beacons
      for (const b of BEACONS) {
        if ((t + b.phase) % b.period > 0.22) continue
        const s = iw * 0.009
        ctx.globalAlpha = 0.9
        ctx.drawImage(sprites.red, px(b.x) - s / 2, py(b.y) - s / 2, s, s)
      }

      // flying cars: a short light trail behind a hot head
      for (const c of cars) {
        const x = c.x
        const y = py(c.y) + Math.sin(t * 1.3 + c.bob) * 1.5
        const len = 14 + 46 * c.depth
        const dir = Math.sign(c.vx)
        const grad = ctx.createLinearGradient(x - dir * len, y, x, y)
        grad.addColorStop(0, `rgb(${c.tone} / 0)`)
        grad.addColorStop(1, `rgb(${c.tone} / ${0.4 + 0.5 * c.depth})`)
        ctx.globalAlpha = 1
        ctx.strokeStyle = grad
        ctx.lineWidth = 0.8 + 1.6 * c.depth
        ctx.beginPath()
        ctx.moveTo(x - dir * len, y)
        ctx.lineTo(x, y)
        ctx.stroke()
        const s = 6 + 14 * c.depth
        ctx.globalAlpha = 0.5 + 0.5 * c.depth
        ctx.drawImage(sprites[c.tone], x - s / 2, y - s / 2, s, s)
      }

      ctx.globalAlpha = 1
      ctx.globalCompositeOperation = 'source-over'
    }

    let prev = born
    const loop = frameLoop((now) => frame(now))
    const frame = (now: number) => {
      loop.slow()
      const dt = Math.min((now - prev) / 1000, 0.25) // a hidden window comes back without a jump
      prev = now
      const t = (now - born) / 1000

      if (now >= nextCar) spawnCar(now)
      if (now >= nextCycle) spawnCycle(now)
      if (now >= nextPulse) {
        pulses.push({ start: now })
        nextPulse = now + rand(5000, 9000)
      }
      if (now >= nextFlash) {
        flashes.push({ start: now, x: rand(0.1, 0.9), y: rand(0.08, 0.4) })
        nextFlash = now + rand(12000, 32000)
      }
      for (const c of cars) c.x += c.vx * dt
      for (const c of cycles) c.z += c.vz * dt
      cars = cars.filter((c) => c.x > -120 && c.x < W + 120)
      cycles = cycles.filter((c) => c.z > 0.55 && c.z <= Z_FAR + 0.01)
      pulses = pulses.filter((p) => now - p.start < 2600 * 1.25)
      flashes = flashes.filter((f) => now - f.start < 600)

      ctx.clearRect(0, 0, W, H)
      drawFloor(t)
      if (now - born > RISE_MS) drawCity(t, now)
    }

    resize()
    window.addEventListener('resize', resize)
    if (still) {
      drawFloor(0)
    } else {
      loop.slow()
    }
    return () => {
      loop.stop()
      window.removeEventListener('resize', resize)
    }
  }, [])

  return (
    <div className="grid-floor" aria-hidden>
      <div className="tron-city">
        <img ref={imgRef} className="tron-city-img" src={cityUrl} alt="" draggable={false} />
      </div>
      <canvas ref={staticRef} className="tron-canvas" />
      <canvas ref={canvasRef} className="tron-canvas" />
    </div>
  )
}

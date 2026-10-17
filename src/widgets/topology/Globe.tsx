import { useEffect, useRef } from 'react'
import { sfx } from '../../lib/sfx'
import { useOfficeStore } from '../../store/useOfficeStore'
import type { DataEdgeType, TronNodeType } from './graph'
import { greatArc, lattice, layoutSphere, type Vec3 } from './sphereLayout'

// The globe: nodes sit on a sphere, links run as great-circle arcs over its
// surface, and a faint lattice gives the sphere its shape even with few nodes.
// One canvas; auto-rotation is capped at 15 fps (like the floor) and runs at
// full rate only while dragging or turning to a node, since anything that
// animates makes the blurred glass panels around it repaint.

export const ORANGE = '#ff8c00'
const INK = '#b8d6dc'
const DIM = '#5b7a82'

const LATTICE = lattice(260)
const CAMERA = 3.2 // camera distance in sphere radii
const AUTO_SPEED = 0.07 // rad/s
const IDLE_FRAME_MS = 1000 / 15
const PITCH_LIMIT = 1.5

export interface Look {
  r: number
  color: string
  /** label shown without hovering */
  label: boolean
  ring?: string
  title: string
  sub: string
}

export interface LookContext {
  activeAgent: string
  selectedFile: string
  replying: boolean
}

export interface GlobeProps {
  nodes: TronNodeType[]
  edges: DataEdgeType[]
  look: (node: TronNodeType, ctx: LookContext) => Look
  /** node to turn to the front and light up with its neighbours (others dim) */
  focus: string | null
  spin: boolean
  /** bumped to reset zoom and tilt */
  resetKey: number
  /** a click on a node, or on empty space (null) */
  onPick: (node: TronNodeType | null) => void
}

/** Soft round glow, drawn once per colour and stamped with drawImage (cheaper than shadowBlur). */
const sprites = new Map<string, HTMLCanvasElement>()
function glow(color: string) {
  let c = sprites.get(color)
  if (c) return c
  c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')!
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32)
  grad.addColorStop(0, `${color}66`)
  grad.addColorStop(0.25, `${color}1f`)
  grad.addColorStop(1, `${color}00`)
  g.fillStyle = grad
  g.fillRect(0, 0, 64, 64)
  sprites.set(color, c)
  return c
}

/** Yaw/pitch that bring unit point p to the front of the globe. */
function facing(p: Vec3) {
  const yaw = Math.atan2(-p[0], p[2])
  const z1 = Math.hypot(p[0], p[2])
  return { yaw, pitch: Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, Math.atan2(p[1], z1))) }
}

export function Globe({ nodes, edges, look, focus, spin, resetKey, onPick }: GlobeProps) {
  const canvas = useRef<HTMLCanvasElement>(null)
  // everything the draw loop reads lives in refs, so React never re-renders per frame
  const pos = useRef(new Map<string, Vec3>())
  // arc points per edge on the unit sphere; only change when the layout does
  const arcs = useRef(new Map<string, Vec3[]>())
  const view = useRef({ yaw: 0.6, pitch: -0.35, zoom: 1, vYaw: 0, vPitch: 0, target: null as null | { yaw: number; pitch: number } })
  const ui = useRef({ hover: null as TronNodeType | null, dragging: false, moved: 0, dirty: true })
  // starts empty so the first effect run lays the graph out
  const props = useRef({ nodes: [] as TronNodeType[], edges: [] as DataEdgeType[], look, focus, spin, onPick })

  useEffect(() => {
    if (props.current.nodes !== nodes || props.current.edges !== edges) {
      pos.current = layoutSphere(nodes, edges, pos.current)
      arcs.current.clear()
    }
    props.current = { nodes, edges, look, focus, spin, onPick }
    ui.current.dirty = true
  }, [nodes, edges, look, focus, spin, onPick])

  // turn the focused node to the front
  useEffect(() => {
    const p = focus ? pos.current.get(focus) : null
    if (!p) return
    const v = view.current
    const t = facing(p)
    // shortest way round
    const turn = ((((t.yaw - v.yaw) % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI)) - Math.PI
    v.target = { yaw: v.yaw + turn, pitch: t.pitch }
    v.vYaw = v.vPitch = 0
  }, [focus, nodes])

  useEffect(() => {
    if (!resetKey) return
    Object.assign(view.current, { zoom: 1, pitch: -0.35, vYaw: 0, vPitch: 0, target: null })
    ui.current.dirty = true
  }, [resetKey])

  // redraw when the selection or chat state changes while the globe is still
  useEffect(
    () =>
      useOfficeStore.subscribe((s, p) => {
        if (s.activeAgent !== p.activeAgent || s.selectedFile !== p.selectedFile || s.chat !== p.chat) ui.current.dirty = true
      }),
    [],
  )

  useEffect(() => {
    const el = canvas.current
    if (!el) return
    const ctx = el.getContext('2d')!
    let w = 0
    let h = 0
    let dpr = 1
    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2)
      w = el.clientWidth
      h = el.clientHeight
      el.width = Math.round(w * dpr)
      el.height = Math.round(h * dpr)
      ui.current.dirty = true
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(el)

    // projected node positions from the last frame, for hit testing
    let projected: Array<{ node: TronNodeType; x: number; y: number; z: number; r: number; s: number }> = []

    const radius = () => Math.min(w, h) * 0.4 * view.current.zoom
    const project = (p: Vec3, cy: number, sy: number, cp: number, sp: number) => {
      const x1 = p[0] * cy + p[2] * sy
      const z1 = -p[0] * sy + p[2] * cy
      const y2 = p[1] * cp - z1 * sp
      const z2 = p[1] * sp + z1 * cp
      const s = CAMERA / (CAMERA - z2)
      const R = radius()
      return { x: w / 2 + x1 * s * R, y: h / 2 + y2 * s * R, z: z2, s }
    }

    const draw = (now: number) => {
      const v = view.current
      const { nodes, edges, look, focus } = props.current
      const { activeAgent, selectedFile, chat } = useOfficeStore.getState()
      const lookCtx = { activeAgent, selectedFile, replying: chat.some((m) => m.streaming) }
      const cy = Math.cos(v.yaw)
      const sy = Math.sin(v.yaw)
      const cp = Math.cos(v.pitch)
      const sp = Math.sin(v.pitch)
      const P = (p: Vec3) => project(p, cy, sy, cp, sp)
      const R = radius()

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)

      // atmosphere + silhouette ring
      const rim = (R * CAMERA) / Math.sqrt(CAMERA * CAMERA - 1)
      const atm = ctx.createRadialGradient(w / 2, h / 2, rim * 0.2, w / 2, h / 2, rim * 1.18)
      atm.addColorStop(0, 'rgb(13 230 255 / 0.05)')
      atm.addColorStop(0.82, 'rgb(13 230 255 / 0.07)')
      atm.addColorStop(1, 'rgb(13 230 255 / 0)')
      ctx.fillStyle = atm
      ctx.beginPath()
      ctx.arc(w / 2, h / 2, rim * 1.18, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = 'rgb(13 230 255 / 0.22)'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.arc(w / 2, h / 2, rim, 0, Math.PI * 2)
      ctx.stroke()

      // lattice: three depth buckets so the back half reads fainter
      const lp = LATTICE.pts.map(P)
      const buckets: Array<[number, number][]> = [[], [], []]
      for (const [a, b] of LATTICE.lines) {
        const z = (lp[a].z + lp[b].z) / 2
        buckets[z < -0.3 ? 0 : z < 0.3 ? 1 : 2].push([a, b])
      }
      const alpha = focus ? [0.02, 0.04, 0.07] : [0.03, 0.065, 0.13]
      buckets.forEach((lines, i) => {
        ctx.strokeStyle = `rgb(13 230 255 / ${alpha[i]})`
        ctx.beginPath()
        for (const [a, b] of lines) {
          ctx.moveTo(lp[a].x, lp[a].y)
          ctx.lineTo(lp[b].x, lp[b].y)
        }
        ctx.stroke()
      })
      for (const p of lp) {
        ctx.fillStyle = `rgb(13 230 255 / ${p.z < 0 ? 0.12 : 0.18 + p.z * 0.3})`
        const s = 1.1 * p.s
        ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s)
      }

      // hovered or focused node: it and its neighbours stay lit
      const hover = ui.current.hover
      const near = (id: string | null | undefined) => {
        const set = new Set<string>()
        if (!id) return set
        set.add(id)
        for (const e of edges) {
          if (e.source === id) set.add(e.target)
          if (e.target === id) set.add(e.source)
        }
        return set
      }
      const lit = near(hover?.id)
      const focused = near(focus)

      // links as arcs over the surface, batched into one path per style: a big
      // code graph has 1000+ links and one stroke() each was the main frame cost
      const flowing: Array<ReturnType<typeof P>[]> = []
      const batches = new Map<string, { width: number; lines: ReturnType<typeof P>[][] }>()
      const add = (style: string, width: number, pts: ReturnType<typeof P>[]) => {
        const key = `${style}|${width}`
        const b = batches.get(key) ?? batches.set(key, { width, lines: [] }).get(key)!
        b.lines.push(pts)
      }
      // front-side alpha in 4 steps, so similar links share a batch
      const q = (z: number) => Math.ceil(Math.max(0, z) * 4) / 4
      for (const e of edges) {
        let arc = arcs.current.get(e.id)
        if (!arc) {
          const a = pos.current.get(e.source)
          const b = pos.current.get(e.target)
          if (!a || !b) continue
          // fewer segments for short links
          const angle = Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])))
          arc = greatArc(a, b, Math.max(2, Math.min(14, Math.ceil(angle * 12))))
          arcs.current.set(e.id, arc)
        }
        const hot = !!hover && (e.source === hover.id || e.target === hover.id)
        const inFocus = !!focus && (e.source === focus || e.target === focus)
        const muted = !!focus && !inFocus && !hot
        const pts = arc.map(P)
        const z = pts[pts.length >> 1].z
        const live = !!e.data?.flowing
        const style = live
          ? `rgb(255 140 0 / ${muted ? 0.15 : z < 0 ? 0.3 : 0.75})`
          : hot || inFocus
            ? `rgb(13 230 255 / ${z < 0 ? 0.45 : 0.95})`
            : `rgb(13 230 255 / ${muted ? 0.035 : z < 0 ? 0.1 : 0.22 + q(z) * 0.3})`
        add(style, hot || inFocus || live ? 1.4 : 1, pts)
        if (live) flowing.push(pts)
      }
      for (const [key, { width, lines }] of batches) {
        ctx.strokeStyle = key.slice(0, key.lastIndexOf('|'))
        ctx.lineWidth = width
        ctx.beginPath()
        for (const pts of lines) pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)))
        ctx.stroke()
      }
      // data packets riding the live links
      flowing.forEach((pts, i) => {
        const t = ((now / 1400 + i * 0.37) % 1) * (pts.length - 1)
        const k = Math.floor(t)
        const f = t - k
        const p = pts[k]
        const q = pts[Math.min(k + 1, pts.length - 1)]
        ctx.drawImage(glow(ORANGE), p.x + (q.x - p.x) * f - 6, p.y + (q.y - p.y) * f - 6, 12, 12)
      })

      // nodes, back to front
      projected = nodes
        .map((node) => {
          const p = pos.current.get(node.id)
          if (!p) return null
          const q = P(p)
          return { node, x: q.x, y: q.y, z: q.z, r: 0, s: q.s }
        })
        .filter((o): o is NonNullable<typeof o> => !!o)
        .sort((a, b) => a.z - b.z)
      const labels: Array<{ x: number; y: number; r: number; l: Look; strong: boolean }> = []
      for (const o of projected) {
        const l = look(o.node, lookCtx)
        const back = o.z < 0
        const isHover = o.node === hover
        const isFocus = o.node.id === focus
        const muted = !!focus && !focused.has(o.node.id) && !lit.has(o.node.id)
        const r = l.r * o.s * (isHover || isFocus ? 1.35 : 1)
        o.r = r
        ctx.globalAlpha = muted ? 0.15 : back ? 0.35 : 1
        ctx.drawImage(glow(l.color), o.x - r * 2, o.y - r * 2, r * 4, r * 4)
        ctx.fillStyle = l.color
        ctx.beginPath()
        ctx.arc(o.x, o.y, r * 0.55, 0, Math.PI * 2)
        ctx.fill()
        const ring = isHover || isFocus ? l.color : l.ring
        if (ring) {
          ctx.strokeStyle = ring
          ctx.lineWidth = 1.2
          ctx.beginPath()
          ctx.arc(o.x, o.y, r + 3, 0, Math.PI * 2)
          ctx.stroke()
        }
        ctx.globalAlpha = 1
        const show = isHover || isFocus || (!back && (lit.has(o.node.id) || (focus ? focused.has(o.node.id) : l.label && !muted)))
        if (show || (!focus && l.label && o.z > -0.15)) labels.push({ x: o.x, y: o.y, r, l, strong: isHover || isFocus })
      }

      ctx.textBaseline = 'middle'
      const font = (bold: boolean, px: number) => `${bold ? 'bold ' : ''}${px}px "JetBrains Mono", monospace`
      for (const { x, y, r, l, strong } of labels) {
        ctx.font = font(strong, 11)
        const tw = ctx.measureText(l.title).width
        let sw = 0
        if (strong && l.sub) {
          ctx.font = font(false, 10)
          sw = ctx.measureText(l.sub).width
        }
        const bw = Math.min(Math.max(tw, sw) + 10, w - 8)
        const bh = strong && l.sub ? 30 : 16
        // keep labels inside the panel
        const bx = Math.min(Math.max(x + r + 6, 4), w - bw - 4)
        const by = Math.min(Math.max(y - bh / 2, 4), h - bh - 4)
        ctx.fillStyle = 'rgb(4 9 12 / 0.85)'
        ctx.fillRect(bx, by, bw, bh)
        ctx.strokeStyle = strong ? l.color : 'rgb(13 230 255 / 0.25)'
        ctx.lineWidth = 1
        ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1)
        ctx.font = font(strong, 11)
        ctx.fillStyle = strong ? l.color : INK
        ctx.fillText(l.title, bx + 5, by + (strong && l.sub ? 9 : bh / 2), bw - 10)
        if (strong && l.sub) {
          ctx.font = font(false, 10)
          ctx.fillStyle = DIM
          ctx.fillText(l.sub, bx + 5, by + 21, bw - 10)
        }
      }
    }

    let raf = 0
    let last = 0
    let lastDraw = 0
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick)
      const dt = Math.min(0.05, (now - (last || now)) / 1000)
      last = now
      const v = view.current
      const u = ui.current
      const { spin, edges, focus } = props.current
      let turning = false
      if (v.target && !u.dragging) {
        const dy = v.target.yaw - v.yaw
        const dp = v.target.pitch - v.pitch
        v.yaw += dy * 0.14
        v.pitch += dp * 0.14
        if (Math.abs(dy) < 0.002 && Math.abs(dp) < 0.002) v.target = null
        turning = true
      }
      const coasting = Math.abs(v.vYaw) > 1e-4 || Math.abs(v.vPitch) > 1e-4
      if (!u.dragging && coasting) {
        v.yaw += v.vYaw
        v.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, v.pitch + v.vPitch))
        v.vYaw *= 0.92
        v.vPitch *= 0.92
      }
      // a focused node stays in front, so no auto-spin then
      const spinning = spin && !focus && !u.hover && !u.dragging && !turning
      if (spinning) v.yaw += AUTO_SPEED * dt
      const hasPackets = edges.some((e) => e.data?.flowing)
      const fast = u.dragging || coasting || turning
      if (!fast && !u.dirty && !spinning && !hasPackets) return
      if (!fast && now - lastDraw < IDLE_FRAME_MS) return
      lastDraw = now
      u.dirty = false
      draw(now)
    }
    raf = requestAnimationFrame(tick)

    // ── pointer: drag rotates (with inertia), wheel zooms, click picks a node
    const hit = (x: number, y: number) => {
      let best: TronNodeType | null = null
      let bestD = Infinity
      for (const o of projected) {
        if (o.z < -0.2) continue
        const d = Math.hypot(o.x - x, o.y - y)
        if (d < Math.max(o.r + 5, 9) && d < bestD) {
          best = o.node
          bestD = d
        }
      }
      return best
    }
    const local = (e: PointerEvent | WheelEvent) => {
      const b = el.getBoundingClientRect()
      return { x: e.clientX - b.left, y: e.clientY - b.top }
    }
    let lx = 0
    let ly = 0
    const down = (e: PointerEvent) => {
      if (e.button !== 0) return
      el.setPointerCapture(e.pointerId)
      ui.current.dragging = true
      ui.current.moved = 0
      lx = e.clientX
      ly = e.clientY
      Object.assign(view.current, { vYaw: 0, vPitch: 0, target: null })
    }
    const move = (e: PointerEvent) => {
      const u = ui.current
      if (u.dragging) {
        const dx = e.clientX - lx
        const dy = e.clientY - ly
        lx = e.clientX
        ly = e.clientY
        u.moved += Math.abs(dx) + Math.abs(dy)
        const k = 0.006 / view.current.zoom
        view.current.yaw += dx * k
        view.current.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, view.current.pitch - dy * k))
        view.current.vYaw = dx * k
        view.current.vPitch = -dy * k
        if (u.moved > 4) u.hover = null
        return
      }
      const { x, y } = local(e)
      const h = hit(x, y)
      if (h !== u.hover) {
        if (h) sfx.emit('hover', { source: 'topology.globe', node: h.id })
        u.hover = h
        u.dirty = true
        el.style.cursor = h ? 'pointer' : 'grab'
      }
    }
    const up = (e: PointerEvent) => {
      const u = ui.current
      if (!u.dragging) return
      u.dragging = false
      if (u.moved < 4) {
        view.current.vYaw = view.current.vPitch = 0
        const { x, y } = local(e)
        props.current.onPick(hit(x, y))
      }
    }
    const leave = () => {
      if (ui.current.dragging) return
      ui.current.hover = null
      ui.current.dirty = true
    }
    const wheel = (e: WheelEvent) => {
      e.preventDefault()
      view.current.zoom = Math.max(0.5, Math.min(3, view.current.zoom * Math.exp(-e.deltaY * 0.0015)))
      ui.current.dirty = true
    }
    el.addEventListener('pointerdown', down)
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
    el.addEventListener('pointerleave', leave)
    el.addEventListener('wheel', wheel, { passive: false })
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      el.removeEventListener('pointerdown', down)
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
      el.removeEventListener('pointerleave', leave)
      el.removeEventListener('wheel', wheel)
    }
  }, [])

  // no-drag: pointer drags rotate the globe instead of moving the grid panel
  return <canvas ref={canvas} className="no-drag absolute inset-0 size-full cursor-grab touch-none" aria-label="Topology globe" />
}

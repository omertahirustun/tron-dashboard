import { useEffect, useRef } from 'react'
import { sfx } from '../../lib/sfx'
import { useOfficeStore } from '../../store/useOfficeStore'
import { ORANGE, type GlobeProps, type Look } from './Globe'
import type { TronNodeType } from './graph'

// The flat view of a graph: graphify-style dots on a 2D force layout over a
// dotted floor. Same props as the globe so GlobeView can swap them. Drag pans,
// the wheel zooms at the cursor, a click picks a node. Draws only when
// something changed (or while live links carry packets, at 15 fps).

const INK = '#b8d6dc'
const DIM = '#5b7a82'
const IDLE_FRAME_MS = 1000 / 15

type P2 = [number, number]

function hash(s: string) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

/**
 * Fruchterman–Reingold in 2D. Known nodes start where they were and new ones
 * next to a placed neighbour, so live updates only nudge the picture.
 */
function layoutFlat(nodes: TronNodeType[], edges: Array<{ source: string; target: string }>, prev: Map<string, P2>) {
  const n = nodes.length
  const out = new Map<string, P2>()
  if (!n) return out
  const index = new Map(nodes.map((nd, i) => [nd.id, i]))
  const links: Array<[number, number]> = []
  for (const e of edges) {
    const a = index.get(e.source)
    const b = index.get(e.target)
    if (a !== undefined && b !== undefined && a !== b) links.push([a, b])
  }
  const neighbours = nodes.map(() => [] as number[])
  for (const [a, b] of links) {
    neighbours[a].push(b)
    neighbours[b].push(a)
  }
  const side = Math.sqrt(n) * 40
  const pos: P2[] = nodes.map((nd) => prev.get(nd.id) ?? (null as unknown as P2))
  const known = pos.filter(Boolean).length
  for (let pass = 0; pass < 3; pass++)
    nodes.forEach((nd, i) => {
      if (pos[i]) return
      const h = hash(nd.id)
      const near = neighbours[i].find((j) => pos[j])
      if (near !== undefined || pass === 2) {
        const base = near !== undefined ? pos[near] : [0, 0]
        const spread = near !== undefined ? 30 : side
        pos[i] = [base[0] + ((h & 0xffff) / 0xffff - 0.5) * spread, base[1] + ((h >>> 16) / 0xffff - 0.5) * spread]
      }
    })

  const k = 34 // ideal link length
  const k2 = k * k
  const iterations = known === n ? 30 : known ? 120 : 320
  let temp = known ? k : side / 4
  const disp = new Float64Array(n * 2)
  for (let it = 0; it < iterations; it++) {
    disp.fill(0)
    for (let i = 0; i < n; i++) {
      const [xi, yi] = pos[i]
      for (let j = i + 1; j < n; j++) {
        let dx = xi - pos[j][0]
        let dy = yi - pos[j][1]
        let d2 = dx * dx + dy * dy
        if (d2 < 0.01) {
          dx = Math.random() - 0.5
          dy = Math.random() - 0.5
          d2 = 0.5
        }
        if (d2 > k2 * 36) continue // far apart: no meaningful push
        const f = k2 / d2
        disp[i * 2] += dx * f
        disp[i * 2 + 1] += dy * f
        disp[j * 2] -= dx * f
        disp[j * 2 + 1] -= dy * f
      }
    }
    for (const [a, b] of links) {
      const dx = pos[a][0] - pos[b][0]
      const dy = pos[a][1] - pos[b][1]
      const d = Math.hypot(dx, dy) || 0.01
      const f = d / k
      disp[a * 2] -= dx * f
      disp[a * 2 + 1] -= dy * f
      disp[b * 2] += dx * f
      disp[b * 2 + 1] += dy * f
    }
    for (let i = 0; i < n; i++) {
      // weak gravity keeps loose components from drifting off
      disp[i * 2] -= pos[i][0] * 0.02
      disp[i * 2 + 1] -= pos[i][1] * 0.02
      const dx = disp[i * 2]
      const dy = disp[i * 2 + 1]
      const d = Math.hypot(dx, dy) || 1
      const step = Math.min(d, temp)
      pos[i] = [pos[i][0] + (dx / d) * step, pos[i][1] + (dy / d) * step]
    }
    temp = Math.max(0.5, temp * 0.97)
  }
  nodes.forEach((nd, i) => out.set(nd.id, pos[i]))
  return out
}

/** Soft round glow, drawn once per colour. */
const sprites = new Map<string, HTMLCanvasElement>()
function glow(color: string) {
  let c = sprites.get(color)
  if (c) return c
  c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')!
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32)
  grad.addColorStop(0, `${color}66`)
  grad.addColorStop(0.25, `${color}1a`)
  grad.addColorStop(1, `${color}00`)
  g.fillStyle = grad
  g.fillRect(0, 0, 64, 64)
  sprites.set(color, c)
  return c
}

export function FlatGraph({ nodes, edges, look, focus, resetKey, onPick }: GlobeProps) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const pos = useRef(new Map<string, P2>())
  // camera: world point at the centre of the canvas, and pixels per world unit
  const cam = useRef({ x: 0, y: 0, scale: 1, target: null as null | { x: number; y: number; scale: number }, fitted: false })
  const ui = useRef({ hover: null as TronNodeType | null, dragging: false, moved: 0, dirty: true, fitRequest: true })
  const props = useRef({ nodes: [] as TronNodeType[], edges: [] as GlobeProps['edges'], look, focus, onPick })

  useEffect(() => {
    if (props.current.nodes !== nodes || props.current.edges !== edges) {
      const firstLayout = pos.current.size === 0
      pos.current = layoutFlat(nodes, edges, pos.current)
      if (firstLayout) ui.current.fitRequest = true
    }
    props.current = { nodes, edges, look, focus, onPick }
    ui.current.dirty = true
  }, [nodes, edges, look, focus, onPick])

  // glide to the focused node
  useEffect(() => {
    const p = focus ? pos.current.get(focus) : null
    if (!p) return
    const c = cam.current
    c.target = { x: p[0], y: p[1], scale: Math.max(c.scale, 1.4) }
  }, [focus, nodes])

  useEffect(() => {
    if (!resetKey) return
    ui.current.fitRequest = true
    ui.current.dirty = true
  }, [resetKey])

  useEffect(
    () =>
      useOfficeStore.subscribe((s, p) => {
        if (s.selectedFile !== p.selectedFile) ui.current.dirty = true
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

    const fit = () => {
      const pts = [...pos.current.values()]
      if (!pts.length || !w || !h) return false
      let x0 = Infinity
      let y0 = Infinity
      let x1 = -Infinity
      let y1 = -Infinity
      for (const [x, y] of pts) {
        x0 = Math.min(x0, x)
        y0 = Math.min(y0, y)
        x1 = Math.max(x1, x)
        y1 = Math.max(y1, y)
      }
      const scale = Math.min((w - 60) / Math.max(1, x1 - x0), (h - 60) / Math.max(1, y1 - y0), 3)
      cam.current.target = { x: (x0 + x1) / 2, y: (y0 + y1) / 2, scale }
      if (!cam.current.fitted) {
        Object.assign(cam.current, cam.current.target, { target: null, fitted: true })
      }
      return true
    }

    let projected: Array<{ node: TronNodeType; x: number; y: number; r: number }> = []
    const toScreen = (p: P2) => {
      const c = cam.current
      return { x: w / 2 + (p[0] - c.x) * c.scale, y: h / 2 + (p[1] - c.y) * c.scale }
    }

    const draw = (now: number) => {
      const c = cam.current
      const { nodes, edges, look, focus } = props.current
      const { activeAgent, selectedFile, chat } = useOfficeStore.getState()
      const lookCtx = { activeAgent, selectedFile, replying: chat.some((m) => m.streaming) }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)

      // dotted floor that moves with the camera
      const step = 22 * Math.max(0.5, Math.min(2, c.scale))
      const ox = (((w / 2 - c.x * c.scale) % step) + step) % step
      const oy = (((h / 2 - c.y * c.scale) % step) + step) % step
      ctx.fillStyle = 'rgb(13 230 255 / 0.13)'
      for (let x = ox; x < w; x += step) for (let y = oy; y < h; y += step) ctx.fillRect(x - 0.6, y - 0.6, 1.2, 1.2)

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

      // links, batched by style
      const batches = new Map<string, Array<[number, number, number, number]>>()
      const flowing: Array<[number, number, number, number]> = []
      for (const e of edges) {
        const a = pos.current.get(e.source)
        const b = pos.current.get(e.target)
        if (!a || !b) continue
        const p = toScreen(a)
        const q = toScreen(b)
        const hot = !!hover && (e.source === hover.id || e.target === hover.id)
        const inFocus = !!focus && (e.source === focus || e.target === focus)
        const muted = !!focus && !inFocus && !hot
        const live = !!e.data?.flowing
        const style = live ? `rgb(255 140 0 / ${muted ? 0.15 : 0.7})` : hot || inFocus ? 'rgb(13 230 255 / 0.9)' : `rgb(13 230 255 / ${muted ? 0.04 : 0.16})`
        const list = batches.get(style) ?? batches.set(style, []).get(style)!
        list.push([p.x, p.y, q.x, q.y])
        if (live) flowing.push([p.x, p.y, q.x, q.y])
      }
      ctx.lineWidth = 1
      for (const [style, lines] of batches) {
        ctx.strokeStyle = style
        ctx.beginPath()
        for (const [x1, y1, x2, y2] of lines) {
          ctx.moveTo(x1, y1)
          ctx.lineTo(x2, y2)
        }
        ctx.stroke()
      }
      flowing.forEach(([x1, y1, x2, y2], i) => {
        const t = (now / 1400 + i * 0.37) % 1
        ctx.drawImage(glow(ORANGE), x1 + (x2 - x1) * t - 6, y1 + (y2 - y1) * t - 6, 12, 12)
      })

      // nodes
      projected = []
      const labels: Array<{ x: number; y: number; r: number; l: Look; strong: boolean }> = []
      const zoomR = Math.max(0.7, Math.min(1.8, Math.sqrt(c.scale)))
      for (const node of nodes) {
        const p = pos.current.get(node.id)
        if (!p) continue
        const s = toScreen(p)
        const l = look(node, lookCtx)
        const isHover = node === hover
        const isFocus = node.id === focus
        const r = l.r * zoomR * (isHover || isFocus ? 1.35 : 1)
        projected.push({ node, x: s.x, y: s.y, r })
        if (s.x < -20 || s.y < -20 || s.x > w + 20 || s.y > h + 20) continue
        const muted = !!focus && !focused.has(node.id) && !lit.has(node.id)
        ctx.globalAlpha = muted ? 0.15 : 1
        ctx.drawImage(glow(l.color), s.x - r * 1.8, s.y - r * 1.8, r * 3.6, r * 3.6)
        ctx.fillStyle = l.color
        ctx.beginPath()
        ctx.arc(s.x, s.y, r * 0.6, 0, Math.PI * 2)
        ctx.fill()
        const ring = isHover || isFocus ? l.color : l.ring
        if (ring) {
          ctx.strokeStyle = ring
          ctx.lineWidth = 1.2
          ctx.beginPath()
          ctx.arc(s.x, s.y, r + 3, 0, Math.PI * 2)
          ctx.stroke()
        }
        ctx.globalAlpha = 1
        const show = isHover || isFocus || lit.has(node.id) || (focus ? focused.has(node.id) : l.label || c.scale > 2.2)
        if (show) labels.push({ x: s.x, y: s.y, r, l, strong: isHover || isFocus })
      }

      ctx.textBaseline = 'middle'
      const font = (bold: boolean, px: number) => `${bold ? 'bold ' : ''}${px}px "JetBrains Mono", monospace`
      for (const { x, y, r, l, strong } of labels) {
        if (!strong) {
          // plain labels: text only, like graphify's own view
          ctx.font = font(false, 10)
          ctx.fillStyle = 'rgb(4 9 12 / 0.7)'
          const tw = ctx.measureText(l.title).width
          ctx.fillRect(x + r + 3, y - 7, tw + 4, 14)
          ctx.fillStyle = INK
          ctx.fillText(l.title, x + r + 5, y)
          continue
        }
        ctx.font = font(true, 11)
        const tw = ctx.measureText(l.title).width
        ctx.font = font(false, 10)
        const sw = l.sub ? ctx.measureText(l.sub).width : 0
        const bw = Math.min(Math.max(tw, sw) + 10, w - 8)
        const bh = l.sub ? 30 : 16
        const bx = Math.min(Math.max(x + r + 6, 4), w - bw - 4)
        const by = Math.min(Math.max(y - bh / 2, 4), h - bh - 4)
        ctx.fillStyle = 'rgb(4 9 12 / 0.9)'
        ctx.fillRect(bx, by, bw, bh)
        ctx.strokeStyle = l.color
        ctx.lineWidth = 1
        ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1)
        ctx.font = font(true, 11)
        ctx.fillStyle = l.color
        ctx.fillText(l.title, bx + 5, by + (l.sub ? 9 : bh / 2), bw - 10)
        if (l.sub) {
          ctx.font = font(false, 10)
          ctx.fillStyle = DIM
          ctx.fillText(l.sub, bx + 5, by + 21, bw - 10)
        }
      }
    }

    let raf = 0
    let lastDraw = 0
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick)
      const u = ui.current
      const c = cam.current
      if (u.fitRequest && fit()) u.fitRequest = false
      let moving = false
      if (c.target && !u.dragging) {
        const t = c.target
        c.x += (t.x - c.x) * 0.16
        c.y += (t.y - c.y) * 0.16
        c.scale += (t.scale - c.scale) * 0.16
        if (Math.abs(t.x - c.x) * c.scale < 0.3 && Math.abs(t.y - c.y) * c.scale < 0.3 && Math.abs(t.scale - c.scale) < 0.002) c.target = null
        moving = true
      }
      const packets = props.current.edges.some((e) => e.data?.flowing)
      const fast = u.dragging || moving
      if (!fast && !u.dirty && !packets) return
      if (!fast && !u.dirty && now - lastDraw < IDLE_FRAME_MS) return
      lastDraw = now
      u.dirty = false
      draw(now)
    }
    raf = requestAnimationFrame(tick)

    const hit = (x: number, y: number) => {
      let best: TronNodeType | null = null
      let bestD = Infinity
      for (const o of projected) {
        const d = Math.hypot(o.x - x, o.y - y)
        if (d < Math.max(o.r + 4, 8) && d < bestD) {
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
      cam.current.target = null
      lx = e.clientX
      ly = e.clientY
    }
    const move = (e: PointerEvent) => {
      const u = ui.current
      if (u.dragging) {
        const dx = e.clientX - lx
        const dy = e.clientY - ly
        lx = e.clientX
        ly = e.clientY
        u.moved += Math.abs(dx) + Math.abs(dy)
        cam.current.x -= dx / cam.current.scale
        cam.current.y -= dy / cam.current.scale
        if (u.moved > 4) u.hover = null
        u.dirty = true
        return
      }
      const { x, y } = local(e)
      const hNode = hit(x, y)
      if (hNode !== u.hover) {
        if (hNode) sfx.emit('hover', { source: 'topology.flat', node: hNode.id })
        u.hover = hNode
        u.dirty = true
        el.style.cursor = hNode ? 'pointer' : 'grab'
      }
    }
    const up = (e: PointerEvent) => {
      const u = ui.current
      if (!u.dragging) return
      u.dragging = false
      if (u.moved < 4) {
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
      const c = cam.current
      c.target = null
      const { x, y } = local(e)
      // keep the world point under the cursor fixed
      const wx = c.x + (x - w / 2) / c.scale
      const wy = c.y + (y - h / 2) / c.scale
      c.scale = Math.max(0.1, Math.min(8, c.scale * Math.exp(-e.deltaY * 0.0015)))
      c.x = wx - (x - w / 2) / c.scale
      c.y = wy - (y - h / 2) / c.scale
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

  return <canvas ref={canvas} className="no-drag absolute inset-0 size-full cursor-grab touch-none" aria-label="Flat code graph" />
}

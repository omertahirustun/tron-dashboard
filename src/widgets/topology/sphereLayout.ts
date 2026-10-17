import type { DataEdgeType, TronNodeType } from './graph'

export type Vec3 = [number, number, number]

const norm = (v: Vec3): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1
  return [v[0] / l, v[1] / l, v[2] / l]
}

/** Evenly spread points on the unit sphere (golden-angle spiral). */
export function fibonacciSphere(count: number): Vec3[] {
  const golden = Math.PI * (3 - Math.sqrt(5))
  return Array.from({ length: count }, (_, i) => {
    const y = 1 - ((i + 0.5) / count) * 2
    const r = Math.sqrt(1 - y * y)
    const a = i * golden
    return [Math.cos(a) * r, y, Math.sin(a) * r]
  })
}

// deterministic per-id jitter, so the same graph always lands the same way
function hash(s: string) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}
const jitter = (id: string, k: number): Vec3 => {
  const h = hash(id)
  return [((h & 0xff) / 255 - 0.5) * k, (((h >> 8) & 0xff) / 255 - 0.5) * k, (((h >> 16) & 0xff) / 255 - 0.5) * k]
}

/**
 * Fruchterman–Reingold on the sphere surface: every node repels every other,
 * edges pull their ends together, and after each step points are pushed back
 * onto the sphere. Nodes from the previous layout start where they were (and
 * new ones next to a placed neighbour), so live updates only nudge the globe.
 */
export function layoutSphere(nodes: TronNodeType[], edges: DataEdgeType[], prev: Map<string, Vec3>): Map<string, Vec3> {
  const n = nodes.length
  const out = new Map<string, Vec3>()
  if (!n) return out
  const index = new Map(nodes.map((nd, i) => [nd.id, i]))
  const links = edges.flatMap((e) => {
    const a = index.get(e.source)
    const b = index.get(e.target)
    return a === undefined || b === undefined ? [] : [[a, b] as const]
  })
  const neighbours = nodes.map(() => [] as number[])
  for (const [a, b] of links) {
    neighbours[a].push(b)
    neighbours[b].push(a)
  }

  const seeds = fibonacciSphere(n)
  const pos: Vec3[] = nodes.map((nd) => prev.get(nd.id) ?? (null as unknown as Vec3))
  const known = pos.filter(Boolean).length
  // new nodes: beside an already placed neighbour, else on the spiral
  for (let pass = 0; pass < 3; pass++)
    nodes.forEach((nd, i) => {
      if (pos[i]) return
      const anchor = neighbours[i].find((j) => pos[j])
      if (anchor !== undefined) {
        const j = jitter(nd.id, 0.3)
        pos[i] = norm([pos[anchor][0] + j[0], pos[anchor][1] + j[1], pos[anchor][2] + j[2]])
      } else if (pass === 2) pos[i] = seeds[i]
    })

  // ideal spacing for n nodes on a sphere of area 4π
  const k = Math.sqrt((4 * Math.PI) / n) * 0.9
  const fresh = known < n / 2
  // big code graphs: fewer rounds, the all-pairs repulsion is O(n²)
  const iterations = Math.round((fresh ? 320 : 90) * (n > 300 ? 0.5 : 1))
  let temp = fresh ? 0.35 : 0.08
  const cool = Math.pow(0.012 / temp, 1 / iterations)
  const disp: Vec3[] = nodes.map(() => [0, 0, 0])

  for (let it = 0; it < iterations; it++) {
    for (const d of disp) d[0] = d[1] = d[2] = 0
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++) {
        const dx = pos[i][0] - pos[j][0]
        const dy = pos[i][1] - pos[j][1]
        const dz = pos[i][2] - pos[j][2]
        const d2 = dx * dx + dy * dy + dz * dz + 1e-6
        const f = (k * k) / d2 // = (k²/d) / d, applied to the unnormalised delta
        disp[i][0] += dx * f
        disp[i][1] += dy * f
        disp[i][2] += dz * f
        disp[j][0] -= dx * f
        disp[j][1] -= dy * f
        disp[j][2] -= dz * f
      }
    for (const [a, b] of links) {
      const dx = pos[a][0] - pos[b][0]
      const dy = pos[a][1] - pos[b][1]
      const dz = pos[a][2] - pos[b][2]
      const d = Math.hypot(dx, dy, dz) + 1e-6
      const f = d / k // = (d²/k) / d
      disp[a][0] -= dx * f
      disp[a][1] -= dy * f
      disp[a][2] -= dz * f
      disp[b][0] += dx * f
      disp[b][1] += dy * f
      disp[b][2] += dz * f
    }
    for (let i = 0; i < n; i++) {
      const d = disp[i]
      const l = Math.hypot(d[0], d[1], d[2]) + 1e-9
      const step = Math.min(l, temp) / l
      pos[i] = norm([pos[i][0] + d[0] * step, pos[i][1] + d[1] * step, pos[i][2] + d[2] * step])
    }
    temp *= cool
  }
  nodes.forEach((nd, i) => out.set(nd.id, pos[i]))
  return out
}

/** The ambient lattice: `count` spiral points, each linked to its 3 nearest. */
export function lattice(count: number) {
  const pts = fibonacciSphere(count)
  const seen = new Set<string>()
  const lines: Array<[number, number]> = []
  pts.forEach((p, i) => {
    pts
      .map((q, j) => ({ j, d: (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2 }))
      .filter((o) => o.j !== i)
      .sort((a, b) => a.d - b.d)
      .slice(0, 3)
      .forEach(({ j }) => {
        const key = i < j ? `${i}-${j}` : `${j}-${i}`
        if (!seen.has(key)) {
          seen.add(key)
          lines.push([i, j])
        }
      })
  })
  return { pts, lines }
}

/** Points along the great circle from a to b (both unit vectors), lifted slightly off the surface. */
export function greatArc(a: Vec3, b: Vec3, steps: number, lift = 0.03): Vec3[] {
  const dot = Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]))
  const omega = Math.acos(dot)
  const sin = Math.sin(omega)
  return Array.from({ length: steps + 1 }, (_, i) => {
    const t = i / steps
    const wa = sin < 1e-4 ? 1 - t : Math.sin((1 - t) * omega) / sin
    const wb = sin < 1e-4 ? t : Math.sin(t * omega) / sin
    const r = 1 + lift * Math.sin(Math.PI * t) * Math.min(1, omega)
    const p = norm([a[0] * wa + b[0] * wb, a[1] * wa + b[1] * wb, a[2] * wa + b[2] * wb])
    return [p[0] * r, p[1] * r, p[2] * r]
  })
}

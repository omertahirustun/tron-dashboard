import type { Edge, Node, OnNodeDrag } from '@xyflow/react'
import { useReducedMotion } from 'framer-motion'
import { useEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'

// "Brain cell" dragging: nodes linked to the dragged one follow it on damped
// springs, direct neighbours tightly and their neighbours more loosely, then
// wobble to rest after release. The loop only runs while something moves.

const MAX_DEPTH = 2
const STIFFNESS = [0, 0.2, 0.08] // by graph distance from the dragged node
const DAMPING = 0.76
const REST = 0.4 // px; below this (and slow) a follower counts as settled

interface Follower {
  depth: number
  /** offset from the dragged node when the drag started (the spring's rest length) */
  ox: number
  oy: number
  x: number
  y: number
  vx: number
  vy: number
}

interface Sim {
  target: { x: number; y: number }
  followers: Map<string, Follower>
  dragging: boolean
  raf: number
}

/** Ids within MAX_DEPTH hops of `start`, with their distance. */
function neighbours(start: string, edges: Edge[]) {
  const adj = new Map<string, string[]>()
  for (const e of edges) {
    adj.set(e.source, [...(adj.get(e.source) ?? []), e.target])
    adj.set(e.target, [...(adj.get(e.target) ?? []), e.source])
  }
  const depth = new Map<string, number>([[start, 0]])
  let frontier = [start]
  for (let d = 1; d <= MAX_DEPTH; d++) {
    const next: string[] = []
    for (const id of frontier)
      for (const n of adj.get(id) ?? [])
        if (!depth.has(n)) {
          depth.set(n, d)
          next.push(n)
        }
    frontier = next
  }
  depth.delete(start)
  return depth
}

export function useNeighborDrag<N extends Node>(
  setNodes: Dispatch<SetStateAction<N[]>>,
  nodesRef: MutableRefObject<N[]>,
  edgesRef: MutableRefObject<Edge[]>,
) {
  const reduce = useReducedMotion()
  const sim = useRef<Sim | null>(null)

  useEffect(() => () => cancelAnimationFrame(sim.current?.raf ?? 0), [])

  const step = () => {
    const s = sim.current
    if (!s) return
    let moving = false
    for (const f of s.followers.values()) {
      const tx = s.target.x + f.ox
      const ty = s.target.y + f.oy
      if (reduce) {
        // reduced motion: move rigidly with the dragged node, no wobble
        f.x = tx
        f.y = ty
        continue
      }
      const k = STIFFNESS[f.depth]
      f.vx = (f.vx + (tx - f.x) * k) * DAMPING
      f.vy = (f.vy + (ty - f.y) * k) * DAMPING
      f.x += f.vx
      f.y += f.vy
      if (Math.abs(f.vx) + Math.abs(f.vy) > 0.05 || Math.abs(tx - f.x) + Math.abs(ty - f.y) > REST) moving = true
    }
    setNodes((nds) =>
      nds.map((n) => {
        const f = s.followers.get(n.id)
        return f ? { ...n, position: { x: f.x, y: f.y } } : n
      }),
    )
    if (s.dragging || moving) s.raf = requestAnimationFrame(step)
    else sim.current = null
  }

  const onNodeDragStart: OnNodeDrag<N> = (_, node) => {
    cancelAnimationFrame(sim.current?.raf ?? 0)
    const pos = new Map(nodesRef.current.map((n) => [n.id, n.position]))
    const followers = new Map<string, Follower>()
    for (const [id, depth] of neighbours(node.id, edgesRef.current)) {
      const p = pos.get(id)
      if (!p) continue
      followers.set(id, { depth, ox: p.x - node.position.x, oy: p.y - node.position.y, x: p.x, y: p.y, vx: 0, vy: 0 })
    }
    sim.current = { target: { ...node.position }, followers, dragging: true, raf: 0 }
    sim.current.raf = requestAnimationFrame(step)
  }

  const onNodeDrag: OnNodeDrag<N> = (_, node) => {
    if (sim.current) sim.current.target = { ...node.position }
  }

  const onNodeDragStop: OnNodeDrag<N> = (_, node) => {
    if (!sim.current) return
    sim.current.target = { ...node.position }
    sim.current.dragging = false // keep stepping until everything settles
  }

  return { onNodeDragStart, onNodeDrag, onNodeDragStop }
}

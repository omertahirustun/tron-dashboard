import type { Edge, Node } from '@xyflow/react'
import type { LiveSession } from '../../native/api'

export type TronNodeData =
  | {
      kind: 'agent'
      label: string
      /** second line: what it is and which model */
      role: string
      /** sessions are drawn larger than subagents */
      core?: boolean
      /** working right now (activity in the last 30 s) */
      live?: boolean
    }
  | { kind: 'note'; label: string; path: string; op?: 'read' | 'edit' | 'write'; live?: boolean }

export type TronNodeType = Node<TronNodeData, 'tron'>
export type DataEdgeType = Edge<{ flowing?: boolean }, 'data'>

// ── Browser sample: Claude_Prime in the middle, sub-agents around it, vault
// notes on the rim. Positions are node centres (the flow uses nodeOrigin [0.5, 0.5]).
const agent = (id: string, role: string, x: number, y: number, core = false): TronNodeType => ({
  id,
  type: 'tron',
  position: { x, y },
  data: { kind: 'agent', label: id, role, core },
})
const note = (id: string, label: string, path: string, x: number, y: number): TronNodeType => ({
  id,
  type: 'tron',
  position: { x, y },
  data: { kind: 'note', label, path },
})
const link = (source: string, target: string, flowing = false): DataEdgeType => ({
  id: `${source}->${target}`,
  source,
  target,
  type: 'data',
  data: { flowing },
})

export const SAMPLE_NODES: TronNodeType[] = [
  agent('Claude_Prime', 'orchestrator, opus', 0, 0, true),
  agent('Agent_Beta', 'vault indexer, sonnet', -190, 190),
  agent('Haiku_Scout', 'file scout, haiku', 190, 190),
  note('architecture', 'architecture.md', 'vault/projects/architecture.md', 0, -210),
  note('agent-office', 'agent-office.md', 'vault/projects/agent-office.md', -210, -130),
  note('ideas', 'agent ideas.md', 'vault/inbox/agent ideas.md', -280, 360),
  note('reading', 'reading list.md', 'vault/inbox/reading list.md', -90, 400),
  note('daily', '2026-10-16.md', 'vault/daily/2026-10-16.md', 210, 380),
  note('calendar', 'calendar-app.md', 'vault/projects/calendar-app.md', 210, -130),
]

export const SAMPLE_EDGES: DataEdgeType[] = [
  link('Claude_Prime', 'Agent_Beta'),
  link('Claude_Prime', 'Haiku_Scout'),
  link('Claude_Prime', 'architecture'),
  link('Claude_Prime', 'agent-office'),
  link('Claude_Prime', 'calendar'),
  link('Agent_Beta', 'ideas'),
  link('Agent_Beta', 'reading'),
  link('Haiku_Scout', 'daily'),
]

// ── Live graph from Claude Code sessions ────────────────────────────────────

const MODEL_SHORT: Record<string, string> = {
  'claude-opus-5-5': 'opus 5.5',
  'claude-sonnet-5-5': 'sonnet 5.5',
  'claude-haiku-5-5': 'haiku 5.5',
  'claude-fable-5-1': 'fable 5.1',
}
const shortModel = (m: string | null) => (m ? (MODEL_SHORT[m] ?? m.replace(/^claude-/, '')) : null)
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

// Each session gets a block: files on an arc above, subagents on an arc below.
// Neighbouring files alternate between two radii (FILE_RADIUS, +FILE_STAGGER)
// so long names never collide side by side. Blocks stack in one column for up
// to two sessions (the topology panel is tall), two columns beyond that.
const FILE_RADIUS = 300
const FILE_STAGGER = 70
const SUB_RADIUS = 220
const BLOCK_W = 900
const BLOCK_H = 720

/** Points spread over an arc; angles in degrees, 0° = right, 90° = down. Odd points sit `stagger` further out. */
function arc(count: number, from: number, to: number, r: number, stagger = 0) {
  return Array.from({ length: count }, (_, i) => {
    const t = count === 1 ? 0.5 : i / (count - 1)
    const a = ((from + (to - from) * t) * Math.PI) / 180
    const radius = r + (i % 2) * stagger
    return { x: Math.cos(a) * radius, y: Math.sin(a) * radius }
  })
}

/**
 * One block per session (see BLOCK_W/H): touched files on the arc above,
 * subagents on the arc below. Nodes that already exist keep their position, so
 * anything dragged by hand stays put when new activity arrives.
 */
export function buildLiveGraph(sessions: LiveSession[], keep: Map<string, { x: number; y: number }>) {
  const nodes: TronNodeType[] = []
  const edges: DataEdgeType[] = []
  const cols = sessions.length <= 2 ? 1 : 2
  sessions.forEach((s, i) => {
    const cx = (i % cols) * BLOCK_W
    const cy = Math.floor(i / cols) * BLOCK_H
    const sid = `session:${s.id}`
    const place = (id: string, x: number, y: number) => keep.get(id) ?? { x, y }
    nodes.push({
      id: sid,
      type: 'tron',
      position: place(sid, cx, cy),
      data: {
        kind: 'agent',
        core: true,
        live: s.live,
        label: clip(s.title, 34),
        // 'HEAD' means detached or no commits yet: not worth a label
        role: [s.project, shortModel(s.model), s.branch !== 'HEAD' && s.branch].filter(Boolean).join(', '),
      },
    })
    arc(s.files.length, 190, 350, FILE_RADIUS, FILE_STAGGER).forEach((p, j) => {
      const f = s.files[j]
      const id = `file:${s.id}:${f.path}`
      // a file counts as live if it was touched in the last 30 s
      const live = s.live && Date.now() - f.at < 30_000
      nodes.push({ id, type: 'tron', position: place(id, cx + p.x, cy + p.y), data: { kind: 'note', label: clip(f.path.split('/').pop() ?? f.path, 28), path: f.path, op: f.op, live } })
      edges.push(link(sid, id, live))
    })
    arc(s.subagents.length, 25, 155, SUB_RADIUS).forEach((p, j) => {
      const a = s.subagents[j]
      const id = `agent:${s.id}:${a.id}`
      nodes.push({
        id,
        type: 'tron',
        position: place(id, cx + p.x, cy + p.y),
        data: { kind: 'agent', live: a.live, label: clip(a.description, 30), role: [a.agentType, shortModel(a.model)].filter(Boolean).join(', ') },
      })
      edges.push(link(sid, id, a.live))
    })
  })
  return { nodes, edges }
}

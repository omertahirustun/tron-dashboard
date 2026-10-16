import type { Edge, Node } from '@xyflow/react'
import type { AgentId } from '../../store/useOfficeStore'

export type TronNodeData =
  | { kind: 'agent'; agent: AgentId; label: string; role: string; model: string }
  | { kind: 'note'; label: string; path: string }

export type TronNodeType = Node<TronNodeData, 'tron'>
export type DataEdgeType = Edge<Record<string, never>, 'data'>

// Claude_Prime in the middle, sub-agents around it, vault notes on the rim.
// Positions are node centres (the flow uses nodeOrigin [0.5, 0.5]).
export const NODES: TronNodeType[] = [
  {
    id: 'Claude_Prime',
    type: 'tron',
    position: { x: 0, y: 0 },
    data: { kind: 'agent', agent: 'Claude_Prime', label: 'Claude_Prime', role: 'orchestrator', model: 'opus' },
  },
  {
    id: 'Agent_Beta',
    type: 'tron',
    position: { x: -190, y: 190 },
    data: { kind: 'agent', agent: 'Agent_Beta', label: 'Agent_Beta', role: 'vault indexer', model: 'sonnet' },
  },
  {
    id: 'Haiku_Scout',
    type: 'tron',
    position: { x: 190, y: 190 },
    data: { kind: 'agent', agent: 'Haiku_Scout', label: 'Haiku_Scout', role: 'file scout', model: 'haiku' },
  },
  note('architecture', 'architecture.md', 'vault/projects/architecture.md', 0, -210),
  note('agent-office', 'agent-office.md', 'vault/projects/agent-office.md', -210, -130),
  note('ideas', 'agent ideas.md', 'vault/inbox/agent ideas.md', -280, 360),
  note('reading', 'reading list.md', 'vault/inbox/reading list.md', -90, 400),
  note('daily', '2026-10-16.md', 'vault/daily/2026-10-16.md', 210, 380),
  note('calendar', 'calendar-app.md', 'vault/projects/calendar-app.md', 210, -130),
]

function note(id: string, label: string, path: string, x: number, y: number): TronNodeType {
  return { id, type: 'tron', position: { x, y }, data: { kind: 'note', label, path } }
}

const link = (source: string, target: string): DataEdgeType => ({
  id: `${source}->${target}`,
  source,
  target,
  type: 'data',
})

export const EDGES: DataEdgeType[] = [
  link('Claude_Prime', 'Agent_Beta'),
  link('Claude_Prime', 'Haiku_Scout'),
  link('Claude_Prime', 'architecture'),
  link('Claude_Prime', 'agent-office'),
  link('Claude_Prime', 'calendar'),
  link('Agent_Beta', 'ideas'),
  link('Agent_Beta', 'reading'),
  link('Haiku_Scout', 'daily'),
]

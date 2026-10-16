import '@xyflow/react/dist/style.css'
import {
  Background,
  BackgroundVariant,
  ReactFlow,
  ReactFlowProvider,
  useNodesInitialized,
  useNodesState,
  useReactFlow,
  type NodeMouseHandler,
} from '@xyflow/react'
import { Maximize, Share2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { TronButton } from '../../components/TronButton'
import { Widget } from '../../components/Widget'
import { sfx } from '../../lib/sfx'
import { native, type SessionsSnapshot } from '../../native/api'
import { readFileToLog } from '../../services/files'
import { useOfficeStore } from '../../store/useOfficeStore'
import { DataEdge } from './DataEdge'
import { buildLiveGraph, buildSampleGraph, type DataEdgeType, type TronNodeType } from './graph'
import { TronNode } from './TronNode'
import { useNeighborDrag } from './useNeighborDrag'

const nodeTypes = { tron: TronNode }
const edgeTypes = { data: DataEdge }

function Graph() {
  const [sample] = useState(() => (native ? null : buildSampleGraph()))
  const [nodes, setNodes, onNodesChange] = useNodesState<TronNodeType>(sample?.nodes ?? [])
  const [edges, setEdges] = useState<DataEdgeType[]>(sample?.edges ?? [])
  const [loaded, setLoaded] = useState(!native)
  const { fitView } = useReactFlow()
  const box = useRef<HTMLDivElement>(null)
  const measured = useNodesInitialized()
  // latest nodes/edges for rebuilds (keep dragged positions) and drag physics
  const nodesRef = useRef(nodes)
  const edgesRef = useRef(edges)
  useEffect(() => {
    nodesRef.current = nodes
    edgesRef.current = edges
  }, [nodes, edges])
  const drag = useNeighborDrag(setNodes, nodesRef, edgesRef)

  // desktop: rebuild the graph from live Claude Code sessions
  useEffect(() => {
    if (!native) return
    const apply = (snapshot: SessionsSnapshot) => {
      const keep = new Map(nodesRef.current.map((n) => [n.id, n.position]))
      const graph = buildLiveGraph(snapshot, keep)
      setNodes(graph.nodes)
      setEdges(graph.edges)
      setLoaded(true)
      useOfficeStore.getState().setAgentOptions(
        graph.nodes.filter((n) => n.data.kind === 'agent').map((n) => ({ id: n.id, label: n.data.label })),
      )
    }
    void native.getSessions().then(apply)
    return native.onSessions(apply)
  }, [setNodes])

  // reframe when nodes are added or removed (not on every activity update)
  const shape = nodes.map((n) => n.id).join('|')
  useEffect(() => {
    if (!measured || !shape) return
    const raf = requestAnimationFrame(() => void fitView({ padding: 0.15, duration: 300 }))
    return () => cancelAnimationFrame(raf)
  }, [shape, measured, fitView])

  // keep the graph framed when the panel is resized in the grid; only once
  // every node has a size, or fitView frames a subset and zooms in too far
  useEffect(() => {
    const el = box.current
    if (!el || !measured) return
    let raf = 0
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        if (el.clientWidth && el.clientHeight) void fitView({ padding: 0.15, duration: 200 })
      })
    })
    ro.observe(el)
    return () => {
      ro.disconnect()
      cancelAnimationFrame(raf)
    }
  }, [fitView, measured])

  const onNodeClick: NodeMouseHandler<TronNodeType> = (_, node) => {
    const { addTerminalLog, setActiveAgent, selectFile, workspaceRoots, setActiveRoot } = useOfficeStore.getState()
    sfx.emit('select', { source: 'topology.node', node: node.id })
    if (node.data.kind === 'hub') {
      addTerminalLog(`[LOG] ${node.data.role.replace(' loaded', '')} skills loaded in Claude Code`, { source: 'topology' })
      return
    }
    if (node.data.kind === 'skill') {
      const { name, description, used } = node.data
      addTerminalLog(`[SKILL] ${name}${used ? ' (used this session)' : ''}`, { source: 'topology', level: 'ok' })
      if (description) addTerminalLog(`  │ ${description.length > 160 ? `${description.slice(0, 160)}…` : description}`, { source: 'topology' })
      return
    }
    if (node.data.kind === 'agent') {
      setActiveAgent(node.id)
      addTerminalLog(`[LOG] Linked to agent: ${node.data.label}${node.data.role ? ` (${node.data.role})` : ''}`, { source: 'topology', level: 'ok' })
      return
    }
    const { path, label } = node.data
    addTerminalLog(`[LOG] Accessed ${path.endsWith('.md') ? 'Obsidian note' : 'file'}: ${label}`, { source: 'topology' })
    selectFile(path)
    if (!native) return
    const root = workspaceRoots.find((r) => path.startsWith(r.path + '/'))
    if (root) {
      setActiveRoot(root.path)
      void readFileToLog(path, label)
    } else addTerminalLog(`  │ ${path.replace(/^\/home\/[^/]+/, '~')} is outside the workspace folders (:workspace add <path>)`, { source: 'topology', level: 'warn' })
  }

  return (
    <div ref={box} className="relative h-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodeClick={onNodeClick}
        onNodeDragStart={drag.onNodeDragStart}
        onNodeDrag={drag.onNodeDrag}
        onNodeDragStop={drag.onNodeDragStop}
        nodeOrigin={[0.5, 0.5]}
        fitView
        fitViewOptions={{ padding: 0.15 }}
        minZoom={0.3}
        maxZoom={2}
        nodesConnectable={false}
        edgesFocusable={false}
        colorMode="dark"
        className="tron-flow"
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="rgb(13 230 255 / 0.18)" />
      </ReactFlow>
      {loaded && nodes.length === 0 && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6 text-center text-[12px] text-dim">
          No Claude Code session in the last 6 hours. Start one with `claude` in the shell and it appears here.
        </div>
      )}
      <div className="no-drag absolute bottom-2 left-2 z-10">
        <TronButton sfxSource="topology.fit" variant="solid" onClick={() => fitView({ padding: 0.15, duration: 300 })} aria-label="Fit graph to panel">
          <Maximize size={12} />
        </TronButton>
      </div>
    </div>
  )
}

export function AgentTopology() {
  const activeAgent = useOfficeStore((s) => s.activeAgentLabel)
  const replying = useOfficeStore((s) => s.chat.some((m) => m.streaming))
  return (
    <Widget
      title="agent.topology"
      icon={Share2}
      flush
      status={
        <span className={`max-w-[260px] truncate ${replying ? 'text-orange' : 'text-cyan'}`}>
          {!native && <span className="text-orange">sample </span>}
          {activeAgent}
          {replying ? ' replying' : ''}
        </span>
      }
    >
      <ReactFlowProvider>
        <Graph />
      </ReactFlowProvider>
    </Widget>
  )
}

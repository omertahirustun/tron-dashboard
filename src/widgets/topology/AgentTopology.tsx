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
import { useEffect, useRef } from 'react'
import { TronButton } from '../../components/TronButton'
import { Widget } from '../../components/Widget'
import { sfx } from '../../lib/sfx'
import { useOfficeStore } from '../../store/useOfficeStore'
import { DataEdge } from './DataEdge'
import { EDGES, NODES, type TronNodeType } from './graph'
import { TronNode } from './TronNode'

const nodeTypes = { tron: TronNode }
const edgeTypes = { data: DataEdge }

function Graph() {
  const [nodes, , onNodesChange] = useNodesState<TronNodeType>(NODES)
  const { fitView } = useReactFlow()
  const box = useRef<HTMLDivElement>(null)

  const measured = useNodesInitialized()

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
    const { addTerminalLog, setActiveAgent, selectFile } = useOfficeStore.getState()
    sfx.emit('select', { source: 'topology.node', node: node.id })
    if (node.data.kind === 'agent') {
      setActiveAgent(node.data.agent)
      addTerminalLog(`[LOG] Linked to agent: ${node.data.label} (${node.data.model})`, { source: 'topology', level: 'ok' })
    } else {
      selectFile(node.data.path)
      addTerminalLog(`[LOG] Accessed Obsidian Note: ${node.data.label}`, { source: 'topology' })
    }
  }

  return (
    <div ref={box} className="relative h-full">
      <ReactFlow
        nodes={nodes}
        edges={EDGES}
        onNodesChange={onNodesChange}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodeClick={onNodeClick}
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
      <div className="no-drag absolute bottom-2 left-2 z-10">
        <TronButton sfxSource="topology.fit" variant="solid" onClick={() => fitView({ padding: 0.15, duration: 300 })} aria-label="Fit graph to panel">
          <Maximize size={12} />
        </TronButton>
      </div>
    </div>
  )
}

export function AgentTopology() {
  const activeAgent = useOfficeStore((s) => s.activeAgent)
  const replying = useOfficeStore((s) => s.chat.some((m) => m.streaming))
  return (
    <Widget
      title="agent.topology"
      icon={Share2}
      flush
      status={
        <span className={replying ? 'text-orange' : 'text-cyan'}>
          {activeAgent}
          {replying ? ' replying' : ' active'}
        </span>
      }
    >
      <ReactFlowProvider>
        <Graph />
      </ReactFlowProvider>
    </Widget>
  )
}

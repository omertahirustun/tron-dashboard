import { Handle, Position, type NodeProps } from '@xyflow/react'
import { motion } from 'framer-motion'
import { Bot, BrainCircuit, FilePen, FileSearch, FileText, NotebookPen, Sparkles } from 'lucide-react'
import { memo } from 'react'
import { sfx } from '../../lib/sfx'
import { useOfficeStore } from '../../store/useOfficeStore'
import type { TronNodeType } from './graph'

// Handles are invisible; edges attach at the node centre via floating handles.
const hidden = '!pointer-events-none !opacity-0 !min-h-0 !min-w-0 !h-px !w-px !border-0'

const OP = { read: { Icon: FileSearch, label: 'read' }, edit: { Icon: FilePen, label: 'edited' }, write: { Icon: FilePen, label: 'written' } }

function TronNodeImpl(props: NodeProps<TronNodeType>) {
  const { data } = props
  if (data.kind === 'skill') return <SkillChip {...props} />
  if (data.kind === 'hub') return <HubNode {...props} />
  return <AgentOrFileNode {...props} />
}

/** Small chip for one loaded skill; brighter when a session used it, orange while in use. */
function SkillChip({ id, data }: NodeProps<TronNodeType>) {
  if (data.kind !== 'skill') return null
  const tone = data.live
    ? 'border-orange text-orange'
    : data.used
      ? 'border-cyan/70 text-cyan'
      : 'border-cyan-line/60 text-ink/70 hover:border-cyan hover:text-cyan'
  return (
    <motion.div
      onMouseEnter={() => sfx.emit('hover', { source: 'topology.skill', node: id })}
      whileHover={{ scale: 1.08 }}
      whileTap={{ scale: 0.94 }}
      transition={{ type: 'spring', stiffness: 500, damping: 30 }}
      className={`relative flex max-w-[150px] cursor-pointer items-center gap-1.5 rounded-full border bg-[#04090c]/95 px-2.5 py-1 text-[11px] transition-colors ${tone}`}
      title={`${data.name}\n${data.description}`}
    >
      {data.live && <span className="glow-layer" data-tone="busy" aria-hidden />}
      <Handle type="target" position={Position.Top} className={hidden} />
      <Sparkles size={11} className="shrink-0" aria-hidden />
      <span className="truncate">{data.label}</span>
      <Handle type="source" position={Position.Bottom} className={hidden} />
    </motion.div>
  )
}

function HubNode({ id, data }: NodeProps<TronNodeType>) {
  if (data.kind !== 'hub') return null
  return (
    <motion.div
      onMouseEnter={() => sfx.emit('hover', { source: 'topology.hub', node: id })}
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.95 }}
      className="tron-node-agent relative flex cursor-grab items-center gap-2 border border-cyan/60 bg-[#04090c]/95 px-3 py-2 text-cyan"
      title="Every skill Claude Code has loaded. Drag to move the whole cluster."
    >
      <Handle type="target" position={Position.Top} className={hidden} />
      <Sparkles size={16} aria-hidden />
      <div>
        <div className="text-[13px] font-bold">{data.label}</div>
        <div className="text-[10px] text-dim">{data.role}</div>
      </div>
      <Handle type="source" position={Position.Bottom} className={hidden} />
    </motion.div>
  )
}

function AgentOrFileNode({ id, data }: NodeProps<TronNodeType>) {
  const activeAgent = useOfficeStore((s) => s.activeAgent)
  const selectedFile = useOfficeStore((s) => s.selectedFile)
  const replying = useOfficeStore((s) => s.chat.some((m) => m.streaming))
  if (data.kind !== 'agent' && data.kind !== 'note') return null

  const isAgent = data.kind === 'agent'
  const active = isAgent ? id === activeAgent : data.path === selectedFile
  // orange = working: a live session/subagent, or the chat's agent while it replies
  const busy = !!data.live || (isAgent && active && replying)
  const isCore = isAgent && !!data.core
  const Icon = !isAgent ? (data.path.endsWith('.md') ? NotebookPen : FileText) : isCore ? BrainCircuit : Bot
  const op = !isAgent && data.op ? OP[data.op] : null

  const base = isAgent ? `min-w-[150px] max-w-[260px] px-3 py-2 ${isCore ? 'min-w-[190px] py-3' : ''}` : 'max-w-[220px] px-2.5 py-1.5'
  const tone = busy
    ? 'border-orange text-orange'
    : active
      ? isAgent
        ? 'border-cyan text-cyan'
        : 'border-[#b99cff] text-white'
      : isAgent
        ? 'border-cyan-line text-ink hover:border-cyan hover:text-cyan'
        : 'border-[#b99cff]/30 text-ink/80 hover:border-[#b99cff] hover:text-white'

  return (
    <motion.div
      onMouseEnter={() => sfx.emit('hover', { source: 'topology.node', node: id })}
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.95 }}
      transition={{ type: 'spring', stiffness: 500, damping: 30 }}
      // no backdrop blur here: the background is near-opaque and each blur
      // would re-render whenever an edge animates
      className={`relative cursor-pointer border bg-[#04090c]/95 transition-colors ${base} ${tone} ${
        isAgent ? 'tron-node-agent' : 'rounded-[2px]'
      }`}
      title={isAgent ? `${data.label}\n${data.role}` : `${data.path}${op ? `\n${op.label}` : ''}`}
    >
      {/* glow: smooth pulse while working, stepped "breathing" for the selected agent */}
      {(busy || (isAgent && active)) && <span className="glow-layer" data-tone={busy ? 'busy' : undefined} aria-hidden />}
      <Handle type="target" position={Position.Top} className={hidden} />
      <div className="flex items-center gap-2">
        <Icon size={isCore ? 18 : 14} className="shrink-0" aria-hidden />
        <div className="min-w-0">
          <div className={`truncate font-bold ${isCore ? 'text-[13px]' : 'text-[12px]'}`}>{data.label}</div>
          {isAgent && data.role && <div className="truncate text-[10px] text-dim">{data.role}</div>}
        </div>
        {isAgent ? (
          <span
            className={`ml-auto size-1.5 shrink-0 rounded-full ${busy ? 'bg-orange' : active ? 'bg-cyan' : 'bg-dim/50'}`}
            aria-label={busy ? 'working' : active ? 'selected' : 'idle'}
          />
        ) : (
          op && <op.Icon size={11} className="ml-auto shrink-0 text-dim" aria-label={op.label} />
        )}
      </div>
      <Handle type="source" position={Position.Bottom} className={hidden} />
    </motion.div>
  )
}

export const TronNode = memo(TronNodeImpl)

import { Handle, Position, type NodeProps } from '@xyflow/react'
import { motion } from 'framer-motion'
import { Bot, BrainCircuit, NotebookPen } from 'lucide-react'
import { memo } from 'react'
import { sfx } from '../../lib/sfx'
import { useOfficeStore } from '../../store/useOfficeStore'
import type { TronNodeType } from './graph'

// Handles are invisible; edges attach at the node centre via floating handles.
const hidden = '!pointer-events-none !opacity-0 !min-h-0 !min-w-0 !h-px !w-px !border-0'

function TronNodeImpl({ id, data }: NodeProps<TronNodeType>) {
  const activeAgent = useOfficeStore((s) => s.activeAgent)
  const selectedFile = useOfficeStore((s) => s.selectedFile)
  const replying = useOfficeStore((s) => s.chat.some((m) => m.streaming))

  const isAgent = data.kind === 'agent'
  const active = isAgent ? data.agent === activeAgent : data.path === selectedFile
  const busy = isAgent && active && replying
  const Icon = !isAgent ? NotebookPen : data.agent === 'Claude_Prime' ? BrainCircuit : Bot
  const isCore = id === 'Claude_Prime'
  const breathing = isAgent && active

  const base = isAgent
    ? `min-w-[150px] px-3 py-2 ${isCore ? 'min-w-[180px] py-3' : ''}`
    : 'px-2.5 py-1.5'
  const tone = busy
    ? 'border-orange text-orange'
    : active
      ? 'border-cyan text-cyan'
      : isAgent
        ? 'border-cyan-line text-ink hover:border-cyan hover:text-cyan'
        : 'border-[#b99cff]/30 text-ink/80 hover:border-[#b99cff] hover:text-white'

  return (
    <motion.div
      onMouseEnter={() => sfx.emit('hover', { source: 'topology.node', node: id })}
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.95 }}
      transition={{ type: 'spring', stiffness: 500, damping: 30 }}
      className={`relative cursor-pointer border bg-[#04090c]/90 backdrop-blur-sm transition-colors ${base} ${tone} ${
        isAgent ? 'tron-node-agent' : 'rounded-[2px]'
      } ${active && !isAgent ? 'border-[#b99cff]! text-white' : ''}`}
    >
      {/* active agent "breathes": CSS opacity pulse on a pre-drawn glow (see .glow-layer) */}
      {breathing && <span className="glow-layer" data-tone={busy ? 'busy' : undefined} aria-hidden />}
      <Handle type="target" position={Position.Top} className={hidden} />
      <div className="flex items-center gap-2">
        <Icon size={isCore ? 18 : 14} className="shrink-0" aria-hidden />
        <div className="min-w-0">
          <div className={`truncate font-bold ${isCore ? 'text-[13px]' : 'text-[12px]'}`}>{data.label}</div>
          {isAgent && (
            <div className="truncate text-[10px] text-dim">
              {data.role}, {data.model}
            </div>
          )}
        </div>
        {isAgent && (
          <span
            className={`ml-auto size-1.5 shrink-0 rounded-full ${busy ? 'bg-orange' : active ? 'bg-cyan' : 'bg-dim/50'}`}
            aria-label={busy ? 'replying' : active ? 'active' : 'idle'}
          />
        )}
      </div>
      <Handle type="source" position={Position.Bottom} className={hidden} />
    </motion.div>
  )
}

export const TronNode = memo(TronNodeImpl)

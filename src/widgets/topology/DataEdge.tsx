import { BaseEdge, useInternalNode, type EdgeProps } from '@xyflow/react'
import { useReducedMotion } from 'framer-motion'
import { memo } from 'react'
import { useOfficeStore } from '../../store/useOfficeStore'
import type { DataEdgeType } from './graph'

function center(node: ReturnType<typeof useInternalNode>) {
  if (!node) return null
  const { x, y } = node.internals.positionAbsolute
  return { x: x + (node.measured.width ?? 0) / 2, y: y + (node.measured.height ?? 0) / 2 }
}

/** Straight centre-to-centre line; while an agent works, a dashed flow and travelling data packets. */
function DataEdgeImpl({ id, source, target, data }: EdgeProps<DataEdgeType>) {
  const reduce = useReducedMotion()
  const a = center(useInternalNode(source))
  const b = center(useInternalNode(target))
  const activeAgent = useOfficeStore((s) => s.activeAgent)
  const replying = useOfficeStore((s) => s.chat.some((m) => m.streaming))
  if (!a || !b) return null

  const live = source === activeAgent || target === activeAgent || !!data?.flowing
  // flowing = the agent at either end is working right now
  const hot = !!data?.flowing || (live && replying)
  const color = hot ? 'var(--color-orange)' : 'var(--color-cyan)'
  const path = `M ${a.x},${a.y} L ${b.x},${b.y}`
  const length = Math.hypot(b.x - a.x, b.y - a.y)
  // constant packet speed regardless of edge length
  const dur = `${(length / 260).toFixed(2)}s`

  // Edges only move while the active agent is replying: any motion makes every
  // glass panel re-render its blur each frame. No SVG filters for the same reason.
  const flowing = hot && !reduce
  return (
    <>
      <BaseEdge id={id} path={path} style={{ stroke: color, strokeOpacity: live ? 0.18 : 0.1, strokeWidth: live ? 5 : 3 }} />
      <path
        d={path}
        fill="none"
        stroke={color}
        strokeWidth={live ? 1.6 : 1}
        strokeOpacity={live ? 0.95 : 0.4}
        strokeDasharray="4 14"
        className={flowing ? 'edge-flow edge-flow-fast' : ''}
      />
      {flowing && (
        <circle r={3.5} fill={color}>
          <animateMotion dur={dur} repeatCount="indefinite" path={path} />
        </circle>
      )}
    </>
  )
}

export const DataEdge = memo(DataEdgeImpl)

import type { ReactNode } from 'react'
import { loadLevel, type LoadLevel } from '../services/telemetry'

const stroke: Record<LoadLevel, string> = {
  normal: 'var(--color-cyan)',
  heavy: 'var(--color-orange)',
  critical: 'var(--color-crit)',
}

export interface RingProps {
  pct: number
  /** under the ring */
  caption: string
  /** small line under the caption */
  sub?: ReactNode
  label: string
  /** text in the middle; defaults to the percentage */
  center?: ReactNode
  size?: number
}

/** Small circular gauge: cyan below 70 %, orange to 90 %, red above. */
export function Ring({ pct, caption, sub, label, center, size = 56 }: RingProps) {
  const clamped = Math.min(100, Math.max(0, pct))
  const level = loadLevel(clamped)
  const r = 15
  const c = 2 * Math.PI * r
  return (
    <figure className="flex min-w-0 flex-1 flex-col items-center gap-0.5">
      <div
        className="relative shrink-0"
        style={{ width: size, height: size }}
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(clamped)}
      >
        <svg viewBox="0 0 40 40" className="size-full -rotate-90" aria-hidden>
          <circle cx="20" cy="20" r={r} fill="none" stroke="rgb(13 230 255 / 0.1)" strokeWidth="3.2" />
          <circle cx="20" cy="20" r={r + 3.6} fill="none" stroke="rgb(13 230 255 / 0.16)" strokeWidth="0.5" strokeDasharray="0.6 2.4" />
          <circle
            cx="20"
            cy="20"
            r={r}
            fill="none"
            stroke={stroke[level]}
            strokeWidth="3.2"
            strokeDasharray={c}
            strokeDashoffset={c * (1 - clamped / 100)}
            style={{ transition: 'stroke-dashoffset 0.6s ease-out, stroke 0.3s' }}
          />
        </svg>
        <span className="absolute inset-0 flex items-center justify-center text-[12px] leading-none font-bold tabular-nums" style={{ color: stroke[level] }}>
          {center ?? (
            <>
              {Math.round(clamped)}
              <span className="text-[8px] font-normal text-dim">%</span>
            </>
          )}
        </span>
      </div>
      <figcaption className="max-w-full truncate text-center text-[10px] leading-tight text-ink">{caption}</figcaption>
      {sub && <span className="max-w-full truncate text-center text-[9px] leading-tight text-dim tabular-nums">{sub}</span>}
    </figure>
  )
}

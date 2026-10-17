import { useId, type ReactNode } from 'react'
import { loadLevel, type LoadLevel } from '../services/telemetry'

const tone: Record<LoadLevel, string> = {
  normal: 'var(--color-cyan)',
  heavy: 'var(--color-orange)',
  critical: 'var(--color-crit)',
}

export interface RingProps {
  pct: number
  /** inside the gauge, under the value */
  caption: string
  /** small line under the gauge */
  sub?: ReactNode
  label: string
  /** text in the middle; defaults to the percentage */
  center?: ReactNode
}

// A 270° HUD gauge opening at the bottom, in a 100×100 box
const C = 50
const R = 38 // the segmented value arc
const SWEEP = 270
const START = -135 // degrees clockwise from 12 o'clock
const SEGMENTS = 36
const ARC = (R * SWEEP * Math.PI) / 180
const STEP = ARC / SEGMENTS
// a value change eases in 9 steps (15 fps): a smooth 60 fps ease here would be
// 36 full-screen frames every 2 s, the blurred panels re-rendered each time
const EASE = '0.6s steps(9, end)'

const point = (r: number, deg: number) => {
  const a = ((deg - 90) * Math.PI) / 180
  return [C + r * Math.cos(a), C + r * Math.sin(a)] as const
}

/** the whole 270° arc at radius r */
function arc(r: number) {
  const [x0, y0] = point(r, START)
  const [x1, y1] = point(r, START + SWEEP)
  return `M ${x0} ${y0} A ${r} ${r} 0 1 1 ${x1} ${y1}`
}

const ticks = Array.from({ length: 11 }, (_, i) => START + (SWEEP * i) / 10)

/**
 * Tron HUD gauge: a ring of lit segments (cyan below 70 %, orange to 90 %, red
 * above) inside a ticked scale, a bright marker at the value and the reading in
 * the middle. Nothing moves except a short stepped ease when the value changes:
 * every frame of motion re-renders every glass panel's blur.
 */
export function Ring({ pct, caption, sub, label, center }: RingProps) {
  const clamped = Math.min(100, Math.max(0, pct))
  const color = tone[loadLevel(clamped)]
  const mask = useId()
  const at = START + (SWEEP * clamped) / 100

  return (
    <figure className="flex min-w-0 flex-1 flex-col items-center gap-1">
      <div
        className="hud-gauge relative w-full"
        style={{ maxWidth: 118, color }}
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(clamped)}
      >
        <svg viewBox="0 0 100 100" className="block size-full overflow-visible" aria-hidden>
          <defs>
            {/* reveals the segments up to the value; the dash offset eases */}
            <mask id={mask} maskUnits="userSpaceOnUse" x="0" y="0" width="100" height="100">
              <path
                d={arc(R)}
                fill="none"
                stroke="#fff"
                strokeWidth="14"
                strokeDasharray={`${ARC} ${ARC}`}
                strokeDashoffset={ARC * (1 - clamped / 100)}
                style={{ transition: `stroke-dashoffset ${EASE}` }}
              />
            </mask>
          </defs>

          {/* outer scale: thin ring with a tick every 10 %, brackets at the opening */}
          <path d={arc(47)} fill="none" stroke="rgb(13 230 255 / 0.28)" strokeWidth="0.6" />
          {ticks.map((deg, i) => {
            const [x0, y0] = point(47, deg)
            const [x1, y1] = point(i % 5 === 0 ? 42.5 : 44.5, deg)
            return <line key={deg} x1={x0} y1={y0} x2={x1} y2={y1} stroke="rgb(13 230 255 / 0.55)" strokeWidth={i % 5 === 0 ? 1.2 : 0.7} />
          })}
          {[START, START + SWEEP].map((deg) => {
            const [x0, y0] = point(47, deg)
            const [x1, y1] = point(53, deg)
            return <line key={deg} x1={x0} y1={y0} x2={x1} y2={y1} stroke="var(--color-cyan)" strokeWidth="1.6" strokeLinecap="square" />
          })}

          {/* unlit segments */}
          <path d={arc(R)} fill="none" stroke="rgb(13 230 255 / 0.1)" strokeWidth="7" strokeDasharray={`${STEP * 0.62} ${STEP * 0.38}`} />
          {/* lit segments, with a soft halo (a wide faint stroke, no SVG filter) */}
          <g mask={`url(#${mask})`}>
            <path d={arc(R)} fill="none" stroke="currentColor" strokeOpacity="0.22" strokeWidth="12" strokeDasharray={`${STEP * 0.62} ${STEP * 0.38}`} />
            <path d={arc(R)} fill="none" stroke="currentColor" strokeWidth="7" strokeDasharray={`${STEP * 0.62} ${STEP * 0.38}`} />
          </g>

          {/* inner rings */}
          <circle cx={C} cy={C} r="30.5" fill="none" stroke="rgb(13 230 255 / 0.22)" strokeWidth="0.5" />
          <circle cx={C} cy={C} r="27.5" fill="rgb(2 8 10 / 0.55)" stroke="rgb(13 230 255 / 0.12)" strokeWidth="0.4" strokeDasharray="1 2" />

          {/* the value marker: a bright needle across the segments (none without a reading) */}
          <g opacity={center !== undefined && clamped === 0 ? 0 : 1} style={{ transform: `rotate(${at}deg)`, transformOrigin: '50px 50px', transition: `transform ${EASE}` }}>
            <line x1={C} y1={C - 30.5} x2={C} y2={C - 46} stroke="#effeff" strokeWidth="1.3" />
            <path d={`M ${C - 2} ${C - 48.5} L ${C + 2} ${C - 48.5} L ${C} ${C - 45.5} Z`} fill="#effeff" />
          </g>
        </svg>

        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="hud-gauge-value tabular-nums">
            {center ?? (
              <>
                {Math.round(clamped)}
                <span className="hud-gauge-unit">%</span>
              </>
            )}
          </span>
          <span lang="en" className="hud-gauge-caption">
            {caption}
          </span>
        </div>
      </div>
      {/* tucked up into the gauge's open bottom */}
      {sub && <span className="-mt-3 max-w-full truncate text-center text-[10px] leading-tight text-dim tabular-nums">{sub}</span>}
    </figure>
  )
}

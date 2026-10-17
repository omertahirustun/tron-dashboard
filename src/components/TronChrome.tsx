import { useEffect, useRef, useState } from 'react'
import { useSessions } from '../native/useSessions'

/** Identity disc: two lit rings and a segmented core. Spins once on hover (CSS). */
export function IdentityDisc({ size = 22 }: { size?: number }) {
  return (
    <svg className="identity-disc" width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <circle cx="16" cy="16" r="14" fill="none" stroke="var(--color-cyan)" strokeWidth="1.6" />
      <circle cx="16" cy="16" r="9.5" fill="none" stroke="var(--color-cyan)" strokeWidth="1" strokeDasharray="5 2.5" opacity="0.8" />
      <circle cx="16" cy="16" r="4.5" fill="rgb(13 230 255 / 0.18)" stroke="#e8feff" strokeWidth="1.2" />
      <path d="M16 2v4M16 26v4M2 16h4M26 16h4" stroke="var(--color-cyan)" strokeWidth="1.6" />
    </svg>
  )
}

/**
 * Light cycles racing along the header's bottom edge: a cyan one every 30 s, and
 * an orange one every 8 s while any agent is working (orange = something runs).
 * Each ride is a one-shot animation that unmounts when it ends: a continuous
 * animation keeps the compositor drawing every frame, re-blurring every glass
 * panel (measured ~+25% CPU), even while it holds still.
 */
export function LightCycles() {
  const snapshot = useSessions()
  const busy = snapshot?.sessions.some((s) => s.activity.state === 'thinking' || s.activity.state === 'tool') ?? false
  const [rides, setRides] = useState<{ id: number; tone: 'idle' | 'busy' }[]>([])
  const nextId = useRef(0)

  useEffect(() => {
    const ride = () => setRides((r) => [...r, { id: nextId.current++, tone: busy ? 'busy' : 'idle' }])
    const first = setTimeout(ride, 1500)
    const id = setInterval(ride, busy ? 8000 : 30000)
    return () => {
      clearTimeout(first)
      clearInterval(id)
    }
  }, [busy])

  return (
    <div className="light-cycles" aria-hidden>
      {rides.map((r) => (
        <span
          key={r.id}
          className="light-cycle"
          data-tone={r.tone}
          onAnimationEnd={() => setRides((all) => all.filter((x) => x.id !== r.id))}
        />
      ))}
    </div>
  )
}

import { useEffect, useState } from 'react'

/** Current time, re-rendering every `ms` while `active` (for countdowns and elapsed timers). */
export function useNow(active: boolean, ms = 1000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    const id = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(id)
  }, [active, ms])
  return now
}

/** 75_000 → "1:15", 3_725_000 → "1:02:05" */
export function formatDuration(msTotal: number) {
  const s = Math.max(0, Math.round(msTotal / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`
}

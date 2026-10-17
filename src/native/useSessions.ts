import { useEffect, useState } from 'react'
import { native, type SessionsSnapshot } from './api'

/** Latest Claude Code sessions snapshot (desktop), or null until the first one arrives. */
export function useSessions() {
  const [snapshot, setSnapshot] = useState<SessionsSnapshot | null>(null)
  useEffect(() => {
    if (!native) return
    void native.getSessions().then(setSnapshot)
    return native.onSessions(setSnapshot)
  }, [])
  return snapshot
}

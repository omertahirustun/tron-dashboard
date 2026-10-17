import { useEffect } from 'react'
import { chime, type Chime } from '../lib/chime'
import { useOfficeStore } from '../store/useOfficeStore'
import { native, type AgentActivity, type PermissionRequest, type SessionsSnapshot } from './api'

const working = (a: AgentActivity | undefined) => a?.state === 'thinking' || a?.state === 'tool'

/** Sound, plus a desktop notification while the dashboard is in the background. */
function notify(kind: Chime, title: string, body: string) {
  chime.play(kind)
  if (document.hasFocus() || typeof Notification === 'undefined') return
  try {
    const n = new Notification(title, { body, silent: true, tag: `aod-${kind}` })
    n.onclick = () => void native?.focusWindow()
  } catch {
    // notifications unavailable
  }
}

/**
 * Keeps the store in step with the desktop bridge: network probes, Claude
 * usage, permission prompts, and the sounds for prompts and finished turns. Mounted once by the dashboard so the data is current even
 * when the matching widget is not on screen. No-op in a plain browser.
 */
export function useNativeSync() {
  useEffect(() => {
    if (!native) return
    const api = native
    const store = useOfficeStore.getState()
    const offs: Array<() => void> = []

    // network probes
    void api.getNetworkStatus().then(store.setNetworkStatus)
    offs.push(api.onNetwork((r) => useOfficeStore.getState().setNetworkStatus(r)))

    // Claude usage
    void api.getClaudeStats().then(store.setClaudeStats)
    offs.push(api.onClaudeStats((s) => useOfficeStore.getState().setClaudeStats(s)))

    // permission prompts from Claude Code; a new one rings
    const seen = new Set<string>()
    const onPermissions = (requests: PermissionRequest[], initial = false) => {
      useOfficeStore.getState().setPermissions(requests)
      const fresh = requests.filter((r) => !seen.has(r.id))
      fresh.forEach((r) => seen.add(r.id))
      if (!initial && fresh.length)
        notify('permission', `${fresh[0].project ?? 'Claude'} asks: ${fresh[0].tool}`, fresh[0].description ?? fresh[0].detail)
    }
    void api.getPermissions().then((r) => onPermissions(r, true))
    offs.push(api.onPermissions((r) => onPermissions(r)))

    // an agent that stops working and waits for you rings too (not the one open in the console)
    const states = new Map<string, AgentActivity['state']>()
    const onSessions = (snap: SessionsSnapshot) => {
      for (const s of snap.sessions) {
        const before = states.get(s.id)
        states.set(s.id, s.activity.state)
        const open = useOfficeStore.getState().agentConsole?.sessionId === s.id && document.hasFocus()
        if (before && working({ ...s.activity, state: before }) && s.activity.state === 'waiting' && !open)
          notify('turn', `${s.project ?? 'Claude'}: your turn`, s.title)
      }
    }
    void api.getSessions().then(onSessions)
    offs.push(api.onSessions(onSessions))

    return () => offs.forEach((off) => off())
  }, [])
}

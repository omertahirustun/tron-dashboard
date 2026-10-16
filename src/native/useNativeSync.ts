import { useEffect } from 'react'
import { useOfficeStore } from '../store/useOfficeStore'
import { native } from './api'

/**
 * Keeps the store in step with the desktop bridge: task queue, network probes
 * and Claude usage. Mounted once by the dashboard so the data is current even
 * when the matching widget is not on screen. No-op in a plain browser.
 */
export function useNativeSync() {
  useEffect(() => {
    if (!native) return
    const api = native
    const store = useOfficeStore.getState()
    const offs: Array<() => void> = []

    // tasks: status list + output lines into the terminal log
    void api.listTasks().then(store.setTasks)
    const lastStatus = new Map<string, string>()
    offs.push(
      api.onTasks((tasks) => {
        const { setTasks, addTerminalLog } = useOfficeStore.getState()
        for (const t of tasks) {
          const prev = lastStatus.get(t.id)
          if (prev && prev !== t.status) {
            if (t.status === 'running') addTerminalLog(`[TASK] ${t.name} started: ${t.command}`, { source: t.id, level: 'ok' })
            else if (t.status === 'done') addTerminalLog(`[TASK] ${t.name} finished [OK]`, { source: t.id, level: 'ok' })
            else if (t.status === 'failed') addTerminalLog(`[TASK] ${t.name} failed (exit ${t.exitCode})`, { source: t.id, level: 'error' })
            else if (t.status === 'stopped') addTerminalLog(`[TASK] ${t.name} stopped`, { source: t.id, level: 'warn' })
          }
          lastStatus.set(t.id, t.status)
        }
        setTasks(tasks)
      }),
    )
    offs.push(api.onTaskOutput(({ id, line }) => useOfficeStore.getState().addTerminalLog(line, { source: id })))

    // network probes
    void api.getNetworkStatus().then(store.setNetworkStatus)
    offs.push(api.onNetwork((r) => useOfficeStore.getState().setNetworkStatus(r)))

    // Claude usage
    void api.getClaudeStats().then(store.setClaudeStats)
    offs.push(api.onClaudeStats((s) => useOfficeStore.getState().setClaudeStats(s)))

    return () => offs.forEach((off) => off())
  }, [])
}

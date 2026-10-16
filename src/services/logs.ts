import { useEffect } from 'react'
import { native } from '../native/api'
import { useOfficeStore, type LogLevel } from '../store/useOfficeStore'

// Simulated background activity for the browser build only. In the desktop app
// the log is fed by real sources (tasks, git, files, shell), so this stays off.

const SAMPLES: Array<{ source: string; level: LogLevel; text: string }> = [
  { source: 'vite', level: 'info', text: 'hmr update /src/widgets/FileExplorer.tsx' },
  { source: 'vite', level: 'ok', text: 'page reload in 84ms' },
  { source: 'hook', level: 'info', text: 'PreToolUse Read → Claude_Prime' },
  { source: 'hook', level: 'info', text: 'PostToolUse Edit ok (12 lines)' },
  { source: 'supabase', level: 'ok', text: 'realtime channel joined: agents' },
  { source: 'postgres', level: 'info', text: 'checkpoint complete: wrote 42 buffers' },
  { source: 'node', level: 'warn', text: 'event loop lag 112ms' },
  { source: 'agent_beta', level: 'info', text: 'indexed 3 notes from vault/inbox' },
  { source: 'build', level: 'ok', text: 'tsc -b finished, 0 errors' },
  { source: 'node', level: 'error', text: 'ECONNRESET on ws://localhost:8787 (retrying)' },
]

export function useLogSimulator() {
  useEffect(() => {
    if (native) return
    const { addTerminalLog } = useOfficeStore.getState()
    const pick = () => SAMPLES[Math.floor(Math.random() * SAMPLES.length)]
    if (useOfficeStore.getState().terminalLogs.length === 0) {
      for (const s of SAMPLES.slice(0, 4)) addTerminalLog(s.text, s)
    }
    let timer: ReturnType<typeof setTimeout>
    const schedule = () => {
      timer = setTimeout(() => {
        const s = pick()
        addTerminalLog(s.text, s)
        schedule()
      }, 1500 + Math.random() * 2500)
    }
    schedule()
    return () => clearTimeout(timer)
  }, [])
}

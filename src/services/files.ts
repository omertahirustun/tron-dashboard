import { native } from '../native/api'
import { useOfficeStore } from '../store/useOfficeStore'

const humanSize = (b: number) => (b < 1024 ? `${b} B` : b < 1024 ** 2 ? `${(b / 1024).toFixed(1)} KB` : `${(b / 1024 ** 2).toFixed(1)} MB`)

/** First few meaningful lines of a file, for the terminal log. */
function snippet(content: string, lines = 5) {
  return content
    .split('\n')
    .map((l) => l.trimEnd())
    .filter((l) => l.trim() && !/^---\s*$/.test(l))
    .slice(0, lines)
    .map((l) => (l.length > 110 ? `${l.slice(0, 110)}…` : l))
}

/** Read a workspace file through the desktop bridge and log its first lines. */
export async function readFileToLog(path: string, name = path.split('/').pop() ?? path) {
  const { addTerminalLog } = useOfficeStore.getState()
  if (!native) {
    addTerminalLog(`[LOG] Opened file: ${name}`, { source: 'explorer' })
    return
  }
  try {
    const file = await native.readFile(path)
    if (file.binary) {
      addTerminalLog(`[LOG] ${name} is a binary file (${humanSize(file.size)})`, { source: 'fs', level: 'warn' })
      return
    }
    const lines = snippet(file.content)
    const count = file.content.split('\n').length
    addTerminalLog(`[LOG] Read ${name} (${humanSize(file.size)}, ${count}${file.truncated ? '+' : ''} lines)`, { source: 'fs', level: 'ok' })
    for (const l of lines) addTerminalLog(`  │ ${l}`, { source: 'fs' })
    if (!lines.length) addTerminalLog('  │ (empty file)', { source: 'fs' })
  } catch (e) {
    const msg = (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
    addTerminalLog(`[ERR] ${name}: ${msg}`, { source: 'fs', level: 'error' })
  }
}

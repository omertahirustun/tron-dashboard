import { sfx } from '../../lib/sfx'
import { native } from '../../native/api'
import { readFileToLog } from '../../services/files'
import { useOfficeStore } from '../../store/useOfficeStore'
import type { TronNodeType } from './graph'

/** What clicking a topology node does, in either view (flow graph or globe). */
export function openNode(node: TronNodeType) {
  const { addTerminalLog, setActiveAgent, selectFile, workspaceRoots, setActiveRoot } = useOfficeStore.getState()
  sfx.emit('select', { source: 'topology.node', node: node.id })
  if (node.data.kind === 'hub') {
    addTerminalLog(`[LOG] ${node.data.role.replace(' loaded', '')} skills loaded in Claude Code`, { source: 'topology' })
    return
  }
  if (node.data.kind === 'skill') {
    const { name, description, used } = node.data
    addTerminalLog(`[SKILL] ${name}${used ? ' (used this session)' : ''}`, { source: 'topology', level: 'ok' })
    if (description) addTerminalLog(`  │ ${description.length > 160 ? `${description.slice(0, 160)}…` : description}`, { source: 'topology' })
    return
  }
  if (node.data.kind === 'agent') {
    setActiveAgent(node.id)
    addTerminalLog(`[LOG] Linked to agent: ${node.data.label}${node.data.role ? ` (${node.data.role})` : ''}`, { source: 'topology', level: 'ok' })
    return
  }
  const { path, label } = node.data
  if (!path) {
    addTerminalLog(`[PKG] ${label}: external package, imported by ${node.data.kind === 'code' ? node.data.degree : 0} files`, { source: 'topology' })
    return
  }
  addTerminalLog(`[LOG] Accessed ${path.endsWith('.md') ? 'note' : 'file'}: ${label}`, { source: 'topology' })
  selectFile(path)
  if (!native) return
  // the most specific root (a project folder before ~ and /)
  const root = workspaceRoots.filter((r) => path.startsWith(r.path === '/' ? '/' : r.path + '/')).sort((a, b) => b.path.length - a.path.length)[0]
  if (root) setActiveRoot(root.path)
  void readFileToLog(path, label)
}

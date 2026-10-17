import { create } from 'zustand'
import { native, type ClaudeStats, type PermissionRequest, type ProbeResult, type WorkspaceRoot } from '../native/api'
import { initialMetrics, type SystemMetrics } from '../services/telemetry'

// One store for everything widgets share. Widgets read slices with selectors,
// e.g. `useOfficeStore((s) => s.activeAgent)`, so they only re-render when
// their slice changes.

export type LogLevel = 'info' | 'ok' | 'warn' | 'error'

export interface LogEntry {
  id: number
  time: string
  source: string
  level: LogLevel
  text: string
}

/** Model the chat panel talks to (the API call itself is still simulated). */
export type ChatModel = 'claude-opus-5-5' | 'claude-sonnet-5-5' | 'claude-haiku-5-5' | 'claude-fable-5-1'

export interface ChatMessage {
  id: number
  role: 'user' | 'claude'
  text: string
  /** true while Claude is still producing this message */
  streaming?: boolean
}

/** An agent the chat can address: a topology node (session, subagent or sample agent). */
export interface AgentOption {
  id: string
  label: string
}

const SAMPLE_AGENTS: AgentOption[] = [
  { id: 'Claude_Prime', label: 'Claude_Prime' },
  { id: 'Agent_Beta', label: 'Agent_Beta' },
  { id: 'Haiku_Scout', label: 'Haiku_Scout' },
]

export interface AgentConsoleTarget {
  sessionId: string
  /** PTY pane already known to run it (a just-started agent has no transcript yet) */
  pane?: string | null
  cwd?: string | null
  /** stopped with ■: don't resume it again on its own */
  stopped?: boolean
  /** screen rect the console grows out of (the clicked card) */
  origin?: { x: number; y: number; width: number; height: number } | null
}

interface OfficeState {
  terminalLogs: LogEntry[]
  /** topology node id of the agent the chat talks to */
  activeAgent: string
  activeAgentLabel: string
  agentOptions: AgentOption[]
  systemMetrics: SystemMetrics
  chat: ChatMessage[]
  /** Workspace path selected in the explorer or the topology graph */
  selectedFile: string
  /** Folders shown in the explorer (desktop app); git intel follows `activeRoot` */
  workspaceRoots: WorkspaceRoot[]
  activeRoot: string | null
  /** git repo of the last selected file that is in one (git intel and the code globe follow it) */
  activeRepo: string | null
  /** false when the selected file is not inside any git repo */
  selectedInRepo: boolean
  /** bumped when the root list changes so the explorer reloads */
  workspaceRev: number
  networkStatus: ProbeResult[]
  claudeStats: ClaudeStats | null
  chatModel: ChatModel
  /** permission prompts waiting for an answer, oldest first */
  permissions: PermissionRequest[]
  /** session shown in the agent console overlay (null: closed) */
  agentConsole: AgentConsoleTarget | null

  addTerminalLog: (text: string, opts?: { source?: string; level?: LogLevel }) => void
  clearTerminalLogs: () => void
  updateSystemMetrics: (next: SystemMetrics | ((prev: SystemMetrics) => SystemMetrics)) => void
  setActiveAgent: (id: string) => void
  setAgentOptions: (options: AgentOption[]) => void
  selectFile: (path: string) => void
  setWorkspaceRoots: (roots: WorkspaceRoot[]) => void
  setActiveRoot: (root: string) => void
  setActiveRepo: (repo: string) => void
  reloadWorkspace: () => void
  setNetworkStatus: (results: ProbeResult[]) => void
  setClaudeStats: (stats: ClaudeStats) => void
  setChatModel: (model: ChatModel) => void
  setPermissions: (requests: PermissionRequest[]) => void
  openConsole: (target: AgentConsoleTarget | null) => void
  addChatMessage: (msg: Omit<ChatMessage, 'id'>) => number
  appendToChatMessage: (id: number, delta: string) => void
  finishChatMessage: (id: number) => void
  clearChat: () => void
}

const MAX_LOGS = 300
let logId = 0
let chatId = 0
const stamp = () => new Date().toLocaleTimeString('en-GB', { hour12: false })

export const useOfficeStore = create<OfficeState>()((set, get) => ({
  terminalLogs: [],
  activeAgent: 'Claude_Prime',
  activeAgentLabel: 'Claude_Prime',
  agentOptions: SAMPLE_AGENTS,
  systemMetrics: initialMetrics(),
  chat: [
    {
      id: chatId++,
      role: 'claude',
      text: 'Ready. Switch the input to claude mode (Ctrl+K) to ask me something. `:help` lists dashboard commands.',
    },
  ],
  // the sample path only exists in the browser's sample tree
  selectedFile: native ? '' : 'vault/projects/agent-office.md',
  workspaceRoots: [],
  activeRoot: null,
  activeRepo: null,
  selectedInRepo: true,
  workspaceRev: 0,
  networkStatus: [],
  claudeStats: null,
  chatModel: 'claude-opus-5-5',
  permissions: [],
  agentConsole: null,

  addTerminalLog: (text, { source = 'sys', level = 'info' } = {}) =>
    set((s) => ({
      terminalLogs: [...s.terminalLogs, { id: logId++, time: stamp(), source, level, text }].slice(-MAX_LOGS),
    })),
  clearTerminalLogs: () => set({ terminalLogs: [] }),

  updateSystemMetrics: (next) =>
    set((s) => ({ systemMetrics: typeof next === 'function' ? next(s.systemMetrics) : next })),

  setActiveAgent: (id) =>
    set((s) => ({ activeAgent: id, activeAgentLabel: s.agentOptions.find((a) => a.id === id)?.label ?? id })),
  // keep the current agent while it still exists, else fall back to the first one
  setAgentOptions: (options) =>
    set((s) => {
      const keep = options.find((a) => a.id === s.activeAgent) ?? options[0]
      return { agentOptions: options, activeAgent: keep?.id ?? '', activeAgentLabel: keep?.label ?? '' }
    }),
  selectFile: (path) => {
    set({ selectedFile: path })
    if (!native || !path) return
    void native.repoOf(path).then(
      (repo) => {
        if (get().selectedFile !== path) return // a newer selection won
        set(repo ? { activeRepo: repo, selectedInRepo: true } : { selectedInRepo: false })
      },
      () => {},
    )
  },
  setWorkspaceRoots: (roots) =>
    set((s) => ({
      workspaceRoots: roots,
      activeRoot: s.activeRoot && roots.some((r) => r.path === s.activeRoot) ? s.activeRoot : (roots[0]?.path ?? null),
      activeRepo: s.activeRepo ?? roots.find((r) => r.isGit)?.path ?? null,
    })),
  setActiveRoot: (root) => set({ activeRoot: root }),
  setActiveRepo: (repo) => set({ activeRepo: repo, selectedInRepo: true }),
  reloadWorkspace: () => set((s) => ({ workspaceRev: s.workspaceRev + 1 })),
  setNetworkStatus: (results) => set({ networkStatus: results }),
  setClaudeStats: (stats) => set({ claudeStats: stats }),
  setChatModel: (model) => set({ chatModel: model }),
  setPermissions: (requests) => set({ permissions: requests }),
  openConsole: (target) => set({ agentConsole: target }),

  addChatMessage: (msg) => {
    const id = chatId++
    set((s) => ({ chat: [...s.chat, { ...msg, id }] }))
    return id
  },
  appendToChatMessage: (id, delta) =>
    set((s) => ({ chat: s.chat.map((m) => (m.id === id ? { ...m, text: m.text + delta } : m)) })),
  finishChatMessage: (id) =>
    set((s) => ({ chat: s.chat.map((m) => (m.id === id ? { ...m, streaming: false } : m)) })),
  clearChat: () => set({ chat: [] }),
}))

/** Shorthand for logging from outside React (timers, services). */
export const addTerminalLog: OfficeState['addTerminalLog'] = (text, opts) =>
  useOfficeStore.getState().addTerminalLog(text, opts)

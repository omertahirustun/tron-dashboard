// Types for the desktop bridge exposed by app/preload.cjs. In a plain browser
// (vite dev in Zen, etc.) `native` is null and widgets fall back to mock data.

export interface WorkspaceRoot {
  name: string
  path: string
  isGit: boolean
}

export interface DirEntry {
  name: string
  path: string
  kind: 'dir' | 'file'
}

export interface FileSnippet {
  binary: boolean
  size: number
  content: string
  truncated: boolean
}

export interface GitCommit {
  hash: string
  subject: string
  author: string
  when: string
  merge: boolean
}

export interface GitStatus {
  repo: string
  name: string
  branch: string
  changed: number
  ahead: number | null
  behind: number | null
  commits: GitCommit[]
}

export interface MetricsSample {
  cpu: { model: string; total: number; threads: number[]; tempC: number | null }
  ram: { usedGb: number; totalGb: number }
  vram: { name: string; usedGb: number; totalGb: number; gpuUtil: number; tempC: number } | null
  uptimeSec: number
  at: number
}

export type TaskStatus = 'idle' | 'scheduled' | 'running' | 'done' | 'failed' | 'stopped'

export interface TaskInfo {
  id: string
  name: string
  command: string
  cwd?: string
  longRunning?: boolean
  status: TaskStatus
  startedAt: number | null
  endedAt: number | null
  exitCode: number | null
  /** epoch ms when a scheduled task will start */
  runAt: number | null
  lastLine: string
}

export interface ProbeResult {
  name: string
  kind: 'tcp' | 'http'
  endpoint: string
  at: number
  state: 'up' | 'offline' | 'down'
  ms?: number
  status?: number
  error?: string
}

export interface ClaudeStats {
  session: {
    at: number
    model: string
    label: string
    window: number
    contextTokens: number
    cwd: string | null
    effort: string | null
  } | null
  today: { input: number; output: number; cacheRead: number; cacheWrite: number; costUsd: number; requests: number }
  budgetUsd: number
  models: Array<{ id: string; label: string; window: number; input: number; output: number }>
}

type Unsubscribe = () => void

export interface NativeApi {
  isNative: true
  getWorkspaceRoots(): Promise<WorkspaceRoot[]>
  addWorkspaceRoot(path: string): Promise<string>
  readDir(path: string): Promise<{ entries: DirEntry[]; truncated: boolean }>
  readFile(path: string): Promise<FileSnippet>

  startShell(cols: number, rows: number): Promise<{ shell: string; backlog: string; restarted: boolean }>
  writeShell(data: string): void
  resizeShell(cols: number, rows: number): void
  executeCommand(command: string): void
  onShellData(cb: (data: string) => void): Unsubscribe
  onShellExit(cb: (info: { code: number | null }) => void): Unsubscribe

  getGitStatus(repo: string): Promise<GitStatus>
  watchGit(repo: string): Promise<void>
  onGitChange(cb: (repo: string) => void): Unsubscribe

  getSystemMetrics(): Promise<MetricsSample>
  onSystemMetrics(cb: (sample: MetricsSample) => void): Unsubscribe

  listTasks(): Promise<TaskInfo[]>
  startTask(id: string): Promise<TaskInfo[]>
  stopTask(id: string): Promise<TaskInfo[]>
  scheduleTask(id: string, delaySec: number): Promise<TaskInfo[]>
  getTaskOutput(id: string): Promise<string[]>
  onTasks(cb: (tasks: TaskInfo[]) => void): Unsubscribe
  onTaskOutput(cb: (e: { id: string; line: string }) => void): Unsubscribe

  getNetworkStatus(): Promise<ProbeResult[]>
  refreshNetwork(): Promise<void>
  onNetwork(cb: (results: ProbeResult[]) => void): Unsubscribe

  getClaudeStats(): Promise<ClaudeStats>
  setDailyBudget(usd: number): Promise<ClaudeStats>
  onClaudeStats(cb: (stats: ClaudeStats) => void): Unsubscribe
}

declare global {
  interface Window {
    api?: NativeApi
  }
}

export const native: NativeApi | null = typeof window !== 'undefined' && window.api?.isNative ? window.api : null

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
  /** web page of the origin remote, e.g. https://github.com/user/repo */
  remote: string | null
}

export interface FileDiff {
  repo: string | null
  /** path inside the repo */
  rel: string
  state: 'modified' | 'clean' | 'untracked' | 'no-repo'
  diff: string
}

export interface CodeGraph {
  repo: string
  name: string
  /** graphify's export when the repo has one, else our own import scan */
  source: 'graphify' | 'imports'
  truncated: boolean
  /** the graphify CLI is installed, so the repo can be (re)mapped with it */
  graphify: boolean
  nodes: Array<{
    id: string
    label: string
    path: string | null
    group: string
    /** graphify: node type and source location, e.g. "code · src/a.ts:12" */
    detail?: string
    /** graphify: the node for a whole file (the others are its symbols) */
    isFile?: boolean
  }>
  edges: Array<[string, string]>
}

export interface MetricsSample {
  cpu: { model: string; total: number; threads: number[]; tempC: number | null }
  ram: { usedGb: number; totalGb: number }
  vram: { name: string; usedGb: number; totalGb: number; gpuUtil: number; tempC: number } | null
  /** root file system; null when it cannot be read */
  disk: { mount: string; usedGb: number; totalGb: number } | null
  uptimeSec: number
  at: number
}

export interface MusicState {
  /** the player bar has rendered */
  ready: boolean
  title: string
  artist: string
  album: string
  art: string
  playing: boolean
  current: number
  duration: number
  volume: number
  /** an ad is playing (no Premium) */
  ad: boolean
  signedIn: boolean
  visible: boolean
  at: number
}

export interface MusicPlaylist {
  id: string
  title: string
  sub: string
  art: string
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
  /** plan usage windows from claude.ai (null until the first reading) */
  limits: {
    fiveHour?: { pct: number; resetsAt: number | null } | null
    sevenDay?: { pct: number; resetsAt: number | null } | null
    at?: number
    error?: string
  } | null
  models: Array<{ id: string; label: string; window: number; input: number; output: number }>
}

/** What a session or subagent is doing right now, from its transcript. */
export interface AgentActivity {
  /** thinking / tool: working · waiting: turn ended, the user's move (a subagent: done) · idle: no activity for 10 min */
  state: 'thinking' | 'tool' | 'waiting' | 'idle'
  /** the running tool while `tool`, otherwise the last one */
  tool: string | null
  /** file name, command description, pattern… of that tool call */
  target: string | null
  /** start of the current turn */
  since: number
}

export interface LiveSession {
  id: string
  title: string
  project: string | null
  cwd: string | null
  branch: string | null
  model: string | null
  lastAt: number
  startedAt: number
  live: boolean
  /** latest user prompt, clipped */
  prompt: string | null
  activity: AgentActivity
  /** dashboard PTY pane running this session's claude, while it runs */
  pane: string | null
  /** where its claude process runs: a dashboard PTY, another terminal, or not running */
  host: 'dashboard' | 'terminal' | null
  files: Array<{ path: string; op: 'read' | 'edit' | 'write'; at: number }>
  subagents: Array<{
    id: string
    description: string
    agentType: string
    model: string | null
    lastAt: number
    live: boolean
    activity: AgentActivity | null
  }>
  skillsUsed: Array<{ name: string; at: number; live: boolean }>
}

export interface SkillInfo {
  /** full name as Claude Code lists it, e.g. "frontend-design:frontend-design" */
  name: string
  /** plugin or group before the colon, or "built-in" */
  source: string
  short: string
  description: string
}

export interface SessionsSnapshot {
  sessions: LiveSession[]
  skills: SkillInfo[]
}

export interface TranscriptLine {
  kind: 'user' | 'text' | 'tool' | 'result'
  text: string
  at: number
}

/** A Claude Code permission prompt waiting for an answer (PermissionRequest hook). */
export interface PermissionRequest {
  id: string
  sessionId: string
  cwd: string | null
  project: string | null
  tool: string
  /** the command, file, URL… */
  detail: string
  description: string | null
  /** rule(s) "always allow" would add, if Claude Code suggested any */
  always: string | null
  at: number
}

export interface PermissionHookStatus {
  installed: boolean
  listening: boolean
  error: string | null
  port: number
}

type Unsubscribe = () => void

export interface NativeApi {
  isNative: true
  getWorkspaceRoots(): Promise<WorkspaceRoot[]>
  addWorkspaceRoot(path: string): Promise<string>
  readDir(path: string): Promise<{ entries: DirEntry[]; truncated: boolean }>
  readFile(path: string): Promise<FileSnippet>

  /** start (or reattach to) the shell of terminal pane `id` */
  startShell(id: string, cols: number, rows: number): Promise<{ shell: string; backlog: string; restarted: boolean }>
  writeShell(id: string, data: string): void
  resizeShell(id: string, cols: number, rows: number): void
  killShell(id: string): void
  onShellData(cb: (e: { id: string; data: string }) => void): Unsubscribe
  onShellExit(cb: (e: { id: string; code: number | null }) => void): Unsubscribe
  openTerminalWindow(): Promise<void>

  getGitStatus(repo: string): Promise<GitStatus>
  watchGit(repo: string): Promise<void>
  onGitChange(cb: (repo: string) => void): Unsubscribe
  /** top folder of the git repo containing a file or folder, or null */
  repoOf(path: string): Promise<string | null>
  getFileDiff(file: string): Promise<FileDiff>
  buildCodeGraph(repo: string): Promise<CodeGraph>
  /** run `graphify update` on the repo (code only, no LLM), then read its graph */
  runGraphify(repo: string): Promise<CodeGraph>
  openPath(path: string): Promise<void>

  getSystemMetrics(): Promise<MetricsSample>
  onSystemMetrics(cb: (sample: MetricsSample) => void): Unsubscribe

  getMusicState(): Promise<MusicState | null>
  /** create the (hidden) YouTube Music window so it starts loading */
  openMusic(): Promise<MusicState | null>
  /** show / hide the YouTube Music window (sign in, browse playlists) */
  showMusicWindow(): Promise<void>
  musicToggle(): Promise<boolean>
  musicNext(): Promise<boolean>
  musicPrevious(): Promise<boolean>
  /** 0..1 of the track */
  musicSeek(fraction: number): Promise<void>
  musicVolume(pct: number): Promise<void>
  /** search YouTube Music and play the top result; false when nothing was found */
  musicSearch(query: string): Promise<boolean>
  /** library playlists of the account signed in to the YouTube Music window */
  getPlaylists(): Promise<{ signedIn: boolean; items: MusicPlaylist[] }>
  /** play a playlist from the start ("LM" = liked music) */
  playPlaylist(id: string): Promise<boolean>
  onMusicState(cb: (state: MusicState) => void): Unsubscribe
  /** ~30 Hz log-spaced band levels (0..255, low → high) while a track plays */
  onMusicSpectrum(cb: (bands: number[]) => void): Unsubscribe

  getNetworkStatus(): Promise<ProbeResult[]>
  refreshNetwork(): Promise<void>
  onNetwork(cb: (results: ProbeResult[]) => void): Unsubscribe

  getClaudeStats(): Promise<ClaudeStats>
  setDailyBudget(usd: number): Promise<ClaudeStats>
  onClaudeStats(cb: (stats: ClaudeStats) => void): Unsubscribe

  getSessions(): Promise<SessionsSnapshot>
  onSessions(cb: (snapshot: SessionsSnapshot) => void): Unsubscribe
  getTranscript(id: string): Promise<{ id: string; log: TranscriptLine[] }>

  /**
   * run claude in a dashboard PTY: `--resume` the session, or a new one in `cwd`;
   * `takeOver` stops the claude that has it open in another terminal first
   */
  startAgent(opts: {
    sessionId?: string
    cwd?: string | null
    cols?: number
    rows?: number
    takeOver?: boolean
  }): Promise<{ sessionId: string; pane: string }>
  stopAgent(sessionId: string): Promise<void>

  getPermissions(): Promise<PermissionRequest[]>
  decidePermission(id: string, decision: 'allow' | 'always' | 'deny', message?: string): Promise<boolean>
  getPermissionHookStatus(): Promise<PermissionHookStatus>
  /** add the dashboard's PermissionRequest hook to ~/.claude/settings.json */
  installPermissionHook(): Promise<PermissionHookStatus>
  onPermissions(cb: (requests: PermissionRequest[]) => void): Unsubscribe
  /** bring the dashboard window to the front (desktop notification clicks) */
  focusWindow(): Promise<void>
}

declare global {
  interface Window {
    api?: NativeApi
  }
}

export const native: NativeApi | null = typeof window !== 'undefined' && window.api?.isNative ? window.api : null

// The only bridge between the page and Node. The page gets `window.api` with
// these functions and nothing else (contextIsolation + sandbox stay on).
const { contextBridge, ipcRenderer } = require('electron')

/** Subscribe to a main → renderer channel; returns an unsubscribe function. */
function listen(channel, callback) {
  const handler = (_event, payload) => callback(payload)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

contextBridge.exposeInMainWorld('api', {
  isNative: true,

  // workspace / file system (read-only; the roots end with ~ and /)
  getWorkspaceRoots: () => ipcRenderer.invoke('workspace:roots'),
  addWorkspaceRoot: (path) => ipcRenderer.invoke('workspace:add-root', path),
  readDir: (path) => ipcRenderer.invoke('workspace:read-dir', path),
  readFile: (path) => ipcRenderer.invoke('workspace:read-file', path),

  // shells, one per terminal pane (id chosen by the page)
  startShell: (id, cols, rows) => ipcRenderer.invoke('pty:start', id, cols, rows),
  writeShell: (id, data) => ipcRenderer.send('pty:write', id, data),
  resizeShell: (id, cols, rows) => ipcRenderer.send('pty:resize', id, cols, rows),
  killShell: (id) => ipcRenderer.send('pty:kill', id),
  onShellData: (cb) => listen('pty:data', cb),
  onShellExit: (cb) => listen('pty:exit', cb),
  openTerminalWindow: () => ipcRenderer.invoke('window:terminal'),

  // git
  getGitStatus: (repo) => ipcRenderer.invoke('git:status', repo),
  watchGit: (repo) => ipcRenderer.invoke('git:watch', repo),
  onGitChange: (cb) => listen('git:changed', cb),
  repoOf: (path) => ipcRenderer.invoke('git:repo-of', path),
  getFileDiff: (file) => ipcRenderer.invoke('git:diff', file),
  buildCodeGraph: (repo) => ipcRenderer.invoke('codegraph:build', repo),
  runGraphify: (repo) => ipcRenderer.invoke('codegraph:graphify', repo),
  openPath: (path) => ipcRenderer.invoke('shell:open-path', path),

  // hardware telemetry
  getSystemMetrics: () => ipcRenderer.invoke('metrics:get'),
  onSystemMetrics: (cb) => listen('metrics:sample', cb),

  // YouTube Music (its own window, driven from the widget)
  getMusicState: () => ipcRenderer.invoke('music:state'),
  openMusic: () => ipcRenderer.invoke('music:open'),
  showMusicWindow: () => ipcRenderer.invoke('music:show'),
  musicToggle: () => ipcRenderer.invoke('music:toggle'),
  musicNext: () => ipcRenderer.invoke('music:next'),
  musicPrevious: () => ipcRenderer.invoke('music:previous'),
  musicSeek: (fraction) => ipcRenderer.invoke('music:seek', fraction),
  musicVolume: (pct) => ipcRenderer.invoke('music:volume', pct),
  musicSearch: (query) => ipcRenderer.invoke('music:search', query),
  getPlaylists: () => ipcRenderer.invoke('music:playlists'),
  playPlaylist: (id) => ipcRenderer.invoke('music:play-playlist', id),
  onMusicState: (cb) => listen('music:state', cb),
  onMusicSpectrum: (cb) => listen('music:spectrum', cb),

  // network / DB latency
  getNetworkStatus: () => ipcRenderer.invoke('network:latest'),
  refreshNetwork: () => ipcRenderer.invoke('network:refresh'),
  onNetwork: (cb) => listen('network:update', cb),

  // Claude usage from Claude Code transcripts
  getClaudeStats: () => ipcRenderer.invoke('claude:stats'),
  setDailyBudget: (usd) => ipcRenderer.invoke('claude:set-budget', usd),
  onClaudeStats: (cb) => listen('claude:stats', cb),

  // live Claude Code sessions, subagents and touched files (topology)
  getSessions: () => ipcRenderer.invoke('sessions:latest'),
  onSessions: (cb) => listen('sessions:update', cb),
  getTranscript: (id) => ipcRenderer.invoke('sessions:transcript', id),

  // claude sessions running in the dashboard's own PTYs
  startAgent: (opts) => ipcRenderer.invoke('agents:start', opts),
  stopAgent: (id) => ipcRenderer.invoke('agents:stop', id),

  // permission prompts from the PermissionRequest hook
  getPermissions: () => ipcRenderer.invoke('permissions:list'),
  decidePermission: (id, decision, message) => ipcRenderer.invoke('permissions:decide', id, decision, message),
  getPermissionHookStatus: () => ipcRenderer.invoke('permissions:status'),
  installPermissionHook: () => ipcRenderer.invoke('permissions:install-hook'),
  onPermissions: (cb) => listen('permissions:update', cb),
  focusWindow: () => ipcRenderer.invoke('window:focus'),
})

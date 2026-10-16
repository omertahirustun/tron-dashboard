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

  // workspace / file system (read-only, limited to workspace roots)
  getWorkspaceRoots: () => ipcRenderer.invoke('workspace:roots'),
  addWorkspaceRoot: (path) => ipcRenderer.invoke('workspace:add-root', path),
  readDir: (path) => ipcRenderer.invoke('workspace:read-dir', path),
  readFile: (path) => ipcRenderer.invoke('workspace:read-file', path),

  // shell (one PTY per app)
  startShell: (cols, rows) => ipcRenderer.invoke('pty:start', cols, rows),
  writeShell: (data) => ipcRenderer.send('pty:write', data),
  resizeShell: (cols, rows) => ipcRenderer.send('pty:resize', cols, rows),
  executeCommand: (command) => ipcRenderer.send('pty:write', `${command}\r`),
  onShellData: (cb) => listen('pty:data', cb),
  onShellExit: (cb) => listen('pty:exit', cb),

  // git
  getGitStatus: (repo) => ipcRenderer.invoke('git:status', repo),
  watchGit: (repo) => ipcRenderer.invoke('git:watch', repo),
  onGitChange: (cb) => listen('git:changed', cb),

  // hardware telemetry
  getSystemMetrics: () => ipcRenderer.invoke('metrics:get'),
  onSystemMetrics: (cb) => listen('metrics:sample', cb),

  // task queue (commands come from settings.json, the page only picks an id)
  listTasks: () => ipcRenderer.invoke('tasks:list'),
  startTask: (id) => ipcRenderer.invoke('tasks:start', id),
  stopTask: (id) => ipcRenderer.invoke('tasks:stop', id),
  scheduleTask: (id, delaySec) => ipcRenderer.invoke('tasks:schedule', id, delaySec),
  getTaskOutput: (id) => ipcRenderer.invoke('tasks:output', id),
  onTasks: (cb) => listen('tasks:update', cb),
  onTaskOutput: (cb) => listen('tasks:output', cb),

  // network / DB latency
  getNetworkStatus: () => ipcRenderer.invoke('network:latest'),
  refreshNetwork: () => ipcRenderer.invoke('network:refresh'),
  onNetwork: (cb) => listen('network:update', cb),

  // Claude usage from Claude Code transcripts
  getClaudeStats: () => ipcRenderer.invoke('claude:stats'),
  setDailyBudget: (usd) => ipcRenderer.invoke('claude:set-budget', usd),
  onClaudeStats: (cb) => listen('claude:stats', cb),
})

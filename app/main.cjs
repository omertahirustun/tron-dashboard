// Agent Office Grid desktop app: opens the built dashboard (dist/) in its own window.
// `--dev` loads the Vite dev server instead, for hot reload while editing.

// Render on the RTX card: PRIME offload + XWayland (the Wayland EGL path falls back to Intel).
// These must be set before the GPU process starts.
process.env.__NV_PRIME_RENDER_OFFLOAD ??= '1'
process.env.__VK_LAYER_NV_optimus ??= 'NVIDIA_only'
process.env.__GLX_VENDOR_LIBRARY_NAME ??= 'nvidia'
const { app, BrowserWindow, ipcMain, Menu, shell } = require('electron')
const path = require('node:path')
const settingsStore = require('./settings.cjs')
const { createWorkspace } = require('./ipc/workspace.cjs')
const { PtySession } = require('./ipc/pty.cjs')
const { createGit } = require('./ipc/git.cjs')
const { createMetricsStream } = require('./ipc/metrics.cjs')
const { createTasks } = require('./ipc/tasks.cjs')
const { createNetworkMonitor } = require('./ipc/network.cjs')
const { createClaudeUsage } = require('./ipc/claude-usage.cjs')
const { createSessions } = require('./ipc/sessions.cjs')

// The Ozone platform can only be picked on the command line: relaunch under XWayland if needed.
if (process.platform === 'linux' && !process.env.AOD_NO_NVIDIA && !process.argv.includes('--ozone-platform=x11')) {
  app.relaunch({ args: [...process.argv.slice(1), '--ozone-platform=x11'] })
  app.exit(0)
}
app.commandLine.appendSwitch('ignore-gpu-blocklist')
app.commandLine.appendSwitch('enable-gpu-rasterization')
app.commandLine.appendSwitch('enable-zero-copy')
app.setName('Agent Office Grid')

const dev = process.argv.includes('--dev')
const devUrl = process.env.AOD_DEV_URL || 'http://localhost:5191'
const indexFile = path.join(__dirname, '..', 'dist', 'index.html')

if (!app.requestSingleInstanceLock()) app.quit()

let win

/** Send to the dashboard window if it is still open. */
function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
}

// Only our own page may call the native API.
function trusted(event) {
  const url = event.senderFrame?.url ?? ''
  return dev ? url.startsWith(devUrl) : url.startsWith('file:')
}

function handle(channel, fn) {
  ipcMain.handle(channel, (event, ...args) => {
    if (!trusted(event)) throw new Error('Untrusted sender')
    return fn(...args)
  })
}

function on(channel, fn) {
  ipcMain.on(channel, (event, ...args) => {
    if (trusted(event)) fn(...args)
  })
}

function registerIpc() {
  const settings = settingsStore.create(app.getPath('userData'))
  const workspace = createWorkspace(settings)
  const git = createGit(settings)
  const pty = new PtySession(send)
  const metrics = createMetricsStream((s) => send('metrics:sample', s))
  const tasks = createTasks(settings, send)
  const network = createNetworkMonitor(settings, send)
  const claude = createClaudeUsage(settings, send)
  const sessions = createSessions(send)

  handle('workspace:roots', () => workspace.roots())
  handle('workspace:add-root', (p) => settings.addRoot(p))
  handle('workspace:read-dir', (p) => workspace.readDir(p))
  handle('workspace:read-file', (p) => workspace.readFile(p))

  handle('pty:start', (cols, rows) => pty.start(cols, rows))
  on('pty:write', (data) => pty.write(data))
  on('pty:resize', (cols, rows) => pty.resize(cols, rows))

  handle('git:status', (repo) => git.status(repo))
  handle('git:watch', (repo) => git.watch(repo, (r) => send('git:changed', r)))

  handle('metrics:get', () => metrics.latest())
  metrics.start()

  handle('tasks:list', () => tasks.list())
  handle('tasks:start', (id) => tasks.start(id))
  handle('tasks:stop', (id) => tasks.stop(id))
  handle('tasks:schedule', (id, delaySec) => tasks.schedule(id, delaySec))
  handle('tasks:output', (id) => tasks.output(id))

  handle('network:latest', () => network.latest())
  handle('network:refresh', () => network.refresh())
  network.start()

  handle('claude:stats', () => claude.stats())
  handle('claude:set-budget', (usd) => {
    const value = Number(usd)
    if (!(value > 0)) throw new Error('Budget must be a positive number')
    settings.set('dailyBudgetUsd', value)
    return claude.stats()
  })
  claude.start()

  handle('sessions:latest', () => sessions.latest())
  sessions.start()

  app.on('before-quit', () => {
    pty.kill()
    git.closeAll()
    metrics.stop()
    tasks.stopAll()
    network.stop()
    claude.stop()
    sessions.stop()
  })
}

app.on('second-instance', () => {
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.focus()
})

app.whenReady().then(() => {
  Menu.setApplicationMenu(null)
  registerIpc()
  win = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 900,
    minHeight: 600,
    title: 'Agent Office Grid',
    icon: path.join(__dirname, 'icon.png'),
    backgroundColor: '#050505',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  })
  win.once('ready-to-show', () => {
    win.maximize()
    win.show()
  })

  // external links go to the system browser, never inside the app window
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    if (dev ? !url.startsWith(devUrl) : !url.startsWith('file:')) e.preventDefault()
  })
  win.webContents.on('before-input-event', (_e, input) => {
    if (input.type !== 'keyDown') return
    if (input.key === 'F11') win.setFullScreen(!win.isFullScreen())
    if (input.key === 'F12' || (input.control && input.shift && input.key === 'I')) win.webContents.toggleDevTools()
    if (input.control && input.key === 'r') win.webContents.reload()
  })

  if (dev) win.loadURL(devUrl)
  else win.loadFile(indexFile)
})

app.on('window-all-closed', () => app.quit())

// kill/Ctrl+C: go through the normal quit so tasks, the shell and monitors are stopped
for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(signal, () => app.quit())

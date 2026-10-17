// Agent Office Grid desktop app: opens the built dashboard (dist/) in its own window.
// `--dev` loads the Vite dev server instead, for hot reload while editing.

// Render on the RTX card: PRIME offload + XWayland (the Wayland EGL path falls back to Intel).
// These must be set before the GPU process starts.
process.env.__NV_PRIME_RENDER_OFFLOAD ??= '1'
process.env.__VK_LAYER_NV_optimus ??= 'NVIDIA_only'
process.env.__GLX_VENDOR_LIBRARY_NAME ??= 'nvidia'
const { app, BrowserWindow, ipcMain, Menu, shell } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const settingsStore = require('./settings.cjs')
const { createWorkspace } = require('./ipc/workspace.cjs')
const { createPtyClient } = require('./ipc/pty-client.cjs')
const { createGit } = require('./ipc/git.cjs')
const { createCodeGraph } = require('./ipc/codegraph.cjs')
const { createMetricsStream } = require('./ipc/metrics.cjs')
const { createNetworkMonitor } = require('./ipc/network.cjs')
const { createClaudeUsage } = require('./ipc/claude-usage.cjs')
const { createSessions } = require('./ipc/sessions.cjs')
const { createAgents } = require('./ipc/agents.cjs')
const { createPermissions } = require('./ipc/permissions.cjs')
const { createMusic, MUSIC_ICON } = require('./ipc/music.cjs')

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
let termWin = null

/** Send to our own windows (dashboard and terminals) that are still open. */
function send(channel, payload) {
  for (const w of [win, termWin]) if (w && !w.isDestroyed()) w.webContents.send(channel, payload)
}

const WEB_PREFS = {
  // notification chimes play without a click first
  autoplayPolicy: 'no-user-gesture-required',
  preload: path.join(__dirname, 'preload.cjs'),
  contextIsolation: true,
  sandbox: true,
  nodeIntegration: false,
}

/** Both windows load the same page; `#terminal` makes it the terminal manager. */
function loadPage(w, hash) {
  if (dev) w.loadURL(hash ? `${devUrl}#${hash}` : devUrl)
  else w.loadFile(indexFile, hash ? { hash } : undefined)
}

function guardNavigation(w) {
  // external links go to the system browser, never inside the app window
  w.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  w.webContents.on('will-navigate', (e, url) => {
    if (dev ? !url.startsWith(devUrl) : !url.startsWith('file:')) e.preventDefault()
  })
  w.webContents.on('before-input-event', (_e, input) => {
    if (input.type !== 'keyDown') return
    if (input.key === 'F11') w.setFullScreen(!w.isFullScreen())
    if (input.key === 'F12' || (input.control && input.shift && input.key === 'I')) w.webContents.toggleDevTools()
    if (input.control && input.key === 'r') w.webContents.reload()
  })
}

/** The terminal window: tiled shells. Opening it again just brings it forward. */
function openTerminalWindow() {
  if (termWin && !termWin.isDestroyed()) {
    if (termWin.isMinimized()) termWin.restore()
    termWin.show()
    termWin.focus()
    return
  }
  termWin = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 480,
    minHeight: 320,
    title: 'Terminals · Agent Office Grid',
    icon: path.join(__dirname, 'icon.png'),
    backgroundColor: '#050505',
    autoHideMenuBar: true,
    show: false,
    webPreferences: WEB_PREFS,
  })
  termWin.once('ready-to-show', () => termWin.show())
  termWin.on('closed', () => {
    termWin = null
  })
  guardNavigation(termWin)
  loadPage(termWin, 'terminal')
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
  const git = createGit()
  const codeGraph = createCodeGraph(git)
  // terminals live in the background PTY host and survive the app
  const pty = createPtyClient(send)
  void pty.connect().catch((e) => console.error('[pty]', e.message))
  const metrics = createMetricsStream((s) => send('metrics:sample', s))
  const network = createNetworkMonitor(settings, send)
  const claude = createClaudeUsage(settings, send)
  const agents = createAgents(pty)
  const sessions = createSessions(send, { paneOf: agents.paneOf })
  // a prompt while the dashboard is in the background makes the taskbar entry flash
  const permissions = createPermissions(send, {
    onRequest: () => win && !win.isDestroyed() && !win.isFocused() && win.flashFrame(true),
  })
  const music = createMusic(send, { icon: MUSIC_ICON })

  handle('workspace:roots', () => workspace.roots())
  handle('workspace:add-root', (p) => settings.addRoot(p))
  handle('workspace:read-dir', (p) => workspace.readDir(p))
  handle('workspace:read-file', (p) => workspace.readFile(p))

  handle('pty:start', (id, cols, rows) => pty.start(id, cols, rows))
  on('pty:write', (id, data) => pty.write(id, data))
  on('pty:resize', (id, cols, rows) => pty.resize(id, cols, rows))
  on('pty:kill', (id) => pty.kill(id))
  handle('window:terminal', () => openTerminalWindow())
  handle('window:focus', () => {
    if (!win || win.isDestroyed()) return
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  })

  handle('git:status', (repo) => git.status(repo))
  handle('git:watch', (repo) => git.watch(repo, (r) => send('git:changed', r)))
  handle('git:repo-of', (p) => git.repoOf(p))
  handle('git:diff', (file) => git.diff(file))
  handle('codegraph:build', (repo) => codeGraph.build(repo))
  handle('codegraph:graphify', (repo) => codeGraph.runGraphify(repo))
  // open a file in its default app (editor, viewer); only existing local paths
  handle('shell:open-path', async (p) => {
    const abs = path.resolve(String(p))
    await fs.promises.access(abs)
    const err = await shell.openPath(abs)
    if (err) throw new Error(err)
  })

  handle('metrics:get', () => metrics.latest())
  metrics.start()

  handle('music:state', () => music.state())
  handle('music:open', () => music.open())
  handle('music:show', () => music.show())
  handle('music:toggle', () => music.toggle())
  handle('music:next', () => music.next())
  handle('music:previous', () => music.previous())
  handle('music:seek', (fraction) => music.seek(fraction))
  handle('music:volume', (pct) => music.volume(pct))
  handle('music:search', (query) => music.search(query))
  handle('music:playlists', () => music.playlists())
  handle('music:play-playlist', (id) => music.playPlaylist(id))

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
  handle('sessions:transcript', (id) => sessions.transcript(String(id)))
  sessions.start()

  handle('agents:start', async (opts) => {
    const r = await agents.start(opts ?? {})
    sessions.rescan()
    return r
  })
  handle('agents:stop', (id) => {
    agents.stop(String(id))
    sessions.rescan()
  })

  handle('permissions:list', () => permissions.list())
  handle('permissions:decide', (id, decision, message) => permissions.decide(id, decision, message))
  handle('permissions:status', () => permissions.status())
  handle('permissions:install-hook', () => permissions.installHook())
  permissions.start()

  app.on('before-quit', () => {
    pty.detach()
    music.stop()
    git.closeAll()
    metrics.stop()
    network.stop()
    claude.stop()
    sessions.stop()
    permissions.stop()
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
    webPreferences: WEB_PREFS,
  })
  win.once('ready-to-show', () => {
    win.maximize()
    win.show()
  })
  win.on('focus', () => win.flashFrame(false))
  // closing the dashboard ends the app, terminals and music included
  win.on('closed', () => app.quit())
  guardNavigation(win)
  loadPage(win)
})

app.on('window-all-closed', () => app.quit())

// kill/Ctrl+C: go through the normal quit so tasks, the shell and monitors are stopped
for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(signal, () => app.quit())

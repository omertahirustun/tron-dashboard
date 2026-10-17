// The app's side of the PTY host (pty-host.cjs): same interface the old
// in-process PtyManager had (start / write / resize / kill / alive), but the
// terminals live in the host, so they keep running when the app closes. The
// host is started detached on first use and re-attached to on the next start.
const { spawn } = require('node:child_process')
const net = require('node:net')
const path = require('node:path')
const { SOCKET, VERSION } = require('./pty-socket.cjs')

const HOST = path.join(__dirname, '..', 'pty-host.cjs')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Chromium leaves many of its descriptors inheritable (the devtools socket,
// GPU cache, pipes); the long-lived host and every shell under it would keep
// them open, so the host starts through a tiny launcher that closes them first.
const CLEAN_EXEC = 'import os,sys; os.closerange(3, os.sysconf("SC_OPEN_MAX")); os.execv(sys.argv[1], sys.argv[1:])'

function spawnHost() {
  // Electron's binary runs as plain node with ELECTRON_RUN_AS_NODE; its own
  // session (detached) so the app's process group going away doesn't take it along
  const child = spawn('python3', ['-c', CLEAN_EXEC, process.execPath, HOST], {
    detached: true,
    stdio: 'ignore',
    cwd: require('node:os').homedir(),
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  })
  child.unref()
}

function createPtyClient(send) {
  let sock = null
  let connecting = null
  let seq = 0
  const replies = new Map() // req -> { resolve, reject }
  /** ids of terminals whose process runs (mirrors the host, for sync checks) */
  const alive = new Set()
  let closing = false

  function onMessage(msg) {
    if (msg.t === 'hello') {
      alive.clear()
      for (const id of msg.alive) alive.add(id)
      if (msg.version !== VERSION) console.warn(`[pty] host protocol ${msg.version}, app ${VERSION}`)
    } else if (msg.t === 'data') send('pty:data', { id: msg.id, data: msg.data })
    else if (msg.t === 'exit') {
      alive.delete(msg.id)
      send('pty:exit', { id: msg.id, code: msg.code })
    } else if (msg.t === 'reply') {
      const r = replies.get(msg.req)
      replies.delete(msg.req)
      if (msg.error) r?.reject(new Error(msg.error))
      else r?.resolve(msg.result)
    }
  }

  function attach(s) {
    return new Promise((resolve, reject) => {
      let buf = ''
      let greeted = false
      s.setEncoding('utf8')
      s.on('data', (chunk) => {
        buf += chunk
        let nl
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl)
          buf = buf.slice(nl + 1)
          let msg
          try {
            msg = JSON.parse(line)
          } catch {
            continue
          }
          onMessage(msg)
          if (msg.t === 'hello' && !greeted) {
            greeted = true
            resolve(s)
          }
        }
      })
      s.on('error', reject)
      s.on('close', () => {
        if (sock === s) sock = null
        for (const r of replies.values()) r.reject(new Error('PTY host connection lost'))
        replies.clear()
        if (!greeted) reject(new Error('PTY host closed'))
        // the host went away (killed, crashed): come back with a new one
        else if (!closing) setTimeout(() => void connect().catch(() => {}), 500)
      })
    })
  }

  const tryConnect = () =>
    new Promise((resolve, reject) => {
      const s = net.connect(SOCKET)
      s.once('connect', () => attach(s).then(resolve, reject))
      s.once('error', reject)
    })

  function connect() {
    if (sock) return Promise.resolve(sock)
    connecting ??= (async () => {
      try {
        let s
        try {
          s = await tryConnect()
        } catch {
          spawnHost()
          for (let i = 0; ; i++) {
            await sleep(100)
            try {
              s = await tryConnect()
              break
            } catch (e) {
              if (i > 50) throw new Error(`PTY host did not start: ${e.message}`)
            }
          }
        }
        sock = s
        return s
      } finally {
        connecting = null
      }
    })()
    return connecting
  }

  const post = (msg) => void connect().then((s) => s.write(`${JSON.stringify(msg)}\n`), () => {})

  return {
    connect,
    async start(id, cols, rows, spec, width, height) {
      const s = await connect()
      const req = ++seq
      const result = await new Promise((resolve, reject) => {
        replies.set(req, { resolve, reject })
        s.write(`${JSON.stringify({ t: 'start', req, id: String(id), cols, rows, spec, width, height })}\n`)
      })
      alive.add(String(id))
      return result
    },
    alive: (id) => alive.has(String(id)),
    write: (id, data) => post({ t: 'write', id: String(id), data }),
    resize: (id, cols, rows, width, height) => post({ t: 'resize', id: String(id), cols, rows, width, height }),
    kill(id) {
      alive.delete(String(id))
      post({ t: 'kill', id: String(id) })
    },
    /** the app is quitting: just hang up, the terminals stay */
    detach() {
      closing = true
      sock?.end()
    },
  }
}

module.exports = { createPtyClient }

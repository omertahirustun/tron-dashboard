// PTY host: a small background process that owns every terminal (shells and
// claude agents) so they outlive the app. The app starts it detached on first
// use and talks to it over a unix socket; closing, crashing or restarting the
// app only drops the connection, and the next start re-attaches (with each
// terminal's backlog). It quits on its own once it has no terminals and no
// app connected for a while.
//
// Protocol: newline-delimited JSON.
//   app → host: { t: start, req, id, cols, rows, spec? } | { t: write, id, data }
//               | { t: resize, id, cols, rows, width?, height? } | { t: kill, id }
//   host → app: { t: hello, version, alive: [id] } | { t: reply, req, result | error }
//               | { t: data, id, data } | { t: exit, id, code }

// run as plain node (ELECTRON_RUN_AS_NODE); the shells must not inherit that
delete process.env.ELECTRON_RUN_AS_NODE

const fs = require('node:fs')
const net = require('node:net')
const { PtyManager } = require('./ipc/pty.cjs')
const { SOCKET, VERSION } = require('./ipc/pty-socket.cjs')

const IDLE_EXIT_MS = 10 * 60 * 1000

const clients = new Set()
const broadcast = (msg) => {
  const line = `${JSON.stringify(msg)}\n`
  for (const c of clients) c.write(line)
}
const pty = new PtyManager((channel, payload) => {
  if (channel === 'pty:data') broadcast({ t: 'data', ...payload })
  else if (channel === 'pty:exit') broadcast({ t: 'exit', ...payload })
})

let idleTimer = null
function checkIdle() {
  clearTimeout(idleTimer)
  if (clients.size || pty.liveIds().length) return
  idleTimer = setTimeout(() => {
    if (!clients.size && !pty.liveIds().length) process.exit(0)
  }, IDLE_EXIT_MS)
}

function handle(client, msg) {
  switch (msg.t) {
    case 'start': {
      let reply
      try {
        reply = { t: 'reply', req: msg.req, result: pty.start(msg.id, msg.cols, msg.rows, msg.spec ?? undefined, msg.width, msg.height) }
      } catch (e) {
        reply = { t: 'reply', req: msg.req, error: e.message }
      }
      client.write(`${JSON.stringify(reply)}\n`)
      break
    }
    case 'write':
      pty.write(msg.id, msg.data)
      break
    case 'resize':
      pty.resize(msg.id, msg.cols, msg.rows, msg.width, msg.height)
      break
    case 'kill':
      pty.kill(msg.id)
      checkIdle()
      break
  }
}

function serve() {
  const server = net.createServer((client) => {
    clients.add(client)
    clearTimeout(idleTimer)
    client.setEncoding('utf8')
    client.write(`${JSON.stringify({ t: 'hello', version: VERSION, pid: process.pid, alive: pty.liveIds() })}\n`)
    let buf = ''
    client.on('data', (chunk) => {
      buf += chunk
      let nl
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl)
        buf = buf.slice(nl + 1)
        try {
          handle(client, JSON.parse(line))
        } catch {
          /* bad line */
        }
      }
    })
    const drop = () => {
      clients.delete(client)
      checkIdle()
    }
    client.on('close', drop)
    client.on('error', drop)
  })
  server.listen(SOCKET, () => {
    fs.chmodSync(SOCKET, 0o600)
    process.on('exit', () => {
      try {
        fs.unlinkSync(SOCKET)
      } catch {
        /* already gone */
      }
    })
  })
  checkIdle()
}

// one host per user: a live socket means another host already runs
const probe = net.connect(SOCKET)
probe.on('connect', () => process.exit(0))
probe.on('error', () => {
  try {
    fs.unlinkSync(SOCKET) // stale socket of a host that died
  } catch {
    /* none */
  }
  serve()
})

// the app's quit signals don't reach us (own session), but a logout's SIGHUP/TERM do
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => {
  pty.killAll()
  process.exit(0)
})
process.on('SIGHUP', () => {}) // the terminal we were started from going away is not our problem

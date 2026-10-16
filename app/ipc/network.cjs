// Latency probes for the services in settings.networkTargets.
//   tcp:  time to open a TCP connection (PostgreSQL)
//   http: time to the first response, any status counts as reachable
const net = require('node:net')

const TIMEOUT_MS = 4000

function probeTcp({ host, port }) {
  return new Promise((resolve) => {
    const t0 = performance.now()
    const socket = net.connect({ host, port })
    const done = (result) => {
      socket.destroy()
      resolve(result)
    }
    socket.setTimeout(TIMEOUT_MS, () => done({ state: 'down', error: 'timeout' }))
    socket.once('connect', () => done({ state: 'up', ms: performance.now() - t0 }))
    socket.once('error', (err) =>
      // nothing listening is "offline", not an error worth shouting about
      done(err.code === 'ECONNREFUSED' ? { state: 'offline', error: 'not running' } : { state: 'down', error: err.code ?? err.message }),
    )
  })
}

async function probeHttp({ url }) {
  const t0 = performance.now()
  try {
    const res = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'manual' })
    return { state: 'up', ms: performance.now() - t0, status: res.status }
  } catch (err) {
    const code = err.cause?.code
    if (code === 'ECONNREFUSED') return { state: 'offline', error: 'not running' }
    return { state: 'down', error: err.name === 'TimeoutError' ? 'timeout' : (code ?? err.message) }
  }
}

function createNetworkMonitor(settings, emit, intervalMs = 10000) {
  let timer = null
  let last = []
  const run = async () => {
    const targets = settings.get().networkTargets
    last = await Promise.all(
      targets.map(async (t) => ({
        name: t.name,
        kind: t.kind,
        endpoint: t.kind === 'tcp' ? `${t.host}:${t.port}` : t.url,
        at: Date.now(),
        ...(t.kind === 'tcp' ? await probeTcp(t) : await probeHttp(t)),
      })),
    )
    emit('network:update', last)
  }
  return {
    start() {
      if (timer) return
      void run()
      timer = setInterval(run, intervalMs)
    },
    stop() {
      clearInterval(timer)
      timer = null
    },
    latest: () => last,
    refresh: run,
  }
}

module.exports = { createNetworkMonitor }

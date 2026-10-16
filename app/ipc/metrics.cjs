// Real hardware telemetry: per-thread CPU load from os.cpus() deltas, memory and
// CPU temperature from systeminformation, GPU/VRAM from a long-lived nvidia-smi.
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const si = require('systeminformation')

let prevCpus = os.cpus()

function cpuLoad() {
  const now = os.cpus()
  const threads = now.map((cpu, i) => {
    const prev = prevCpus[i]?.times ?? cpu.times
    const total = Object.values(cpu.times).reduce((a, b) => a + b, 0) - Object.values(prev).reduce((a, b) => a + b, 0)
    const idle = cpu.times.idle - prev.idle
    return total > 0 ? Math.max(0, Math.min(100, (1 - idle / total) * 100)) : 0
  })
  prevCpus = now
  return { total: threads.reduce((a, b) => a + b, 0) / (threads.length || 1), threads }
}

// One long-lived nvidia-smi in its own loop mode (-lms) instead of spawning a
// new process every sample. It prints a CSV line per interval; we keep the last.
const GPU_QUERY = '--query-gpu=name,memory.used,memory.total,utilization.gpu,temperature.gpu'
let gpuProc = null
let gpuLatest = null
let gpuRestart = null
let gpuMissing = false
const HAS_SETPRIV = ['/usr/bin/setpriv', '/bin/setpriv'].some((p) => fs.existsSync(p))

function parseGpuLine(line) {
  const [name, used, total, util, temp] = line.split(',').map((s) => s.trim())
  if (!name || Number.isNaN(Number(total))) return null
  return { name, usedGb: Number(used) / 1024, totalGb: Number(total) / 1024, gpuUtil: Number(util), tempC: Number(temp) }
}

function startGpuMonitor(intervalMs) {
  if (gpuProc || gpuMissing) return
  const args = [GPU_QUERY, '--format=csv,noheader,nounits', '-lms', String(intervalMs)]
  // setpriv --pdeathsig: the kernel stops nvidia-smi if the app dies without cleanup
  const proc = HAS_SETPRIV
    ? spawn('setpriv', ['--pdeathsig', 'TERM', '--', 'nvidia-smi', ...args], { stdio: ['ignore', 'pipe', 'ignore'] })
    : spawn('nvidia-smi', args, { stdio: ['ignore', 'pipe', 'ignore'] })
  gpuProc = proc
  let buf = ''
  proc.stdout.on('data', (chunk) => {
    buf += chunk
    const lines = buf.split('\n')
    buf = lines.pop()
    for (const line of lines) gpuLatest = parseGpuLine(line) ?? gpuLatest
  })
  proc.on('error', (err) => {
    // no nvidia-smi on this machine: stop trying, VRAM shows as unavailable
    if (err.code === 'ENOENT') gpuMissing = true
  })
  proc.on('exit', () => {
    if (gpuProc !== proc) return
    gpuProc = null
    gpuLatest = null
    if (!gpuMissing) gpuRestart = setTimeout(() => startGpuMonitor(intervalMs), 5000)
  })
}

function stopGpuMonitor() {
  clearTimeout(gpuRestart)
  const proc = gpuProc
  gpuProc = null
  proc?.kill()
}

async function sample() {
  const [mem, temp] = await Promise.all([si.mem(), si.cpuTemperature().catch(() => null)])
  const gpu = gpuLatest
  const cpu = cpuLoad()
  const GB = 1024 ** 3
  return {
    cpu: {
      model: os.cpus()[0]?.model.replace(/\s+/g, ' ').trim() ?? 'CPU',
      total: cpu.total,
      threads: cpu.threads,
      tempC: temp?.main ?? null,
    },
    // "available" counts reclaimable cache as free, like `free -h`
    ram: { usedGb: (mem.total - mem.available) / GB, totalGb: mem.total / GB },
    vram: gpu,
    uptimeSec: os.uptime(),
    at: Date.now(),
  }
}

/** Calls onSample every intervalMs while started; latest() serves one-off reads. */
function createMetricsStream(onSample, intervalMs = 2000) {
  let timer = null
  let busy = false
  let last = null
  const tick = async () => {
    if (busy) return
    busy = true
    try {
      last = await sample()
      onSample(last)
    } catch (err) {
      console.error('[metrics]', err)
    } finally {
      busy = false
    }
  }
  return {
    start() {
      if (timer) return
      // CPU load is a delta between two readings: take the baseline now and
      // the first sample one interval later, otherwise it reads as noise
      prevCpus = os.cpus()
      startGpuMonitor(intervalMs)
      timer = setInterval(tick, intervalMs)
    },
    stop() {
      clearInterval(timer)
      timer = null
      stopGpuMonitor()
    },
    async latest() {
      if (!last) await new Promise((r) => setTimeout(r, intervalMs + 200))
      return last
    },
  }
}

module.exports = { createMetricsStream }

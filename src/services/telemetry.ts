import type { MetricsSample } from '../native/api'

// Hardware telemetry. In the desktop app real samples come from the main
// process (app/ipc/metrics.cjs) through `applySample`; in a plain browser
// `nextMetrics` simulates them.

export interface SystemMetrics {
  source: 'live' | 'simulated'
  cpu: { model: string; total: number; threads: number[]; tempC: number | null }
  ram: { usedGb: number; totalGb: number }
  /** null when no NVIDIA GPU / nvidia-smi is available */
  vram: { name: string; usedGb: number; totalGb: number; gpuUtil: number; tempC: number } | null
  disk: { mount: string; usedGb: number; totalGb: number } | null
  uptimeSec: number
  history: { cpu: number[]; ram: number[]; vram: number[] }
}

// only used by the simulation
const SIM = { cpu: 'i7-12700H', threads: 20, ramGb: 32, gpu: 'RTX 4060 Laptop', vramGb: 8 }

export type LoadLevel = 'normal' | 'heavy' | 'critical'

/** <70 normal, 70–90 heavy, >90 critical */
export function loadLevel(pct: number): LoadLevel {
  if (pct > 90) return 'critical'
  if (pct >= 70) return 'heavy'
  return 'normal'
}

const HISTORY = 40
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const jitter = (amount: number) => (Math.random() - 0.5) * amount

// Each metric eases toward a target that jumps every few ticks, so the bars
// visibly travel through normal, heavy and critical ranges.
const targets = { cpu: 30, ram: 60, vram: 40 }
function retarget() {
  if (Math.random() < 0.3) targets.cpu = 10 + Math.random() * 88
  if (Math.random() < 0.15) targets.ram = 45 + Math.random() * 52
  if (Math.random() < 0.25) targets.vram = 15 + Math.random() * 82
}
const ease = (from: number, to: number) => from + (to - from) * 0.45

const push = (arr: number[], v: number) => [...arr, v].slice(-HISTORY)

export function initialMetrics(): SystemMetrics {
  return {
    source: 'simulated',
    cpu: { model: SIM.cpu, total: 24, threads: Array.from({ length: SIM.threads }, () => 10 + Math.random() * 30), tempC: 58 },
    ram: { usedGb: 9.4, totalGb: SIM.ramGb },
    vram: { name: SIM.gpu, usedGb: 3.1, totalGb: SIM.vramGb, gpuUtil: 18, tempC: 46 },
    disk: { mount: '/', usedGb: 544, totalGb: 754 },
    uptimeSec: 0,
    history: { cpu: [], ram: [], vram: [] },
  }
}

/** Fold a real sample from the desktop bridge into the store shape. */
export function applySample(prev: SystemMetrics, s: MetricsSample): SystemMetrics {
  const vramPct = s.vram ? (s.vram.usedGb / s.vram.totalGb) * 100 : null
  // drop simulated history when the first live sample arrives
  const h = prev.source === 'live' ? prev.history : { cpu: [], ram: [], vram: [] }
  return {
    source: 'live',
    cpu: { model: shortCpuName(s.cpu.model), total: s.cpu.total, threads: s.cpu.threads, tempC: s.cpu.tempC },
    ram: s.ram,
    vram: s.vram ? { ...s.vram, name: s.vram.name.replace(/^NVIDIA GeForce /, '') } : null,
    disk: s.disk,
    uptimeSec: s.uptimeSec,
    history: {
      cpu: push(h.cpu, s.cpu.total),
      ram: push(h.ram, (s.ram.usedGb / s.ram.totalGb) * 100),
      vram: vramPct === null ? h.vram : push(h.vram, vramPct),
    },
  }
}

/** "12th Gen Intel(R) Core(TM) i7-12700H" → "i7-12700H" */
function shortCpuName(model: string) {
  return model.match(/\b(i[3579]-\w+|Ryzen \d \w+|M\d\w*)\b/)?.[0] ?? model
}

export function nextMetrics(m: SystemMetrics): SystemMetrics {
  retarget()
  const cpuTotal = clamp(ease(m.cpu.total, targets.cpu) + jitter(6), 1, 100)
  const threads = m.cpu.threads.map((t) => clamp(ease(t, cpuTotal) + jitter(40), 0, 100))
  const ramPct = clamp(ease((m.ram.usedGb / m.ram.totalGb) * 100, targets.ram) + jitter(3), 5, 99)
  const prevVram = m.vram ? (m.vram.usedGb / m.vram.totalGb) * 100 : 40
  const vramPct = clamp(ease(prevVram, targets.vram) + jitter(5), 5, 99)
  return {
    source: 'simulated',
    cpu: { model: m.cpu.model, total: cpuTotal, threads, tempC: clamp(45 + cpuTotal * 0.5 + jitter(3), 40, 99) },
    ram: { usedGb: (ramPct / 100) * m.ram.totalGb, totalGb: m.ram.totalGb },
    vram: {
      name: SIM.gpu,
      usedGb: (vramPct / 100) * SIM.vramGb,
      totalGb: SIM.vramGb,
      gpuUtil: clamp(vramPct * 0.9 + jitter(20), 0, 100),
      tempC: clamp(38 + vramPct * 0.4 + jitter(2), 35, 90),
    },
    disk: m.disk,
    uptimeSec: m.uptimeSec + 2,
    history: { cpu: push(m.history.cpu, cpuTotal), ram: push(m.history.ram, ramPct), vram: push(m.history.vram, vramPct) },
  }
}

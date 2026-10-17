import { Activity } from 'lucide-react'
import { useEffect } from 'react'
import { Ring } from '../components/Ring'
import { Widget } from '../components/Widget'
import { sfx } from '../lib/sfx'
import { native } from '../native/api'
import { applySample, loadLevel, nextMetrics, type LoadLevel } from '../services/telemetry'
import { useOfficeStore } from '../store/useOfficeStore'

const TICK_MS = 2000

const levelColor: Record<LoadLevel, string> = {
  normal: 'var(--color-cyan)',
  heavy: 'var(--color-orange)',
  critical: 'var(--color-crit)',
}

const gb = (v: number) => (v >= 100 ? v.toFixed(0) : v.toFixed(1))

function formatUptime(sec: number) {
  const d = Math.floor(sec / 86400)
  const h = Math.floor((sec % 86400) / 3600)
  const m = Math.floor((sec % 3600) / 60)
  return d ? `${d}d ${h}h` : `${h}h ${m}m`
}

export function SystemTelemetry() {
  const t = useOfficeStore((s) => s.systemMetrics)
  const ramPct = (t.ram.usedGb / t.ram.totalGb) * 100
  const vramPct = t.vram ? (t.vram.usedGb / t.vram.totalGb) * 100 : null
  const diskPct = t.disk ? (t.disk.usedGb / t.disk.totalGb) * 100 : 0
  const critical = [t.cpu.total, ramPct, vramPct ?? 0].some((v) => loadLevel(v) === 'critical')

  // desktop app: real samples streamed from the main process every 2 s;
  // plain browser: simulated samples on the same cadence
  useEffect(() => {
    const { updateSystemMetrics } = useOfficeStore.getState()
    if (native) return native.onSystemMetrics((sample) => updateSystemMetrics((prev) => applySample(prev, sample)))
    const id = setInterval(() => updateSystemMetrics(nextMetrics), TICK_MS)
    return () => clearInterval(id)
  }, [])

  // log + sfx once when the machine enters the critical range
  useEffect(() => {
    if (!critical) return
    sfx.emit('alert', { source: 'telemetry' })
    useOfficeStore.getState().addTerminalLog('[WARN] System load critical (>90%)', { source: 'telemetry', level: 'error' })
  }, [critical])

  return (
    <Widget
      title="system.telemetry"
      icon={Activity}
      tone={critical ? 'alert' : 'default'}
      status={
        <span className="tabular-nums" title={t.source === 'live' ? 'Live hardware data' : 'Simulated data (browser)'}>
          {t.source === 'simulated' && <span className="mr-1.5 text-orange">sim</span>}
          up {formatUptime(t.uptimeSec)}
        </span>
      }
    >
      <div className="flex h-full flex-col justify-center gap-2">
        <div className="flex items-start justify-around gap-1">
          <Ring pct={t.cpu.total} caption="cpu" sub={t.cpu.tempC !== null ? `${t.cpu.tempC.toFixed(0)}°C` : t.cpu.model} label="CPU load" />
          {t.vram && vramPct !== null ? (
            <Ring pct={t.vram.gpuUtil} caption="gpu" sub={`${gb(t.vram.usedGb)}/${t.vram.totalGb.toFixed(0)}G · ${t.vram.tempC.toFixed(0)}°C`} label={`${t.vram.name} load`} />
          ) : (
            <Ring pct={0} caption="gpu" sub="n/a" center={<span className="text-[10px] text-dim">--</span>} label="No NVIDIA GPU reported" />
          )}
          <Ring pct={ramPct} caption="ram" sub={`${gb(t.ram.usedGb)}/${t.ram.totalGb.toFixed(0)}G`} label="Memory used" />
          {t.disk ? (
            <Ring pct={diskPct} caption={`disk ${t.disk.mount}`} sub={`${gb(t.disk.totalGb - t.disk.usedGb)}G free`} label="Disk used" />
          ) : (
            <Ring pct={0} caption="disk" sub="n/a" center={<span className="text-[10px] text-dim">--</span>} label="Disk usage unavailable" />
          )}
        </div>
        {/* per-thread load, one cell per hardware thread */}
        <div className="grid gap-px" style={{ gridTemplateColumns: `repeat(${t.cpu.threads.length}, 1fr)` }} aria-label="Per-thread load">
          {t.cpu.threads.map((v, i) => (
            <span
              key={i}
              title={`thread ${i}: ${v.toFixed(0)}%`}
              className="h-1.5"
              style={{ background: levelColor[loadLevel(v)], opacity: 0.12 + (v / 100) * 0.88 }}
            />
          ))}
        </div>
      </div>
    </Widget>
  )
}

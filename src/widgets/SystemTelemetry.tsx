import { Activity } from 'lucide-react'
import { useEffect } from 'react'
import { Widget } from '../components/Widget'
import { sfx } from '../lib/sfx'
import { native } from '../native/api'
import { applySample, loadLevel, nextMetrics, type LoadLevel } from '../services/telemetry'
import { useOfficeStore } from '../store/useOfficeStore'

const SEGMENTS = 24
const TICK_MS = 2000

const levelColor: Record<LoadLevel, string> = {
  normal: 'var(--color-cyan)',
  heavy: 'var(--color-orange)',
  critical: 'var(--color-crit)',
}
const levelText: Record<LoadLevel, string> = {
  normal: 'text-cyan',
  heavy: 'text-orange',
  critical: 'text-crit',
}

function Meter({ value, label }: { value: number; label: string }) {
  const on = Math.round((value / 100) * SEGMENTS)
  return (
    <div
      className="meter"
      data-level={loadLevel(value)}
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value)}
    >
      {Array.from({ length: SEGMENTS }, (_, i) => (
        <span key={i} data-on={i < on} />
      ))}
    </div>
  )
}

function Spark({ data, level }: { data: number[]; level: LoadLevel }) {
  if (data.length < 2) return <svg className="h-6 w-full" aria-hidden />
  const step = 100 / (data.length - 1)
  const pts = data.map((v, i) => `${(i * step).toFixed(2)},${(24 - (v / 100) * 22).toFixed(2)}`).join(' ')
  const stroke = levelColor[level]
  return (
    <svg viewBox="0 0 100 24" preserveAspectRatio="none" className="h-6 w-full" aria-hidden>
      <polygon points={`0,24 ${pts} 100,24`} fill={stroke} opacity={0.08} />
      <polyline points={pts} fill="none" stroke={stroke} strokeWidth={1} vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

interface RowProps {
  name: string
  detail: string
  value: number
  history: number[]
  extra?: string
}

function MetricRow({ name, detail, value, history, extra }: RowProps) {
  const level = loadLevel(value)
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline gap-2">
        <span className="text-[12px] font-medium text-ink">{name}</span>
        <span className="truncate text-[11px] text-dim">{detail}</span>
        <span className={`ml-auto text-[15px] font-bold tabular-nums transition-colors ${levelText[level]}`}>
          {value.toFixed(0)}
          <span className="text-[11px] font-normal text-dim">%</span>
        </span>
      </div>
      <Meter value={value} label={`${name} usage`} />
      <div className="flex items-end gap-2">
        <div className="min-w-0 flex-1">
          <Spark data={history} level={level} />
        </div>
        {extra && <span className="shrink-0 pb-0.5 text-[11px] tabular-nums text-dim">{extra}</span>}
      </div>
    </div>
  )
}

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
          {t.cpu.tempC !== null && `  ${t.cpu.tempC.toFixed(0)}°C`}
        </span>
      }
    >
      <div className="space-y-4">
        <MetricRow
          name="cpu"
          detail={`${t.cpu.model}, ${t.cpu.threads.length} threads`}
          value={t.cpu.total}
          history={t.history.cpu}
        />
        <div
          className="-mt-2 grid gap-[2px]"
          style={{ gridTemplateColumns: `repeat(${t.cpu.threads.length}, 1fr)` }}
          aria-label="Per-thread load"
        >
          {t.cpu.threads.map((v, i) => (
            <span
              key={i}
              title={`thread ${i}: ${v.toFixed(0)}%`}
              className="h-3 transition-colors duration-300"
              style={{
                background: levelColor[loadLevel(v)],
                opacity: 0.12 + (v / 100) * 0.88,
              }}
            />
          ))}
        </div>
        <MetricRow
          name="ram"
          detail={`${t.ram.usedGb.toFixed(1)} / ${t.ram.totalGb.toFixed(0)} GB`}
          value={ramPct}
          history={t.history.ram}
        />
        {t.vram && vramPct !== null ? (
          <MetricRow
            name="vram"
            detail={`${t.vram.name}, ${t.vram.usedGb.toFixed(1)} / ${t.vram.totalGb.toFixed(0)} GB`}
            value={vramPct}
            history={t.history.vram}
            extra={`gpu ${t.vram.gpuUtil.toFixed(0)}%  ${t.vram.tempC.toFixed(0)}°C`}
          />
        ) : (
          <p className="text-[11px] text-dim">vram: no NVIDIA GPU reported by nvidia-smi</p>
        )}
      </div>
    </Widget>
  )
}

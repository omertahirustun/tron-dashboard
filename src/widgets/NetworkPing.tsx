import { motion } from 'framer-motion'
import { Network, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { TronButton } from '../components/TronButton'
import { Widget } from '../components/Widget'
import { sfx } from '../lib/sfx'
import { native, type ProbeResult } from '../native/api'
import { useOfficeStore } from '../store/useOfficeStore'

// Browser fallback rows
const SAMPLE: ProbeResult[] = [
  { name: 'PostgreSQL', kind: 'tcp', endpoint: '127.0.0.1:5432', at: 0, state: 'up', ms: 1.2 },
  { name: 'Supabase', kind: 'http', endpoint: 'supabase.co', at: 0, state: 'up', ms: 148 },
  { name: 'Node.js', kind: 'http', endpoint: '127.0.0.1:8787', at: 0, state: 'offline', error: 'not running' },
]

/** <100 ms cyan, <400 ms orange, slower or failing red */
function tone(r: ProbeResult) {
  if (r.state === 'offline') return { dot: 'bg-dim/50', text: 'text-dim' }
  if (r.state === 'down') return { dot: 'bg-crit shadow-[0_0_8px_var(--color-crit)]', text: 'text-crit' }
  const ms = r.ms ?? 0
  if (ms < 100) return { dot: 'bg-cyan shadow-[0_0_8px_var(--color-cyan)]', text: 'text-cyan' }
  if (ms < 400) return { dot: 'bg-orange shadow-[0_0_8px_var(--color-orange)]', text: 'text-orange' }
  return { dot: 'bg-crit shadow-[0_0_8px_var(--color-crit)]', text: 'text-crit' }
}

export function NetworkPing() {
  const live = useOfficeStore((s) => s.networkStatus)
  const results = native ? live : SAMPLE
  const [spin, setSpin] = useState(0)
  const up = results.filter((r) => r.state === 'up').length

  const refresh = () => {
    setSpin((n) => n + 1)
    sfx.emit('click', { source: 'network.refresh' })
    void native?.refreshNetwork()
  }

  return (
    <Widget
      title="network.ping"
      icon={Network}
      tone={results.some((r) => r.state === 'down') ? 'alert' : 'default'}
      status={
        <>
          {!native && <span className="text-orange">sample </span>}
          {up}/{results.length} up
        </>
      }
      actions={
        native && (
          <TronButton sfxSource="network.refresh" onClick={refresh} aria-label="Probe now">
            <motion.span animate={{ rotate: spin * 360 }} transition={{ duration: 0.5 }} className="inline-flex">
              <RefreshCw size={12} />
            </motion.span>
          </TronButton>
        )
      }
    >
      {results.length === 0 ? (
        <p className="text-[12px] text-dim">Probing…</p>
      ) : (
        <ul className="space-y-1.5 text-[12px]" aria-label="Service latency">
          {results.map((r) => {
            const t = tone(r)
            return (
              <li key={r.name} className="flex items-center gap-2" title={`${r.endpoint}${r.status ? ` (HTTP ${r.status})` : ''}`}>
                <span className={`size-2 shrink-0 rotate-45 ${t.dot}`} aria-hidden />
                <span className="w-24 shrink-0 truncate text-ink">{r.name}</span>
                <span className="min-w-0 flex-1 truncate text-[10px] text-dim/80">{r.endpoint.replace(/^https?:\/\//, '').split('/')[0]}</span>
                <span className={`shrink-0 text-right tabular-nums ${t.text}`}>
                  {r.state === 'up' ? `${r.ms! < 10 ? r.ms!.toFixed(1) : Math.round(r.ms!)} ms` : r.error}
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </Widget>
  )
}

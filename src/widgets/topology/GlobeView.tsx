import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { Code2, ExternalLink, FileDiff as FileDiffIcon, FolderSearch, Maximize, Pause, Play, Search, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { TronButton } from '../../components/TronButton'
import { sfx } from '../../lib/sfx'
import { native, type FileDiff } from '../../native/api'
import { useOfficeStore } from '../../store/useOfficeStore'
import { FlatGraph } from './FlatGraph'
import { Globe, type Look, type LookContext } from './Globe'
import type { DataEdgeType, TronNodeType } from './graph'
import { openNode } from './openNode'

// Everything around the globe canvas: search, the picked node's card with its
// file actions, the diff viewer, legend and view buttons. Shared by the
// sessions globe and the code globe.

export interface GlobeViewProps {
  nodes: TronNodeType[]
  edges: DataEdgeType[]
  look: (node: TronNodeType, ctx: LookContext) => Look
  legend: Array<[color: string, label: string]>
  /** shown in the middle when there are no nodes */
  empty: ReactNode
  /** one line under the search box (e.g. which repo the code graph shows) */
  info?: ReactNode
  /** node to focus from outside (e.g. the file selected in the explorer) */
  focusRequest?: string | null
  /** "show in code graph" on file cards (sessions globe only) */
  onShowInCode?: (path: string) => void
  /** draw as a flat 2D dot graph instead of the globe */
  flat?: boolean
}

const NO_CTX: LookContext = { activeAgent: '', selectedFile: '', replying: false }
const filePath = (n: TronNodeType) => (n.data.kind === 'note' || n.data.kind === 'code' ? n.data.path : null)
const errText = (e: unknown) => (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

export function GlobeView({ nodes, edges, look, legend, empty, info, focusRequest, onShowInCode, flat }: GlobeViewProps) {
  const reduced = useReducedMotion()
  const [spin, setSpin] = useState(!reduced)
  const [resetKey, setResetKey] = useState(0)
  const [focus, setFocus] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [diff, setDiff] = useState<{ path: string; result: FileDiff | null; error?: string } | null>(null)

  // follow outside requests (explorer selection in code mode)
  const [lastRequest, setLastRequest] = useState(focusRequest)
  if (focusRequest !== lastRequest) {
    setLastRequest(focusRequest)
    if (focusRequest) setFocus(focusRequest)
  }

  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes])
  const picked = focus ? (byId.get(focus) ?? null) : null

  const pick = useCallback((node: TronNodeType | null) => {
    if (!node) {
      setFocus(null)
      return
    }
    setFocus(node.id)
    openNode(node)
  }, [])

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    return nodes
      .filter((n) => n.data.label.toLowerCase().includes(q) || (filePath(n) ?? '').toLowerCase().includes(q))
      .sort((a, b) => +!a.data.label.toLowerCase().startsWith(q) - +!b.data.label.toLowerCase().startsWith(q))
      .slice(0, 8)
  }, [nodes, query])

  const showDiff = (path: string) => {
    sfx.emit('click', { source: 'topology.diff' })
    setDiff({ path, result: null })
    if (!native) {
      setDiff({ path, result: { repo: '~/sample', rel: path, state: 'modified', diff: '@@ -1,3 +1,4 @@\n # sample\n-old line\n+new line\n+added by Claude\n' } })
      return
    }
    native.getFileDiff(path).then(
      (result) => setDiff((d) => (d?.path === path ? { path, result } : d)),
      (e) => setDiff((d) => (d?.path === path ? { path, result: null, error: errText(e) } : d)),
    )
  }

  const openExternal = (path: string) => {
    sfx.emit('click', { source: 'topology.open' })
    native?.openPath(path).catch((e) => useOfficeStore.getState().addTerminalLog(`[ERR] Cannot open ${path}: ${errText(e)}`, { source: 'topology', level: 'error' }))
  }

  // Escape: close the diff, then clear the focus
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || (e.target as HTMLElement)?.closest?.('.xterm')) return
      if (diff) setDiff(null)
      else setFocus(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [diff])

  const pickedLook = picked ? look(picked, NO_CTX) : null
  const pickedPath = picked ? filePath(picked) : null

  return (
    <div className="relative h-full overflow-hidden">
      {flat ? (
        <FlatGraph nodes={nodes} edges={edges} look={look} focus={focus} spin={false} resetKey={resetKey} onPick={pick} />
      ) : (
        <Globe nodes={nodes} edges={edges} look={look} focus={focus} spin={spin} resetKey={resetKey} onPick={pick} />
      )}

      {nodes.length === 0 && <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6 text-center text-[12px] text-dim">{empty}</div>}

      {/* search */}
      <div className="no-drag absolute top-2 left-2 z-10 w-[min(260px,calc(100%-120px))]">
        <label className="flex items-center gap-1.5 border border-cyan-line/70 bg-[#04090c]/90 px-2 py-1 focus-within:border-cyan">
          <Search size={12} className="shrink-0 text-dim" aria-hidden />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && matches[0]) {
                pick(matches[0])
                setQuery('')
              }
              if (e.key === 'Escape') setQuery('')
            }}
            placeholder="Find a node…"
            aria-label="Find a node on the globe"
            className="min-w-0 flex-1 bg-transparent text-[12px] text-ink outline-none placeholder:text-dim/70"
          />
        </label>
        {matches.length > 0 && (
          <ul className="mt-px border border-cyan-line/70 bg-[#04090c]/95 py-0.5" role="listbox" aria-label="Matching nodes">
            {matches.map((n) => {
              const l = look(n, NO_CTX)
              return (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => {
                      pick(n)
                      setQuery('')
                    }}
                    className="flex w-full items-center gap-2 px-2 py-1 text-left text-[11px] hover:bg-cyan-soft"
                  >
                    <span className="size-1.5 shrink-0 rounded-full" style={{ background: l.color }} />
                    <span className="truncate text-ink">{l.title}</span>
                    <span className="ml-auto truncate pl-2 text-[10px] text-dim">{l.sub}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
        {info && !matches.length && <div className="mt-1 truncate text-[10px] text-dim">{info}</div>}
      </div>

      {/* legend */}
      <div className="pointer-events-none absolute top-2 right-2 flex flex-col gap-1 text-[10px] text-dim">
        {legend.map(([c, label]) => (
          <span key={label} className="flex items-center gap-1.5">
            <span className="size-1.5 rounded-full" style={{ background: c, boxShadow: `0 0 6px ${c}` }} />
            {label}
          </span>
        ))}
      </div>

      {/* picked node */}
      <AnimatePresence>
        {picked && pickedLook && (
          <motion.div
            key={picked.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.15 }}
            className="no-drag absolute right-2 bottom-2 z-10 w-[min(320px,calc(100%-100px))] border bg-[#04090c]/95 p-2.5"
            style={{ borderColor: pickedLook.color }}
          >
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12px] font-bold" style={{ color: pickedLook.color }}>
                  {pickedLook.title}
                </div>
                <div className="truncate text-[10px] text-dim" title={pickedPath ?? pickedLook.sub}>
                  {pickedLook.sub}
                </div>
              </div>
              <button type="button" onClick={() => setFocus(null)} aria-label="Close" className="text-dim hover:text-ink">
                <X size={13} />
              </button>
            </div>
            {pickedPath && (
              <div className="mt-2 flex flex-wrap gap-1">
                <TronButton sfxSource="topology.reveal" onClick={() => useOfficeStore.getState().selectFile(pickedPath)} title="Show in the explorer">
                  <FolderSearch size={12} /> explorer
                </TronButton>
                <TronButton sfxSource="topology.diff" onClick={() => showDiff(pickedPath)} title="Uncommitted changes to this file">
                  <FileDiffIcon size={12} /> diff
                </TronButton>
                {native && (
                  <TronButton sfxSource="topology.open" onClick={() => openExternal(pickedPath)} title="Open in its default app">
                    <ExternalLink size={12} /> open
                  </TronButton>
                )}
                {onShowInCode && (
                  <TronButton sfxSource="topology.code" onClick={() => onShowInCode(pickedPath)} title="Show this file in its repo's code graph">
                    <Code2 size={12} /> code graph
                  </TronButton>
                )}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* diff viewer */}
      {diff && (
        <div className="no-drag absolute inset-x-2 top-12 bottom-2 z-20 flex flex-col border border-cyan-line bg-[#04090c]/97">
          <header className="flex items-center gap-2 border-b border-cyan-line/60 px-3 py-1.5 text-[11px]">
            <FileDiffIcon size={12} className="text-cyan" aria-hidden />
            <span className="truncate text-ink">{diff.result?.rel ?? diff.path}</span>
            {diff.result && (
              <span className={diff.result.state === 'modified' ? 'text-orange' : 'text-dim'}>
                {{ modified: 'uncommitted changes', clean: 'no changes since the last commit', untracked: 'new file, not in git yet', 'no-repo': 'not in a git repo' }[diff.result.state]}
              </span>
            )}
            <button type="button" onClick={() => setDiff(null)} aria-label="Close diff" className="ml-auto text-dim hover:text-ink">
              <X size={13} />
            </button>
          </header>
          <pre className="min-h-0 flex-1 overflow-auto px-3 py-2 text-[11px] leading-[1.45]">
            {diff.error ? (
              <span className="text-crit">{diff.error}</span>
            ) : !diff.result ? (
              <span className="text-dim">Reading diff…</span>
            ) : !diff.result.diff ? (
              <span className="text-dim">Nothing to show.</span>
            ) : (
              diff.result.diff.split('\n').map((line, i) => (
                <div
                  key={i}
                  className={
                    line.startsWith('+++') || line.startsWith('---')
                      ? 'text-dim'
                      : line.startsWith('+')
                        ? 'bg-ok/10 text-ok'
                        : line.startsWith('-')
                          ? 'bg-crit/10 text-crit'
                          : line.startsWith('@@')
                            ? 'text-cyan'
                            : 'text-ink/70'
                  }
                >
                  {line || ' '}
                </div>
              ))
            )}
          </pre>
        </div>
      )}

      <div className="no-drag absolute bottom-2 left-2 z-10 flex gap-1">
        <TronButton sfxSource="topology.fit" variant="solid" onClick={() => setResetKey((k) => k + 1)} aria-label={flat ? 'Fit graph to panel' : 'Reset globe view'}>
          <Maximize size={12} />
        </TronButton>
        {!flat && (
          <TronButton sfxSource="topology.spin" variant="solid" onClick={() => setSpin((s) => !s)} aria-label={spin ? 'Stop rotation' : 'Start rotation'}>
            {spin ? <Pause size={12} /> : <Play size={12} />}
          </TronButton>
        )}
      </div>
    </div>
  )
}

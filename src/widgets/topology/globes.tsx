import { RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { native, type CodeGraph, type LiveSession } from '../../native/api'
import { useSessions } from '../../native/useSessions'
import { useOfficeStore } from '../../store/useOfficeStore'
import { ORANGE, type Look, type LookContext } from './Globe'
import { GlobeView } from './GlobeView'
import type { DataEdgeType, TronNodeType } from './graph'

const CYAN = '#0de6ff'
const DIM = '#5b7a82'
const home = (p: string) => p.replace(/^\/home\/[^/]+/, '~')

// ── Code: files of the selected repo linked by their imports (graphify-like) ─

const GROUP_COLORS = ['#0de6ff', '#b99cff', '#3dffa8', '#ffd166', '#ff6fb5', '#5b9cff', '#7ff3ff', '#c3e88d']
const MAX_NODES = 600
const TOUCHED = '#ffffff'

/** Paths Claude Code sessions touched (value: touched in the last 30 s). */
function touchedFiles(sessions: LiveSession[] | undefined) {
  const map = new Map<string, boolean>()
  for (const s of sessions ?? [])
    for (const f of s.files) map.set(f.path, map.get(f.path) || (s.live && Date.now() - f.at < 30_000))
  return map
}

export function CodeGlobe({ flat = false }: { flat?: boolean }) {
  const repo = useOfficeStore((s) => s.activeRepo)
  const selectedFile = useOfficeStore((s) => s.selectedFile)
  const snapshot = useSessions()
  const [built, setCode] = useState<CodeGraph | null>(null)
  const [error, setError] = useState<{ repo: string; message: string } | null>(null)
  const [rebuilding, setRebuilding] = useState(false)

  const build = useCallback(
    (target: string) =>
      native!.buildCodeGraph(target).then(
        (g) => {
          setCode(g)
          setError(null)
        },
        (e: Error) => setError({ repo: target, message: e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') }),
      ),
    [],
  )
  useEffect(() => {
    if (native && repo) void build(repo)
  }, [repo, build])
  const rebuild = () => {
    if (!repo) return
    setRebuilding(true)
    void build(repo).finally(() => setRebuilding(false))
  }
  // graphify's own extraction (code only, no LLM); it writes graphify-out/ into the repo
  const runGraphify = () => {
    if (!repo || !native) return
    const log = useOfficeStore.getState().addTerminalLog
    setRebuilding(true)
    log(`[GRAPHIFY] mapping ${home(repo)}…`, { source: 'graphify' })
    native
      .runGraphify(repo)
      .then((g) => {
        setCode(g)
        setError(null)
        log(`[GRAPHIFY] ${g.name}: ${g.nodes.length} nodes, ${g.edges.length} links`, { source: 'graphify', level: 'ok' })
      })
      .catch((e: Error) => log(`[GRAPHIFY] ${e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')}`, { source: 'graphify', level: 'error' }))
      .finally(() => setRebuilding(false))
  }
  const failed = error && error.repo === repo ? error.message : null
  // only the graph of the repo selected now (the old one hides while the new one builds)
  const code = built && built.repo === repo ? built : null
  const loading = !!repo && !code && !failed

  const touched = useMemo(() => touchedFiles(snapshot?.sessions), [snapshot])

  const { nodes, edges, groups, hubs } = useMemo(() => {
    if (!code) return { nodes: [] as TronNodeType[], edges: [] as DataEdgeType[], groups: new Map<string, string>(), hubs: new Set<string>() }
    const degree = new Map<string, number>()
    for (const [a, b] of code.edges) {
      degree.set(a, (degree.get(a) ?? 0) + 1)
      degree.set(b, (degree.get(b) ?? 0) + 1)
    }
    // the best-connected files when the repo is huge
    const kept = [...code.nodes].sort((a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0)).slice(0, MAX_NODES)
    const ids = new Set(kept.map((n) => n.id))
    const count = new Map<string, number>()
    for (const n of kept) if (n.path) count.set(n.group, (count.get(n.group) ?? 0) + 1)
    const groups = new Map([...count].sort((a, b) => b[1] - a[1]).map(([g], i) => [g, GROUP_COLORS[i % GROUP_COLORS.length]]))
    const hubs = new Set(kept.filter((n) => n.path).slice(0, 8).map((n) => n.id))
    const nodes: TronNodeType[] = kept.map((n) => ({
      id: n.id,
      type: 'tron',
      position: { x: 0, y: 0 },
      data: {
        kind: 'code',
        label: n.label,
        path: n.path,
        group: n.group,
        degree: degree.get(n.id) ?? 0,
        detail: n.detail,
        isFile: n.isFile,
        // with graphify only the file's own node is marked, not each of its symbols
        touched: !!n.path && n.isFile !== false && touched.has(n.path),
        live: !!n.path && n.isFile !== false && !!touched.get(n.path),
      },
    }))
    const live = new Set(nodes.filter((n) => n.data.kind === 'code' && n.data.live).map((n) => n.id))
    const edges: DataEdgeType[] = code.edges
      .filter(([a, b]) => ids.has(a) && ids.has(b))
      .map(([a, b]) => ({ id: `${a}->${b}`, source: a, target: b, type: 'data', data: { flowing: live.has(a) || live.has(b) } }))
    return { nodes, edges, groups, hubs }
  }, [code, touched])

  const look = useCallback(
    (node: TronNodeType, { selectedFile }: LookContext): Look => {
      const d = node.data
      if (d.kind !== 'code') return { r: 3, color: DIM, label: false, title: d.label, sub: '' }
      const deg = Math.sqrt(d.degree)
      if (!d.path) return { r: 2 + Math.min(4, deg * 0.8), color: DIM, label: false, title: d.label, sub: `package, used by ${d.degree} files` }
      const color = d.live ? ORANGE : (groups.get(d.group) ?? CYAN)
      const sub = d.detail ?? (code ? d.path.slice(code.repo.length + 1) : d.path)
      return {
        r: 2.6 + Math.min(6, deg * 1.1),
        color,
        label: hubs.has(node.id) || !!d.live,
        ring: d.path === selectedFile ? color : d.touched ? TOUCHED : undefined,
        title: d.label,
        sub: d.touched ? `${sub}  · touched by Claude` : sub,
      }
    },
    [groups, hubs, code],
  )

  const legend = useMemo<Array<[string, string]>>(
    () => [...[...groups].slice(0, 7).map(([g, c]) => [c, g === '.' ? '(root)' : g] as [string, string]), [DIM, 'package'], [TOUCHED, 'touched by Claude'], [ORANGE, 'live']],
    [groups],
  )

  // the explorer's (or a card's) selected file, when it is in this graph
  const focusRequest = useMemo(() => {
    const inFile = nodes.filter((n) => n.data.kind === 'code' && n.data.path === selectedFile)
    return (inFile.find((n) => n.data.kind === 'code' && n.data.isFile) ?? inFile[0])?.id ?? null
  }, [nodes, selectedFile])

  if (!native) return <div className="flex h-full items-center justify-center p-6 text-center text-[12px] text-dim">The code graph reads your repositories, so it only works in the desktop app.</div>

  const info = code && (
    <span className="pointer-events-auto inline-flex flex-wrap items-center gap-x-1.5">
      {code.name}: {nodes.length} nodes, {edges.length} links ({code.source === 'graphify' ? 'graphify' : 'imports'}
      {code.truncated || code.nodes.length > MAX_NODES ? ', largest shown' : ''})
      {code.graphify ? (
        <button
          type="button"
          onClick={runGraphify}
          disabled={rebuilding}
          title={code.source === 'graphify' ? 'Re-run graphify on this repo' : 'Map this repo with graphify (functions, classes, communities)'}
          className="inline-flex items-center gap-1 text-cyan hover:underline disabled:opacity-50"
        >
          <RefreshCw size={10} className={rebuilding ? 'animate-spin' : ''} aria-hidden />
          {code.source === 'graphify' ? 'update' : 'map with graphify'}
        </button>
      ) : (
        <button type="button" onClick={rebuild} aria-label="Rebuild code graph" title="Rebuild" className="text-dim hover:text-cyan">
          <RefreshCw size={10} className={rebuilding ? 'animate-spin' : ''} />
        </button>
      )}
    </span>
  )

  return (
    <GlobeView
      flat={flat}
      nodes={nodes}
      edges={edges}
      look={look}
      legend={legend}
      info={info}
      focusRequest={focusRequest}
      empty={
        !repo
          ? 'Select a file inside a git repository (explorer or sessions globe) to map its code.'
          : failed
            ? `Cannot map ${home(repo)}: ${failed}`
            : loading || !code
              ? `Mapping ${home(repo)}…`
              : 'No source files found in this repository.'
      }
    />
  )
}

import { AnimatePresence, motion } from 'framer-motion'
import {
  ChevronRight,
  FileCode2,
  FileJson,
  FileText,
  Folder,
  FolderGit2,
  FolderOpen,
  FolderTree,
  Loader2,
  NotebookPen,
  RefreshCw,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { TronButton } from '../components/TronButton'
import { Widget } from '../components/Widget'
import { parentPaths, TREE, type TreeNode } from '../data/workspace'
import { sfx } from '../lib/sfx'
import { native, type DirEntry } from '../native/api'
import { useOfficeStore } from '../store/useOfficeStore'

// Desktop app: real folders from the workspace roots, loaded one level at a
// time when a folder opens. Browser: the static sample tree from data/workspace.

type Entry = DirEntry & { isRoot?: boolean; isGit?: boolean }

function sampleChildren(): Map<string, Entry[]> {
  const map = new Map<string, Entry[]>()
  const walk = (nodes: TreeNode[], parent: string) => {
    map.set(
      parent,
      nodes.map((n) => {
        const path = parent ? `${parent}/${n.name}` : n.name
        if (n.children) walk(n.children, path)
        return { name: n.name, path, kind: n.children ? 'dir' : 'file', isRoot: !parent }
      }),
    )
  }
  walk(TREE, '')
  return map
}

function iconFor(entry: Entry, open: boolean): { Icon: LucideIcon; color: string } {
  if (entry.kind === 'dir') {
    if (entry.isGit) return { Icon: FolderGit2, color: 'text-cyan' }
    return { Icon: open ? FolderOpen : Folder, color: 'text-cyan' }
  }
  const { name } = entry
  if (name.endsWith('.md')) return { Icon: NotebookPen, color: 'text-[#b99cff]' }
  if (/\.(tsx?|jsx?|c?js|mjs|css|py|rs|go|kt|java|sh|fish)$/.test(name)) return { Icon: FileCode2, color: 'text-cyan/80' }
  if (/\.(json|canvas|ya?ml|toml)$/.test(name)) return { Icon: FileJson, color: 'text-orange/80' }
  return { Icon: FileText, color: 'text-dim' }
}

interface Row {
  entry: Entry
  depth: number
  parent: string | null
}

/** Visible rows in display order (also drives keyboard navigation). */
function flatten(children: Map<string, Entry[]>, expanded: Set<string>, key = '', depth = 0, parent: string | null = null): Row[] {
  return (children.get(key) ?? []).flatMap((entry) => {
    const row: Row = { entry, depth, parent }
    return entry.kind === 'dir' && expanded.has(entry.path)
      ? [row, ...flatten(children, expanded, entry.path, depth + 1, entry.path)]
      : [row]
  })
}

const humanSize = (b: number) => (b < 1024 ? `${b} B` : b < 1024 ** 2 ? `${(b / 1024).toFixed(1)} KB` : `${(b / 1024 ** 2).toFixed(1)} MB`)

/** First few meaningful lines of a file, for the terminal log. */
function snippet(content: string, lines = 5) {
  return content
    .split('\n')
    .map((l) => l.trimEnd())
    .filter((l) => l.trim() && !/^---\s*$/.test(l))
    .slice(0, lines)
    .map((l) => (l.length > 110 ? `${l.slice(0, 110)}…` : l))
}

export function FileExplorer() {
  const selected = useOfficeStore((s) => s.selectedFile)
  const roots = useOfficeStore((s) => s.workspaceRoots)
  const [children, setChildren] = useState<Map<string, Entry[]>>(() => (native ? new Map() : sampleChildren()))
  const [expanded, setExpanded] = useState(() =>
    native ? new Set<string>() : new Set(['vault', 'vault/projects', 'agent-office-dashboard']),
  )
  const [loading, setLoading] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const listRef = useRef<HTMLUListElement>(null)

  /** desktop: read folders that haven't been loaded yet (one level each) */
  const ensureLoaded = (dirs: string[]) => {
    if (!native) return
    const api = native
    const pending = dirs.filter((dir) => !children.has(dir) && !loading.has(dir))
    if (!pending.length) return
    setLoading((l) => new Set([...l, ...pending]))
    for (const dir of pending) {
      api
        .readDir(dir)
        .then(({ entries }) => setChildren((c) => new Map(c).set(dir, entries)))
        .catch((e: Error) => {
          setChildren((c) => new Map(c).set(dir, []))
          useOfficeStore.getState().addTerminalLog(`[ERR] Cannot read ${dir}: ${e.message}`, { source: 'fs', level: 'error' })
        })
        .finally(() =>
          setLoading((l) => {
            const n = new Set(l)
            n.delete(dir)
            return n
          }),
        )
    }
  }

  // desktop: load the workspace roots and open the first one
  const loadRoots = () =>
    native
      ?.getWorkspaceRoots()
      .then(async (list) => {
        useOfficeStore.getState().setWorkspaceRoots(list)
        const first = list[0]?.path
        const tops = list.map((r) => ({ name: r.name, path: r.path, kind: 'dir' as const, isRoot: true, isGit: r.isGit }))
        const map = new Map<string, Entry[]>([['', tops]])
        if (first) map.set(first, (await native!.readDir(first)).entries)
        setChildren(map)
        setExpanded(new Set(first ? [first] : []))
        setError(null)
      })
      .catch((e: Error) => setError(e.message))

  const workspaceRev = useOfficeStore((s) => s.workspaceRev)
  useEffect(() => {
    void loadRoots()
  }, [workspaceRev])

  // reveal files selected elsewhere (e.g. a note node in the topology graph):
  // open their folders while rendering, then scroll the row into view
  const [revealed, setRevealed] = useState(selected)
  if (revealed !== selected) {
    setRevealed(selected)
    const missing = parentPaths(selected).filter((p) => p && !expanded.has(p))
    if (missing.length) setExpanded(new Set([...expanded, ...missing]))
  }

  useEffect(() => {
    // scroll only the list; scrollIntoView would also move the page
    const id = requestAnimationFrame(() => {
      const list = listRef.current
      const row = list?.querySelector<HTMLElement>(`[data-path="${CSS.escape(selected)}"]`)
      if (!list || !row) return
      const top = row.offsetTop - list.offsetTop
      if (top < list.scrollTop || top + row.offsetHeight > list.scrollTop + list.clientHeight)
        list.scrollTop = top - list.clientHeight / 2
    })
    return () => cancelAnimationFrame(id)
  }, [selected])

  const rows = useMemo(() => flatten(children, expanded), [children, expanded])

  const toggle = (path: string, force?: boolean) => {
    const open = force ?? !expanded.has(path)
    sfx.emit(open ? 'open' : 'close', { source: 'explorer.folder', path })
    const next = new Set(expanded)
    if (open) next.add(path)
    else next.delete(path)
    setExpanded(next)
    if (open) ensureLoaded([path])
  }

  const rootOf = (path: string) => roots.find((r) => path === r.path || path.startsWith(r.path + '/'))?.path

  async function openFile(entry: Entry) {
    const { addTerminalLog } = useOfficeStore.getState()
    sfx.emit('select', { source: 'explorer.file', path: entry.path })
    if (!native) {
      addTerminalLog(`[LOG] Opened file: ${entry.name}`, { source: 'explorer' })
      return
    }
    try {
      const file = await native.readFile(entry.path)
      if (file.binary) {
        addTerminalLog(`[LOG] ${entry.name} is a binary file (${humanSize(file.size)})`, { source: 'fs', level: 'warn' })
        return
      }
      const lines = snippet(file.content)
      const count = file.content.split('\n').length
      addTerminalLog(`[LOG] Read ${entry.name} (${humanSize(file.size)}, ${count}${file.truncated ? '+' : ''} lines)`, {
        source: 'fs',
        level: 'ok',
      })
      for (const l of lines) addTerminalLog(`  │ ${l}`, { source: 'fs' })
      if (!lines.length) addTerminalLog('  │ (empty file)', { source: 'fs' })
    } catch (e) {
      addTerminalLog(`[ERR] ${entry.name}: ${(e as Error).message}`, { source: 'fs', level: 'error' })
    }
  }

  const activate = (row: Row) => {
    const { selectFile, setActiveRoot } = useOfficeStore.getState()
    selectFile(row.entry.path)
    const root = rootOf(row.entry.path)
    if (root) setActiveRoot(root)
    if (row.entry.kind === 'dir') toggle(row.entry.path)
    else void openFile(row.entry)
  }

  const focusRow = (path: string) => {
    useOfficeStore.getState().selectFile(path)
    listRef.current?.querySelector<HTMLElement>(`[data-path="${CSS.escape(path)}"]`)?.focus()
  }

  const onKeyDown = (e: KeyboardEvent) => {
    const i = rows.findIndex((r) => r.entry.path === selected)
    const row = rows[i]
    if (!row) return
    const isDir = row.entry.kind === 'dir'
    switch (e.key) {
      case 'ArrowDown':
        if (rows[i + 1]) focusRow(rows[i + 1].entry.path)
        break
      case 'ArrowUp':
        if (rows[i - 1]) focusRow(rows[i - 1].entry.path)
        break
      case 'ArrowRight':
        if (isDir && !expanded.has(row.entry.path)) toggle(row.entry.path, true)
        else if (isDir && rows[i + 1]) focusRow(rows[i + 1].entry.path)
        break
      case 'ArrowLeft':
        if (isDir && expanded.has(row.entry.path)) toggle(row.entry.path, false)
        else if (row.parent) focusRow(row.parent)
        break
      default:
        return
    }
    e.preventDefault()
    sfx.emit('key', { source: 'explorer.nav', key: e.key })
  }

  const refresh = () => void loadRoots()

  const fileCount = rows.filter((r) => r.entry.kind === 'file').length

  return (
    <Widget
      title="workspace.explorer"
      icon={FolderTree}
      status={
        native ? (
          `${fileCount} files`
        ) : (
          <>
            <span className="text-orange">sample</span> {fileCount} files
          </>
        )
      }
      actions={
        native && (
          <TronButton sfxSource="explorer.refresh" onClick={refresh} aria-label="Reload folders">
            <RefreshCw size={12} />
          </TronButton>
        )
      }
      flush
    >
      <div className="flex h-full flex-col">
        {error && <p className="px-3 py-2 text-[11px] text-crit">Cannot load workspace: {error}</p>}
        <ul
          ref={listRef}
          role="tree"
          aria-label="Workspace files"
          className="min-h-0 flex-1 overflow-auto py-1.5"
          onKeyDown={onKeyDown}
        >
          <TreeLevel parentKey="" depth={0} {...{ children, expanded, selected, loading, onActivate: activate }} />
        </ul>
        <footer className="truncate border-t border-cyan-line/60 px-3 py-1.5 text-[11px] text-dim" title={selected}>
          {!selected ? 'Select a file to read it into the log' : selected.startsWith('/') ? selected.replace(/^\/home\/[^/]+/, '~') : `~/${selected}`}
        </footer>
      </div>
    </Widget>
  )
}

interface TreeLevelProps {
  parentKey: string
  depth: number
  children: Map<string, Entry[]>
  expanded: Set<string>
  loading: Set<string>
  selected: string
  onActivate: (row: Row) => void
}

function TreeLevel({ parentKey, depth, children, expanded, loading, selected, onActivate }: TreeLevelProps) {
  const entries = children.get(parentKey) ?? []
  return (
    <>
      {entries.map((entry) => {
        const { path } = entry
        const isDir = entry.kind === 'dir'
        const open = isDir && expanded.has(path)
        const active = path === selected
        const busy = loading.has(path)
        const { Icon, color } = iconFor(entry, open)
        return (
          <li key={path} role="treeitem" aria-expanded={isDir ? open : undefined} aria-selected={active}>
            <motion.button
              type="button"
              data-path={path}
              tabIndex={active ? 0 : -1}
              whileTap={{ scale: 0.98, x: 2 }}
              onMouseEnter={() => sfx.emit('hover', { source: 'explorer.row', path })}
              onClick={() => onActivate({ entry, depth, parent: parentKey || null })}
              className={`group relative flex w-full items-center gap-1.5 py-[3px] pr-3 text-left text-[12px] transition-colors ${
                active ? 'bg-cyan-soft text-cyan' : 'text-ink hover:bg-cyan/5 hover:text-white'
              } ${entry.isRoot ? 'font-medium' : ''}`}
              style={{ paddingLeft: 10 + depth * 14 }}
              title={path}
            >
              {active && (
                <motion.span
                  layoutId="explorer-active"
                  className="absolute inset-y-0 left-0 w-[2px] bg-cyan shadow-[0_0_8px_var(--color-cyan)]"
                  transition={{ type: 'spring', stiffness: 500, damping: 40 }}
                />
              )}
              {busy ? (
                <Loader2 size={12} aria-hidden className="shrink-0 animate-spin text-dim" />
              ) : (
                <ChevronRight
                  size={12}
                  aria-hidden
                  className={`shrink-0 text-dim transition-transform ${isDir ? '' : 'invisible'} ${open ? 'rotate-90' : ''}`}
                />
              )}
              <Icon size={13} aria-hidden className={`shrink-0 ${color}`} />
              <span className="truncate">{entry.name}</span>
            </motion.button>
            <AnimatePresence initial={false}>
              {open && children.has(path) && (
                <motion.ul
                  role="group"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.18, ease: 'easeOut' }}
                  className="overflow-hidden"
                >
                  {children.get(path)!.length === 0 ? (
                    <li className="py-[3px] text-[11px] text-dim/70" style={{ paddingLeft: 38 + depth * 14 }}>
                      empty
                    </li>
                  ) : (
                    <TreeLevel
                      parentKey={path}
                      depth={depth + 1}
                      {...{ children, expanded, loading, selected, onActivate }}
                    />
                  )}
                </motion.ul>
              )}
            </AnimatePresence>
          </li>
        )
      })}
    </>
  )
}

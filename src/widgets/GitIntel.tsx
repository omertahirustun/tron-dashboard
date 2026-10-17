import { motion } from 'framer-motion'
import { ArrowDown, ArrowUp, ExternalLink, GitBranch, GitMerge, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { TronButton } from '../components/TronButton'
import { Widget } from '../components/Widget'
import { sfx } from '../lib/sfx'
import { native, type GitStatus } from '../native/api'
import { useOfficeStore } from '../store/useOfficeStore'

const ME = 'omertahirustun'

// Browser fallback so the panel isn't empty outside the desktop app.
const SAMPLE: GitStatus = {
  repo: '~/agent-office',
  name: 'agent-office',
  branch: 'master',
  changed: 2,
  ahead: 1,
  behind: 0,
  remote: 'https://github.com/omertahirustun/agent-office',
  commits: [
    { hash: '5dce5da', subject: 'F2/F3 work while the terminal has focus', author: ME, when: '2 hours ago', merge: false },
    { hash: 'ca21aff', subject: 'Terminal opens above the scene', author: ME, when: '3 hours ago', merge: false },
    { hash: 'ef6bbd3', subject: 'History limit keeps the newest events', author: ME, when: '5 days ago', merge: false },
    { hash: '90cc902', subject: 'Docs: new features and hook events', author: ME, when: '5 days ago', merge: false },
    { hash: '814dd73', subject: 'Rooms, detail panel, board, timeline', author: ME, when: '5 days ago', merge: true },
  ],
}

export function GitIntel() {
  // the repo of the file last selected in the explorer or topology
  const repo = useOfficeStore((s) => s.activeRepo)
  const inRepo = useOfficeStore((s) => s.selectedInRepo)

  const [status, setStatus] = useState<GitStatus | null>(native ? null : SAMPLE)
  const [error, setError] = useState<string | null>(null)
  const [spin, setSpin] = useState(0)
  const last = useRef<GitStatus | null>(null)

  const load = useCallback(
    () =>
      repo && native
        ? native
            .getGitStatus(repo)
            .then((s) => {
              // announce branch switches and new commits in the terminal log
              const prev = last.current
              const log = useOfficeStore.getState().addTerminalLog
              if (prev && prev.repo === s.repo) {
                if (prev.branch !== s.branch) log(`[GIT] ${s.name}: switched to ${s.branch}`, { source: 'git', level: 'ok' })
                else if (s.commits[0] && prev.commits[0]?.hash !== s.commits[0].hash)
                  log(`[GIT] ${s.name}: new commit ${s.commits[0].hash} ${s.commits[0].subject}`, { source: 'git', level: 'ok' })
              }
              last.current = s
              setStatus(s)
              setError(null)
            })
            .catch((e: Error) => setError(e.message))
        : Promise.resolve(),
    [repo],
  )

  useEffect(() => {
    if (!native || !repo) return
    void load()
    void native.watchGit(repo)
    return native.onGitChange((changed) => {
      if (changed === repo) void load()
    })
  }, [repo, load])

  const refresh = () => {
    setSpin((n) => n + 1)
    sfx.emit('click', { source: 'git.refresh' })
    void load()
  }

  const title = status ? status.name : 'no repository'
  return (
    <Widget
      title="github.intel"
      icon={GitBranch}
      status={native ? title : <><span className="text-orange">sample</span> {title}</>}
      actions={
        native && (
          <TronButton sfxSource="git.refresh" onClick={refresh} aria-label="Refresh git status">
            <motion.span animate={{ rotate: spin * 360 }} transition={{ duration: 0.5 }} className="inline-flex">
              <RefreshCw size={12} />
            </motion.span>
          </TronButton>
        )
      }
    >
      {!repo && native ? (
        <p className="text-[12px] text-dim">
          Select a file inside a git repository (in the explorer or the topology) and its repo shows up here.
        </p>
      ) : error ? (
        <p className="text-[12px] text-crit">git failed: {error}</p>
      ) : !status ? (
        <p className="text-[12px] text-dim">Reading repository…</p>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-[11px]">
            <span className="truncate text-dim" title={status.repo}>
              {status.repo.replace(/^\/home\/[^/]+/, '~')}
            </span>
            {status.remote ? (
              <a
                href={status.remote}
                target="_blank"
                rel="noreferrer"
                className="no-drag ml-auto inline-flex shrink-0 items-center gap-1 text-cyan hover:underline"
                title={status.remote}
                onClick={() => sfx.emit('click', { source: 'git.remote' })}
              >
                {status.remote.replace(/^https:\/\/(www\.)?/, '').replace(/^github\.com\//, '')}
                <ExternalLink size={11} aria-hidden />
              </a>
            ) : (
              <span className="ml-auto shrink-0 text-dim/70">no remote</span>
            )}
          </div>
          {!inRepo && <p className="text-[11px] text-orange/80">The selected file is not in a git repo; showing the last one.</p>}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px]">
            <span className="inline-flex items-center gap-1.5 font-bold text-cyan [text-shadow:0_0_8px_rgb(13_230_255/0.5)]">
              <GitBranch size={13} aria-hidden />
              {status.branch}
            </span>
            {status.ahead !== null && (
              <span className="inline-flex items-center gap-2 text-[11px] text-dim tabular-nums" title="ahead / behind upstream">
                <span className="inline-flex items-center">
                  <ArrowUp size={11} aria-hidden />
                  {status.ahead}
                </span>
                <span className="inline-flex items-center">
                  <ArrowDown size={11} aria-hidden />
                  {status.behind}
                </span>
              </span>
            )}
            <span className={`ml-auto text-[11px] ${status.changed ? 'text-orange' : 'text-ok'}`}>
              {status.changed ? `${status.changed} changed` : 'clean'}
            </span>
          </div>

          {/* commit rail: newest on top */}
          <ol className="relative" aria-label="Recent commits">
            <span className="absolute top-2 bottom-2 left-[5px] w-px bg-cyan-line" aria-hidden />
            {status.commits.map((c, i) => (
              <li key={c.hash} className="relative flex gap-3 py-1 pl-0">
                <span
                  className={`relative z-10 mt-[5px] size-[11px] shrink-0 border ${
                    i === 0 ? 'border-cyan bg-cyan shadow-[0_0_8px_var(--color-cyan)]' : 'border-cyan/60 bg-void'
                  } ${c.merge ? 'rotate-45' : 'rounded-full'}`}
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12px] text-ink" title={c.subject}>
                    {c.merge && <GitMerge size={11} className="mr-1 inline text-orange" aria-label="merge" />}
                    {c.subject}
                  </p>
                  <p className="truncate text-[10px] text-dim">
                    <span className="text-cyan/70">{c.hash}</span> {c.author === ME ? 'you' : c.author}, {c.when}
                  </p>
                </div>
              </li>
            ))}
            {status.commits.length === 0 && <li className="text-[12px] text-dim">No commits yet.</li>}
          </ol>
        </div>
      )}
    </Widget>
  )
}

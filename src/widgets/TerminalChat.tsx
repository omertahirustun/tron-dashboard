import { AnimatePresence, motion } from 'framer-motion'
import { Bot, ScrollText, SquareTerminal, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState, type CSSProperties, type FormEvent, type KeyboardEvent, type PointerEvent } from 'react'
import { TronButton } from '../components/TronButton'
import { Widget } from '../components/Widget'
import { useDashboard } from '../layout/DashboardContext'
import { sfx } from '../lib/sfx'
import { native } from '../native/api'
import { streamReply } from '../services/claude'
import { useOfficeStore, type ChatModel, type LogLevel } from '../store/useOfficeStore'
import { ShellView } from './terminal/ShellView'

const PROMPT = 'OMERTAHIRUSTUN@AGENT-OFFICE:~$ '

const MODEL_LABEL: Record<ChatModel, string> = {
  'claude-opus-5-5': 'Opus 5.5',
  'claude-sonnet-5-5': 'Sonnet 5.5',
  'claude-haiku-5-5': 'Haiku 5.5',
  'claude-fable-5-1': 'Fable 5.1',
}

type Mode = 'shell' | 'claude'
type Pane = 'shell' | 'logs'

const levelColor: Record<LogLevel, string> = {
  info: 'text-dim',
  ok: 'text-ok',
  warn: 'text-orange',
  error: 'text-crit',
}

// Dashboard commands start with ":" so they never collide with shell input
const APP_COMMANDS = ['help', 'clear', 'layout', 'tasks', 'run', 'stop', 'schedule', 'agent', 'workspace', 'budget', 'mode']

// Background process lines shown while a prompt is handled: [delay ms, text]
const BOOT_SEQUENCE: Array<[number, string]> = [
  [0, '[LOG] INITIALIZING SUB-ROUTINES... [OK]'],
  [180, '[LOG] LOADING VAULT CONTEXT... [OK]'],
  [380, '[LOG] ROUTING PROMPT → {agent}... [OK]'],
  [620, '[LOG] OPENING RESPONSE STREAM... [OK]'],
]
const THINK_MS = 900

export function TerminalChat() {
  const { setLocked, resetLayout } = useDashboard()
  const lines = useOfficeStore((s) => s.terminalLogs)
  const messages = useOfficeStore((s) => s.chat)
  const activeAgent = useOfficeStore((s) => s.activeAgentLabel)
  const chatModel = useOfficeStore((s) => s.chatModel)
  const [mode, setMode] = useState<Mode>(native ? 'shell' : 'claude')
  const [pane, setPane] = useState<Pane>(native ? 'shell' : 'logs')
  const [seenLogs, setSeenLogs] = useState(0)
  const [input, setInput] = useState('')
  const [history, setHistory] = useState<string[]>([])
  const [histIdx, setHistIdx] = useState(-1)
  const [split, setSplit] = useState(40)

  const inputRef = useRef<HTMLInputElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const chatBox = useRef<HTMLDivElement>(null)
  const logBox = useRef<HTMLDivElement>(null)
  const stickLogs = useRef(true)
  const abort = useRef<AbortController | null>(null)
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>())

  const later = (ms: number, fn: () => void) => {
    const t = setTimeout(() => {
      timers.current.delete(t)
      fn()
    }, ms)
    timers.current.add(t)
  }

  useEffect(() => {
    const pending = timers.current
    return () => {
      abort.current?.abort()
      pending.forEach(clearTimeout)
    }
  }, [])

  useEffect(() => {
    // scroll the pane itself; scrollIntoView would also scroll the page
    const el = chatBox.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages])

  useEffect(() => {
    const el = logBox.current
    if (el && stickLogs.current) el.scrollTop = el.scrollHeight
  }, [lines, pane])

  const lastLogId = lines.at(-1)?.id ?? 0
  const unread = pane === 'logs' ? 0 : lines.filter((l) => l.id > seenLogs).length
  const showPane = (next: Pane) => {
    setPane(next)
    setSeenLogs(lastLogId)
    sfx.emit('toggle', { source: 'terminal.pane', pane: next })
  }

  const busy = messages.some((m) => m.streaming)

  function log(text: string, level: LogLevel = 'info', source = 'sh') {
    useOfficeStore.getState().addTerminalLog(text, { source, level })
  }

  const switchMode = (next: Mode = mode === 'shell' ? 'claude' : 'shell') => {
    if (next === 'shell' && !native) return log('The shell is only available in the desktop app', 'warn')
    setMode(next)
    sfx.emit('toggle', { source: 'terminal.mode', mode: next })
    inputRef.current?.focus()
  }

  function ask(prompt: string) {
    const { addChatMessage, appendToChatMessage, finishChatMessage } = useOfficeStore.getState()
    const agent = useOfficeStore.getState().activeAgentLabel
    addChatMessage({ role: 'user', text: prompt })
    // empty streaming message = "typing" indicator until the first words arrive
    const replyId = addChatMessage({ role: 'claude', text: '', streaming: true })

    for (const [delay, text] of BOOT_SEQUENCE) later(delay, () => log(text.replace('{agent}', agent), 'ok', 'kernel'))

    later(THINK_MS, async () => {
      const ctrl = new AbortController()
      abort.current = ctrl
      let words = 0
      for await (const delta of streamReply(prompt, ctrl.signal)) {
        appendToChatMessage(replyId, delta)
        words++
      }
      finishChatMessage(replyId)
      if (!ctrl.signal.aborted) log(`[LOG] STREAM CLOSED (${words} words) [OK]`, 'ok', 'kernel')
    })
  }

  async function runAppCommand(raw: string) {
    const [cmd, ...args] = raw.slice(1).trim().split(/\s+/)
    const store = useOfficeStore.getState()
    const out = (text: string, level: LogLevel = 'info') => log(text, level, 'app')
    out(`> ${raw}`, 'ok')
    if (pane !== 'logs') showPane('logs')
    switch (cmd) {
      case 'help':
        out('Input modes: shell runs commands in fish, claude sends a message. Ctrl+K switches.')
        out(':clear [chat|logs]   :layout reset|lock|unlock   :mode shell|claude')
        out(':tasks   :run <task>   :stop <task>   :schedule <task> <minutes>')
        out(':agent <name>   :workspace list|add <path>   :budget <usd per day>')
        return
      case 'clear':
        if (args[0] !== 'logs') store.clearChat()
        if (args[0] !== 'chat') store.clearTerminalLogs()
        return
      case 'mode':
        if (args[0] === 'shell' || args[0] === 'claude') switchMode(args[0])
        else out('usage: :mode shell | claude', 'warn')
        return
      case 'layout':
        if (args[0] === 'reset') {
          resetLayout()
          out('layout restored to default', 'ok')
        } else if (args[0] === 'lock' || args[0] === 'unlock') {
          setLocked(args[0] === 'lock')
          out(`layout ${args[0]}ed`, 'ok')
        } else out('usage: :layout reset | lock | unlock', 'warn')
        return
      case 'tasks':
        for (const t of store.taskQueue) out(`${t.id.padEnd(10)} ${t.status.padEnd(9)} ${t.command}`)
        return
      case 'run':
      case 'stop':
      case 'schedule': {
        const task = store.taskQueue.find((t) => t.id === args[0])
        if (!task) return out(`unknown task "${args[0] ?? ''}"; see :tasks`, 'warn')
        const clean = (e: unknown) => (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
        if (!native) {
          // browser: simulated run
          if (cmd !== 'run') return out('stop/schedule need the desktop app', 'warn')
          store.setTaskStatus(task.id, 'running')
          out(`[TASK] ${task.command} started (simulated)`, 'ok')
          later(4000, () => {
            useOfficeStore.getState().setTaskStatus(task.id, 'done')
            log(`[TASK] ${task.command} finished [OK]`, 'ok', 'task')
          })
          return
        }
        try {
          if (cmd === 'run') await native.startTask(task.id)
          else if (cmd === 'stop') await native.stopTask(task.id)
          else {
            const minutes = Number(args[1])
            if (!(minutes > 0)) return out('usage: :schedule <task> <minutes>', 'warn')
            await native.scheduleTask(task.id, minutes * 60)
            out(`[TASK] ${task.name} scheduled in ${minutes} min`, 'ok')
          }
        } catch (e) {
          out(clean(e), 'error')
        }
        return
      }
      case 'budget': {
        const usd = Number(args[0])
        if (!native) return out('the budget is stored by the desktop app', 'warn')
        if (!(usd > 0)) return out('usage: :budget <usd per day>', 'warn')
        store.setClaudeStats(await native.setDailyBudget(usd))
        out(`[LOG] Daily budget set to $${usd}`, 'ok')
        return
      }
      case 'agent': {
        const q = args.join(' ').toLowerCase()
        if (!q) {
          for (const a of store.agentOptions) out(`${a.id === store.activeAgent ? '›' : ' '} ${a.label}`)
          return
        }
        const agent = store.agentOptions.find((a) => a.label.toLowerCase() === q) ?? store.agentOptions.find((a) => a.label.toLowerCase().includes(q))
        if (!agent) return out(`no agent matches "${q}"; :agent lists them`, 'warn')
        store.setActiveAgent(agent.id)
        out(`[LOG] Linked to agent: ${agent.label}`, 'ok')
        return
      }
      case 'workspace': {
        if (args[0] === 'list' || !args[0]) {
          if (!store.workspaceRoots.length) out('no workspace folders (desktop app only)', 'warn')
          for (const r of store.workspaceRoots) out(`${r.isGit ? 'git ' : '    '}${r.path}`)
          return
        }
        if (args[0] === 'add' && args[1]) {
          if (!native) return out('workspace folders need the desktop app', 'warn')
          try {
            const added = await native.addWorkspaceRoot(args.slice(1).join(' '))
            store.reloadWorkspace()
            out(`[LOG] Added workspace folder ${added}`, 'ok')
          } catch (e) {
            out(`cannot add folder: ${(e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')}`, 'error')
          }
          return
        }
        out('usage: :workspace list | add <path>', 'warn')
        return
      }
      default:
        out(`unknown command ":${cmd}"; try :help`, 'warn')
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    const value = input.trim()
    if (!value) {
      // bare Enter in shell mode still reaches the shell (e.g. to answer a prompt)
      if (mode === 'shell') native?.writeShell('\r')
      return
    }
    sfx.emit('submit', { source: 'terminal.input', mode })
    setHistory((h) => [...h, value])
    setHistIdx(-1)
    setInput('')
    if (value.startsWith(':') && APP_COMMANDS.includes(value.slice(1).split(/\s+/)[0])) return void runAppCommand(value)
    if (mode === 'shell' && native) {
      if (pane !== 'shell') showPane('shell')
      native.executeCommand(value)
      return
    }
    if (busy) log('Claude is still replying; send again when it finishes', 'warn')
    else ask(value)
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'k' && e.ctrlKey) {
      e.preventDefault()
      switchMode()
    } else if (e.key === 'c' && e.ctrlKey && mode === 'shell' && !input) {
      // Ctrl+C with an empty line interrupts the running shell command
      e.preventDefault()
      native?.writeShell('\x03')
    } else if (e.key === 'ArrowUp' && history.length) {
      e.preventDefault()
      const i = histIdx === -1 ? history.length - 1 : Math.max(0, histIdx - 1)
      setHistIdx(i)
      setInput(history[i])
    } else if (e.key === 'ArrowDown' && histIdx !== -1) {
      e.preventDefault()
      const i = histIdx + 1
      setHistIdx(i >= history.length ? -1 : i)
      setInput(i >= history.length ? '' : history[i])
    } else if (e.key === 'Tab' && input.startsWith(':') && !input.includes(' ')) {
      const match = APP_COMMANDS.find((c) => c.startsWith(input.slice(1)))
      if (match) {
        e.preventDefault()
        setInput(`:${match} `)
      }
    } else if (e.key.length === 1) {
      sfx.emit('key', { source: 'terminal.input' })
    }
  }

  // draggable splitter between chat and shell/logs
  function startSplit(e: PointerEvent<HTMLDivElement>) {
    const body = bodyRef.current
    if (!body) return
    e.currentTarget.setPointerCapture(e.pointerId)
    const rect = body.getBoundingClientRect()
    const move = (ev: globalThis.PointerEvent) =>
      setSplit(Math.min(75, Math.max(20, ((ev.clientX - rect.left) / rect.width) * 100)))
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      sfx.emit('resize-stop', { source: 'terminal.split' })
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const tabs: Array<{ id: Pane; label: string; icon: typeof SquareTerminal }> = [
    { id: 'shell', label: native ? 'fish' : 'shell', icon: SquareTerminal },
    { id: 'logs', label: 'logs', icon: ScrollText },
  ]

  return (
    <Widget
      title="command.center"
      icon={SquareTerminal}
      flush
      status={
        busy ? (
          <span className="text-orange">{activeAgent} is replying…</span>
        ) : (
          <span>
            chat: {activeAgent}, {MODEL_LABEL[chatModel]}
          </span>
        )
      }
      actions={
        <TronButton sfxSource="terminal.clear" onClick={() => void runAppCommand(':clear')} aria-label="Clear chat and logs">
          <Trash2 size={12} />
        </TronButton>
      }
    >
      <div className="@container flex h-full flex-col">
        {/* side by side when wide, stacked when the panel is narrow */}
        <div
          ref={bodyRef}
          className="flex min-h-0 flex-1 flex-col @2xl:flex-row"
          style={{ '--split': `${split}%` } as CSSProperties}
        >
          {/* chat */}
          <div
            ref={chatBox}
            onClick={() => window.getSelection()?.isCollapsed && inputRef.current?.focus()}
            className="min-h-0 min-w-0 flex-1 overflow-auto px-3 py-2 @2xl:w-(--split) @2xl:flex-none"
            aria-live="polite"
          >
            <AnimatePresence initial={false}>
              {messages.map((m) => (
                <motion.div
                  key={m.id}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`mb-2 flex gap-2 ${m.role === 'user' ? 'justify-end' : ''}`}
                >
                  {m.role === 'claude' && <Bot size={14} className="mt-0.5 shrink-0 text-cyan" aria-hidden />}
                  <p
                    className={`max-w-[85%] whitespace-pre-wrap px-2.5 py-1.5 text-[12px] ${
                      m.role === 'user' ? 'border border-cyan-line bg-cyan-soft text-white' : 'border-l border-cyan/40 text-ink'
                    }`}
                  >
                    {m.text}
                    {m.streaming &&
                      (m.text ? (
                        <span className="caret ml-0.5" />
                      ) : (
                        <span className="inline-flex gap-1 py-1" aria-label={`${activeAgent} is typing`}>
                          {[0, 1, 2].map((i) => (
                            <motion.span
                              key={i}
                              className="size-1.5 bg-cyan"
                              animate={{ opacity: [0.2, 1, 0.2] }}
                              transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.15 }}
                            />
                          ))}
                        </span>
                      ))}
                  </p>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>

          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize chat and shell"
            onPointerDown={startSplit}
            className="no-drag group relative h-px shrink-0 bg-cyan-line @2xl:h-auto @2xl:w-2 @2xl:cursor-col-resize @2xl:bg-transparent"
          >
            <span className="absolute inset-y-0 left-1/2 hidden w-px bg-cyan-line transition-colors group-hover:bg-cyan @2xl:block" />
          </div>

          {/* shell + logs */}
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div role="tablist" aria-label="Output" className="no-drag flex shrink-0 gap-1 border-b border-cyan-line/60 px-2 pt-1.5">
              {tabs.map(({ id, label, icon: Icon }) => (
                <motion.button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={pane === id}
                  whileTap={{ scale: 0.95 }}
                  onMouseEnter={() => sfx.emit('hover', { source: 'terminal.tab' })}
                  onClick={() => showPane(id)}
                  className={`relative flex items-center gap-1.5 px-2.5 pb-1.5 text-[11px] transition-colors ${
                    pane === id ? 'text-cyan' : 'text-dim hover:text-ink'
                  }`}
                >
                  <Icon size={12} aria-hidden />
                  {label}
                  {id === 'logs' && unread > 0 && (
                    <span className="bg-orange px-1 text-[10px] leading-4 font-bold text-void tabular-nums">{unread > 99 ? '99+' : unread}</span>
                  )}
                  {pane === id && (
                    <motion.span layoutId="terminal-tab" className="absolute inset-x-0 -bottom-px h-[2px] bg-cyan shadow-[0_0_8px_var(--color-cyan)]" />
                  )}
                </motion.button>
              ))}
            </div>
            {/* the shell stays mounted while hidden so its screen is kept */}
            <div className={`min-h-0 flex-1 ${pane === 'shell' ? '' : 'hidden'}`}>
              <ShellView />
            </div>
            <div
              ref={logBox}
              onScroll={(e) => {
                const el = e.currentTarget
                stickLogs.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
              }}
              className={`min-h-0 flex-1 overflow-auto px-3 py-1.5 text-[11px] leading-[1.6] ${pane === 'logs' ? '' : 'hidden'}`}
              role="log"
              aria-label="Streaming logs"
            >
              {lines.map((l) => (
                <div key={l.id} className="flex gap-2 whitespace-pre-wrap">
                  <span className="shrink-0 text-dim/70 tabular-nums">{l.time}</span>
                  <span className={`w-16 shrink-0 truncate ${levelColor[l.level]}`}>{l.source}</span>
                  <span className={`min-w-0 ${l.level === 'info' ? 'text-ink/80' : levelColor[l.level]}`}>{l.text}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <form onSubmit={submit} className="no-drag flex items-center gap-2 border-t border-cyan-line/60 bg-black/40 px-3 py-2">
          <button
            type="button"
            onClick={() => switchMode()}
            title="Switch input mode (Ctrl+K)"
            className={`shrink-0 border px-1.5 text-[10px] leading-5 font-bold transition-colors ${
              mode === 'shell' ? 'border-cyan/50 text-cyan hover:bg-cyan-soft' : 'border-orange/60 text-orange hover:bg-orange-soft'
            }`}
          >
            {mode}
          </button>
          <label htmlFor="cli" className="shrink-0 whitespace-pre text-[12px] font-bold text-cyan">
            {mode === 'shell' ? PROMPT : `ask ${activeAgent} › `}
          </label>
          <input
            id="cli"
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            autoComplete="off"
            spellCheck={false}
            placeholder={
              mode === 'shell'
                ? 'command for fish, or :help'
                : busy
                  ? 'waiting for reply…'
                  : 'message for Claude, or :help'
            }
            className="min-w-0 flex-1 bg-transparent text-[12px] text-white caret-orange outline-none placeholder:text-dim/60"
          />
        </form>
      </div>
    </Widget>
  )
}

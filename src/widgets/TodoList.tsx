import { AnimatePresence, motion } from 'framer-motion'
import { Check, ListTodo, Plus, Trash2, X } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { TronButton } from '../components/TronButton'
import { Widget } from '../components/Widget'
import { sfx } from '../lib/sfx'

// Personal to-do list. Kept in this app's localStorage (the desktop app's
// storage persists in its profile folder); nothing leaves the machine.

interface Todo {
  id: number
  text: string
  done: boolean
  /** high priority: drawn in orange and kept on top */
  urgent: boolean
  createdAt: number
}

type Filter = 'open' | 'all' | 'done'

const KEY = 'aod.todos.v1'

function loadTodos(): Todo[] {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as Todo[]) : []
  } catch {
    return []
  }
}

export function TodoList() {
  const [todos, setTodos] = useState<Todo[]>(loadTodos)
  const [draft, setDraft] = useState('')
  const [filter, setFilter] = useState<Filter>('open')
  const [editing, setEditing] = useState<number | null>(null)

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(todos))
    } catch {
      // storage unavailable: the list lasts until the window closes
    }
  }, [todos])

  const add = (e: FormEvent) => {
    e.preventDefault()
    // a leading "!" marks it urgent
    const urgent = draft.trimStart().startsWith('!')
    const text = draft.trim().replace(/^!\s*/, '')
    if (!text) return
    sfx.emit('click', { source: 'todo.add' })
    setTodos((t) => [{ id: Date.now(), text, done: false, urgent, createdAt: Date.now() }, ...t])
    setDraft('')
  }
  const update = (id: number, patch: Partial<Todo>) => setTodos((t) => t.map((x) => (x.id === id ? { ...x, ...patch } : x)))
  const remove = (id: number) => {
    sfx.emit('click', { source: 'todo.delete' })
    setTodos((t) => t.filter((x) => x.id !== id))
  }

  const open = todos.filter((t) => !t.done).length
  const doneCount = todos.length - open
  const shown = todos
    .filter((t) => (filter === 'all' ? true : filter === 'open' ? !t.done : t.done))
    // open before done, urgent first, then newest
    .sort((a, b) => +a.done - +b.done || +b.urgent - +a.urgent || b.createdAt - a.createdAt)

  return (
    <Widget
      title="todo.list"
      icon={ListTodo}
      status={<span className={open ? 'text-cyan' : 'text-ok'}>{open ? `${open} open` : 'all done'}</span>}
      actions={
        doneCount > 0 && (
          <TronButton sfxSource="todo.clear" onClick={() => setTodos((t) => t.filter((x) => !x.done))} aria-label="Remove finished items" title="Remove finished">
            <Trash2 size={12} />
          </TronButton>
        )
      }
      flush
    >
      <div className="flex h-full flex-col">
        <form onSubmit={add} className="flex items-center gap-1.5 border-b border-cyan-line/60 px-3 py-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Add a task… (start with ! for urgent)"
            aria-label="New task"
            className="no-drag min-w-0 flex-1 border border-cyan-line/60 bg-void/60 px-2 py-1 text-[12px] text-ink outline-none placeholder:text-dim/70 focus:border-cyan"
          />
          <TronButton sfxSource="todo.add" variant="solid" type="submit" aria-label="Add task" disabled={!draft.trim()}>
            <Plus size={12} />
          </TronButton>
        </form>
        <div className="flex gap-1 px-3 pt-2 text-[11px]" role="tablist" aria-label="Filter tasks">
          {(['open', 'all', 'done'] as Filter[]).map((f) => (
            <button
              key={f}
              type="button"
              role="tab"
              aria-selected={filter === f}
              onClick={() => {
                sfx.emit('click', { source: 'todo.filter', filter: f })
                setFilter(f)
              }}
              className={`no-drag border px-2 py-0.5 transition-colors ${filter === f ? 'border-cyan-line bg-cyan-soft text-cyan' : 'border-transparent text-dim hover:text-ink'}`}
            >
              {f} {f === 'open' ? open : f === 'done' ? doneCount : todos.length}
            </button>
          ))}
        </div>
        <ul className="min-h-0 flex-1 overflow-auto px-1.5 py-1.5">
          <AnimatePresence initial={false}>
            {shown.map((t) => (
              <motion.li
                key={t.id}
                layout
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 8 }}
                transition={{ duration: 0.15 }}
                className="group flex items-center gap-2 px-1.5 py-1 hover:bg-cyan/5"
              >
                <button
                  type="button"
                  onClick={() => {
                    sfx.emit('toggle', { source: 'todo.check', done: !t.done })
                    update(t.id, { done: !t.done })
                  }}
                  aria-label={t.done ? `Mark "${t.text}" as not done` : `Mark "${t.text}" as done`}
                  className={`no-drag flex size-3.5 shrink-0 items-center justify-center border transition-colors ${
                    t.done ? 'border-ok bg-ok/20 text-ok' : t.urgent ? 'border-orange hover:bg-orange-soft' : 'border-cyan/60 hover:bg-cyan-soft'
                  }`}
                >
                  {t.done && <Check size={10} strokeWidth={3} aria-hidden />}
                </button>
                {editing === t.id ? (
                  <input
                    autoFocus
                    defaultValue={t.text}
                    aria-label="Edit task"
                    className="no-drag min-w-0 flex-1 border border-cyan bg-void/60 px-1 text-[12px] text-ink outline-none"
                    onBlur={(e) => {
                      const text = e.target.value.trim()
                      if (text) update(t.id, { text })
                      setEditing(null)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') e.currentTarget.blur()
                      if (e.key === 'Escape') setEditing(null)
                    }}
                  />
                ) : (
                  <span
                    onDoubleClick={() => setEditing(t.id)}
                    title="Double-click to edit"
                    className={`min-w-0 flex-1 truncate text-[12px] ${t.done ? 'text-dim line-through' : t.urgent ? 'text-orange' : 'text-ink'}`}
                  >
                    {t.text}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => update(t.id, { urgent: !t.urgent })}
                  aria-label={t.urgent ? 'Unmark urgent' : 'Mark urgent'}
                  title={t.urgent ? 'Urgent' : 'Mark urgent'}
                  className={`no-drag shrink-0 px-1 text-[11px] font-bold ${t.urgent ? 'text-orange' : 'text-dim opacity-0 group-hover:opacity-100 focus:opacity-100'}`}
                >
                  !
                </button>
                <button
                  type="button"
                  onClick={() => remove(t.id)}
                  aria-label={`Delete "${t.text}"`}
                  className="no-drag shrink-0 text-dim opacity-0 hover:text-crit group-hover:opacity-100 focus:opacity-100"
                >
                  <X size={12} />
                </button>
              </motion.li>
            ))}
          </AnimatePresence>
          {shown.length === 0 && (
            <li className="px-1.5 py-2 text-[12px] text-dim">{filter === 'done' ? 'Nothing finished yet.' : todos.length ? 'Nothing open. Nice.' : 'No tasks yet. Type one above.'}</li>
          )}
        </ul>
      </div>
    </Widget>
  )
}

import { AppWindow, ListMusic, Music2, RefreshCw, Pause, Play, Search, SkipBack, SkipForward, Volume2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { TronButton } from '../components/TronButton'
import { Widget } from '../components/Widget'
import { sfx } from '../lib/sfx'
import { native, type MusicPlaylist, type MusicState } from '../native/api'
import { useOfficeStore } from '../store/useOfficeStore'
import { NeonRing } from './music/NeonRing'

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

const SAMPLE: MusicState = {
  ready: true, title: 'Derezzed', artist: 'Daft Punk', album: 'TRON: Legacy', art: '', playing: false,
  current: 42, duration: 104, volume: 80, ad: false, signedIn: false, visible: false, at: 0,
}

export function MusicControl() {
  const [state, setState] = useState<MusicState | null>(native ? null : SAMPLE)
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const lastTitle = useRef('')
  const [showLists, setShowLists] = useState(false)
  const [lists, setLists] = useState<{ signedIn: boolean; items: MusicPlaylist[] } | null>(null)
  const [listsLoading, setListsLoading] = useState(false)

  const loadLists = () => {
    if (!native) return
    setListsLoading(true)
    native
      .getPlaylists()
      .then(setLists)
      .catch((e: Error) => setNote(e.message))
      .finally(() => setListsLoading(false))
  }
  const toggleLists = () => {
    const next = !showLists
    setShowLists(next)
    if (next && !lists) loadLists()
  }
  const playList = (p: MusicPlaylist) => {
    sfx.emit('select', { source: 'music.playlist', id: p.id })
    void native?.playPlaylist(p.id).catch((e: Error) => setNote(e.message))
    setShowLists(false)
  }

  // The YouTube Music window (hidden) starts on first use: search, play, a
  // playlist or the sign-in window. Until then it would hold a few hundred MB and
  // be polled every second for nothing. Once open it reports every second.
  useEffect(() => {
    if (!native) return
    void native.getMusicState().then((s) => s && setState(s))
    return native.onMusicState(setState)
  }, [])

  useEffect(() => {
    if (!state?.title || state.ad || state.title === lastTitle.current) return
    lastTitle.current = state.title
    useOfficeStore.getState().addTerminalLog(`[LOG] Now playing: ${state.title} · ${state.artist}`, { source: 'yt.music' })
  }, [state?.title, state?.artist, state?.ad])

  const playing = !!state?.playing
  const call = (fn: () => Promise<unknown> | undefined, source: string) => {
    sfx.emit('click', { source })
    void fn()?.catch((e: Error) => setNote(e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')))
  }

  const search = () => {
    const q = query.trim()
    if (!q || !native) return
    setBusy(true)
    setNote('')
    native
      .musicSearch(q)
      .then((ok) => {
        if (!ok) setNote(`nothing found for “${q}”`)
        else setQuery('')
      })
      .catch((e: Error) => setNote(e.message))
      .finally(() => setBusy(false))
  }

  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!state?.duration) return
    const r = e.currentTarget.getBoundingClientRect()
    call(() => native?.musicSeek((e.clientX - r.left) / r.width), 'music.seek')
  }

  const controls = (
    <div className="flex items-center gap-2">
      <TronButton sfxSource="music.prev" onClick={() => call(() => native?.musicPrevious(), 'music.prev')} aria-label="Previous track" disabled={!native}>
        <SkipBack size={14} />
      </TronButton>
      <TronButton sfxSource="music.play" variant="solid" onClick={() => call(() => native?.musicToggle(), 'music.play')} aria-label={playing ? 'Pause' : 'Play'} className="px-3" disabled={!native}>
        {playing ? <Pause size={14} /> : <Play size={14} />}
      </TronButton>
      <TronButton sfxSource="music.next" onClick={() => call(() => native?.musicNext(), 'music.next')} aria-label="Next track" disabled={!native}>
        <SkipForward size={14} />
      </TronButton>
      <label className="no-drag ml-1 flex items-center gap-1 text-dim" title="Volume">
        <Volume2 size={12} aria-hidden />
        <input
          type="range"
          min={0}
          max={100}
          value={state?.volume ?? 100}
          disabled={!native}
          onChange={(e) => {
            const v = Number(e.target.value)
            setState((s) => (s ? { ...s, volume: v } : s))
            void native?.musicVolume(v)
          }}
          aria-label="Volume"
          className="h-1 w-16 accent-[var(--color-cyan)]"
        />
      </label>
    </div>
  )

  return (
    <Widget
      title="yt.music"
      icon={Music2}
      status={!native ? <span className="text-orange">sample</span> : state?.ad ? <span className="text-orange" title="Sign in with YouTube Premium in the YouTube Music window to skip ads">ad</span> : playing ? <span className="text-cyan">playing</span> : state?.ready ? 'paused' : state ? 'loading…' : 'off'}
      actions={
        native && (
          <>
          <TronButton sfxSource="music.lists" variant={showLists ? 'solid' : 'ghost'} onClick={toggleLists} title="Your playlists">
            <ListMusic size={12} />
          </TronButton>
          <TronButton sfxSource="music.window" variant={state?.visible ? 'solid' : 'ghost'} onClick={() => void native?.showMusicWindow()} title="Show / hide the YouTube Music window (sign in, playlists)">
            <AppWindow size={12} />
          </TronButton>
          </>
        )
      }
    >
      <div className="flex h-full flex-col gap-2">
        <form
          className="no-drag flex items-center gap-1.5 border border-cyan-line/70 bg-[#04090c]/90 px-2 py-1 focus-within:border-cyan"
          onSubmit={(e) => {
            e.preventDefault()
            search()
          }}
        >
          <Search size={12} className="shrink-0 text-dim" aria-hidden />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search YouTube Music, Enter plays…"
            aria-label="Search YouTube Music"
            disabled={!native || busy}
            className="min-w-0 flex-1 bg-transparent text-[12px] text-ink outline-none placeholder:text-dim/70"
          />
          {busy && <span className="text-[10px] text-dim">…</span>}
        </form>
        {showLists ? (
          <div className="no-drag min-h-0 flex-1 overflow-auto">
            {listsLoading && !lists ? (
              <p className="text-[11px] text-dim">Reading your library…</p>
            ) : lists && !lists.signedIn ? (
              <div className="space-y-2 text-[11px] text-dim">
                <p>Not signed in. Open the YouTube Music window, sign in with your Premium account, then refresh.</p>
                <div className="flex gap-1">
                  <TronButton sfxSource="music.window" onClick={() => void native?.showMusicWindow()}>
                    <AppWindow size={12} /> sign in
                  </TronButton>
                  <TronButton sfxSource="music.lists.refresh" onClick={loadLists}>
                    <RefreshCw size={12} className={listsLoading ? 'animate-spin' : ''} /> refresh
                  </TronButton>
                </div>
              </div>
            ) : (
              <ul className="space-y-0.5" aria-label="Playlists">
                {[{ id: 'LM', title: 'Liked music', sub: 'auto playlist', art: '' }, ...(lists?.items.filter((p) => p.id !== 'LM') ?? [])].map((p) => (
                  <li key={p.id}>
                    <button type="button" onClick={() => playList(p)} className="flex w-full items-center gap-2 px-1 py-0.5 text-left hover:bg-cyan-soft">
                      {p.art ? (
                        <img src={p.art} alt="" className="size-7 shrink-0 object-cover" referrerPolicy="no-referrer" />
                      ) : (
                        <span className="flex size-7 shrink-0 items-center justify-center border border-cyan-line text-cyan">
                          <ListMusic size={12} />
                        </span>
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12px] text-ink">{p.title}</span>
                        {p.sub && <span className="block truncate text-[10px] text-dim">{p.sub}</span>}
                      </span>
                    </button>
                  </li>
                ))}
                <li>
                  <button type="button" onClick={loadLists} className="mt-1 flex items-center gap-1 px-1 text-[10px] text-dim hover:text-cyan">
                    <RefreshCw size={10} className={listsLoading ? 'animate-spin' : ''} /> refresh
                  </button>
                </li>
              </ul>
            )}
          </div>
        ) : (
        <div className="flex min-h-0 flex-1 items-center gap-3">
          <div className="aspect-square h-full max-w-[55%] shrink-0">
            <NeonRing playing={playing && !state?.ad} art={state?.ad ? '' : state?.art ?? ''} title={state?.ad ? '' : state?.title ?? ''} />
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <div className="min-w-0">
              <p className="truncate text-[13px] font-bold text-white [text-shadow:0_0_10px_rgb(13_230_255/0.45)]">{state?.ad ? 'Advertisement' : state?.title || 'Nothing playing'}</p>
              <p className="truncate text-[11px] text-dim">
                {state?.ad ? 'your track starts after it' : state?.title ? state.artist : note || 'search above, or press play for a quick pick'}
              </p>
            </div>
            <div>
              <div className="no-drag h-[3px] cursor-pointer bg-cyan/10" onClick={seek} role="slider" aria-label="Seek" aria-valuemin={0} aria-valuemax={Math.round(state?.duration ?? 0)} aria-valuenow={Math.round(state?.current ?? 0)}>
                <div className="h-full bg-cyan shadow-[0_0_6px_var(--color-cyan)]" style={{ width: `${state?.duration ? (state.current / state.duration) * 100 : 0}%` }} />
              </div>
              <div className="mt-0.5 flex justify-between text-[10px] tabular-nums text-dim">
                <span>{fmt(state?.current ?? 0)}</span>
                <span>{fmt(state?.duration ?? 0)}</span>
              </div>
            </div>
            {controls}
          </div>
        </div>
        )}
        {showLists && <div className="mt-auto">{controls}</div>}
      </div>
    </Widget>
  )
}

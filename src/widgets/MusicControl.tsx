import { motion, useReducedMotion } from 'framer-motion'
import { Music2, Pause, Play, SkipBack, SkipForward } from 'lucide-react'
import { useEffect, useState } from 'react'
import { TronButton } from '../components/TronButton'
import { Widget } from '../components/Widget'
import { sfx } from '../lib/sfx'
import { useOfficeStore } from '../store/useOfficeStore'

// Mock playlist until the YT Music bridge exists (e.g. ytmusicapi on the local agent).
const PLAYLIST = [
  { title: 'Derezzed', artist: 'Daft Punk', length: 104 },
  { title: 'The Grid', artist: 'Daft Punk', length: 97 },
  { title: 'End of Line', artist: 'Daft Punk', length: 157 },
  { title: 'Solar Sailer', artist: 'Daft Punk', length: 162 },
]
const BARS = 28

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

function Disc({ playing }: { playing: boolean }) {
  const reduce = useReducedMotion()
  return (
    <motion.div
      className="relative size-16 shrink-0 rounded-full border border-cyan/50"
      style={{
        background:
          'repeating-radial-gradient(circle, #071216 0 2px, #0b1c22 2px 4px), radial-gradient(circle, #0b1c22, #04090c)',
      }}
      animate={reduce ? undefined : { rotate: playing ? 360 : 0 }}
      transition={playing ? { duration: 4, repeat: Infinity, ease: 'linear' } : { duration: 0.6 }}
      aria-hidden
    >
      {/* breathing glow while playing (CSS opacity pulse, see .glow-layer) */}
      {playing && <span className="glow-layer" style={{ animationDuration: '1.6s' }} />}
      {/* label + light streak so the rotation is visible */}
      <span className="absolute inset-[30%] rounded-full bg-[#071216] ring-1 ring-cyan/60" />
      <span className="absolute inset-[44%] rounded-full bg-orange shadow-[0_0_8px_var(--color-orange)]" />
      <span className="absolute top-1 left-1/2 h-3 w-px -translate-x-1/2 bg-cyan/70" />
    </motion.div>
  )
}

function Visualizer({ playing }: { playing: boolean }) {
  const reduce = useReducedMotion()
  // random but stable per-bar rhythm
  const [profile] = useState(() =>
    Array.from({ length: BARS }, (_, i) => ({
      peak: 0.35 + Math.random() * 0.65 * (1 - Math.abs(i - BARS / 2) / BARS),
      dur: 0.35 + Math.random() * 0.5,
    })),
  )
  return (
    <div className="flex h-10 items-end gap-[2px]" aria-hidden>
      {profile.map((p, i) => (
        <motion.span
          key={i}
          className="flex-1 origin-bottom bg-cyan"
          style={{ height: '100%', boxShadow: '0 0 6px rgb(13 230 255 / 0.6)' }}
          initial={{ scaleY: 0.08 }}
          animate={
            playing && !reduce ? { scaleY: [0.1, p.peak, 0.2, p.peak * 0.7, 0.1] } : { scaleY: 0.08 }
          }
          transition={playing && !reduce ? { duration: p.dur * 2, repeat: Infinity, ease: 'easeInOut' } : { duration: 0.3 }}
        />
      ))}
    </div>
  )
}

export function MusicControl() {
  const [index, setIndex] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const track = PLAYLIST[index]

  useEffect(() => {
    if (!playing) return
    const id = setInterval(() => setElapsed((e) => e + 1), 1000)
    return () => clearInterval(id)
  }, [playing])

  const go = (step: number) => {
    const next = (index + step + PLAYLIST.length) % PLAYLIST.length
    setIndex(next)
    setElapsed(0)
    useOfficeStore.getState().addTerminalLog(`[LOG] Now playing: ${PLAYLIST[next].title}`, { source: 'yt.music' })
  }

  // advance at the end of the track
  const ended = elapsed >= track.length
  useEffect(() => {
    if (ended) go(1)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only react to the track ending
  }, [ended])


  const toggle = () => {
    const next = !playing
    setPlaying(next)
    sfx.emit('toggle', { source: 'music.play', playing: next })
  }

  return (
    <Widget title="yt.music" icon={Music2} status={playing ? <span className="text-cyan">playing</span> : 'paused'}>
      <div className="flex h-full flex-col gap-3">
        <div className="flex items-center gap-3">
          <Disc playing={playing} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-bold text-white">{track.title}</p>
            <p className="truncate text-[11px] text-dim">{track.artist}</p>
            <div className="mt-2 h-[3px] bg-cyan/10">
              <div className="h-full bg-cyan shadow-[0_0_6px_var(--color-cyan)]" style={{ width: `${(elapsed / track.length) * 100}%` }} />
            </div>
            <div className="mt-1 flex justify-between text-[10px] tabular-nums text-dim">
              <span>{fmt(elapsed)}</span>
              <span>{fmt(track.length)}</span>
            </div>
          </div>
        </div>
        <Visualizer playing={playing} />
        <div className="mt-auto flex items-center justify-center gap-2">
          <TronButton sfxSource="music.prev" onClick={() => go(-1)} aria-label="Previous track">
            <SkipBack size={14} />
          </TronButton>
          <TronButton sfxSource="music.play" variant="solid" onClick={toggle} aria-label={playing ? 'Pause' : 'Play'} className="px-3">
            {playing ? <Pause size={14} /> : <Play size={14} />}
          </TronButton>
          <TronButton sfxSource="music.next" onClick={() => go(1)} aria-label="Next track">
            <SkipForward size={14} />
          </TronButton>
        </div>
      </div>
    </Widget>
  )
}

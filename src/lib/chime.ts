// Notification sounds, synthesized with Web Audio (no sample files):
//  - permission: an agent is waiting for an allow/deny — two bright rising
//    blips, played twice, so it is heard from across the room
//  - turn: an agent finished its turn — a soft falling two-note chime
// Muted state and volume live in localStorage.

export type Chime = 'permission' | 'turn'

const KEY = 'aod.sound.v1'

interface SoundSettings {
  muted: boolean
  volume: number // 0..1
}

function load(): SoundSettings {
  try {
    return { muted: false, volume: 0.6, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }
  } catch {
    return { muted: false, volume: 0.6 }
  }
}

let settings = load()
const listeners = new Set<() => void>()
let ctx: AudioContext | null = null
let lastAt: Record<Chime, number> = { permission: 0, turn: 0 }

function audio() {
  ctx ??= new AudioContext()
  if (ctx.state === 'suspended') void ctx.resume()
  return ctx
}

/** One enveloped tone with a quieter octave above for sheen. */
function tone(ac: AudioContext, out: AudioNode, freq: number, at: number, dur: number, type: OscillatorType, gain: number) {
  for (const [mult, g] of [
    [1, gain],
    [2, gain * 0.18],
  ] as const) {
    const osc = ac.createOscillator()
    const env = ac.createGain()
    osc.type = type
    osc.frequency.setValueAtTime(freq * mult, at)
    env.gain.setValueAtTime(0, at)
    env.gain.linearRampToValueAtTime(g, at + 0.012)
    env.gain.exponentialRampToValueAtTime(0.0001, at + dur)
    osc.connect(env).connect(out)
    osc.start(at)
    osc.stop(at + dur + 0.05)
  }
}

export const chime = {
  play(kind: Chime) {
    if (settings.muted) return
    // a burst of prompts (or several agents finishing together) rings once
    const now = performance.now()
    if (now - lastAt[kind] < 1500) return
    lastAt = { ...lastAt, [kind]: now }
    try {
      const ac = audio()
      const master = ac.createGain()
      master.gain.value = settings.volume
      // short feedback echo: the "grid" space
      const delay = ac.createDelay()
      const feedback = ac.createGain()
      delay.delayTime.value = 0.14
      feedback.gain.value = 0.28
      master.connect(ac.destination)
      master.connect(delay)
      delay.connect(feedback).connect(delay)
      delay.connect(ac.destination)
      const t = ac.currentTime + 0.02
      // the echo loop keeps its nodes alive: take it apart once it has died out
      setTimeout(() => {
        master.disconnect()
        delay.disconnect()
        feedback.disconnect()
      }, 3000)
      if (kind === 'permission') {
        for (const offset of [0, 0.42]) {
          tone(ac, master, 659.25, t + offset, 0.16, 'triangle', 0.32) // E5
          tone(ac, master, 987.77, t + offset + 0.11, 0.22, 'triangle', 0.32) // B5
        }
      } else {
        tone(ac, master, 783.99, t, 0.35, 'sine', 0.3) // G5
        tone(ac, master, 523.25, t + 0.13, 0.55, 'sine', 0.3) // C5
      }
    } catch {
      // no audio device: stay silent
    }
  },
  get: () => settings,
  set(next: Partial<SoundSettings>) {
    settings = { ...settings, ...next }
    try {
      localStorage.setItem(KEY, JSON.stringify(settings))
    } catch {
      // not persisted
    }
    listeners.forEach((l) => l())
  },
  subscribe(listener: () => void) {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },
}

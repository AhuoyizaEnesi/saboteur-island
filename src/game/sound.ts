/**
 * Tiny synthesized sound effects (Web Audio, no files). Browsers only allow
 * sound after a user gesture, so nothing plays until the first click or key.
 */

type Cue = 'bell' | 'pop' | 'alarm' | 'whoosh' | 'crash' | 'tick'

let ctx: AudioContext | null = null
let muted = typeof localStorage !== 'undefined' && (() => {
  try {
    return localStorage.getItem('si-muted') === '1'
  } catch {
    return false
  }
})()

export const isMuted = () => muted
export function setMuted(m: boolean) {
  muted = m
  try {
    localStorage.setItem('si-muted', m ? '1' : '0')
  } catch {
    // private mode: keep it for this page only
  }
}

/** The shared audio context, once a click or key has unlocked it. */
export const audioContext = () => ctx

/** Call from a click or key handler to allow sound. */
export function unlockSound() {
  if (typeof window === 'undefined') return
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AC) return
  ctx ??= new AC()
  if (ctx.state === 'suspended') void ctx.resume()
}

function tone(freq: number, start: number, dur: number, type: OscillatorType, gain: number, slideTo?: number) {
  if (!ctx) return
  const o = ctx.createOscillator()
  const g = ctx.createGain()
  o.type = type
  o.frequency.setValueAtTime(freq, start)
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, start + dur)
  g.gain.setValueAtTime(0.0001, start)
  g.gain.exponentialRampToValueAtTime(gain, start + 0.01)
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur)
  o.connect(g).connect(ctx.destination)
  o.start(start)
  o.stop(start + dur + 0.05)
}

function noise(start: number, dur: number, gain: number) {
  if (!ctx) return
  const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate)
  const d = buf.getChannelData(0)
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length)
  const s = ctx.createBufferSource()
  const g = ctx.createGain()
  g.gain.value = gain
  s.buffer = buf
  s.connect(g).connect(ctx.destination)
  s.start(start)
}

export function play(cue: Cue) {
  if (muted || !ctx || ctx.state !== 'running') return
  const t = ctx.currentTime
  if (cue === 'bell') {
    for (let i = 0; i < 3; i++) {
      tone(880, t + i * 0.32, 1.1, 'sine', 0.18)
      tone(1320, t + i * 0.32, 0.6, 'sine', 0.06)
    }
  } else if (cue === 'pop') {
    tone(520, t, 0.12, 'triangle', 0.16, 980)
    tone(1300, t + 0.08, 0.18, 'sine', 0.08)
  } else if (cue === 'alarm') {
    for (let i = 0; i < 4; i++) tone(i % 2 ? 330 : 440, t + i * 0.22, 0.2, 'square', 0.05)
  } else if (cue === 'whoosh') {
    tone(300, t, 1.4, 'sawtooth', 0.04, 60)
    noise(t, 1.2, 0.05)
  } else if (cue === 'crash') {
    noise(t, 0.35, 0.18)
    tone(160, t, 0.3, 'square', 0.06, 70)
  } else if (cue === 'tick') {
    tone(1200, t, 0.05, 'sine', 0.05)
  }
}

/**
 * Background music: one looping track under the round. It plays at a low
 * level during play and drops lower during meetings, votes and ejections so
 * people can read and talk. The mute button silences it with the effects.
 *
 * The track runs through the same Web Audio context as the effects, so the
 * level works on phones too (iOS ignores an audio element's volume). Nothing
 * plays until the first click or key, like the effects.
 *
 * Track: "Afro Beat - Instrumental Music" by rediskasound on Pixabay,
 * used under the Pixabay Content License.
 * https://pixabay.com/music/afrobeat-afro-beat-instrumental-music-554537/
 */

import { audioContext, isMuted } from './sound'

export type MusicLevel = 'off' | 'low' | 'full'

const SRC = '/audio/afro-beat.mp3'
const GAIN: Record<MusicLevel, number> = { off: 0, low: 0.05, full: 0.2 }
const FADE_S = 0.9

let level: MusicLevel = 'off'
let el: HTMLAudioElement | null = null
let gain: GainNode | null = null
let primed = false
let current = -1
let pauseTimer: ReturnType<typeof setTimeout> | undefined

function ensure(): { ctx: AudioContext; el: HTMLAudioElement; gain: GainNode } | null {
  const ctx = audioContext()
  if (!ctx || ctx.state === 'closed' || typeof Audio === 'undefined') return null
  if (!el || !gain) {
    el = new Audio(SRC)
    el.loop = true
    el.preload = 'auto'
    gain = ctx.createGain()
    gain.gain.value = 0
    ctx.createMediaElementSource(el).connect(gain).connect(ctx.destination)
    document.addEventListener('visibilitychange', syncMusic)
  }
  return { ctx, el, gain }
}

/** Move the music toward the level the game wants. Safe to call often. */
export function syncMusic() {
  const a = ensure()
  if (!a) return
  const v = isMuted() || document.hidden ? 0 : GAIN[level]

  if (v === current && (v === 0 || !a.el.paused)) return
  current = v
  const now = a.ctx.currentTime
  a.gain.gain.cancelScheduledValues(now)
  a.gain.gain.setValueAtTime(a.gain.gain.value, now)
  a.gain.gain.linearRampToValueAtTime(v, now + FADE_S)
  clearTimeout(pauseTimer)

  if (v > 0) {
    primed = true
    if (a.el.paused) void a.el.play().catch(() => {})
  } else if (!primed) {
    // Safari only lets an element play later if it first played inside a
    // click or key handler, so start it silently once and pause it.
    primed = true
    void a.el.play().then(() => current === 0 && a.el.pause()).catch(() => {})
  } else {
    pauseTimer = setTimeout(() => current === 0 && a.el.pause(), FADE_S * 1000 + 100)
  }
}

export function setMusicLevel(next: MusicLevel) {
  level = next
  syncMusic()
}

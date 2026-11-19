/**
 * Deterministic placement. The server decides every object's position, so a
 * prompt can never put something off the island, in the pond, or on top of
 * another object. Given the same seed and existing builds it always answers
 * the same spot, which keeps tests stable.
 */

import { CATALOG, type BuildType } from './catalog'
import { ISLAND } from './constants'
import { LANDMARKS } from './landmarks'
import { streamInfo, STREAM_DIR } from './terrain'

const { USABLE_R, POND } = ISLAND

export interface PlacedLike {
  type: string
  x: number
  z: number
  scale?: number
}

export type Rng = () => number

/** Small fast seeded PRNG (mulberry32). */
export function makeRng(seed: number): Rng {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function hashString(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

const rr = (rng: Rng, a: number, b: number) => a + rng() * (b - a)

export function footprint(type: string, scale = 1): number {
  const entry = (CATALOG as Record<string, { fp: number }>)[type]
  return (entry ? entry.fp : 0.4) * scale
}

const isWaterType = (type: string) => Boolean((CATALOG as Record<string, { water?: boolean }>)[type]?.water)

/** Where something sits relative to an existing object, the pond, the edge or the center. */
export type Near = 'edge' | 'center' | 'pond' | { x: number; z: number } | null

export function resolveNear(near: unknown, placed: PlacedLike[], rng: Rng): Near {
  if (typeof near !== 'string' || !near.trim()) return null
  const n = near.toLowerCase().trim().replace(/[\s-]+/g, '_')
  if (n === 'edge' || n === 'cliff' || n === 'shore') return 'edge'
  if (n === 'center' || n === 'middle' || n === 'hill') return 'center'
  if (n === 'pond' || n === 'water' || n === 'lake') return 'pond'
  const key = (CATALOG as Record<string, unknown>)[n] ? n : n.replace(/s$/, '')
  const matches = placed.filter((p) => p.type === key)
  if (!matches.length) return null
  const p = matches[Math.floor(rng() * matches.length)]
  return { x: p.x, z: p.z }
}

function blocked(x: number, z: number, fp: number, placed: PlacedLike[]): boolean {
  if (Math.hypot(x, z) > USABLE_R - fp * 0.4) return true
  if (Math.hypot(x - POND.x, z - POND.z) < POND.r + fp * 0.8 + 0.12) return true
  if (streamInfo(x, z).d < 0.28 + fp * 0.7) return true
  for (const l of LANDMARKS) {
    // Landmarks keep a clear core; the bell and the shed keep a wider ring for walking.
    const keep = l.id === 'bell' ? 1.6 : l.id === 'power_shed' ? 1.3 : Math.max(l.solid, 0.5) + 0.2
    if (Math.hypot(x - l.x, z - l.z) < keep + fp) return true
  }
  for (const p of placed) {
    if (isWaterType(p.type) || p.type === 'dock') continue
    const pf = footprint(p.type, p.scale ?? 1)
    if (Math.hypot(x - p.x, z - p.z) < (fp + pf) * 0.82) return true
  }
  return false
}

export function findSpot(fp: number, near: Near, placed: PlacedLike[], rng: Rng): { x: number; z: number } {
  let best: { x: number; z: number } | null = null
  let bestScore = -Infinity
  for (let k = 0; k < 160; k++) {
    const a = rr(rng, 0, Math.PI * 2)
    let x: number
    let z: number
    let r: number
    if (near === 'edge') {
      r = rr(rng, USABLE_R * 0.78, USABLE_R)
      x = Math.cos(a) * r
      z = Math.sin(a) * r
    } else if (near === 'center') {
      r = Math.sqrt(rng()) * USABLE_R * 0.45
      x = Math.cos(a) * r
      z = Math.sin(a) * r
    } else if (near === 'pond') {
      r = POND.r + fp + rr(rng, 0.15, 1.1)
      x = POND.x + Math.cos(a) * r
      z = POND.z + Math.sin(a) * r
    } else if (near && typeof near === 'object') {
      r = rr(rng, fp + 0.35, fp + 1.5)
      x = near.x + Math.cos(a) * r
      z = near.z + Math.sin(a) * r
    } else {
      r = Math.sqrt(rng()) * USABLE_R
      x = Math.cos(a) * r
      z = Math.sin(a) * r
    }
    if (blocked(x, z, fp, placed)) continue
    let minD = 3
    for (const p of placed) {
      if (isWaterType(p.type)) continue
      minD = Math.min(minD, Math.hypot(x - p.x, z - p.z) - footprint(p.type, p.scale ?? 1) - fp)
    }
    const score = Math.min(minD, 1.2) + rr(rng, 0, 0.35)
    if (score > bestScore) {
      bestScore = score
      best = { x, z }
    }
    if (k > 40 && best) break
  }
  if (best) return best
  for (let k = 0; k < 300; k++) {
    const a = rr(rng, 0, Math.PI * 2)
    const r = Math.sqrt(rng()) * USABLE_R
    const x = Math.cos(a) * r
    const z = Math.sin(a) * r
    if (Math.hypot(x - POND.x, z - POND.z) > POND.r + 0.25 && streamInfo(x, z).d > 0.3) return { x, z }
  }
  return { x: -1, z: 1 }
}

export function pondSpot(fp: number, placed: PlacedLike[], rng: Rng): { x: number; z: number } {
  const water = placed.filter((p) => isWaterType(p.type))
  for (let k = 0; k < 80; k++) {
    const a = rr(rng, 0, Math.PI * 2)
    const r = Math.sqrt(rng()) * (POND.r - fp - 0.2)
    const x = POND.x + Math.cos(a) * r
    const z = POND.z + Math.sin(a) * r
    if (water.every((p) => Math.hypot(x - p.x, z - p.z) > footprint(p.type) + fp)) return { x, z }
  }
  const a = rr(rng, 0, Math.PI * 2)
  const r = rr(rng, 0, POND.r - 0.4)
  return { x: POND.x + Math.cos(a) * r, z: POND.z + Math.sin(a) * r }
}

/** A dock stands on the shore, pointing into the pond, away from the stream. */
export function dockSpot(placed: PlacedLike[], rng: Rng): { x: number; z: number; rot: number } {
  const streamAng = Math.atan2(STREAM_DIR.z, STREAM_DIR.x)
  const used = placed
    .filter((p) => p.type === 'dock')
    .map((p) => Math.atan2(p.z - POND.z, p.x - POND.x))
  let a = 0
  for (let k = 0; k < 60; k++) {
    a = rr(rng, 0, Math.PI * 2)
    const far = (b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b))) > 0.9
    if (far(streamAng) && used.every(far)) break
  }
  const dx = Math.cos(a)
  const dz = Math.sin(a)
  return { x: POND.x + dx * (POND.r + 0.12), z: POND.z + dz * (POND.r + 0.12), rot: Math.atan2(dz, -dx) }
}

export interface PlacementRequest {
  type: BuildType
  near?: unknown
  scale?: number
  x?: number
  z?: number
}

export interface Placement {
  type: BuildType
  x: number
  z: number
  rot: number
  scale: number
}

/** Decide where one object goes. Pure: reads `placed`, never mutates it. */
export function placeOne(req: PlacementRequest, placed: PlacedLike[], rng: Rng): Placement {
  const scale = Math.max(0.4, Math.min(2.2, Number(req.scale) || 1))
  const fp = footprint(req.type, scale)
  const nearStr = typeof req.near === 'string' ? req.near.toLowerCase() : ''
  const water = isWaterType(req.type) && (!nearStr || nearStr === 'pond' || nearStr === 'water')
  if (req.type === 'dock') {
    const s = dockSpot(placed, rng)
    return { type: req.type, x: s.x, z: s.z, rot: s.rot, scale }
  }
  if (water) {
    const s = pondSpot(fp, placed, rng)
    return { type: req.type, ...s, rot: rr(rng, 0, Math.PI * 2), scale }
  }
  if (Number.isFinite(req.x) && Number.isFinite(req.z)) {
    let x = Number(req.x)
    let z = Number(req.z)
    const r = Math.hypot(x, z)
    if (r > USABLE_R) {
      x *= USABLE_R / r
      z *= USABLE_R / r
    }
    if (!blocked(x, z, fp, placed)) return { type: req.type, x, z, rot: rr(rng, 0, Math.PI * 2), scale }
  }
  const entry = (CATALOG as Record<string, { edge?: boolean }>)[req.type]
  const near = resolveNear(req.near, placed, rng) ?? (entry?.edge ? 'edge' : null)
  const s = findSpot(fp, near, placed, rng)
  return { type: req.type, ...s, rot: rr(rng, 0, Math.PI * 2), scale }
}

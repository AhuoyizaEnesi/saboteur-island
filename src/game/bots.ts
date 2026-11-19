/**
 * AI player movement. The server plans each AI player's walk as timed legs;
 * every browser evaluates the same legs against the shared clock, so all
 * players see AI players in the same place and the server can tell where
 * any AI player is at any moment without streaming positions.
 */

import { WALK_SPEED } from './constants'
import { walkable } from './landmarks'

export const BOT_SPEED = WALK_SPEED * 0.85

export interface Leg {
  x0: number
  z0: number
  x1: number
  z1: number
  t0: number
  t1: number
  /** What the AI player is doing at the end of this leg. */
  doing?: 'walk' | 'work' | 'wait'
  /** Task template, landmark or break this leg is heading for. */
  ref?: string
}

/** Where an AI player stands at time t. */
export function routePos(legs: Leg[] | null | undefined, t: number, fallback: { x: number; z: number }): { x: number; z: number } {
  if (!legs || !legs.length) return fallback
  if (t <= legs[0].t0) return { x: legs[0].x0, z: legs[0].z0 }
  for (const l of legs) {
    if (t <= l.t1) {
      const k = l.t1 > l.t0 ? (t - l.t0) / (l.t1 - l.t0) : 1
      return walkable(l.x0 + (l.x1 - l.x0) * k, l.z0 + (l.z1 - l.z0) * k)
    }
  }
  const last = legs[legs.length - 1]
  return { x: last.x1, z: last.z1 }
}

/** True when the last leg is over and the AI player needs a new plan. */
export const routeDone = (legs: Leg[] | null | undefined, t: number) => !legs || !legs.length || t >= legs[legs.length - 1].t1

/** A walk from a to b starting at t0, at AI walking speed. */
export function walkLeg(a: { x: number; z: number }, b: { x: number; z: number }, t0: number, ref?: string): Leg {
  const end = walkable(b.x, b.z)
  const ms = (Math.hypot(end.x - a.x, end.z - a.z) / BOT_SPEED) * 1000
  return { x0: a.x, z0: a.z, x1: end.x, z1: end.z, t0, t1: t0 + Math.round(ms), doing: 'walk', ref }
}

/** Standing still at p for ms, doing something. */
export function stayLeg(p: { x: number; z: number }, t0: number, ms: number, doing: 'work' | 'wait', ref?: string): Leg {
  return { x0: p.x, z0: p.z, x1: p.x, z1: p.z, t0, t1: t0 + Math.round(ms), doing, ref }
}

/** A spot to stand at a landmark: on the side that faces the island's middle. */
export function standSpot(l: { x: number; z: number }, rng: () => number, dist = 1.6): { x: number; z: number } {
  const a = Math.atan2(-l.z, -l.x) + (rng() - 0.5) * 1.6
  return walkable(l.x + Math.cos(a) * dist, l.z + Math.sin(a) * dist)
}

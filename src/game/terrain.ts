/**
 * Island surface math, shared so the server places objects on the same ground
 * the browser draws.
 */

import { ISLAND } from './constants'

const { TOP_R, DOME_H, POND, POND_Y } = ISLAND

export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))
export const smooth = (e0: number, e1: number, x: number) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1)
  return t * t * (3 - 2 * t)
}

const pondDist = Math.hypot(POND.x, POND.z)
/** Unit vector from the island center through the pond: the stream runs this way. */
export const STREAM_DIR = { x: POND.x / pondDist, z: POND.z / pondDist }
export const STREAM_START = {
  x: POND.x + STREAM_DIR.x * (POND.r - 0.2),
  z: POND.z + STREAM_DIR.z * (POND.r - 0.2),
}
export const STREAM_END = { x: STREAM_DIR.x * (TOP_R + 0.12), z: STREAM_DIR.z * (TOP_R + 0.12) }

export const streamLevel = (t: number) => POND_Y - t * 0.24

export function streamInfo(x: number, z: number): { d: number; t: number } {
  const vx = STREAM_END.x - STREAM_START.x
  const vz = STREAM_END.z - STREAM_START.z
  const t = clamp(((x - STREAM_START.x) * vx + (z - STREAM_START.z) * vz) / (vx * vx + vz * vz), 0, 1)
  return { d: Math.hypot(x - (STREAM_START.x + vx * t), z - (STREAM_START.z + vz * t)), t }
}

/** Height of the grass at (x, z). */
export function terrainH(x: number, z: number): number {
  const rn = Math.hypot(x, z) / TOP_R
  let y =
    DOME_H * Math.sqrt(Math.max(0, 1 - rn * rn)) +
    Math.sin(x * 1.35 + 0.5) * Math.cos(z * 1.15) * 0.07 * (1 - rn * rn)
  const k = smooth(POND.r + 0.5, POND.r - 0.25, Math.hypot(x - POND.x, z - POND.z))
  y = y * (1 - k) + (POND_Y - 0.12) * k
  const si = streamInfo(x, z)
  const ks = smooth(0.42, 0.12, si.d)
  if (ks > 0) y = y * (1 - ks) + Math.min(y, streamLevel(si.t) - 0.05) * ks
  return y
}

/**
 * Fixed landmarks. They are part of the island itself, not records: every
 * browser draws them from this list and the server uses the same list for
 * range checks, so both always agree on where the Red Cottage is.
 */

import { ISLAND, MEETING_SPOT } from './constants'

export type LandmarkId =
  | 'bell'
  | 'red_cottage'
  | 'blue_cottage'
  | 'dock'
  | 'well'
  | 'windmill'
  | 'lighthouse'
  | 'camp'
  | 'orchard'
  | 'power_shed'

export interface Landmark {
  id: LandmarkId
  name: string
  x: number
  z: number
  /** Facing, in radians around the vertical axis. */
  rot: number
  /** Islanders cannot walk inside this radius. */
  solid: number
  /** Things built for this landmark go inside this radius. */
  area: number
}

const { POND } = ISLAND

/** The dock sits on the pond shore that faces the middle of the island. */
const dockAng = Math.atan2(-POND.z, -POND.x)
const DOCK = { x: POND.x + Math.cos(dockAng) * (POND.r + 0.15), z: POND.z + Math.sin(dockAng) * (POND.r + 0.15) }

const at = (deg: number, r: number) => ({ x: Math.cos((deg * Math.PI) / 180) * r, z: Math.sin((deg * Math.PI) / 180) * r })

export const LANDMARKS: Landmark[] = [
  { id: 'bell', name: 'Meeting Bell', ...MEETING_SPOT, rot: 0, solid: 0.75, area: 0 },
  { id: 'lighthouse', name: 'Lighthouse', ...at(-4, 8.7), rot: 0, solid: 0.55, area: 1.8 },
  { id: 'dock', name: 'Dock', ...DOCK, rot: Math.atan2(Math.sin(dockAng), -Math.cos(dockAng)), solid: 0, area: 2.4 },
  { id: 'camp', name: 'Camp', ...at(92, 6.9), rot: 0, solid: 0, area: 1.9 },
  { id: 'orchard', name: 'Orchard', ...at(142, 6.7), rot: 0.4, solid: 0.5, area: 2.0 },
  { id: 'power_shed', name: 'Power Shed', ...at(181, 7.6), rot: 0.55, solid: 0.7, area: 0 },
  { id: 'red_cottage', name: 'Red Cottage', ...at(214, 6.6), rot: 0.3, solid: 0.8, area: 1.9 },
  { id: 'blue_cottage', name: 'Blue Cottage', ...at(254, 6.9), rot: -0.2, solid: 0.8, area: 1.9 },
  { id: 'well', name: 'Well', ...at(292, 6.1), rot: 0, solid: 0.45, area: 1.8 },
  { id: 'windmill', name: 'Windmill', ...at(326, 7.2), rot: -0.5, solid: 0.55, area: 1.9 },
]

const BY_ID = new Map(LANDMARKS.map((l) => [l.id, l]))

export function landmarkById(id: string): Landmark | null {
  return BY_ID.get(id as LandmarkId) ?? null
}

export const distTo = (l: { x: number; z: number }, x: number, z: number) => Math.hypot(l.x - x, l.z - z)

/** The closest landmark to a point, and how far away it is. */
export function nearestLandmark(x: number, z: number, filter?: (l: Landmark) => boolean): { landmark: Landmark; dist: number } | null {
  let best: { landmark: Landmark; dist: number } | null = null
  for (const l of LANDMARKS) {
    if (filter && !filter(l)) continue
    const d = distTo(l, x, z)
    if (!best || d < best.dist) best = { landmark: l, dist: d }
  }
  return best
}

/**
 * Keep a walking position on dry, open ground: inside the island rim, out of
 * the pond, and outside every landmark's solid core.
 */
export function walkable(x: number, z: number): { x: number; z: number } {
  let px = x
  let pz = z
  const r = Math.hypot(px, pz)
  if (r > ISLAND.USABLE_R) {
    px *= ISLAND.USABLE_R / r
    pz *= ISLAND.USABLE_R / r
  }
  const dpx = px - POND.x
  const dpz = pz - POND.z
  const dp = Math.hypot(dpx, dpz)
  if (dp < POND.r + 0.25) {
    const k = dp < 0.001 ? 1 : (POND.r + 0.25) / dp
    px = POND.x + (dp < 0.001 ? POND.r + 0.25 : dpx * k)
    pz = POND.z + (dp < 0.001 ? 0 : dpz * k)
  }
  for (const l of LANDMARKS) {
    if (!l.solid) continue
    const dx = px - l.x
    const dz = pz - l.z
    const d = Math.hypot(dx, dz)
    if (d < l.solid) {
      const k = d < 0.001 ? 1 : l.solid / d
      px = l.x + (d < 0.001 ? l.solid : dx * k)
      pz = l.z + (d < 0.001 ? 0 : dz * k)
    }
  }
  return { x: px, z: pz }
}

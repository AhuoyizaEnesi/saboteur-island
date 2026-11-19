/**
 * Crew tasks. Each task is a small change at one landmark, like a yellow bird
 * on the Red Cottage roof. Tasks are checked against the builds on the island,
 * so the same code decides "done" on the server and in tests.
 */

import { CATALOG, type BuildType, type ColorName } from './catalog'
import { ISLAND } from './constants'
import { landmarkById, type Landmark, type LandmarkId } from './landmarks'
import { footprint, type Rng } from './placement'

export interface TaskTemplate {
  id: string
  landmarkId: LandmarkId
  /** What the task list says. */
  text: string
  /** What the order box starts with. */
  order: string
  need: { type: BuildType; color?: ColorName }
  /** Where the needed object goes, relative to the landmark and its facing. */
  slot: { dx: number; dz: number; lift?: number; rot?: number }
}

export const TASKS: TaskTemplate[] = [
  { id: 'red_bird', landmarkId: 'red_cottage', text: 'Put a yellow bird on the roof', order: 'a yellow bird on the roof', need: { type: 'bird', color: 'yellow' }, slot: { dx: 0, dz: 0.2, lift: 1.47, rot: Math.PI / 2 } },
  { id: 'red_lantern', landmarkId: 'red_cottage', text: 'Hang a lantern by the door', order: 'a lantern by the front door', need: { type: 'lantern' }, slot: { dx: 0.62, dz: 0.82 } },
  { id: 'blue_flowers', landmarkId: 'blue_cottage', text: 'Plant flowers out front', order: 'flowers in front of the cottage', need: { type: 'flowers' }, slot: { dx: -0.35, dz: 1.0 } },
  { id: 'blue_fence', landmarkId: 'blue_cottage', text: 'Build a fence beside the cottage', order: 'a wooden fence beside the cottage', need: { type: 'fence' }, slot: { dx: 1.25, dz: 0.2, rot: Math.PI / 2 } },
  { id: 'dock_boat', landmarkId: 'dock', text: 'Tie a boat to the dock', order: 'a little boat tied to the dock', need: { type: 'boat' }, slot: { dx: 1.1, dz: 0.5 } },
  { id: 'dock_duck', landmarkId: 'dock', text: 'Put a duck on the pond', order: 'a duck swimming on the pond', need: { type: 'duck' }, slot: { dx: 1.9, dz: -0.7 } },
  { id: 'well_mushrooms', landmarkId: 'well', text: 'Plant mushrooms by the well', order: 'some mushrooms next to the well', need: { type: 'mushroom' }, slot: { dx: 0.85, dz: 0.45 } },
  { id: 'well_bench', landmarkId: 'well', text: 'Put a bench next to the well', order: 'a bench next to the well', need: { type: 'bench' }, slot: { dx: -0.9, dz: 0.55, rot: 0.4 } },
  { id: 'mill_sheep', landmarkId: 'windmill', text: 'Put a sheep by the windmill', order: 'a sheep grazing by the windmill', need: { type: 'sheep' }, slot: { dx: 1.0, dz: 0.7 } },
  { id: 'mill_scarecrow', landmarkId: 'windmill', text: 'Stand a scarecrow by the windmill', order: 'a scarecrow by the windmill', need: { type: 'scarecrow' }, slot: { dx: -1.0, dz: 0.8 } },
  { id: 'light_flag', landmarkId: 'lighthouse', text: 'Raise a blue flag by the lighthouse', order: 'a blue flag by the lighthouse', need: { type: 'flag', color: 'blue' }, slot: { dx: -0.9, dz: 0.6 } },
  { id: 'light_lantern', landmarkId: 'lighthouse', text: 'Light a lantern on the lighthouse path', order: 'a lantern on the path to the lighthouse', need: { type: 'lantern' }, slot: { dx: -1.15, dz: -0.5 } },
  { id: 'camp_tent', landmarkId: 'camp', text: 'Pitch a tent at the camp', order: 'a tent at the camp', need: { type: 'tent' }, slot: { dx: 0.3, dz: -1.5 } },
  { id: 'camp_fire', landmarkId: 'camp', text: 'Light the campfire', order: 'a campfire in the middle of the camp', need: { type: 'campfire' }, slot: { dx: 0, dz: 0 } },
  { id: 'orchard_tree', landmarkId: 'orchard', text: 'Plant a round tree in the orchard', order: 'a round fruit tree in the orchard', need: { type: 'round_tree' }, slot: { dx: 0.9, dz: -0.5 } },
  { id: 'orchard_hive', landmarkId: 'orchard', text: 'Put a beehive by the orchard', order: 'a beehive by the orchard', need: { type: 'beehive' }, slot: { dx: -0.8, dz: 0.7 } },
]

const BY_ID = new Map(TASKS.map((t) => [t.id, t]))
export const taskTemplate = (id: string) => BY_ID.get(id) ?? null

/** Landmark-relative offset to island coordinates, matching three.js rotation.y. */
export function fromLandmark(l: Landmark, dx: number, dz: number): { x: number; z: number } {
  const c = Math.cos(l.rot)
  const s = Math.sin(l.rot)
  return { x: l.x + dx * c + dz * s, z: l.z - dx * s + dz * c }
}

export function slotOf(t: TaskTemplate): { x: number; z: number; lift: number; rot: number } {
  const l = landmarkById(t.landmarkId) as Landmark
  const p = fromLandmark(l, t.slot.dx, t.slot.dz)
  return { ...p, lift: t.slot.lift ?? 0, rot: l.rot + (t.slot.rot ?? 0) }
}

// ─── checking ────────────────────────────────────────────────────────────────

export interface BuildLike {
  playerId: string
  landmarkId?: string
  type: string
  colorName?: string
  state?: string
}

export interface TaskLike {
  playerId: string
  templateId: string
}

/** A task is done when its owner has an intact matching build at the landmark. */
export function taskDone(task: TaskLike, builds: BuildLike[]): boolean {
  const t = taskTemplate(task.templateId)
  if (!t) return false
  return builds.some(
    (b) =>
      b.playerId === task.playerId &&
      b.landmarkId === t.landmarkId &&
      b.type === t.need.type &&
      (b.state ?? 'ok') === 'ok' &&
      (!t.need.color || b.colorName === t.need.color),
  )
}

// ─── dealing ─────────────────────────────────────────────────────────────────

const shuffle = <T,>(list: T[], rng: Rng): T[] => {
  const a = list.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/**
 * Deal tasks: every crew member gets `per` tasks at different landmarks, and
 * no task goes to two players. Falls back to allowing a shared landmark if the
 * shuffle paints itself into a corner.
 */
export function dealTasks(crewIds: string[], rng: Rng, per = 3): Record<string, string[]> {
  for (let attempt = 0; attempt < 40; attempt++) {
    const pool = shuffle(TASKS, rng)
    const out: Record<string, string[]> = {}
    let okAll = true
    for (const id of crewIds) {
      const mine: TaskTemplate[] = []
      for (const t of pool) {
        if (mine.length >= per) break
        if (mine.some((m) => m.landmarkId === t.landmarkId)) continue
        mine.push(t)
      }
      if (mine.length < per) {
        okAll = false
        break
      }
      for (const m of mine) pool.splice(pool.indexOf(m), 1)
      out[id] = mine.map((m) => m.id)
    }
    if (okAll) return out
  }
  const pool = shuffle(TASKS, rng)
  const out: Record<string, string[]> = {}
  crewIds.forEach((id, i) => {
    out[id] = [0, 1, 2].slice(0, per).map((k) => pool[(i * per + k) % pool.length].id)
  })
  return out
}

/** The Impostor's fake list: plausible tasks at three landmarks. */
export function fakeTasks(rng: Rng, per = 3): string[] {
  const out: TaskTemplate[] = []
  for (const t of shuffle(TASKS, rng)) {
    if (out.length >= per) break
    if (out.some((m) => m.landmarkId === t.landmarkId)) continue
    out.push(t)
  }
  return out.map((t) => t.id)
}

// ─── placing things at a landmark ────────────────────────────────────────────

export interface PlacedAt {
  type: string
  x: number
  z: number
  state?: string
}

const isWater = (type: string) => Boolean((CATALOG as Record<string, { water?: boolean }>)[type]?.water)

/**
 * Where a new object goes at a landmark. If one of the landmark's task slots
 * wants this type and is free, it goes there, so "a yellow bird on the roof"
 * really sits on the roof. Otherwise it goes somewhere open inside the
 * landmark's building area.
 */
export function spotAtLandmark(
  l: Landmark,
  type: BuildType,
  existing: PlacedAt[],
  rng: Rng,
): { x: number; z: number; lift: number; rot: number } {
  for (const t of TASKS) {
    if (t.landmarkId !== l.id || t.need.type !== type) continue
    const s = slotOf(t)
    const taken = existing.some((b) => b.type === type && (b.state ?? 'ok') === 'ok' && Math.hypot(b.x - s.x, b.z - s.z) < 0.3)
    if (!taken) return s
  }
  const fp = footprint(type)
  const { POND } = ISLAND
  let best: { x: number; z: number } | null = null
  let bestScore = -Infinity
  for (let k = 0; k < 120; k++) {
    const a = rng() * Math.PI * 2
    let x: number
    let z: number
    if (isWater(type)) {
      const r = Math.sqrt(rng()) * (POND.r - fp - 0.25)
      x = POND.x + Math.cos(a) * r
      z = POND.z + Math.sin(a) * r
    } else {
      const r = 0.9 + rng() * Math.max(0.3, l.area - 0.9)
      x = l.x + Math.cos(a) * r
      z = l.z + Math.sin(a) * r
      if (Math.hypot(x, z) > ISLAND.USABLE_R - fp * 0.5) continue
      if (Math.hypot(x - POND.x, z - POND.z) < POND.r + fp + 0.1) continue
      if (l.solid && Math.hypot(x - l.x, z - l.z) < l.solid + fp + 0.1) continue
    }
    let minD = 2
    for (const b of existing) {
      if (isWater(b.type) !== isWater(type)) continue
      minD = Math.min(minD, Math.hypot(x - b.x, z - b.z) - footprint(b.type) - fp)
    }
    if (minD < -0.05 && k < 100) continue
    const score = Math.min(minD, 0.8) - Math.hypot(x - l.x, z - l.z) * 0.15 + rng() * 0.2
    if (score > bestScore) {
      bestScore = score
      best = { x, z }
    }
    if (k > 40 && best) break
  }
  const p = best ?? fromLandmark(l, 1, 0)
  return { ...p, lift: 0, rot: rng() * Math.PI * 2 }
}

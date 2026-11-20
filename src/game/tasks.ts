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
  /** Why the island needs it. Shown under the task. */
  reason: string
  /** What to build, with every detail the check needs. */
  text: string
  /** A specific prompt that completes the task. Tests use it; players never see it. */
  order: string
  need: { type: BuildType; color?: ColorName; count?: number }
  /** Where the needed object goes, relative to the landmark and its facing. */
  slot: { dx: number; dz: number; lift?: number; rot?: number }
}

export const TASKS: TaskTemplate[] = [
  { id: 'red_bird', landmarkId: 'red_cottage', reason: 'The roof looks empty since the birds flew south.', text: 'Put a yellow bird on the roof', order: 'a yellow bird on the roof', need: { type: 'bird', color: 'yellow' }, slot: { dx: 0, dz: 0.2, lift: 1.47, rot: Math.PI / 2 } },
  { id: 'red_lantern', landmarkId: 'red_cottage', reason: 'Guests keep tripping on the step at night.', text: 'Hang 2 lanterns by the door', order: '2 lanterns by the front door', need: { type: 'lantern', count: 2 }, slot: { dx: 0.62, dz: 0.82 } },
  { id: 'blue_flowers', landmarkId: 'blue_cottage', reason: 'The front yard looks bare.', text: 'Plant 3 pink flower beds out front', order: '3 pink flower beds in front of the cottage', need: { type: 'flowers', color: 'pink', count: 3 }, slot: { dx: -0.35, dz: 1.0 } },
  { id: 'blue_fence', landmarkId: 'blue_cottage', reason: 'The garden needs a border.', text: 'Build a white fence beside the cottage', order: 'a white wooden fence beside the cottage', need: { type: 'fence', color: 'white' }, slot: { dx: 1.25, dz: 0.2, rot: Math.PI / 2 } },
  { id: 'dock_boat', landmarkId: 'dock', reason: 'The fisher needs a ride across the pond.', text: 'Tie a red boat to the dock', order: 'a red boat tied to the dock', need: { type: 'boat', color: 'red' }, slot: { dx: 1.1, dz: 0.5 } },
  { id: 'dock_duck', landmarkId: 'dock', reason: 'The pond feels lonely.', text: 'Put 2 ducks on the pond', order: '2 ducks swimming on the pond', need: { type: 'duck', count: 2 }, slot: { dx: 1.9, dz: -0.7 } },
  { id: 'well_mushrooms', landmarkId: 'well', reason: 'Something odd grows in the shade here.', text: 'Plant 3 purple mushrooms by the well', order: '3 purple mushrooms next to the well', need: { type: 'mushroom', color: 'purple', count: 3 }, slot: { dx: 0.85, dz: 0.45 } },
  { id: 'well_bench', landmarkId: 'well', reason: 'Travelers need a place to rest.', text: 'Put a green bench next to the well', order: 'a green bench next to the well', need: { type: 'bench', color: 'green' }, slot: { dx: -0.9, dz: 0.55, rot: 0.4 } },
  { id: 'mill_sheep', landmarkId: 'windmill', reason: 'The miller wants a small flock.', text: 'Put 2 sheep by the windmill', order: '2 sheep grazing by the windmill', need: { type: 'sheep', count: 2 }, slot: { dx: 1.0, dz: 0.7 } },
  { id: 'mill_scarecrow', landmarkId: 'windmill', reason: 'Crows keep stealing the grain.', text: 'Stand a scarecrow in a red shirt by the windmill', order: 'a scarecrow in a red shirt by the windmill', need: { type: 'scarecrow', color: 'red' }, slot: { dx: -1.0, dz: 0.8 } },
  { id: 'light_flag', landmarkId: 'lighthouse', reason: 'Ships cannot spot the island.', text: 'Raise a blue flag by the lighthouse', order: 'a blue flag by the lighthouse', need: { type: 'flag', color: 'blue' }, slot: { dx: -0.9, dz: 0.6 } },
  { id: 'light_lantern', landmarkId: 'lighthouse', reason: 'The path is too dark to walk at night.', text: 'Light 3 lanterns on the lighthouse path', order: '3 lanterns on the path to the lighthouse', need: { type: 'lantern', count: 3 }, slot: { dx: -1.15, dz: -0.5 } },
  { id: 'camp_tent', landmarkId: 'camp', reason: 'Campers arrive tonight.', text: 'Pitch 2 orange tents at the camp', order: '2 orange tents at the camp', need: { type: 'tent', color: 'orange', count: 2 }, slot: { dx: 0.3, dz: -1.5 } },
  { id: 'camp_fire', landmarkId: 'camp', reason: 'Story night needs something spooky.', text: 'Light a green campfire at the camp', order: 'a green campfire in the middle of the camp', need: { type: 'campfire', color: 'green' }, slot: { dx: 0, dz: 0 } },
  { id: 'orchard_tree', landmarkId: 'orchard', reason: 'The orchard is short on fruit.', text: 'Plant 2 round trees in the orchard', order: '2 round fruit trees in the orchard', need: { type: 'round_tree', count: 2 }, slot: { dx: 0.9, dz: -0.5 } },
  { id: 'orchard_hive', landmarkId: 'orchard', reason: 'The bees need a new home.', text: 'Put a white beehive by the orchard', order: 'a white beehive by the orchard', need: { type: 'beehive', color: 'white' }, slot: { dx: -0.8, dz: 0.7 } },
]

/** "a yellow bird", "2 ducks", "3 pink flower beds": what a task needs, in words. */
export function needLabel(need: TaskTemplate['need']): string {
  const n = need.count ?? 1
  const noun = needNoun(need.type, n)
  return `${n === 1 ? (/^[aeiou]/.test(need.color ?? noun) ? 'an' : 'a') : n} ${need.color ? `${need.color} ` : ''}${noun}`
}

export function needNoun(type: string, n: number): string {
  const base: Record<string, [string, string]> = {
    flowers: ['flower bed', 'flower beds'],
    round_tree: ['round tree', 'round trees'],
    sheep: ['sheep', 'sheep'],
    mushroom: ['mushroom', 'mushrooms'],
  }
  const pair = base[type] ?? [type.replace(/_/g, ' '), `${type.replace(/_/g, ' ')}s`]
  return n === 1 ? pair[0] : pair[1]
}

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

/** Builds that count toward a task: its owner's intact matching objects at the landmark. */
export function matchingBuilds<B extends BuildLike>(task: TaskLike, builds: B[]): B[] {
  const t = taskTemplate(task.templateId)
  if (!t) return []
  return builds.filter(
    (b) =>
      b.playerId === task.playerId &&
      b.landmarkId === t.landmarkId &&
      b.type === t.need.type &&
      (b.state ?? 'ok') === 'ok' &&
      (!t.need.color || b.colorName === t.need.color),
  )
}

/** A task is done when its owner has enough intact matching builds at the landmark. */
export function taskDone(task: TaskLike, builds: BuildLike[]): boolean {
  const t = taskTemplate(task.templateId)
  if (!t) return false
  return matchingBuilds(task, builds).length >= (t.need.count ?? 1)
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
  const fp = footprint(type)
  const { POND } = ISLAND
  const slots: ReturnType<typeof slotOf>[] = []
  for (const t of TASKS) {
    if (t.landmarkId !== l.id || t.need.type !== type) continue
    const s = slotOf(t)
    slots.push(s)
    const taken = existing.some((b) => b.type === type && (b.state ?? 'ok') === 'ok' && Math.hypot(b.x - s.x, b.z - s.z) < 0.3)
    if (!taken) return s
  }
  // More of the same: cluster around the task's spot, so "3 lanterns" stand together.
  for (const s of slots) {
    for (let ring = 1; ring <= 3; ring++) {
      const r = fp * 2 * ring + 0.12
      const steps = 6 * ring
      const turn = rng() * Math.PI * 2
      for (let k = 0; k < steps; k++) {
        const a = turn + (k / steps) * Math.PI * 2
        const x = s.x + Math.cos(a) * r
        const z = s.z + Math.sin(a) * r
        const onPond = Math.hypot(x - POND.x, z - POND.z) < POND.r - fp - 0.15
        if (isWater(type) ? !onPond : Math.hypot(x - POND.x, z - POND.z) < POND.r + fp + 0.1) continue
        if (Math.hypot(x, z) > ISLAND.USABLE_R - fp * 0.5) continue
        if (l.solid && Math.hypot(x - l.x, z - l.z) < l.solid + fp + 0.1) continue
        const clash = existing.some((b) => (b.state ?? 'ok') === 'ok' && isWater(b.type) === isWater(type) && Math.hypot(x - b.x, z - b.z) < footprint(b.type) + fp - 0.02)
        if (!clash) return { x, z, lift: 0, rot: s.rot + (rng() - 0.5) * 0.6 }
      }
    }
  }
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

// ─── feedback ────────────────────────────────────────────────────────────────

/**
 * One line on why a task is still not done after an order, so players learn
 * what their prompt left out. `mine` is the owner's intact builds at the
 * landmark; `guess` is what the builder had to make up.
 */
export function explainMiss(t: TaskTemplate, mine: BuildLike[], guess?: { color?: string; count?: number }): string {
  const need = t.need
  const want = need.count ?? 1
  const same = mine.filter((b) => b.type === need.type && (b.state ?? 'ok') === 'ok')
  const matching = same.filter((b) => !need.color || b.colorName === need.color)
  const why: string[] = []
  if (guess?.color) why.push(`did not say the color, so the builder picked ${guess.color}`)
  if (guess?.count) why.push(`did not say how many, so the builder made ${guess.count}`)
  const tail = why.length ? ` Your prompt ${why.join(' and ')}.` : ''
  if (!same.length) return `The task needs ${needLabel(need)}. Your prompt did not build one.`
  if (need.color && !matching.length) {
    const colors = [...new Set(same.map((b) => b.colorName || 'plain'))]
    return `You built ${same.length} ${colors.join(' and ')} ${needNoun(need.type, same.length)}. The task needs ${needLabel(need)}.${tail}`
  }
  if (matching.length < want) {
    return `You have ${matching.length} ${need.color ? `${need.color} ` : ''}${needNoun(need.type, matching.length)}. The task needs ${want}.${tail}`
  }
  return ''
}

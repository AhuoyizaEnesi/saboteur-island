/**
 * Crew tasks. Each task is a small change at one landmark, like a yellow bird
 * on the Red Cottage roof. Tasks are checked against the builds on the island,
 * so the same code decides "done" on the server and in tests.
 */

import { type BuildType, type ColorName } from './catalog'
import { ISLAND } from './constants'
import { landmarkById, type Landmark, type LandmarkId } from './landmarks'
import { footprint, type Rng } from './placement'
import { PLACES, type PlaceTag } from './prompting'

export interface TaskTemplate {
  id: string
  landmarkId: LandmarkId
  /** Who is asking. */
  who: string
  /** The request, in their words. Turning it into a clear prompt is the player's job. */
  request: string
  /** What the check needs, in plain words. Shown only after a second miss. */
  text: string
  /** A specific prompt that completes the task. Tests use it; players never see it. */
  order: string
  need: { type: BuildType; color?: ColorName; count?: number; place?: PlaceTag }
  /** Where the needed object goes, relative to the landmark and its facing. */
  slot: { dx: number; dz: number; lift?: number; rot?: number }
}

export const TASKS: TaskTemplate[] = [
  { id: 'red_bird', landmarkId: 'red_cottage', who: 'Mira', request: 'I miss the birds since winter. Put one up high where I can see it from my window, in the color of a lemon.', text: 'a yellow bird on the roof', order: 'a yellow bird on the roof', need: { type: 'bird', color: 'yellow', place: 'roof' }, slot: { dx: 0, dz: 0.2, lift: 1.47, rot: Math.PI / 2 } },
  { id: 'red_lantern', landmarkId: 'red_cottage', who: 'Mira', request: 'Guests keep tripping on my step at night. I need a lantern on each side of my door.', text: '2 lanterns by the door', order: '2 lanterns by the door', need: { type: 'lantern', count: 2, place: 'door' }, slot: { dx: 0.62, dz: 0.82 } },
  { id: 'blue_flowers', landmarkId: 'blue_cottage', who: 'Tomas', request: 'My front yard looks bare. I want three flower beds out front, the color of bubblegum.', text: '3 pink flower beds out front', order: '3 pink flower beds out front', need: { type: 'flowers', color: 'pink', count: 3, place: 'front' }, slot: { dx: -0.35, dz: 1.0 } },
  { id: 'blue_fence', landmarkId: 'blue_cottage', who: 'Tomas', request: 'My garden needs a border. Build me a fence the color of fresh snow.', text: 'a white fence', order: 'a white fence', need: { type: 'fence', color: 'white' }, slot: { dx: 1.25, dz: 0.2, rot: Math.PI / 2 } },
  { id: 'dock_boat', landmarkId: 'dock', who: 'The fisher', request: 'I need a ride across the pond. Tie a boat to the dock, the color of a ripe tomato so I can spot it.', text: 'a red boat tied to the dock', order: 'a red boat tied to the dock', need: { type: 'boat', color: 'red', place: 'dock' }, slot: { dx: 1.1, dz: 0.5 } },
  { id: 'dock_duck', landmarkId: 'dock', who: 'The fisher', request: 'My two kids want company out on the water. One duck each, please.', text: '2 ducks in the pond', order: '2 ducks in the pond', need: { type: 'duck', count: 2, place: 'pond' }, slot: { dx: 1.9, dz: -0.7 } },
  { id: 'well_mushrooms', landmarkId: 'well', who: 'Old Wen', request: 'Something odd grows in the shade here. Grow me three mushrooms the color of a grape.', text: '3 purple mushrooms', order: '3 purple mushrooms', need: { type: 'mushroom', color: 'purple', count: 3 }, slot: { dx: 0.85, dz: 0.45 } },
  { id: 'well_bench', landmarkId: 'well', who: 'Old Wen', request: 'My knees ache after hauling water. I need a bench to rest on, the color of fresh grass.', text: 'a green bench', order: 'a green bench', need: { type: 'bench', color: 'green' }, slot: { dx: -0.9, dz: 0.55, rot: 0.4 } },
  { id: 'mill_sheep', landmarkId: 'windmill', who: 'The miller', request: 'I want a small flock grazing here. Just a pair to start.', text: '2 sheep', order: '2 sheep', need: { type: 'sheep', count: 2 }, slot: { dx: 1.0, dz: 0.7 } },
  { id: 'mill_scarecrow', landmarkId: 'windmill', who: 'The miller', request: 'Crows keep stealing my grain. I need a scarecrow in a shirt the color of a fire truck.', text: 'a red scarecrow', order: 'a red scarecrow', need: { type: 'scarecrow', color: 'red' }, slot: { dx: -1.0, dz: 0.8 } },
  { id: 'light_flag', landmarkId: 'lighthouse', who: 'The keeper', request: 'Ships cannot spot the island. Raise a flag the color of the sky.', text: 'a blue flag', order: 'a blue flag', need: { type: 'flag', color: 'blue' }, slot: { dx: -0.9, dz: 0.6 } },
  { id: 'light_lantern', landmarkId: 'lighthouse', who: 'The keeper', request: 'The way up to my tower is too dark at night. Three lanterns along the path.', text: '3 lanterns along the path', order: '3 lanterns along the path', need: { type: 'lantern', count: 3, place: 'path' }, slot: { dx: -1.15, dz: -0.5 } },
  { id: 'camp_tent', landmarkId: 'camp', who: 'The scouts', request: 'Two of us arrive tonight and we each need a tent. The color of a pumpkin, please.', text: '2 orange tents', order: '2 orange tents', need: { type: 'tent', color: 'orange', count: 2 }, slot: { dx: 0.3, dz: -1.5 } },
  { id: 'camp_fire', landmarkId: 'camp', who: 'The scouts', request: 'Story night needs something spooky. A campfire with flames the color of a frog.', text: 'a green campfire', order: 'a green campfire', need: { type: 'campfire', color: 'green' }, slot: { dx: 0, dz: 0 } },
  { id: 'orchard_tree', landmarkId: 'orchard', who: 'Farmer Lu', request: 'The orchard is short on fruit. Plant me a couple of round trees.', text: '2 round trees', order: '2 round trees', need: { type: 'round_tree', count: 2 }, slot: { dx: 0.9, dz: -0.5 } },
  { id: 'orchard_hive', landmarkId: 'orchard', who: 'Farmer Lu', request: 'The bees lost their home in the storm. Build them a hive the color of milk.', text: 'a white beehive', order: 'a white beehive', need: { type: 'beehive', color: 'white' }, slot: { dx: -0.8, dz: 0.7 } },
]

/** "a yellow bird on the roof", "2 ducks in the pond": what a task needs, in words. */
export function needLabel(need: TaskTemplate['need']): string {
  const n = need.count ?? 1
  const noun = needNoun(need.type, n)
  const head = `${n === 1 ? (/^[aeiou]/.test(need.color ?? noun) ? 'an' : 'a') : n} ${need.color ? `${need.color} ` : ''}${noun}`
  return need.place ? `${head} ${PLACES[need.place].label}` : head
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
  /** The place word spot it stands at ("roof"), or empty. */
  placeTag?: string
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
      (!t.need.color || b.colorName === t.need.color) &&
      (!t.need.place || b.placeTag === t.need.place),
  )
}

/** A task is done when its owner has exactly the asked number of intact matching builds there. */
export function taskDone(task: TaskLike, builds: BuildLike[]): boolean {
  const t = taskTemplate(task.templateId)
  if (!t) return false
  const n = matchingBuilds(task, builds).length
  return t.need.count && t.need.count > 1 ? n === t.need.count : n >= 1
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

/** Spots at a landmark that a place word can send things to, from the tasks that need a place. */
export function placeAnchors(l: Landmark): { tag: PlaceTag; type: BuildType; slot: ReturnType<typeof slotOf> }[] {
  return TASKS.filter((t) => t.landmarkId === l.id && t.need.place).map((t) => ({ tag: t.need.place as PlaceTag, type: t.need.type, slot: slotOf(t) }))
}

/**
 * Where a new object goes. A place word the prompt used ("on the roof") sends
 * it to that spot if the landmark has one. Without one, objects for tasks that
 * do not care about place keep their tidy task spot, and everything else is
 * set down anywhere at the landmark, away from the special spots. Boats always
 * float; ducks only go in the water when the prompt says so.
 */
export function spotAtLandmark(
  l: Landmark,
  type: BuildType,
  existing: PlacedAt[],
  rng: Rng,
  asked: PlaceTag[] = [],
): { x: number; z: number; lift: number; rot: number; place: PlaceTag | null } {
  const fp = footprint(type)
  const { POND } = ISLAND
  const water = type === 'boat' || (type === 'duck' && asked.includes('pond'))
  const free = (x: number, z: number) =>
    !existing.some((b) => (b.state ?? 'ok') === 'ok' && Math.hypot(x - b.x, z - b.z) < Math.max(0.3, footprint(b.type) + fp - 0.02))
  const okSurface = (x: number, z: number) => {
    const onPond = Math.hypot(x - POND.x, z - POND.z) < POND.r - fp - 0.15
    if (water ? !onPond : Math.hypot(x - POND.x, z - POND.z) < POND.r + fp + 0.1) return false
    if (Math.hypot(x, z) > ISLAND.USABLE_R - fp * 0.5) return false
    if (l.solid && Math.hypot(x - l.x, z - l.z) < l.solid + fp + 0.1) return false
    return true
  }
  const cluster = (s: ReturnType<typeof slotOf>) => {
    for (let ring = 1; ring <= 3; ring++) {
      const r = fp * 2 * ring + 0.12
      const steps = 6 * ring
      const turn = rng() * Math.PI * 2
      for (let k = 0; k < steps; k++) {
        const a = turn + (k / steps) * Math.PI * 2
        const x = s.x + Math.cos(a) * r
        const z = s.z + Math.sin(a) * r
        if (okSurface(x, z) && free(x, z)) return { x, z, lift: 0, rot: s.rot + (rng() - 0.5) * 0.6 }
      }
    }
    return null
  }

  // 1. A place the prompt asked for, if this landmark has it. Prefer the spot whose task wants this object.
  const anchors = placeAnchors(l)
  for (const tag of asked) {
    const a = anchors.find((x) => x.tag === tag && x.type === type) ?? anchors.find((x) => x.tag === tag)
    if (!a) continue
    // The spot itself is for the object its task wants; anything else goes beside it on a fitting surface.
    if (a.type === type && free(a.slot.x, a.slot.z)) return { ...a.slot, place: tag }
    const near = cluster(a.slot)
    if (near) return { ...near, place: tag }
  }
  // 2. Tasks that do not care about place keep their task spot, with extras beside it.
  const slots = TASKS.filter((t) => t.landmarkId === l.id && t.need.type === type && !t.need.place).map(slotOf)
  for (const s of slots) if (free(s.x, s.z)) return { ...s, place: null }
  for (const s of slots) {
    const near = cluster(s)
    if (near) return { ...near, place: null }
  }
  // 3. Anywhere at the landmark, away from the special spots.
  let best: { x: number; z: number } | null = null
  let bestScore = -Infinity
  for (let k = 0; k < 120; k++) {
    const a = rng() * Math.PI * 2
    let x: number
    let z: number
    if (water) {
      const r = Math.sqrt(rng()) * (POND.r - fp - 0.25)
      x = POND.x + Math.cos(a) * r
      z = POND.z + Math.sin(a) * r
    } else {
      const r = 0.9 + rng() * Math.max(0.3, l.area - 0.9)
      x = l.x + Math.cos(a) * r
      z = l.z + Math.sin(a) * r
      if (!okSurface(x, z)) continue
    }
    if (anchors.some((an) => Math.hypot(x - an.slot.x, z - an.slot.z) < 0.9)) continue
    let minD = 2
    for (const b of existing) minD = Math.min(minD, Math.hypot(x - b.x, z - b.z) - footprint(b.type) - fp)
    if (minD < -0.05 && k < 100) continue
    const score = Math.min(minD, 0.8) - Math.hypot(x - l.x, z - l.z) * 0.15 + rng() * 0.2
    if (score > bestScore) {
      bestScore = score
      best = { x, z }
    }
    if (k > 40 && best) break
  }
  const p = best ?? fromLandmark(l, 1, 0)
  return { ...p, lift: 0, rot: rng() * Math.PI * 2, place: null }
}

// ─── feedback ────────────────────────────────────────────────────────────────

/** "The fisher" at the start of a sentence, "the fisher" in the middle. */
const midName = (who: string) => (who.startsWith('The ') ? `the ${who.slice(4)}` : who)

/**
 * One line on why a task is still not done after a prompt. The first miss
 * says which part is off (the color, the place, how many) so the player
 * rereads the request; later misses say exactly what was asked for.
 * `mine` is the owner's intact builds at the landmark.
 */
export function explainMiss(t: TaskTemplate, mine: BuildLike[], reveal: boolean): string {
  const need = t.need
  const want = need.count ?? 1
  const who = midName(t.who)
  const end = reveal ? ` ${t.who} wants ${needLabel(need)}.` : ' Read the request again.'
  const same = mine.filter((b) => b.type === need.type && (b.state ?? 'ok') === 'ok')
  if (!same.length) return `Not done yet: that is not what ${who} asked for.${end}`
  const colorOk = (b: BuildLike) => !need.color || b.colorName === need.color
  const placeOk = (b: BuildLike) => !need.place || b.placeTag === need.place
  const issues: string[] = []
  if (need.color && !same.some(colorOk)) issues.push('the color')
  if (need.place && !same.some(placeOk)) issues.push('the place')
  const full = same.filter((b) => colorOk(b) && placeOk(b)).length
  if (!issues.length && (want > 1 ? full !== want : full < 1)) {
    return `Not done yet: you have ${full} and ${who} asked for ${want > 1 ? 'a different number' : 'one'}.${end}`
  }
  if (!issues.length) return ''
  const list = issues.length > 1 ? `${issues.slice(0, -1).join(', ')} and ${issues[issues.length - 1]}` : issues[0]
  return `Not done yet: ${list} ${issues.length > 1 ? 'are' : 'is'} not what ${who} asked for.${end}`
}

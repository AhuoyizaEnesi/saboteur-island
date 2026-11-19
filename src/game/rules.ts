/**
 * Pure game rules. No network, no records: everything here takes plain data
 * and returns plain data, so it is unit tested and shared by the server
 * actions and the browser HUD.
 */

import type { BuildType } from './catalog'
import { pluralLabel } from './catalog'
import type { Rng } from './placement'
import type { Role } from './constants'

// ─── Crew task list ──────────────────────────────────────────────────────────

export interface Task {
  type: BuildType
  need: number
  label: string
}

export const CREW_TASKS: Task[] = [
  { type: 'house', need: 3, label: 'Build 3 cottages' },
  { type: 'dock', need: 1, label: 'Build a dock' },
  { type: 'boat', need: 1, label: 'Put a boat on the pond' },
  { type: 'lighthouse', need: 1, label: 'Raise a lighthouse' },
  { type: 'lantern', need: 3, label: 'Light 3 lanterns' },
]

export interface TaskStatus extends Task {
  have: number
  done: boolean
}

export function taskStatus(builds: { type: string }[]): TaskStatus[] {
  return CREW_TASKS.map((t) => {
    const have = builds.filter((b) => b.type === t.type).length
    return { ...t, have: Math.min(have, t.need), done: have >= t.need }
  })
}

export function taskProgress(builds: { type: string }[]): number {
  const s = taskStatus(builds)
  const total = s.reduce((n, t) => n + t.need, 0)
  const have = s.reduce((n, t) => n + t.have, 0)
  return total ? have / total : 0
}

export const tasksDone = (builds: { type: string }[]) => taskStatus(builds).every((t) => t.done)

// ─── Impostor secret goals ───────────────────────────────────────────────────

export interface Theme {
  id: string
  title: string
  goal: string
  targets: BuildType[]
  /** How a bot Impostor phrases each target so it sounds harmless. */
  disguises: Partial<Record<BuildType, string[]>>
  /** How the reveal describes each target. */
  reveals: Partial<Record<BuildType, string>>
}

export const THEMES: Theme[] = [
  {
    id: 'lair',
    title: 'Supervillain hideout',
    goal: 'Turn the village into a supervillain hideout: sneak in a volcano, a pirate flag and glowing crystals.',
    targets: ['volcano', 'pirate_flag', 'crystal'],
    disguises: {
      volcano: ['Pile up some warm rocks by the trees so people stay cozy', 'A little hill with a warm glow for chilly nights'],
      pirate_flag: ['Hang a dark flag by the water to guide the fishing fleet', 'A tall pole with a dark banner so boats find home'],
      crystal: ['Some pretty glowing stones to light the path', 'A few shiny gems near the houses for decoration'],
    },
    reveals: { volcano: 'a volcano, passed off as warm rocks', pirate_flag: 'a pirate flag, passed off as a fleet signal', crystal: 'villain crystals, passed off as path lights' },
  },
  {
    id: 'ducks',
    title: 'Rubber duck cult',
    goal: 'Start a rubber duck cult: get rubber ducks on the pond, a totem and giant mushrooms on the island.',
    targets: ['duck', 'totem', 'mushroom'],
    disguises: {
      duck: ['Add a couple of little yellow buoys on the pond for the boats', 'Some yellow floats so the fishers can mark their nets'],
      totem: ['A carved welcome post at the edge of the village', 'A wooden statue to honor the first fisher'],
      mushroom: ['A big red and white sun umbrella for the beach', 'Some tall shade umbrellas near the cottages'],
    },
    reveals: { duck: 'rubber ducks, passed off as buoys', totem: 'a cult totem, passed off as a welcome post', mushroom: 'giant mushrooms, passed off as sun umbrellas' },
  },
  {
    id: 'desert',
    title: 'Secret desert',
    goal: 'Quietly turn the island into a desert: plant cacti, raise a totem and start a volcano.',
    targets: ['cactus', 'totem', 'volcano'],
    disguises: {
      cactus: ['Some tall green plants that do not need much water', 'A couple of hardy green posts for the fence line'],
      totem: ['A carved welcome post at the edge of the village', 'A wooden statue to honor the first fisher'],
      volcano: ['Pile up some warm rocks by the trees so people stay cozy', 'A little hill with a warm glow for chilly nights'],
    },
    reveals: { cactus: 'cacti, passed off as hardy plants', totem: 'a desert totem, passed off as a welcome post', volcano: 'a volcano, passed off as warm rocks' },
  },
]

export const themeById = (id: string): Theme => THEMES.find((t) => t.id === id) ?? THEMES[0]

export interface SecretStatus {
  target: BuildType
  done: boolean
}

/** Which of the Impostor's targets the Impostor has placed so far. */
export function secretStatus(
  builds: { type: string; playerId: string }[],
  impostorPlayerId: string,
  theme: Theme,
): SecretStatus[] {
  return theme.targets.map((target) => ({
    target,
    done: builds.some((b) => b.playerId === impostorPlayerId && b.type === target),
  }))
}

export const secretDone = (builds: { type: string; playerId: string }[], impostorPlayerId: string, theme: Theme) =>
  secretStatus(builds, impostorPlayerId, theme).every((s) => s.done)

// ─── Voting ──────────────────────────────────────────────────────────────────

export interface Vote {
  voterId: string
  targetId: string
}

export interface TallyResult {
  /** Ejected player id, or null for a tie or a skip win. */
  ejectedId: string | null
  counts: Record<string, number>
  tie: boolean
}

export function tally(votes: Vote[], aliveIds: string[]): TallyResult {
  const counts: Record<string, number> = {}
  const alive = new Set(aliveIds)
  const seen = new Set<string>()
  for (const v of votes) {
    if (!alive.has(v.voterId) || seen.has(v.voterId)) continue
    seen.add(v.voterId)
    const target = v.targetId === 'skip' || alive.has(v.targetId) ? v.targetId : 'skip'
    counts[target] = (counts[target] ?? 0) + 1
  }
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1])
  if (!entries.length) return { ejectedId: null, counts, tie: false }
  const top = entries.filter((e) => e[1] === entries[0][1])
  if (top.length > 1) return { ejectedId: null, counts, tie: true }
  return { ejectedId: top[0][0] === 'skip' ? null : top[0][0], counts, tie: false }
}

// ─── Winning ─────────────────────────────────────────────────────────────────

export interface WinInput {
  impostorAlive: boolean
  aliveCrew: number
  aliveImpostors: number
  /** True once the last round and the final vote are finished. */
  finalDone: boolean
  tasksComplete: boolean
  secretComplete: boolean
}

export type Winner = 'crew' | 'impostor' | null

export function decideWinner(s: WinInput): { winner: Winner; reason: string } {
  if (!s.impostorAlive) return { winner: 'crew', reason: 'The crew ejected the Impostor.' }
  if (s.aliveImpostors >= s.aliveCrew) return { winner: 'impostor', reason: 'Too few crew are left to outvote the Impostor.' }
  if (!s.finalDone) return { winner: null, reason: '' }
  if (s.secretComplete) return { winner: 'impostor', reason: 'The Impostor finished their secret goal and was never caught.' }
  if (!s.tasksComplete) return { winner: 'impostor', reason: 'The village was never finished, and the Impostor slipped away.' }
  return { winner: 'crew', reason: 'The village is finished and the Impostor never completed their plan.' }
}

// ─── Roles ───────────────────────────────────────────────────────────────────

export function assignRoles(playerIds: string[], rng: Rng): Record<string, Role> {
  const roles: Record<string, Role> = {}
  const impostor = playerIds[Math.floor(rng() * playerIds.length)]
  for (const id of playerIds) roles[id] = id === impostor ? 'impostor' : 'crew'
  return roles
}

export function pickTheme(rng: Rng): Theme {
  return THEMES[Math.floor(rng() * THEMES.length)]
}

// ─── Join codes ──────────────────────────────────────────────────────────────

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ'
export function makeCode(rng: Rng): string {
  let s = ''
  for (let i = 0; i < 4; i++) s += CODE_ALPHABET[Math.floor(rng() * CODE_ALPHABET.length)]
  return s
}

export const normalizeCode = (code: unknown) =>
  typeof code === 'string' ? code.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4) : ''

// ─── AI player orders ────────────────────────────────────────────────────────

export interface BotOp {
  type: BuildType
  count: number
  near?: string
  scale?: number
}

export interface BotOrder {
  text: string
  ops: BotOp[]
}

const CREW_PHRASES: Partial<Record<BuildType, { text: string; op: BotOp }[]>> = {
  house: [
    { text: 'A couple of cottages by the pond for the fishers', op: { type: 'house', count: 2, near: 'pond' } },
    { text: 'One more cottage near the others', op: { type: 'house', count: 1, near: 'house' } },
  ],
  dock: [{ text: 'A little wooden dock on the pond', op: { type: 'dock', count: 1 } }],
  boat: [{ text: 'A fishing boat on the pond, please', op: { type: 'boat', count: 1 } }],
  lighthouse: [{ text: 'Raise a lighthouse out on the cliff edge', op: { type: 'lighthouse', count: 1, near: 'edge' } }],
  lantern: [
    { text: 'Lanterns along the paths between the houses', op: { type: 'lantern', count: 3, near: 'house' } },
    { text: 'A couple of lanterns by the water', op: { type: 'lantern', count: 2, near: 'pond' } },
  ],
}

const CREW_EXTRAS: { text: string; op: BotOp }[] = [
  { text: 'Some sheep grazing on the hill', op: { type: 'sheep', count: 3, near: 'center' } },
  { text: 'Flower beds next to the cottages', op: { type: 'flowers', count: 2, near: 'house' } },
  { text: 'A windmill up on the hill', op: { type: 'windmill', count: 1, near: 'center' } },
  { text: 'A stone well for fresh water', op: { type: 'well', count: 1, near: 'house' } },
  { text: 'A campfire where the fishers can gather', op: { type: 'campfire', count: 1, near: 'house' } },
  { text: 'A short fence around the sheep', op: { type: 'fence', count: 1, near: 'sheep' } },
]

/**
 * A crew AI player works on whatever task is furthest behind, then on
 * village extras. An Impostor AI player sneaks in its next missing target in
 * disguise, but only some of the time, so it also looks helpful.
 */
export function botOrder(input: {
  role: Role
  theme: Theme
  builds: { type: string; playerId: string }[]
  botPlayerId: string
  rng: Rng
  /** Orders this bot already sent this game, to avoid repeating itself. */
  pastTexts: string[]
}): BotOrder {
  const { role, theme, builds, botPlayerId, rng, pastTexts } = input
  const fresh = <T extends { text: string }>(list: T[]) => {
    const unused = list.filter((p) => !pastTexts.includes(p.text))
    return unused.length ? unused : list
  }

  if (role === 'impostor') {
    const missing = secretStatus(builds, botPlayerId, theme).filter((s) => !s.done)
    if (missing.length && rng() < 0.75) {
      const target = missing[Math.floor(rng() * missing.length)].target
      const lines = fresh((theme.disguises[target] ?? [`Add a ${target.replace('_', ' ')}`]).map((text) => ({ text })))
      const text = lines[Math.floor(rng() * lines.length)].text
      const count = target === 'duck' ? 3 : target === 'crystal' || target === 'cactus' || target === 'mushroom' ? 2 : 1
      const near = target === 'volcano' ? 'pine_tree' : target === 'pirate_flag' ? 'pond' : undefined
      return { text, ops: [{ type: target, count, near, scale: target === 'volcano' ? 0.6 : undefined }] }
    }
  }

  const behind = taskStatus(builds)
    .filter((t) => !t.done)
    .sort((a, b) => a.have / a.need - b.have / b.need)
  if (behind.length && rng() < 0.85) {
    const options = fresh(CREW_PHRASES[behind[0].type] ?? [])
    if (options.length) {
      const pickd = options[Math.floor(rng() * options.length)]
      return { text: pickd.text, ops: [pickd.op] }
    }
  }
  const extra = fresh(CREW_EXTRAS)
  const e = extra[Math.floor(rng() * extra.length)]
  return { text: e.text, ops: [e.op] }
}

/** Plain summary of a list of ops, for the agent's narration line. */
export function describeOps(ops: { type: BuildType; count: number }[]): string {
  if (!ops.length) return 'Nothing was built.'
  const parts = ops.map((o) => pluralLabel(o.type, o.count))
  const line = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0]
  return `Built ${line}.`
}

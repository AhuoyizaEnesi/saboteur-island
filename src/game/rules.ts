/**
 * Pure game rules. No network, no records: everything here takes plain data
 * and returns plain data, so it is unit tested and shared by the server
 * actions and the browser HUD.
 */

import type { BuildType } from './catalog'
import { pluralLabel } from './catalog'
import type { Rng } from './placement'
import type { Role, TimeOfDay } from './constants'

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
  tasksDone: number
  tasksTotal: number
  nightFallen: boolean
}

export type Winner = 'crew' | 'impostor' | null

export function decideWinner(s: WinInput): { winner: Winner; reason: string } {
  if (!s.impostorAlive) return { winner: 'crew', reason: 'The crew voted out the Impostor.' }
  if (s.tasksTotal > 0 && s.tasksDone >= s.tasksTotal) return { winner: 'crew', reason: 'Every task was finished before night fell.' }
  if (s.aliveCrew <= 1) return { winner: 'impostor', reason: 'Only one crew member was left to stop the Impostor.' }
  if (s.nightFallen) return { winner: 'impostor', reason: 'Night fell before the island was finished.' }
  return { winner: null, reason: '' }
}

/** How the sky looks as the night clock runs down. `elapsed` is 0 at the start and 1 at nightfall. */
export function skyFor(elapsed: number): TimeOfDay {
  if (elapsed < 0.45) return 'day'
  if (elapsed < 0.85) return 'sunset'
  return 'night'
}

// ─── Roles ───────────────────────────────────────────────────────────────────

/**
 * Pick the one Impostor. People count `humanWeight` times as much as AI
 * players, so a person gets the role more often than any one AI player.
 * `pick` lets a solo player choose their own role.
 */
export function assignRoles(
  playerIds: string[],
  rng: Rng,
  opts: { humans?: string[]; humanWeight?: number; pick?: { id: string; role: Role } } = {},
): Record<string, Role> {
  const weight = (id: string) => {
    if (opts.pick) {
      if (opts.pick.id === id) return opts.pick.role === 'impostor' ? 1 : 0
      if (opts.pick.role === 'impostor') return 0
    }
    return opts.humans?.includes(id) ? (opts.humanWeight ?? 1) : 1
  }
  const total = playerIds.reduce((n, id) => n + weight(id), 0)
  let r = rng() * total
  let impostor = playerIds[playerIds.length - 1]
  for (const id of playerIds) {
    r -= weight(id)
    if (r < 0 && weight(id) > 0) {
      impostor = id
      break
    }
  }
  const roles: Record<string, Role> = {}
  for (const id of playerIds) roles[id] = id === impostor ? 'impostor' : 'crew'
  return roles
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

/** Plain summary of a list of ops, for the agent's narration line. */
export function describeOps(ops: { type: BuildType; count: number }[]): string {
  if (!ops.length) return 'Nothing was built.'
  const parts = ops.map((o) => pluralLabel(o.type, o.count))
  const line = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0]
  return `Built ${line}.`
}

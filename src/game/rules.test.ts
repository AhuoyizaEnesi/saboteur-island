import { describe, expect, it } from 'vitest'
import { ISLAND, MEETING_SPOT } from './constants'
import { footprint, makeRng, placeOne, type PlacedLike } from './placement'
import {
  assignRoles,
  botOrder,
  decideWinner,
  makeCode,
  normalizeCode,
  secretDone,
  secretStatus,
  tally,
  taskProgress,
  tasksDone,
  THEMES,
} from './rules'
import { streamInfo } from './terrain'

describe('tally', () => {
  const alive = ['a', 'b', 'c', 'd', 'e']
  it('ejects the clear majority', () => {
    const r = tally(
      [
        { voterId: 'a', targetId: 'c' },
        { voterId: 'b', targetId: 'c' },
        { voterId: 'd', targetId: 'skip' },
      ],
      alive,
    )
    expect(r.ejectedId).toBe('c')
    expect(r.counts.c).toBe(2)
  })
  it('ejects nobody on a tie', () => {
    const r = tally(
      [
        { voterId: 'a', targetId: 'c' },
        { voterId: 'b', targetId: 'd' },
      ],
      alive,
    )
    expect(r.ejectedId).toBeNull()
    expect(r.tie).toBe(true)
  })
  it('ejects nobody when skip wins', () => {
    const r = tally(
      [
        { voterId: 'a', targetId: 'skip' },
        { voterId: 'b', targetId: 'skip' },
        { voterId: 'c', targetId: 'a' },
      ],
      alive,
    )
    expect(r.ejectedId).toBeNull()
    expect(r.tie).toBe(false)
  })
  it('ignores dead voters and double votes', () => {
    const r = tally(
      [
        { voterId: 'zombie', targetId: 'a' },
        { voterId: 'b', targetId: 'a' },
        { voterId: 'b', targetId: 'a' },
        { voterId: 'c', targetId: 'd' },
        { voterId: 'e', targetId: 'd' },
      ],
      alive,
    )
    expect(r.ejectedId).toBe('d')
  })
})

describe('decideWinner', () => {
  const base = { impostorAlive: true, aliveCrew: 4, aliveImpostors: 1, finalDone: false, tasksComplete: false, secretComplete: false }
  it('crew wins the moment the Impostor is ejected', () => {
    expect(decideWinner({ ...base, impostorAlive: false, aliveImpostors: 0 }).winner).toBe('crew')
  })
  it('keeps playing mid game', () => {
    expect(decideWinner(base).winner).toBeNull()
  })
  it('Impostor wins when crew numbers collapse', () => {
    expect(decideWinner({ ...base, aliveCrew: 1 }).winner).toBe('impostor')
  })
  it('at the end, a finished secret goal beats finished tasks', () => {
    expect(decideWinner({ ...base, finalDone: true, tasksComplete: true, secretComplete: true }).winner).toBe('impostor')
  })
  it('at the end, finished tasks and a failed plan is a crew win', () => {
    expect(decideWinner({ ...base, finalDone: true, tasksComplete: true }).winner).toBe('crew')
  })
  it('at the end, an unfinished village goes to the Impostor', () => {
    expect(decideWinner({ ...base, finalDone: true }).winner).toBe('impostor')
  })
})

describe('tasks and secret goals', () => {
  it('counts task progress and completion', () => {
    const builds = [
      { type: 'house' }, { type: 'house' }, { type: 'house' }, { type: 'house' },
      { type: 'dock' }, { type: 'boat' }, { type: 'lighthouse' },
      { type: 'lantern' }, { type: 'lantern' },
    ]
    expect(tasksDone(builds)).toBe(false)
    expect(taskProgress(builds)).toBeCloseTo(8 / 9)
    expect(tasksDone([...builds, { type: 'lantern' }])).toBe(true)
  })
  it('only counts the Impostor’s own builds toward the secret goal', () => {
    const theme = THEMES[0]
    const builds = [
      { type: 'volcano', playerId: 'crew1' },
      { type: 'pirate_flag', playerId: 'imp' },
      { type: 'crystal', playerId: 'imp' },
    ]
    expect(secretDone(builds, 'imp', theme)).toBe(false)
    expect(secretStatus(builds, 'imp', theme).filter((s) => s.done)).toHaveLength(2)
    expect(secretDone([...builds, { type: 'volcano', playerId: 'imp' }], 'imp', theme)).toBe(true)
  })
})

describe('roles and codes', () => {
  it('deals exactly one Impostor', () => {
    for (let seed = 1; seed < 50; seed++) {
      const roles = assignRoles(['a', 'b', 'c', 'd', 'e'], makeRng(seed))
      expect(Object.values(roles).filter((r) => r === 'impostor')).toHaveLength(1)
    }
  })
  it('makes 4 letter codes without confusing letters', () => {
    const code = makeCode(makeRng(7))
    expect(code).toMatch(/^[A-Z]{4}$/)
    expect(code).not.toMatch(/[ILO]/)
    expect(normalizeCode(' ab-cd9 ')).toBe('ABCD')
  })
})

describe('placement', () => {
  it('keeps every object on the island, off the pond, stream and meeting spot, and apart', () => {
    const rng = makeRng(42)
    const placed: PlacedLike[] = []
    const types = ['house', 'pine_tree', 'lantern', 'windmill', 'well', 'sheep', 'volcano', 'campfire'] as const
    for (let i = 0; i < 40; i++) placed.push(placeOne({ type: types[i % types.length] }, placed, rng))
    for (const p of placed) {
      expect(Math.hypot(p.x, p.z)).toBeLessThanOrEqual(ISLAND.USABLE_R + 0.001)
      expect(Math.hypot(p.x - ISLAND.POND.x, p.z - ISLAND.POND.z)).toBeGreaterThan(ISLAND.POND.r)
      expect(streamInfo(p.x, p.z).d).toBeGreaterThan(0.2)
      expect(Math.hypot(p.x - MEETING_SPOT.x, p.z - MEETING_SPOT.z)).toBeGreaterThan(0.9)
    }
    let overlaps = 0
    for (let i = 0; i < placed.length; i++)
      for (let j = i + 1; j < placed.length; j++) {
        const a = placed[i]
        const b = placed[j]
        if (Math.hypot(a.x - b.x, a.z - b.z) < (footprint(a.type) + footprint(b.type)) * 0.5) overlaps++
      }
    expect(overlaps).toBe(0)
  })
  it('puts boats and ducks on the pond', () => {
    const rng = makeRng(3)
    for (const type of ['boat', 'duck'] as const) {
      const p = placeOne({ type }, [], rng)
      expect(Math.hypot(p.x - ISLAND.POND.x, p.z - ISLAND.POND.z)).toBeLessThan(ISLAND.POND.r)
    }
  })
  it('clamps a requested position to the island', () => {
    const p = placeOne({ type: 'rock', x: 40, z: 0 }, [], makeRng(1))
    expect(Math.hypot(p.x, p.z)).toBeLessThanOrEqual(ISLAND.USABLE_R + 0.001)
  })
})

describe('AI player orders', () => {
  it('a crew AI works on the task furthest behind', () => {
    const order = botOrder({ role: 'crew', theme: THEMES[0], builds: [], botPlayerId: 'b', rng: makeRng(1), pastTexts: [] })
    expect(order.ops.length).toBeGreaterThan(0)
  })
  it('an Impostor AI eventually sneaks in its targets', () => {
    const theme = THEMES[1]
    const seen = new Set<string>()
    for (let seed = 0; seed < 40; seed++) {
      const o = botOrder({ role: 'impostor', theme, builds: [], botPlayerId: 'imp', rng: makeRng(seed), pastTexts: [] })
      for (const op of o.ops) seen.add(op.type)
    }
    for (const t of theme.targets) expect(seen.has(t)).toBe(true)
  })
})

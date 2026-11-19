import { describe, expect, it } from 'vitest'
import { legalMove, seatSpot } from '../actions/game'
import { __test as builder } from '../server/builder-agent'
import { heuristicMeeting, notesFor, type MeetingInput } from '../server/meeting-ai'
import { BOT_SPEED, routeDone, routePos, stayLeg, walkLeg } from './bots'
import { ISLAND, MEETING_SPOT, POS_SLACK, WALK_SPEED } from './constants'
import { LANDMARKS, landmarkById, walkable } from './landmarks'
import { footprint, makeRng, placeOne, type PlacedLike } from './placement'
import { assignRoles, decideWinner, makeCode, normalizeCode, skyFor, tally } from './rules'
import { dealTasks, fakeTasks, slotOf, spotAtLandmark, taskDone, TASKS, taskTemplate } from './tasks'
import { streamInfo } from './terrain'

describe('tally', () => {
  const alive = ['a', 'b', 'c', 'd', 'e']
  it('ejects the clear majority', () => {
    const r = tally([{ voterId: 'a', targetId: 'c' }, { voterId: 'b', targetId: 'c' }, { voterId: 'd', targetId: 'skip' }], alive)
    expect(r.ejectedId).toBe('c')
  })
  it('ejects nobody on a tie', () => {
    const r = tally([{ voterId: 'a', targetId: 'c' }, { voterId: 'b', targetId: 'd' }], alive)
    expect(r.ejectedId).toBeNull()
    expect(r.tie).toBe(true)
  })
  it('ejects nobody when skip wins', () => {
    const r = tally([{ voterId: 'a', targetId: 'skip' }, { voterId: 'b', targetId: 'skip' }, { voterId: 'c', targetId: 'a' }], alive)
    expect(r.ejectedId).toBeNull()
    expect(r.tie).toBe(false)
  })
  it('ignores ghosts and double votes', () => {
    const r = tally(
      [{ voterId: 'ghost', targetId: 'a' }, { voterId: 'b', targetId: 'a' }, { voterId: 'b', targetId: 'a' }, { voterId: 'c', targetId: 'd' }, { voterId: 'e', targetId: 'd' }],
      alive,
    )
    expect(r.ejectedId).toBe('d')
  })
})

describe('decideWinner', () => {
  const base = { impostorAlive: true, aliveCrew: 4, tasksDone: 3, tasksTotal: 12, nightFallen: false }
  it('keeps playing mid game', () => expect(decideWinner(base).winner).toBeNull())
  it('crew wins when the Impostor is ejected', () => expect(decideWinner({ ...base, impostorAlive: false }).winner).toBe('crew'))
  it('crew wins when every task is done at once', () => expect(decideWinner({ ...base, tasksDone: 12 }).winner).toBe('crew'))
  it('Impostor wins at nightfall with tasks unfinished', () => expect(decideWinner({ ...base, nightFallen: true }).winner).toBe('impostor'))
  it('Impostor wins when only one crew member is left', () => expect(decideWinner({ ...base, aliveCrew: 1 }).winner).toBe('impostor'))
  it('finished tasks beat nightfall in the same moment', () => expect(decideWinner({ ...base, tasksDone: 12, nightFallen: true }).winner).toBe('crew'))
  it('the sky gets darker as the clock runs down', () => {
    expect(skyFor(0)).toBe('day')
    expect(skyFor(0.6)).toBe('sunset')
    expect(skyFor(0.95)).toBe('night')
  })
})

describe('tasks', () => {
  it('has unique ids, real landmarks, and two tasks per working landmark', () => {
    expect(new Set(TASKS.map((t) => t.id)).size).toBe(TASKS.length)
    for (const t of TASKS) expect(landmarkById(t.landmarkId)?.area).toBeGreaterThan(0)
    const counts: Record<string, number> = {}
    for (const t of TASKS) counts[t.landmarkId] = (counts[t.landmarkId] ?? 0) + 1
    expect(Object.values(counts).every((n) => n === 2)).toBe(true)
  })
  it('deals 3 tasks per crew member at different landmarks, never sharing a task', () => {
    for (let seed = 1; seed < 40; seed++) {
      const crew = ['a', 'b', 'c', 'd', 'e']
      const deal = dealTasks(crew, makeRng(seed), 3)
      const all = crew.flatMap((id) => deal[id])
      expect(all).toHaveLength(15)
      expect(new Set(all).size).toBe(15)
      for (const id of crew) expect(new Set(deal[id].map((t) => taskTemplate(t)?.landmarkId)).size).toBe(3)
    }
  })
  it('gives the Impostor a believable fake list', () => {
    const fake = fakeTasks(makeRng(9))
    expect(fake).toHaveLength(3)
    expect(new Set(fake.map((t) => taskTemplate(t)?.landmarkId)).size).toBe(3)
  })
  it('is done only by its owner, with the right type and color, still standing', () => {
    const task = { playerId: 'p1', templateId: 'red_bird' }
    const bird = { playerId: 'p1', landmarkId: 'red_cottage', type: 'bird', colorName: 'yellow', state: 'ok' }
    expect(taskDone(task, [bird])).toBe(true)
    expect(taskDone(task, [{ ...bird, playerId: 'p2' }])).toBe(false)
    expect(taskDone(task, [{ ...bird, colorName: 'red' }])).toBe(false)
    expect(taskDone(task, [{ ...bird, landmarkId: 'well' }])).toBe(false)
    expect(taskDone(task, [{ ...bird, state: 'knocked' }])).toBe(false)
    expect(taskDone(task, [{ ...bird, state: 'painted', colorName: 'black' }])).toBe(false)
  })
  it('puts a task object in its slot, so the bird really sits on the roof', () => {
    const l = landmarkById('red_cottage')!
    const s = spotAtLandmark(l, 'bird', [], makeRng(1))
    const want = slotOf(taskTemplate('red_bird')!)
    expect(s.x).toBeCloseTo(want.x)
    expect(s.z).toBeCloseTo(want.z)
    expect(s.lift).toBeGreaterThan(1)
  })
  it('puts a second one elsewhere in the landmark area once the slot is taken', () => {
    const l = landmarkById('well')!
    const first = spotAtLandmark(l, 'bench', [], makeRng(1))
    const second = spotAtLandmark(l, 'bench', [{ type: 'bench', x: first.x, z: first.z, state: 'ok' }], makeRng(2))
    expect(Math.hypot(second.x - first.x, second.z - first.z)).toBeGreaterThan(0.3)
    expect(Math.hypot(second.x - l.x, second.z - l.z)).toBeLessThanOrEqual(l.area + 0.01)
  })
})

describe('walking and positions', () => {
  it('keeps islanders on the island, out of the pond and out of buildings', () => {
    const rng = makeRng(5)
    for (let i = 0; i < 300; i++) {
      const p = walkable((rng() - 0.5) * 30, (rng() - 0.5) * 30)
      expect(Math.hypot(p.x, p.z)).toBeLessThanOrEqual(ISLAND.USABLE_R + 0.001)
      expect(Math.hypot(p.x - ISLAND.POND.x, p.z - ISLAND.POND.z)).toBeGreaterThanOrEqual(ISLAND.POND.r + 0.2)
      for (const l of LANDMARKS) if (l.solid) expect(Math.hypot(p.x - l.x, p.z - l.z)).toBeGreaterThanOrEqual(l.solid - 0.01)
    }
  })
  it('accepts a legal move and pulls back a teleport', () => {
    const prev = { x: 0, z: 2, at: 1000 }
    const ok = legalMove(prev, { x: 1, z: 2 }, 2000)
    expect(ok.x).toBeCloseTo(1)
    const far = legalMove(prev, { x: 9, z: 2 }, 2000)
    expect(Math.hypot(far.x - prev.x, far.z - prev.z)).toBeLessThanOrEqual(WALK_SPEED + POS_SLACK + 0.01)
  })
  it('seats everyone around the bell', () => {
    for (let s = 0; s < 6; s++) {
      const p = seatSpot(s)
      expect(Math.hypot(p.x - MEETING_SPOT.x, p.z - MEETING_SPOT.z)).toBeGreaterThan(1)
    }
  })
})

describe('AI player routes', () => {
  it('walks at AI speed and every browser computes the same spot', () => {
    const a = { x: -3, z: -2 }
    const b = { x: 3, z: -2 }
    const leg = walkLeg(a, b, 10_000)
    expect(leg.t1 - leg.t0).toBeCloseTo((6 / BOT_SPEED) * 1000, -1)
    const mid = routePos([leg], (leg.t0 + leg.t1) / 2, a)
    expect(mid.x).toBeCloseTo(0, 1)
    expect(routePos([leg], leg.t1 + 5000, a).x).toBeCloseTo(3)
  })
  it('knows when a route is finished', () => {
    const legs = [stayLeg({ x: 0, z: 2 }, 0, 1000, 'wait')]
    expect(routeDone(legs, 500)).toBe(false)
    expect(routeDone(legs, 1000)).toBe(true)
    expect(routeDone([], 0)).toBe(true)
  })
})

describe('builder fallback', () => {
  it('reads type, color and count from plain words', () => {
    const p = builder.keywordBuild({ text: 'a yellow bird on the roof', capacity: 10 })
    expect(p.items).toEqual([{ type: 'bird', color: 'yellow' }])
    const two = builder.keywordBuild({ text: 'two blue flags and a bench', capacity: 10 })
    expect(two.items.filter((i) => i.type === 'flag' && i.color === 'blue')).toHaveLength(2)
    expect(two.items.some((i) => i.type === 'bench')).toBe(true)
  })
  it('never places more than 4 things per order', () => {
    expect(builder.keywordBuild({ text: '9 sheep', capacity: 50 }).items).toHaveLength(4)
  })
  it('turns a wreck order into one action on the named thing', () => {
    const targets = [{ id: 't1', type: 'lantern', colorName: '' }, { id: 't2', type: 'bird', colorName: 'yellow' }]
    const w = builder.keywordWreck('paint the bird green', targets)
    expect(w.acts).toEqual([{ targetId: 't2', kind: 'paint', color: 'green' }])
    expect(builder.keywordWreck('take it away', targets).acts[0].kind).toBe('remove')
  })
})

describe('meeting AI notes', () => {
  const players = [
    { id: 'imp', name: 'Kai', isBot: true, alive: true, isImpostor: true },
    { id: 'w', name: 'Ada', isBot: true, alive: true, isImpostor: false },
    { id: 'n', name: 'Juno', isBot: true, alive: true, isImpostor: false },
    { id: 'h', name: 'Peace', isBot: false, alive: true, isImpostor: false },
  ]
  const input: MeetingInput = {
    players,
    clues: [{ landmark: 'Well', at: 1000, impostorId: 'imp', nearby: ['imp', 'w', 'h'], witnesses: ['w'] }],
    callerName: 'Ada',
    reason: 'report',
    where: 'Well',
    rng: makeRng(4),
  }
  it('an eyewitness is sure and names the Impostor', () => {
    const n = notesFor(players[1], input)
    expect(n.sure).toBe(true)
    expect(n.suspect).toBe('imp')
  })
  it('a crew AI with no clues has nobody to accuse', () => {
    expect(notesFor(players[2], input).suspect).toBeNull()
  })
  it('the Impostor AI blames someone who was nearby, never itself', () => {
    const n = notesFor(players[0], input)
    expect(['w', 'h']).toContain(n.suspect)
  })
  it('without the model, the eyewitness still votes for the Impostor', () => {
    const out = heuristicMeeting(input, players.filter((p) => p.isBot))
    expect(out.votes.find((v) => v.playerId === 'w')?.targetId).toBe('imp')
    expect(out.lines.length).toBe(3)
  })
})

describe('roles, codes and scenery', () => {
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
  it('keeps scenery on the island, off the pond, stream and landmarks, and apart', () => {
    const rng = makeRng(42)
    const placed: PlacedLike[] = []
    const types = ['pine_tree', 'rock', 'round_tree', 'flowers'] as const
    for (let i = 0; i < 40; i++) placed.push(placeOne({ type: types[i % types.length] }, placed, rng))
    for (const p of placed) {
      expect(Math.hypot(p.x, p.z)).toBeLessThanOrEqual(ISLAND.USABLE_R + 0.001)
      expect(Math.hypot(p.x - ISLAND.POND.x, p.z - ISLAND.POND.z)).toBeGreaterThan(ISLAND.POND.r)
      expect(streamInfo(p.x, p.z).d).toBeGreaterThan(0.2)
      expect(Math.hypot(p.x - MEETING_SPOT.x, p.z - MEETING_SPOT.z)).toBeGreaterThan(1.5)
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
})

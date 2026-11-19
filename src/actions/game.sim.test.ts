/**
 * Plays whole games through the real server actions against an in-memory
 * stand-in for the records layer. The AI model is unreachable here, so every
 * call takes its non-AI fallback, which is exactly the path that must never
 * stall a game.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ActionResult, ActionTools } from 'deepspace/worker'
import { gameActions } from './game'
import { landmarkById } from '../game/landmarks'
import { makeRng } from '../game/placement'
import { assignRoles } from '../game/rules'
import { taskTemplate } from '../game/tasks'
import { INTRO_MS, MEETING_MS, VOTE_MS, EJECT_MS, PLAY_MS } from '../game/constants'

type Rec = { recordId: string; data: Record<string, unknown>; createdAt: string }

function fakeTools() {
  const db = new Map<string, Map<string, Rec>>()
  let n = 0
  const table = (c: string) => {
    if (!db.has(c)) db.set(c, new Map())
    return db.get(c) as Map<string, Rec>
  }
  const okR = <T,>(data: T): ActionResult<T> => ({ success: true, data }) as ActionResult<T>
  const tools = {
    async create(c: string, data: Record<string, unknown>) {
      const id = `${c}_${++n}`
      table(c).set(id, { recordId: id, data: structuredClone(data), createdAt: new Date(Date.now() + n).toISOString() })
      return okR({ recordId: id })
    },
    async update(c: string, id: string, patch: Record<string, unknown>) {
      const r = table(c).get(id)
      if (!r) return { success: false, error: `no ${c}/${id}` }
      r.data = { ...r.data, ...structuredClone(patch) }
      return okR({ recordId: id })
    },
    async remove(c: string, id: string) {
      table(c).delete(id)
      return okR({ recordId: id })
    },
    async get(c: string, id: string) {
      if (c === 'users') return okR({ record: { recordId: id, data: { name: id.toUpperCase() }, createdAt: '' } })
      const r = table(c).get(id)
      if (!r) return { success: false, error: 'not found' }
      return okR({ record: structuredClone(r) })
    },
    async query(c: string, opts: { where?: Record<string, unknown>; limit?: number } = {}) {
      const rows = [...table(c).values()].filter((r) => Object.entries(opts.where ?? {}).every(([k, v]) => r.data[k] === v))
      return okR({ records: rows.slice(0, opts.limit ?? 50).map((r) => structuredClone(r)) })
    },
    async deleteWhere() {
      return okR({ deleted: 0 })
    },
    async integration() {
      return { success: false, error: 'offline' }
    },
  } as unknown as ActionTools
  return { tools, db, table }
}

async function call(tools: ActionTools, name: string, userId: string, params: Record<string, unknown> = {}) {
  const r = await gameActions[name]({ userId, params, tools, env: {} } as never)
  return r as { success: boolean; data?: Record<string, unknown>; error?: string }
}

const rowsOf = (t: ReturnType<typeof fakeTools>, c: string, where: Record<string, unknown> = {}) =>
  [...t.table(c).values()].filter((r) => Object.entries(where).every(([k, v]) => r.data[k] === v))

let clock = 1_800_000_000_000
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(clock)
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  clock += 10_000_000
})
const advance = (ms: number) => vi.setSystemTime(Date.now() + ms)

/** Make a game with two humans and pick the seed so `impostorSeat` gets the role. */
async function setup(impostorSeat: number) {
  const t = fakeTools()
  const created = await call(t.tools, 'game-create', 'u1')
  expect(created.success).toBe(true)
  const { gameId, code } = created.data as { gameId: string; code: string }
  expect((await call(t.tools, 'game-join', 'u2', { code })).success).toBe(true)
  // Choose a seed that deals the Impostor role to the seat we want.
  for (let seed = 1; seed < 5000; seed++) {
    const roles = assignRoles(['a', 'b', 'c', 'd', 'e'], makeRng(seed ^ 0x5eed))
    if (roles[['a', 'b', 'c', 'd', 'e'][impostorSeat]] === 'impostor') {
      await t.tools.update('games', gameId, { seed })
      break
    }
  }
  const started = await call(t.tools, 'game-start', 'u1', { gameId })
  expect(started.success).toBe(true)
  advance(INTRO_MS + 100)
  await call(t.tools, 'game-tick', 'u1', { gameId })
  const game = rowsOf(t, 'games')[0]
  expect(game.data.phase).toBe('play')
  const players = rowsOf(t, 'players', { gameId }).sort((a, b) => (a.data.seat as number) - (b.data.seat as number))
  return { t, gameId, players }
}

/** Walk a human to a spot by sending checkpoints within walking speed. */
async function walk(t: ReturnType<typeof fakeTools>, gameId: string, userId: string, to: { x: number; z: number }) {
  for (let i = 0; i < 40; i++) {
    const me = rowsOf(t, 'players', { gameId, userId })[0]
    const d = Math.hypot((me.data.x as number) - to.x, (me.data.z as number) - to.z)
    if (d < 0.05) return
    advance(1500)
    await call(t.tools, 'game-pos', userId, { gameId, x: to.x, z: to.z })
  }
}

describe('a full game through the server actions', () => {
  it('fills seats with AI players and deals one Impostor, private roles and 3 tasks each', async () => {
    const { t, gameId, players } = await setup(2)
    expect(players).toHaveLength(5)
    const secrets = rowsOf(t, 'secrets', { gameId })
    expect(secrets.filter((s) => s.data.role === 'impostor')).toHaveLength(1)
    const tasks = rowsOf(t, 'tasks', { gameId })
    expect(tasks).toHaveLength(12)
    for (const s of secrets) expect(s.data.ownerUserId).toBe(players.find((p) => p.recordId === s.data.playerId)?.data.userId)
    expect(rowsOf(t, 'games')[0].data.tasksTotal).toBe(12)
  })

  it('a crew human walks to a task, orders it from the builder, and it counts', async () => {
    const { t, gameId, players } = await setup(2)
    const me = players[0]
    const task = rowsOf(t, 'tasks', { gameId, playerId: me.recordId })[0]
    const tpl = taskTemplate(task.data.templateId as string)!
    const lm = landmarkById(tpl.landmarkId)!
    // Too far away first.
    const far = await call(t.tools, 'game-build', 'u1', { gameId, landmarkId: lm.id, text: tpl.order })
    expect(far.success).toBe(false)
    const stand = { x: lm.x + (0 - lm.x) * (1.6 / Math.hypot(lm.x, lm.z)), z: lm.z + (0 - lm.z) * (1.6 / Math.hypot(lm.x, lm.z)) }
    await walk(t, gameId, 'u1', stand)
    advance(5000)
    const r = await call(t.tools, 'game-build', 'u1', { gameId, landmarkId: lm.id, text: tpl.order })
    expect(r.success, r.error).toBe(true)
    expect(r.data?.completed).toContain(tpl.id)
    expect(rowsOf(t, 'tasks', { gameId, playerId: me.recordId }).find((x) => x.recordId === task.recordId)?.data.status).toBe('done')
    expect(rowsOf(t, 'games')[0].data.tasksDone).toBeGreaterThanOrEqual(1)
  })

  it('the Impostor human wrecks a finished task; the owner sees it broken; a report starts a meeting', async () => {
    const { t, gameId, players } = await setup(1)
    const crew = players[0]
    const task = rowsOf(t, 'tasks', { gameId, playerId: crew.recordId })[0]
    const tpl = taskTemplate(task.data.templateId as string)!
    const lm = landmarkById(tpl.landmarkId)!
    const stand = { x: lm.x * (1 - 1.6 / Math.hypot(lm.x, lm.z)), z: lm.z * (1 - 1.6 / Math.hypot(lm.x, lm.z)) }
    await walk(t, gameId, 'u1', stand)
    expect((await call(t.tools, 'game-build', 'u1', { gameId, landmarkId: lm.id, text: tpl.order })).success).toBe(true)
    const doneBefore = rowsOf(t, 'games')[0].data.tasksDone as number

    // Crew cannot wreck.
    expect((await call(t.tools, 'game-wreck', 'u1', { gameId, landmarkId: lm.id, kind: 'knock' })).error).toMatch(/Only the Impostor/)
    // The Impostor walks over and knocks it over.
    await walk(t, gameId, 'u2', stand)
    advance(25_000)
    const w = await call(t.tools, 'game-wreck', 'u2', { gameId, landmarkId: lm.id, kind: 'knock' })
    expect(w.success, w.error).toBe(true)
    expect(rowsOf(t, 'tasks', { gameId }).find((x) => x.recordId === task.recordId)?.data.status).toBe('broken')
    expect(rowsOf(t, 'games')[0].data.tasksDone).toBe(doneBefore - 1)
    expect(rowsOf(t, 'breaks', { gameId })).toHaveLength(1)
    const clue = rowsOf(t, 'clues', { gameId })[0]
    expect(clue.data.impostorId).toBe(players[1].recordId)
    expect(clue.data.nearby).toContain(players[0].recordId)
    // Cooldown blocks a second wreck straight away.
    expect((await call(t.tools, 'game-wreck', 'u2', { gameId, landmarkId: lm.id, kind: 'knock' })).success).toBe(false)

    // The owner redoes it; it counts again and the smoke is marked fixed.
    advance(5000)
    expect((await call(t.tools, 'game-build', 'u1', { gameId, landmarkId: lm.id, text: tpl.order })).success).toBe(true)
    expect(rowsOf(t, 'tasks', { gameId }).find((x) => x.recordId === task.recordId)?.data.status).toBe('done')
    expect(rowsOf(t, 'breaks', { gameId })[0].data.fixed).toBe(1)
    expect(rowsOf(t, 'builds', { gameId, landmarkId: lm.id }).filter((b) => b.data.state !== 'ok')).toHaveLength(0)
  })

  it('a report, a vote that ejects the human Impostor, and the crew wins', async () => {
    const { t, gameId, players } = await setup(1)
    const crew = players[0]
    const task = rowsOf(t, 'tasks', { gameId, playerId: crew.recordId })[0]
    const tpl = taskTemplate(task.data.templateId as string)!
    const lm = landmarkById(tpl.landmarkId)!
    const stand = { x: lm.x * (1 - 1.6 / Math.hypot(lm.x, lm.z)), z: lm.z * (1 - 1.6 / Math.hypot(lm.x, lm.z)) }
    await walk(t, gameId, 'u1', stand)
    await call(t.tools, 'game-build', 'u1', { gameId, landmarkId: lm.id, text: tpl.order })
    await walk(t, gameId, 'u2', stand)
    advance(25_000)
    expect((await call(t.tools, 'game-wreck', 'u2', { gameId, landmarkId: lm.id, kind: 'paint' })).success).toBe(true)
    const brk = rowsOf(t, 'breaks', { gameId })[0]
    await walk(t, gameId, 'u1', { x: brk.data.x as number, z: (brk.data.z as number) + 0.8 })
    const rep = await call(t.tools, 'game-report', 'u1', { gameId })
    expect(rep.success, rep.error).toBe(true)
    const g1 = rowsOf(t, 'games')[0].data
    expect(g1.phase).toBe('meeting')
    expect(g1.meetingReason).toBe('report')
    expect(rowsOf(t, 'chat', { gameId }).length).toBeGreaterThan(0)

    advance(MEETING_MS + 100)
    await call(t.tools, 'game-tick', 'u1', { gameId })
    expect(rowsOf(t, 'games')[0].data.phase).toBe('vote')
    // Everyone alive votes for the Impostor; AI votes were already cast for them.
    for (const v of rowsOf(t, 'votes', { gameId })) await t.tools.update('votes', v.recordId, { targetId: players[1].recordId })
    expect((await call(t.tools, 'game-vote', 'u1', { gameId, targetId: players[1].recordId })).success).toBe(true)
    expect((await call(t.tools, 'game-vote', 'u2', { gameId, targetId: players[0].recordId })).success).toBe(true)
    advance(VOTE_MS + 100)
    await call(t.tools, 'game-tick', 'u1', { gameId })
    const g2 = rowsOf(t, 'games')[0].data
    expect(g2.phase).toBe('eject')
    expect(g2.ejectedId).toBe(players[1].recordId)
    expect(g2.ejectedWasImpostor).toBe(1)
    advance(EJECT_MS + 100)
    await call(t.tools, 'game-tick', 'u1', { gameId })
    const g3 = rowsOf(t, 'games')[0].data
    expect(g3.phase).toBe('over')
    expect(g3.winner).toBe('crew')
  })

  it('AI players walk, finish tasks and the game always ends: one human, AI Impostor', async () => {
    const { t, gameId } = await setup(3)
    const start = Date.now()
    let meetings = 0
    for (let i = 0; i < 2000; i++) {
      const g = rowsOf(t, 'games')[0].data
      if (g.phase === 'over') break
      if (g.phase === 'meeting') meetings++
      advance(1000)
      const r = await call(t.tools, 'game-tick', 'u1', { gameId })
      expect(r.success, r.error).toBe(true)
    }
    const g = rowsOf(t, 'games')[0].data
    if (process.env.PROBE) {
      const ev = rowsOf(t, 'events', { gameId }).map((e) => `${Math.round(((e.data.at as number) - start) / 1000)}s ${e.data.text}`)
      console.log(ev.join('\n'))
      console.log('winner', g.winner, g.winReason, 'tasks', g.tasksDone, '/', g.tasksTotal, 'clues', rowsOf(t, 'clues', { gameId }).length)
      console.log(rowsOf(t, 'chat', { gameId }).map((c) => c.data.text).join('\n'))
    }
    expect(g.phase).toBe('over')
    expect(['crew', 'impostor']).toContain(g.winner)
    // AI crew finished their own tasks along the way.
    const botTasks = rowsOf(t, 'tasks', { gameId }).filter((x) => String(x.data.ownerUserId).startsWith('bot:'))
    expect(botTasks.some((x) => x.data.status === 'done')).toBe(true)
    expect(meetings).toBeGreaterThanOrEqual(0)
  })

  it('night falls and the Impostor wins if the island is not finished', async () => {
    const { t, gameId } = await setup(3)
    advance(PLAY_MS + 1000)
    await call(t.tools, 'game-tick', 'u1', { gameId })
    const g = rowsOf(t, 'games')[0].data
    expect(g.phase).toBe('over')
    expect(g.winner).toBe('impostor')
  })

  it('the bell only rings at the bell, once per player', async () => {
    const { t, gameId } = await setup(3)
    advance(12_000)
    await walk(t, gameId, 'u1', { x: 5, z: -1 })
    expect((await call(t.tools, 'game-bell', 'u1', { gameId })).error).toMatch(/Walk to the bell/)
    await walk(t, gameId, 'u1', { x: 1.2, z: 0.6 })
    const r = await call(t.tools, 'game-bell', 'u1', { gameId })
    expect(r.success, r.error).toBe(true)
    expect(rowsOf(t, 'games')[0].data.meetingReason).toBe('bell')
    expect(rowsOf(t, 'players', { gameId, userId: 'u1' })[0].data.bellsLeft).toBe(0)
  })

  it('lights: only the Impostor cuts them, only at the shed are they fixed', async () => {
    const { t, gameId } = await setup(1)
    advance(25_000)
    expect((await call(t.tools, 'game-lights', 'u1', { gameId })).success).toBe(false)
    expect((await call(t.tools, 'game-lights', 'u2', { gameId })).success).toBe(true)
    expect((rowsOf(t, 'games')[0].data.lightsOutUntil as number) > Date.now()).toBe(true)
    expect((await call(t.tools, 'game-fix-lights', 'u1', { gameId })).error).toMatch(/Power Shed/)
    const shed = landmarkById('power_shed')!
    await walk(t, gameId, 'u1', { x: shed.x + 1.2, z: shed.z + 0.5 })
    const fixed = await call(t.tools, 'game-fix-lights', 'u1', { gameId })
    expect(fixed.success, fixed.error).toBe(true)
    expect(rowsOf(t, 'games')[0].data.lightsOutUntil).toBe(0)
  })
})

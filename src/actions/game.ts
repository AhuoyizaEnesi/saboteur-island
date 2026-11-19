/**
 * Every game move is a server action. Actions run with RBAC off (see
 * src/server/action-routes.ts), so each one checks for itself that the caller
 * is a player in this game, that the phase allows the move, that the caller is
 * close enough, and, for the Impostor's moves, that the caller's secret role
 * allows it.
 *
 * Timers: one browser (the host's, or the first online human's) calls `tick`
 * every second. `tick` reads the clock, advances phases whose deadline has
 * passed, runs the AI players, and checks every win condition. Cron's one
 * minute floor is too slow for this.
 */

import type { ActionHandler, ActionResult, ActionTools } from 'deepspace/worker'
import type { Env } from '../../worker'
import { routeDone, routePos, stayLeg, standSpot, walkLeg, type Leg } from '../game/bots'
import { COLORS, type BuildType, type ColorName } from '../game/catalog'
import {
  BELL_LOCK_MS,
  BELL_RANGE,
  BELLS_PER_PLAYER,
  BOT_NAMES,
  CHAT_MAX_CHARS,
  EJECT_MS,
  FIRST_WRECK_MS,
  INTRO_MS,
  LIGHTS_COOLDOWN_MS,
  LIGHTS_OUT_MS,
  MAX_BUILDS_PER_GAME,
  MAX_PLAYERS,
  MEETING_MS,
  MEETING_SPOT,
  MIN_PLAYERS,
  ORDER_COOLDOWN_MS,
  ORDER_MAX_CHARS,
  PLAY_MS,
  POS_SLACK,
  REPORT_RANGE,
  SEAT_COLORS,
  SHED_RANGE,
  TASK_RANGE,
  TASKS_PER_CREW,
  VISION,
  VOTE_MS,
  WALK_SPEED,
  WRECK_COOLDOWN_MS,
  type Phase,
} from '../game/constants'
import { LANDMARKS, landmarkById, walkable, type Landmark } from '../game/landmarks'
import { hashString, makeRng, placeOne, type PlacedLike, type Rng } from '../game/placement'
import { assignRoles, decideWinner, makeCode, normalizeCode, skyFor, tally } from '../game/rules'
import { dealTasks, fakeTasks, spotAtLandmark, taskDone, taskTemplate } from '../game/tasks'
import type {
  BreakRow,
  BuildRow,
  ChatRow,
  ClueRow,
  EventRow,
  GameRow,
  PlayerRow,
  RouteRow,
  SecretRow,
  TaskRow,
  VoteRow,
} from '../game/types'
import { describeItems, quickWreck, runBuilderAgent, runWreckAgent, type WreckKind, type WreckTarget } from '../server/builder-agent'
import { planMeeting, replyToMention } from '../server/meeting-ai'

type Ctx = Parameters<ActionHandler<Env>>[0]
type Row<T> = { id: string; data: T; createdAt: string }
type Pos = { x: number; z: number }

// ─── small helpers ───────────────────────────────────────────────────────────

const ok = <T>(data: T): ActionResult => ({ success: true, data })
const fail = (error: string, code?: string): ActionResult => ({ success: false, error, ...(code ? { code } : {}) })

function parseJson<T>(v: unknown, fallback: T): T {
  if (v === null || v === undefined || v === '') return fallback
  if (typeof v === 'string') {
    try {
      return JSON.parse(v) as T
    } catch {
      return fallback
    }
  }
  return v as T
}

async function query<T>(tools: ActionTools, collection: string, where: Record<string, unknown>, limit = 300): Promise<Row<T>[]> {
  const res = await tools.query<Record<string, unknown>>(collection, { where, limit })
  if (!res.success) throw new Error(res.error)
  return res.data.records.map((r) => ({ id: r.recordId, data: r.data as unknown as T, createdAt: r.createdAt }))
}

async function must(p: Promise<ActionResult<unknown>>): Promise<void> {
  const r = await p
  if (!r.success) throw new Error(r.error)
}

async function create<T extends object>(tools: ActionTools, collection: string, data: T): Promise<string> {
  const r = await tools.create(collection, data as unknown as Record<string, unknown>)
  if (!r.success) throw new Error(r.error)
  return r.data.recordId
}

async function loadGame(tools: ActionTools, gameId: unknown): Promise<Row<GameRow> | null> {
  if (typeof gameId !== 'string' || !gameId) return null
  const r = await tools.get<Record<string, unknown>>('games', gameId)
  if (!r.success) return null
  const d = r.data.record.data as unknown as GameRow
  d.botVotes = parseJson<GameRow['botVotes']>(d.botVotes, [])
  d.reveal = parseJson<GameRow['reveal']>(d.reveal, null)
  return { id: r.data.record.recordId, data: d, createdAt: r.data.record.createdAt }
}

const loadPlayers = async (tools: ActionTools, gameId: string) =>
  (await query<PlayerRow>(tools, 'players', { gameId })).sort((a, b) => a.data.seat - b.data.seat)
const loadSecrets = (tools: ActionTools, gameId: string) => query<SecretRow>(tools, 'secrets', { gameId })
const loadTasks = (tools: ActionTools, gameId: string) => query<TaskRow>(tools, 'tasks', { gameId }, 60)
const loadBuilds = (tools: ActionTools, gameId: string, landmarkId?: string) =>
  query<BuildRow>(tools, 'builds', landmarkId ? { gameId, landmarkId } : { gameId }, 500)
const loadBreaks = (tools: ActionTools, gameId: string) => query<BreakRow>(tools, 'breaks', { gameId }, 100)
async function loadRoutes(tools: ActionTools, gameId: string) {
  const rows = await query<RouteRow>(tools, 'routes', { gameId }, 12)
  return rows.map((r) => ({ ...r, legs: parseJson<Leg[]>(r.data.legs, []) }))
}

async function displayName(tools: ActionTools, userId: string): Promise<string> {
  const r = await tools.get<{ name?: string; email?: string }>('users', userId)
  const name = r.success ? r.data.record.data.name || r.data.record.data.email?.split('@')[0] : ''
  return (name || 'Player').slice(0, 24)
}

async function event(tools: ActionTools, gameId: string, kind: EventRow['kind'], text: string, playerId = '') {
  await create<EventRow>(tools, 'events', { gameId, kind, text, playerId, at: Date.now() })
}

async function patchGame(tools: ActionTools, gameId: string, patch: Partial<GameRow>) {
  await must(tools.update('games', gameId, patch as Record<string, unknown>))
}

const rngFor = (...parts: (string | number)[]) => makeRng(hashString(parts.join(':')) ^ (Date.now() & 0xffff))

const dist = (a: Pos, b: Pos) => Math.hypot(a.x - b.x, a.z - b.z)

/** Seats around the bell, where meetings put everyone and games start. */
export function seatSpot(seat: number, r = 2.2): Pos {
  const a = (seat / 6) * Math.PI * 2 + 2.3
  return walkable(MEETING_SPOT.x + Math.cos(a) * r, MEETING_SPOT.z + Math.sin(a) * r)
}

/**
 * Position checkpoint rule. Live movement travels over presence, which the
 * server cannot read, so browsers report positions. A report further than
 * walking speed allows is pulled back to the farthest legal spot.
 */
export function legalMove(prev: { x: number; z: number; at: number } | null, next: Pos, now: number): Pos {
  const want = walkable(next.x, next.z)
  if (!prev) return want
  const maxD = (WALK_SPEED * Math.max(0, now - prev.at)) / 1000 + POS_SLACK
  const d = dist(want, prev)
  if (d <= maxD) return want
  const k = maxD / d
  return walkable(prev.x + (want.x - prev.x) * k, prev.z + (want.z - prev.z) * k)
}

const prevOf = (p: PlayerRow) => (p.posAt ? { x: Number(p.x), z: Number(p.z), at: Number(p.posAt) } : null)

/** Where every player is right now: AI players from their routes, humans from checkpoints. */
function positions(players: Row<PlayerRow>[], routes: { data: RouteRow; legs: Leg[] }[], now: number): Map<string, Pos> {
  const out = new Map<string, Pos>()
  for (const p of players) {
    if (p.data.isBot) {
      const r = routes.find((x) => x.data.playerId === p.id)
      out.set(p.id, routePos(r?.legs, now, seatSpot(p.data.seat)))
    } else {
      out.set(p.id, p.data.posAt ? { x: Number(p.data.x), z: Number(p.data.z) } : seatSpot(p.data.seat))
    }
  }
  return out
}

/**
 * Trust the caller's position for this action: start from their last
 * checkpoint and move toward what their browser says, within walking speed.
 */
async function callerPos(tools: ActionTools, me: Row<PlayerRow>, params: Record<string, unknown>, now: number): Promise<Pos> {
  const x = Number(params.x)
  const z = Number(params.z)
  const prev = prevOf(me.data)
  const pos = Number.isFinite(x) && Number.isFinite(z) ? legalMove(prev, { x, z }, now) : prev ? { x: prev.x, z: prev.z } : seatSpot(me.data.seat)
  await must(tools.update('players', me.id, { x: pos.x, z: pos.z, posAt: now, lastActiveAt: now }))
  return pos
}

// ─── tasks ───────────────────────────────────────────────────────────────────

/**
 * Recheck tasks against the builds, update statuses, and keep the game's
 * public task counter in step. Returns which tasks changed.
 */
async function refreshTasks(tools: ActionTools, game: Row<GameRow>, landmarkId?: string) {
  const tasks = await loadTasks(tools, game.id)
  const builds = (await loadBuilds(tools, game.id, landmarkId)).map((b) => b.data)
  const done: Row<TaskRow>[] = []
  const broken: Row<TaskRow>[] = []
  const t = Date.now()
  for (const task of tasks) {
    if (landmarkId && task.data.landmarkId !== landmarkId) continue
    const isDone = taskDone(task.data, builds)
    const next = isDone ? 'done' : task.data.status === 'todo' ? 'todo' : 'broken'
    if (next === task.data.status) continue
    await must(tools.update('tasks', task.id, { status: next, doneAt: isDone ? t : task.data.doneAt }))
    task.data.status = next
    if (next === 'done') done.push(task)
    else if (next === 'broken') broken.push(task)
  }
  const count = tasks.filter((x) => x.data.status === 'done').length
  if (count !== game.data.tasksDone) {
    await patchGame(tools, game.id, { tasksDone: count })
    game.data.tasksDone = count
  }
  return { done, broken, count, total: tasks.length }
}

/** Remove the caller's knocked over or painted leftovers before they redo a task. */
async function clearBroken(tools: ActionTools, gameId: string, playerId: string, landmarkId: string, type: string) {
  const builds = await loadBuilds(tools, gameId, landmarkId)
  for (const b of builds) {
    if (b.data.playerId === playerId && b.data.type === type && b.data.state !== 'ok') await must(tools.remove('builds', b.id))
  }
}

/** Put objects at a landmark for one player. */
async function placeItems(
  tools: ActionTools,
  game: Row<GameRow>,
  player: Row<PlayerRow>,
  landmark: Landmark,
  items: { type: BuildType; color: ColorName | null }[],
  orderId: string,
  rng: Rng,
): Promise<number> {
  for (const it of items) await clearBroken(tools, game.id, player.id, landmark.id, it.type)
  const all = await loadBuilds(tools, game.id)
  const here = all.filter((b) => b.data.landmarkId === landmark.id).map((b) => b.data)
  let seq = all.length
  let n = 0
  const at = Date.now()
  for (const it of items) {
    if (all.length + n >= MAX_BUILDS_PER_GAME) break
    const spot = spotAtLandmark(landmark, it.type, here, rng)
    const row: BuildRow = {
      gameId: game.id, orderId, playerId: player.id, landmarkId: landmark.id, type: it.type, x: spot.x, z: spot.z, lift: spot.lift,
      rot: spot.rot, scale: 1, color: it.color ? COLORS[it.color] : '', colorName: it.color ?? '', state: 'ok', seq: seq++, at,
    }
    await create<BuildRow>(tools, 'builds', row)
    here.push(row)
    n++
  }
  return n
}

/** Mark broken spots at a landmark fixed once nothing there is broken any more. */
async function settleBreaks(tools: ActionTools, gameId: string, landmarkId: string) {
  const tasks = await loadTasks(tools, gameId)
  if (tasks.some((t) => t.data.landmarkId === landmarkId && t.data.status === 'broken')) return
  for (const b of await loadBreaks(tools, gameId)) {
    if (b.data.landmarkId === landmarkId && !b.data.fixed) await must(tools.update('breaks', b.id, { fixed: 1 }))
  }
}

// ─── wrecking ────────────────────────────────────────────────────────────────

/** Builds at a landmark that currently complete a finished task: what a wreck can hit. */
async function wreckTargets(tools: ActionTools, gameId: string, landmarkId: string): Promise<{ targets: WreckTarget[]; rows: Row<BuildRow>[] }> {
  const tasks = (await loadTasks(tools, gameId)).filter((t) => t.data.landmarkId === landmarkId && t.data.status === 'done')
  const rows = await loadBuilds(tools, gameId, landmarkId)
  const hits = rows.filter(
    (b) =>
      b.data.state === 'ok' &&
      tasks.some((t) => {
        const tpl = taskTemplate(t.data.templateId)
        return tpl && t.data.playerId === b.data.playerId && tpl.need.type === b.data.type && (!tpl.need.color || tpl.need.color === b.data.colorName)
      }),
  )
  hits.sort((a, b) => b.data.at - a.data.at)
  return { targets: hits.map((b, i) => ({ id: `t${i + 1}`, type: b.data.type, colorName: b.data.colorName })), rows: hits }
}

/** Apply a wreck plan, mark broken tasks, leave smoke, and record who was nearby. */
async function applyWreck(
  tools: ActionTools,
  game: Row<GameRow>,
  impostor: Row<PlayerRow>,
  impostorPos: Pos,
  landmark: Landmark,
  acts: { targetId: string; kind: WreckKind; color: ColorName }[],
  targets: WreckTarget[],
  rows: Row<BuildRow>[],
) {
  const now = Date.now()
  const spots: Pos[] = []
  for (const a of acts) {
    const i = targets.findIndex((t) => t.id === a.targetId)
    const row = rows[i]
    if (!row) continue
    spots.push({ x: row.data.x, z: row.data.z })
    if (a.kind === 'remove') await must(tools.remove('builds', row.id))
    else if (a.kind === 'knock') await must(tools.update('builds', row.id, { state: 'knocked' }))
    else await must(tools.update('builds', row.id, { state: 'painted', colorName: a.color, color: COLORS[a.color] }))
  }
  const res = await refreshTasks(tools, game, landmark.id)
  if (res.broken.length) {
    const s = spots[0] ?? { x: landmark.x, z: landmark.z }
    await create<BreakRow>(tools, 'breaks', { gameId: game.id, landmarkId: landmark.id, x: s.x, z: s.z, at: now, reported: 0, fixed: 0 })
    // Clues for the AI players: who was near, and which AI players could see the Impostor.
    const players = await loadPlayers(tools, game.id)
    const routes = await loadRoutes(tools, game.id)
    const pos = positions(players, routes, now)
    pos.set(impostor.id, impostorPos)
    const dark = game.data.lightsOutUntil > now
    const nearby = players.filter((p) => p.data.alive && p.id !== impostor.id && dist(pos.get(p.id) as Pos, s) <= VISION.crew).map((p) => p.id)
    const sight = dark ? VISION.lightsOut : VISION.crew
    const witnesses = players
      .filter((p) => p.data.isBot && p.data.alive && p.id !== impostor.id && dist(pos.get(p.id) as Pos, impostorPos) <= sight)
      .map((p) => p.id)
    await create<ClueRow>(tools, 'clues', { gameId: game.id, landmarkId: landmark.id, at: now, impostorId: impostor.id, nearby: [impostor.id, ...nearby], witnesses })
  }
  return res
}

// ─── AI players ──────────────────────────────────────────────────────────────

async function setRoute(tools: ActionTools, gameId: string, playerId: string, legs: Leg[], goal: string, existingId?: string) {
  if (existingId) await must(tools.update('routes', existingId, { legs, goal }))
  else await create<RouteRow>(tools, 'routes', { gameId, playerId, legs, goal })
}

const WRECK_KINDS: WreckKind[] = ['knock', 'paint', 'remove']

/**
 * Run every AI player for one tick: finish what they arrived to do, report
 * broken tasks they walk past, and plan the next walk. Returns true if an AI
 * player started a meeting or ended the game (the tick should stop there).
 */
async function runBots(env: Env, tools: ActionTools, game: Row<GameRow>, now: number): Promise<boolean> {
  const players = await loadPlayers(tools, game.id)
  const bots = players.filter((p) => p.data.isBot && p.data.alive)
  if (!bots.length) return false
  const secrets = await loadSecrets(tools, game.id)
  const routes = await loadRoutes(tools, game.id)
  const roleOf = (id: string) => secrets.find((s) => s.data.playerId === id)?.data.role ?? 'crew'
  const rng = rngFor(game.id, 'bots', now)
  const pos = positions(players, routes, now)
  const dark = game.data.lightsOutUntil > now

  // Reports first: a crew AI player standing near an unreported break calls a meeting.
  if (!dark) {
    const breaks = (await loadBreaks(tools, game.id)).filter((b) => !b.data.reported && !b.data.fixed && now - b.data.at > 2500)
    for (const bot of bots) {
      if (roleOf(bot.id) !== 'crew') continue
      const p = pos.get(bot.id) as Pos
      const seen = breaks.find((b) => dist(b.data, p) <= REPORT_RANGE + 0.6)
      if (seen && rng() < 0.45) {
        await must(tools.update('breaks', seen.id, { reported: 1 }))
        await startMeeting(env, tools, game, bot, 'report', landmarkById(seen.data.landmarkId)?.name ?? 'the island')
        return true
      }
    }
  }

  let tasks: Row<TaskRow>[] | null = null
  const getTasks = async () => (tasks ??= await loadTasks(tools, game.id))
  let fixerAssigned = routes.some((r) => r.data.goal === 'lights' && !routeDone(r.legs, now))

  for (const bot of bots) {
    const route = routes.find((r) => r.data.playerId === bot.id)
    const legs = route?.legs ?? []
    if (!routeDone(legs, now)) continue
    const here = pos.get(bot.id) as Pos
    const last = legs[legs.length - 1]
    const role = roleOf(bot.id)

    // 1. Finish what they came to do.
    if (last?.doing === 'work' && last.ref?.startsWith('task:')) {
      const tpl = taskTemplate(last.ref.slice(5))
      const lm = tpl ? landmarkById(tpl.landmarkId) : null
      if (tpl && lm && dist(here, lm) <= TASK_RANGE + 0.5) {
        await placeItems(tools, game, bot, lm, [{ type: tpl.need.type, color: tpl.need.color ?? null }], '', rng)
        const res = await refreshTasks(tools, game, lm.id)
        await settleBreaks(tools, game.id, lm.id)
        tasks = null
        if (res.total && res.count >= res.total) {
          await finishIfOver(tools, game)
          return true
        }
      }
    } else if (last?.doing === 'work' && last.ref === 'lights') {
      if (game.data.lightsOutUntil > now) {
        await patchGame(tools, game.id, { lightsOutUntil: 0 })
        game.data.lightsOutUntil = 0
        await event(tools, game.id, 'lights', `${bot.data.name} fixed the lights.`, bot.id)
      }
    } else if (last?.doing === 'wait' && last.ref?.startsWith('wreck:') && role === 'impostor') {
      const lm = landmarkById(last.ref.slice(6))
      const secret = secrets.find((s) => s.data.playerId === bot.id)
      const watched = players.some((p) => p.id !== bot.id && p.data.alive && dist(pos.get(p.id) as Pos, here) <= (dark ? VISION.lightsOut : 4.5))
      if (lm && secret && secret.data.wreckReadyAt <= now && (!watched || rng() < 0.12)) {
        const { targets, rows } = await wreckTargets(tools, game.id, lm.id)
        if (targets.length) {
          const plan = quickWreck(WRECK_KINDS[Math.floor(rng() * WRECK_KINDS.length)], targets)
          await applyWreck(tools, game, bot, here, lm, plan.acts, targets, rows)
          await must(tools.update('secrets', secret.id, { wreckReadyAt: now + WRECK_COOLDOWN_MS }))
          tasks = null
        }
      }
      if (secret && secret.data.lightsReadyAt <= now && !dark && rng() < 0.15) {
        await patchGame(tools, game.id, { lightsOutUntil: now + LIGHTS_OUT_MS })
        await must(tools.update('secrets', secret.id, { lightsReadyAt: now + LIGHTS_COOLDOWN_MS }))
        await event(tools, game.id, 'lights', 'The lights went out! Fix them at the Power Shed.')
      }
    }

    // 2. Plan the next walk.
    const shed = landmarkById('power_shed') as Landmark
    let next: Leg[] = []
    let goal = 'wander'
    if (role === 'crew' && game.data.lightsOutUntil > now && !fixerAssigned && rng() < 0.5) {
      fixerAssigned = true
      const walk = walkLeg(here, standSpot(shed, rng, 1.4), now, 'lights')
      next = [walk, stayLeg({ x: walk.x1, z: walk.z1 }, walk.t1, 1500, 'work', 'lights')]
      goal = 'lights'
    } else if (role === 'crew') {
      const mine = (await getTasks()).filter((t) => t.data.playerId === bot.id && t.data.status !== 'done')
      const far = (t: Row<TaskRow>) => dist(landmarkById(t.data.landmarkId) as Landmark, here)
      mine.sort((a, b) => Number(b.data.status === 'broken') - Number(a.data.status === 'broken') || far(a) - far(b))
      const task = mine[0]
      // Like real players, AI crew sometimes wander between tasks instead of beelining.
      if (task && last?.doing === 'work' && rng() < 0.35) {
        const lm = LANDMARKS[1 + Math.floor(rng() * (LANDMARKS.length - 1))]
        const walk = walkLeg(here, standSpot(lm, rng, 2), now + 600, 'wander')
        next = [stayLeg(here, now, 600, 'wait'), walk, stayLeg({ x: walk.x1, z: walk.z1 }, walk.t1, 2000 + rng() * 3000, 'wait')]
        goal = 'wander'
      } else if (task) {
        const lm = landmarkById(task.data.landmarkId) as Landmark
        const ref = `task:${task.data.templateId}`
        const walk = walkLeg(here, standSpot(lm, rng), now + Math.round(rng() * 1500), ref)
        next = [stayLeg(here, now, walk.t0 - now, 'wait'), walk, stayLeg({ x: walk.x1, z: walk.z1 }, walk.t1, 5000 + rng() * 4000, 'work', ref)]
        goal = ref
      }
    } else {
      // The Impostor drifts between landmarks, preferring ones with finished tasks.
      const done = (await getTasks()).filter((t) => t.data.status === 'done').map((t) => t.data.landmarkId)
      const options = LANDMARKS.filter((l) => l.area > 0 && dist(l, here) > 2)
      const weighted = options.flatMap((l) => (done.includes(l.id) ? [l, l, l] : [l]))
      const lm = weighted[Math.floor(rng() * weighted.length)]
      const walk = walkLeg(here, standSpot(lm, rng), now + Math.round(rng() * 2000), `wreck:${lm.id}`)
      next = [stayLeg(here, now, walk.t0 - now, 'wait'), walk, stayLeg({ x: walk.x1, z: walk.z1 }, walk.t1, 2500 + rng() * 3000, 'wait', `wreck:${lm.id}`)]
      goal = 'wreck'
    }
    if (!next.length) {
      const lm = LANDMARKS[Math.floor(rng() * LANDMARKS.length)]
      const walk = walkLeg(here, standSpot(lm, rng, 2), now + 800, 'wander')
      next = [stayLeg(here, now, 800, 'wait'), walk, stayLeg({ x: walk.x1, z: walk.z1 }, walk.t1, 3000 + rng() * 4000, 'wait')]
    }
    await setRoute(tools, game.id, bot.id, next, goal, route?.id)
  }
  return false
}

/** Freeze every AI player at a seat (meetings, the start). */
async function parkBots(tools: ActionTools, gameId: string, players: Row<PlayerRow>[], until: number, r = 1.55) {
  const routes = await loadRoutes(tools, gameId)
  const now = Date.now()
  for (const p of players) {
    if (!p.data.isBot) continue
    const route = routes.find((x) => x.data.playerId === p.id)
    const s = seatSpot(p.data.seat, r)
    await setRoute(tools, gameId, p.id, [stayLeg(s, now, Math.max(0, until - now), 'wait')], 'park', route?.id)
  }
}

// ─── phase transitions ───────────────────────────────────────────────────────

async function startMeeting(env: Env, tools: ActionTools, game: Row<GameRow>, caller: Row<PlayerRow>, reason: 'bell' | 'report', where: string) {
  const t = Date.now()
  const meetingNo = (game.data.meetingNo || 0) + 1
  const playMsLeft = Math.max(0, game.data.nightAt - t)
  await patchGame(tools, game.id, {
    phase: 'meeting', meetingNo, phaseEndsAt: t + MEETING_MS, playMsLeft, meetingCalledBy: caller.data.name,
    meetingReason: reason, meetingWhere: where, lightsOutUntil: 0, botVotes: [],
  })
  Object.assign(game.data, { phase: 'meeting', meetingNo })
  await event(
    tools,
    game.id,
    'meeting',
    reason === 'report' ? `${caller.data.name} found something wrecked at the ${where}!` : `${caller.data.name} rang the bell!`,
    caller.id,
  )
  // Everyone sits around the bell; the server's positions match what browsers draw.
  const players = await loadPlayers(tools, game.id)
  const alive = players.filter((p) => p.data.alive)
  for (const p of alive) {
    const s = seatSpot(p.data.seat, 1.55)
    await must(tools.update('players', p.id, { x: s.x, z: s.z, posAt: t }))
  }
  await parkBots(tools, game.id, alive, t + MEETING_MS + VOTE_MS + EJECT_MS + 60_000)

  const secrets = await loadSecrets(tools, game.id)
  const clues = await query<ClueRow>(tools, 'clues', { gameId: game.id }, 50)
  const plan = await planMeeting(env, {
    players: players.map((p) => ({
      id: p.id, name: p.data.name, isBot: Boolean(p.data.isBot), alive: Boolean(p.data.alive),
      isImpostor: secrets.some((s) => s.data.playerId === p.id && s.data.role === 'impostor'),
    })),
    clues: clues.map((c) => ({
      landmark: landmarkById(c.data.landmarkId)?.name ?? 'somewhere', at: c.data.at, impostorId: c.data.impostorId,
      nearby: parseJson<string[]>(c.data.nearby, []), witnesses: parseJson<string[]>(c.data.witnesses, []),
    })),
    callerName: caller.data.name,
    reason,
    where,
    rng: rngFor(game.id, 'meeting', meetingNo),
  })
  const start = Date.now()
  const span = MEETING_MS - 12_000
  for (let i = 0; i < plan.lines.length; i++) {
    const showAt = start + 3_000 + Math.round((span * (i + 0.3)) / Math.max(1, plan.lines.length))
    await create<ChatRow>(tools, 'chat', { gameId: game.id, meetingNo, playerId: plan.lines[i].playerId, text: plan.lines[i].text, showAt })
  }
  await patchGame(tools, game.id, { botVotes: plan.votes })
}

async function startVote(tools: ActionTools, game: Row<GameRow>) {
  const t = Date.now()
  await patchGame(tools, game.id, { phase: 'vote', phaseEndsAt: t + VOTE_MS })
  const rng = rngFor(game.id, 'votes', game.data.meetingNo)
  const players = await loadPlayers(tools, game.id)
  for (const v of game.data.botVotes ?? []) {
    const voter = players.find((p) => p.id === v.playerId)
    if (!voter || !voter.data.alive) continue
    await tools.create('votes', {
      gameId: game.id, meetingNo: game.data.meetingNo, voterId: v.playerId, targetId: v.targetId,
      showAt: t + 2_000 + Math.round(rng() * 14_000),
    })
  }
}

async function resolveVote(tools: ActionTools, game: Row<GameRow>) {
  const t = Date.now()
  const players = await loadPlayers(tools, game.id)
  const secrets = await loadSecrets(tools, game.id)
  const votes = await query<VoteRow>(tools, 'votes', { gameId: game.id, meetingNo: game.data.meetingNo })
  const aliveIds = players.filter((p) => p.data.alive).map((p) => p.id)
  const result = tally(votes.map((v) => ({ voterId: v.data.voterId, targetId: v.data.targetId })), aliveIds)
  let wasImpostor = 0
  if (result.ejectedId) {
    await must(tools.update('players', result.ejectedId, { alive: 0 }))
    wasImpostor = secrets.some((s) => s.data.playerId === result.ejectedId && s.data.role === 'impostor') ? 1 : 0
    const name = players.find((p) => p.id === result.ejectedId)?.data.name ?? 'Someone'
    await event(tools, game.id, 'eject', wasImpostor ? `${name} was ejected. ${name} was the Impostor.` : `${name} was ejected. ${name} was not the Impostor.`, result.ejectedId)
  } else {
    await event(tools, game.id, 'eject', result.tie ? 'The vote was tied. Nobody was ejected.' : 'The crew skipped. Nobody was ejected.')
  }
  await patchGame(tools, game.id, { phase: 'eject', phaseEndsAt: t + EJECT_MS, ejectedId: result.ejectedId ?? '', ejectedWasImpostor: wasImpostor })
}

/** Decide the winner from the current state, and end the game if there is one. */
async function finishIfOver(tools: ActionTools, game: Row<GameRow>, nightFallen = false): Promise<boolean> {
  const players = await loadPlayers(tools, game.id)
  const secrets = await loadSecrets(tools, game.id)
  const tasks = await loadTasks(tools, game.id)
  const impostorId = secrets.find((s) => s.data.role === 'impostor')?.data.playerId ?? ''
  const alive = players.filter((p) => p.data.alive)
  const verdict = decideWinner({
    impostorAlive: alive.some((p) => p.id === impostorId),
    aliveCrew: alive.filter((p) => p.id !== impostorId).length,
    tasksDone: tasks.filter((t) => t.data.status === 'done').length,
    tasksTotal: tasks.length,
    nightFallen,
  })
  if (!verdict.winner) return false
  const wrecks = (await query<ClueRow>(tools, 'clues', { gameId: game.id }, 100)).length
  await patchGame(tools, game.id, {
    phase: 'over', phaseEndsAt: 0, winner: verdict.winner, winReason: verdict.reason, lightsOutUntil: 0,
    reveal: { impostorPlayerId: impostorId, wrecks }, timeOfDay: nightFallen ? 'night' : game.data.timeOfDay,
  })
  game.data.phase = 'over'
  await event(tools, game.id, 'system', verdict.winner === 'crew' ? `Crew wins. ${verdict.reason}` : `Impostor wins. ${verdict.reason}`)
  return true
}

async function afterEject(tools: ActionTools, game: Row<GameRow>) {
  if (await finishIfOver(tools, game)) return
  const t = Date.now()
  await patchGame(tools, game.id, {
    phase: 'play', phaseEndsAt: 0, nightAt: t + Math.max(game.data.playMsLeft, 20_000), ejectedId: '', bellLockUntil: t + BELL_LOCK_MS,
  })
  // AI players get up from the table and pick new plans on the next tick.
  const players = await loadPlayers(tools, game.id)
  await parkBots(tools, game.id, players.filter((p) => p.data.alive), t + 1_500)
}

// ─── actions: lobby ──────────────────────────────────────────────────────────

/** Wild trees and rocks every island starts with. Records, so placement avoids them. */
async function plantScenery(tools: ActionTools, gameId: string, seed: number) {
  const rng = makeRng(seed)
  const placed: PlacedLike[] = []
  const plan: [BuildType, number, string | undefined][] = [
    ['pine_tree', 18, 'edge'],
    ['round_tree', 7, undefined],
    ['rock', 10, undefined],
    ['flowers', 4, undefined],
  ]
  // Wild scenery stays out of every landmark's building area, so tasks have room.
  const clear = (x: number, z: number) => LANDMARKS.every((l) => Math.hypot(x - l.x, z - l.z) > Math.max(l.area, 1.6) + 0.5)
  let seq = 0
  for (const [type, n, near] of plan) {
    for (let i = 0; i < n; i++) {
      let p = placeOne({ type, near }, placed, rng)
      for (let k = 0; k < 12 && !clear(p.x, p.z); k++) p = placeOne({ type, near }, placed, rng)
      if (!clear(p.x, p.z)) continue
      placed.push(p)
      await create<BuildRow>(tools, 'builds', {
        gameId, orderId: '', playerId: 'world', landmarkId: '', type, x: p.x, z: p.z, lift: 0, rot: p.rot, scale: p.scale,
        color: '', colorName: '', state: 'ok', seq: seq++, at: 0,
      })
    }
  }
}

async function createGame({ userId, tools }: Ctx): Promise<ActionResult> {
  const rng = rngFor(userId, 'create')
  let code = ''
  for (let i = 0; i < 10; i++) {
    const c = makeCode(rng)
    const clash = await query<GameRow>(tools, 'games', { code: c }, 5)
    if (!clash.some((g) => g.data.phase !== 'over')) {
      code = c
      break
    }
  }
  if (!code) return fail('Could not find a free game code. Try again.')
  const seed = Math.floor(rng() * 2 ** 31)
  const gameId = await create<GameRow>(tools, 'games', {
    code, hostId: userId, phase: 'lobby', phaseEndsAt: 0, nightAt: 0, playMsLeft: 0, tasksDone: 0, tasksTotal: 0,
    timeOfDay: 'day', weather: 'clear', lightsOutUntil: 0, bellLockUntil: 0, meetingNo: 0, meetingCalledBy: '',
    meetingReason: '', meetingWhere: '', ejectedId: '', ejectedWasImpostor: 0, winner: '', winReason: '', reveal: null,
    botVotes: [], nextCode: '', seed,
  })
  await create<PlayerRow>(tools, 'players', {
    gameId, userId, name: await displayName(tools, userId), color: SEAT_COLORS[0], seat: 0, isBot: 0, alive: 1,
    bellsLeft: BELLS_PER_PLAYER, lastActiveAt: Date.now(),
  })
  await plantScenery(tools, gameId, seed)
  return ok({ gameId, code })
}

async function findGameByCode(tools: ActionTools, codeRaw: unknown): Promise<Row<GameRow> | null> {
  const code = normalizeCode(codeRaw)
  if (code.length !== 4) return null
  const games = await query<GameRow>(tools, 'games', { code }, 20)
  if (!games.length) return null
  games.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  return loadGame(tools, games[0].id)
}

async function joinGame({ userId, params, tools }: Ctx): Promise<ActionResult> {
  const game = await findGameByCode(tools, params.code)
  if (!game) return fail('No game with that code.', 'not_found')
  const players = await loadPlayers(tools, game.id)
  const me = players.find((p) => p.data.userId === userId)
  if (me) {
    await must(tools.update('players', me.id, { lastActiveAt: Date.now() }))
    return ok({ gameId: game.id, code: game.data.code, playerId: me.id })
  }
  if (game.data.phase !== 'lobby') return ok({ gameId: game.id, code: game.data.code, spectator: true })
  if (players.length >= MAX_PLAYERS) return fail('That game is full.', 'full')
  const taken = new Set(players.map((p) => p.data.seat))
  const seat = [0, 1, 2, 3, 4, 5].find((s) => !taken.has(s)) ?? players.length
  const playerId = await create<PlayerRow>(tools, 'players', {
    gameId: game.id, userId, name: await displayName(tools, userId), color: SEAT_COLORS[seat], seat, isBot: 0, alive: 1,
    bellsLeft: BELLS_PER_PLAYER, lastActiveAt: Date.now(),
  })
  return ok({ gameId: game.id, code: game.data.code, playerId })
}

async function startGame({ userId, params, tools }: Ctx): Promise<ActionResult> {
  const game = await loadGame(tools, params.gameId)
  if (!game) return fail('Game not found.')
  if (game.data.hostId !== userId) return fail('Only the host can start the game.')
  if (game.data.phase !== 'lobby') return fail('This game already started.')
  const players = await loadPlayers(tools, game.id)
  const usedNames = new Set(players.map((p) => p.data.name.toLowerCase()))
  const freeSeats = [0, 1, 2, 3, 4, 5].filter((s) => !players.some((p) => p.data.seat === s))
  const botNames = BOT_NAMES.filter((n) => !usedNames.has(n.toLowerCase()))
  while (players.length < MIN_PLAYERS && freeSeats.length && botNames.length) {
    const seat = freeSeats.shift() as number
    const name = botNames.shift() as string
    const data: PlayerRow = {
      gameId: game.id, userId: `bot:${name.toLowerCase()}`, name, color: SEAT_COLORS[seat], seat, isBot: 1, alive: 1,
      bellsLeft: BELLS_PER_PLAYER, lastActiveAt: Date.now(),
    }
    players.push({ id: await create<PlayerRow>(tools, 'players', data), data, createdAt: '' })
  }
  const t = Date.now()
  const rng = makeRng(game.data.seed ^ 0x5eed)
  const roles = assignRoles(players.map((p) => p.id), rng)
  const crew = players.filter((p) => roles[p.id] === 'crew').map((p) => p.id)
  const deal = dealTasks(crew, rng, TASKS_PER_CREW)
  const firstWreck = t + INTRO_MS + FIRST_WRECK_MS
  for (const p of players) {
    await create<SecretRow>(tools, 'secrets', {
      gameId: game.id, playerId: p.id, ownerUserId: p.data.userId, role: roles[p.id],
      fakeTasks: roles[p.id] === 'impostor' ? fakeTasks(rng, TASKS_PER_CREW) : [], wreckReadyAt: firstWreck, lightsReadyAt: firstWreck,
    })
    for (const templateId of deal[p.id] ?? []) {
      const tpl = taskTemplate(templateId)
      await create<TaskRow>(tools, 'tasks', {
        gameId: game.id, playerId: p.id, ownerUserId: p.data.userId, templateId, landmarkId: tpl?.landmarkId ?? '', status: 'todo', doneAt: 0,
      })
    }
    const s = seatSpot(p.data.seat)
    await must(tools.update('players', p.id, { alive: 1, bellsLeft: BELLS_PER_PLAYER, x: s.x, z: s.z, posAt: t }))
  }
  await parkBots(tools, game.id, players, t + INTRO_MS + 500, 2.2)
  await patchGame(tools, game.id, { phase: 'intro', phaseEndsAt: t + INTRO_MS, tasksTotal: crew.length * TASKS_PER_CREW, tasksDone: 0 })
  await event(tools, game.id, 'system', 'Roles are dealt. One of you is the Impostor.')
  return ok({ started: true })
}

// ─── actions: the clock ──────────────────────────────────────────────────────

async function tick({ env, params, tools }: Ctx): Promise<ActionResult> {
  const game = await loadGame(tools, params.gameId)
  if (!game) return fail('Game not found.')
  const t = Date.now()
  const phase: Phase = game.data.phase
  if (phase === 'intro' && t >= game.data.phaseEndsAt) {
    await patchGame(tools, game.id, { phase: 'play', phaseEndsAt: 0, nightAt: t + PLAY_MS, timeOfDay: 'day', bellLockUntil: t + 10_000 })
    await event(tools, game.id, 'system', 'Fix up the island before night falls.')
  } else if (phase === 'play') {
    if (t >= game.data.nightAt) {
      await finishIfOver(tools, game, true)
      return ok({ phase: 'over', now: Date.now() })
    }
    const sky = skyFor(1 - (game.data.nightAt - t) / PLAY_MS)
    if (sky !== game.data.timeOfDay) {
      await patchGame(tools, game.id, { timeOfDay: sky })
      game.data.timeOfDay = sky
      if (sky === 'night') await event(tools, game.id, 'night', 'Night is almost here. Hurry!')
    }
    if (game.data.lightsOutUntil && t >= game.data.lightsOutUntil) {
      await patchGame(tools, game.id, { lightsOutUntil: 0 })
      game.data.lightsOutUntil = 0
      await event(tools, game.id, 'lights', 'The lights came back on.')
    }
    await runBots(env, tools, game, t)
  } else if (phase === 'meeting' && t >= game.data.phaseEndsAt) {
    await startVote(tools, game)
  } else if (phase === 'vote' && t >= game.data.phaseEndsAt) {
    await resolveVote(tools, game)
  } else if (phase === 'eject' && t >= game.data.phaseEndsAt) {
    await afterEject(tools, game)
  }
  return ok({ phase: game.data.phase, now: Date.now() })
}

async function reportPos({ userId, params, tools }: Ctx): Promise<ActionResult> {
  const x = Number(params.x)
  const z = Number(params.z)
  if (!Number.isFinite(x) || !Number.isFinite(z)) return fail('Bad position.')
  const game = await loadGame(tools, params.gameId)
  if (!game) return fail('Game not found.')
  if (game.data.phase !== 'play' && game.data.phase !== 'lobby') return ok({ ignored: true })
  const me = (await query<PlayerRow>(tools, 'players', { gameId: game.id, userId }, 1))[0]
  if (!me) return fail('You are not in this game.')
  const t = Date.now()
  const pos = legalMove(prevOf(me.data), { x, z }, t)
  await must(tools.update('players', me.id, { x: pos.x, z: pos.z, posAt: t, lastActiveAt: t }))
  return ok({ x: pos.x, z: pos.z })
}

// ─── actions: play ───────────────────────────────────────────────────────────

/** Shared checks for moves during play. */
async function playMove(ctx: Ctx, opts: { living?: boolean } = {}) {
  const { userId, params, tools } = ctx
  const game = await loadGame(tools, params.gameId)
  if (!game) return { error: fail('Game not found.') }
  if (game.data.phase !== 'play') return { error: fail('That only works while the game is on.') }
  const me = (await query<PlayerRow>(tools, 'players', { gameId: game.id, userId }, 1))[0]
  if (!me) return { error: fail('You are not in this game.') }
  if (opts.living && !me.data.alive) return { error: fail('Ghosts cannot do that.') }
  const secret = (await query<SecretRow>(tools, 'secrets', { gameId: game.id, playerId: me.id }, 1))[0]
  const now = Date.now()
  const pos = await callerPos(tools, me, params, now)
  return { game, me, secret, pos, now }
}

async function buildOrder(ctx: Ctx): Promise<ActionResult> {
  const { env, params, tools } = ctx
  const m = await playMove(ctx)
  if ('error' in m) return m.error as ActionResult
  const { game, me, secret, pos, now } = m
  if (!me.data.alive && secret?.data.role === 'impostor') return fail('Ghosts cannot do that.')
  const landmark = landmarkById(String(params.landmarkId ?? ''))
  if (!landmark || !landmark.area) return fail('Walk up to a landmark first.')
  if (dist(pos, landmark) > TASK_RANGE) return fail(`Walk closer to the ${landmark.name}.`, 'too_far')
  if (me.data.lastOrderAt && now - me.data.lastOrderAt < ORDER_COOLDOWN_MS) return fail('The builder is still busy. Try again in a moment.')
  const text = typeof params.text === 'string' ? params.text.replace(/\s+/g, ' ').trim().slice(0, ORDER_MAX_CHARS) : ''
  if (!text) return fail('Type what to build first.')
  await must(tools.update('players', me.id, { lastOrderAt: now }))

  const builds = await loadBuilds(tools, game.id)
  const here = builds
    .filter((b) => b.data.landmarkId === landmark.id && b.data.state === 'ok')
    .map((b) => `${b.data.colorName ? `${b.data.colorName} ` : ''}${b.data.type.replace('_', ' ')}`)
  const plan = await runBuilderAgent(env, { text, landmarkName: landmark.name, here, capacity: MAX_BUILDS_PER_GAME - builds.length })
  if (!plan.items.length) return ok({ narration: plan.narration, placed: 0, completed: [] })
  const placed = await placeItems(tools, game, me, landmark, plan.items, `o${now}`, makeRng(hashString(`${me.id}:${now}`)))
  const res = await refreshTasks(tools, game, landmark.id)
  await settleBreaks(tools, game.id, landmark.id)
  const completed = res.done.filter((t) => t.data.playerId === me.id).map((t) => t.data.templateId)
  if (res.total && res.count >= res.total) await finishIfOver(tools, game)
  return ok({ narration: plan.narration || describeItems(plan.items), placed, completed, usedModel: plan.usedModel })
}

async function wreck(ctx: Ctx): Promise<ActionResult> {
  const { env, params, tools } = ctx
  const m = await playMove(ctx, { living: true })
  if ('error' in m) return m.error as ActionResult
  const { game, me, secret, pos, now } = m
  if (!secret || secret.data.role !== 'impostor') return fail('Only the Impostor can do that.', 'forbidden')
  if (secret.data.wreckReadyAt > now) return fail('Not yet. Your wreck is cooling down.')
  const landmark = landmarkById(String(params.landmarkId ?? ''))
  if (!landmark || !landmark.area) return fail('Walk up to a landmark first.')
  if (dist(pos, landmark) > TASK_RANGE) return fail(`Walk closer to the ${landmark.name}.`, 'too_far')
  const { targets, rows } = await wreckTargets(tools, game.id, landmark.id)
  if (!targets.length) return fail('Nothing finished here to wreck yet.')
  const text = typeof params.text === 'string' ? params.text.replace(/\s+/g, ' ').trim().slice(0, ORDER_MAX_CHARS) : ''
  const kind = (['knock', 'paint', 'remove'] as WreckKind[]).includes(params.kind as WreckKind) ? (params.kind as WreckKind) : 'knock'
  const plan = text ? await runWreckAgent(env, { text, landmarkName: landmark.name, targets }) : quickWreck(kind, targets)
  await must(tools.update('secrets', secret.id, { wreckReadyAt: now + WRECK_COOLDOWN_MS }))
  const res = await applyWreck(tools, game, me, pos, landmark, plan.acts, targets, rows)
  return ok({ narration: plan.narration, broke: res.broken.length })
}

async function lightsOut(ctx: Ctx): Promise<ActionResult> {
  const m = await playMove(ctx, { living: true })
  if ('error' in m) return m.error as ActionResult
  const { game, secret, now } = m
  if (!secret || secret.data.role !== 'impostor') return fail('Only the Impostor can do that.', 'forbidden')
  if (secret.data.lightsReadyAt > now) return fail('Not yet. The lights trick is cooling down.')
  if (game.data.lightsOutUntil > now) return fail('The lights are already out.')
  await must(ctx.tools.update('secrets', secret.id, { lightsReadyAt: now + LIGHTS_COOLDOWN_MS }))
  await patchGame(ctx.tools, game.id, { lightsOutUntil: now + LIGHTS_OUT_MS })
  await event(ctx.tools, game.id, 'lights', 'The lights went out! Fix them at the Power Shed.')
  return ok({ lightsOut: true })
}

async function fixLights(ctx: Ctx): Promise<ActionResult> {
  const m = await playMove(ctx, { living: true })
  if ('error' in m) return m.error as ActionResult
  const { game, me, pos, now } = m
  if (game.data.lightsOutUntil <= now) return ok({ alreadyOn: true })
  const shed = landmarkById('power_shed') as Landmark
  if (dist(pos, shed) > SHED_RANGE) return fail('Walk to the Power Shed to fix the lights.', 'too_far')
  await patchGame(ctx.tools, game.id, { lightsOutUntil: 0 })
  await event(ctx.tools, game.id, 'lights', `${me.data.name} fixed the lights.`, me.id)
  return ok({ fixed: true })
}

async function report(ctx: Ctx): Promise<ActionResult> {
  const m = await playMove(ctx, { living: true })
  if ('error' in m) return m.error as ActionResult
  const { game, me, pos } = m
  const breaks = (await loadBreaks(ctx.tools, game.id)).filter((b) => !b.data.reported && !b.data.fixed)
  breaks.sort((a, b) => dist(a.data, pos) - dist(b.data, pos))
  const near = breaks[0]
  if (!near || dist(near.data, pos) > REPORT_RANGE) return fail('There is nothing wrecked close enough to report.', 'too_far')
  await must(ctx.tools.update('breaks', near.id, { reported: 1 }))
  await startMeeting(ctx.env, ctx.tools, game, me, 'report', landmarkById(near.data.landmarkId)?.name ?? 'the island')
  return ok({ meeting: true })
}

async function ringBell(ctx: Ctx): Promise<ActionResult> {
  const m = await playMove(ctx, { living: true })
  if ('error' in m) return m.error as ActionResult
  const { game, me, pos, now } = m
  if (dist(pos, MEETING_SPOT) > BELL_RANGE) return fail('Walk to the bell in the middle of the island.', 'too_far')
  if ((me.data.bellsLeft ?? 0) <= 0) return fail('You already rang the bell this game.')
  if (game.data.bellLockUntil > now) return fail('The bell was just rung. Wait a few seconds.')
  await must(ctx.tools.update('players', me.id, { bellsLeft: (me.data.bellsLeft ?? 1) - 1 }))
  await startMeeting(ctx.env, ctx.tools, game, me, 'bell', 'the bell')
  return ok({ meeting: true })
}

// ─── actions: meetings ───────────────────────────────────────────────────────

async function sendChat({ env, userId, params, tools }: Ctx): Promise<ActionResult> {
  const game = await loadGame(tools, params.gameId)
  if (!game) return fail('Game not found.')
  if (game.data.phase !== 'meeting' && game.data.phase !== 'vote') return fail('Chat opens during meetings.')
  const text = typeof params.text === 'string' ? params.text.replace(/\s+/g, ' ').trim().slice(0, CHAT_MAX_CHARS) : ''
  if (!text) return fail('Say something first.')
  const players = await loadPlayers(tools, game.id)
  const me = players.find((p) => p.data.userId === userId)
  if (!me || !me.data.alive) return fail('Only living players can talk in meetings.')
  const t = Date.now()
  await create<ChatRow>(tools, 'chat', { gameId: game.id, meetingNo: game.data.meetingNo, playerId: me.id, text, showAt: t })

  // An AI player who is named in the message answers once.
  const named = players.find((p) => p.data.isBot && p.data.alive && new RegExp(`\\b${p.data.name}\\b`, 'i').test(text))
  if (named && game.data.phaseEndsAt - t > 4_000) {
    const secrets = await loadSecrets(tools, game.id)
    const isImpostor = secrets.some((s) => s.data.playerId === named.id && s.data.role === 'impostor')
    const theirTasks = (await loadTasks(tools, game.id)).filter((x) => x.data.playerId === named.id)
    const reply = await replyToMention(env, {
      botName: named.data.name,
      isImpostor,
      accuser: me.data.name,
      message: text,
      alibi: theirTasks.map((x) => landmarkById(x.data.landmarkId)?.name ?? '').filter(Boolean),
    })
    await create<ChatRow>(tools, 'chat', { gameId: game.id, meetingNo: game.data.meetingNo, playerId: named.id, text: reply, showAt: Date.now() + 1_500 })
  }
  return ok({ sent: true })
}

async function castVote({ userId, params, tools }: Ctx): Promise<ActionResult> {
  const game = await loadGame(tools, params.gameId)
  if (!game) return fail('Game not found.')
  if (game.data.phase !== 'vote') return fail('Voting is not open.')
  const players = await loadPlayers(tools, game.id)
  const me = players.find((p) => p.data.userId === userId)
  if (!me || !me.data.alive) return fail('Only living players can vote.')
  const targetId = String(params.targetId ?? '')
  if (targetId !== 'skip' && !players.some((p) => p.id === targetId && p.data.alive)) return fail('Pick a living player or skip.')
  if (targetId === me.id) return fail('You cannot vote for yourself.')
  const existing = await query<VoteRow>(tools, 'votes', { gameId: game.id, meetingNo: game.data.meetingNo, voterId: me.id }, 1)
  if (existing.length) return fail('You already voted.')
  await create<VoteRow>(tools, 'votes', { gameId: game.id, meetingNo: game.data.meetingNo, voterId: me.id, targetId, showAt: Date.now() })
  const votes = await query<VoteRow>(tools, 'votes', { gameId: game.id, meetingNo: game.data.meetingNo })
  const alive = players.filter((p) => p.data.alive)
  if (alive.every((p) => votes.some((v) => v.data.voterId === p.id))) {
    // Everyone has voted: close the vote shortly so the last vote shows.
    await patchGame(tools, game.id, { phaseEndsAt: Math.min(game.data.phaseEndsAt, Date.now() + 2_500) })
  }
  return ok({ voted: true })
}

async function rematch(ctx: Ctx): Promise<ActionResult> {
  const { userId, params, tools } = ctx
  const game = await loadGame(tools, params.gameId)
  if (!game) return fail('Game not found.')
  if (game.data.phase !== 'over') return fail('The game is still running.')
  if (game.data.nextCode) return ok({ code: game.data.nextCode })
  const players = await loadPlayers(tools, game.id)
  if (!players.some((p) => p.data.userId === userId)) return fail('You were not in this game.')
  const created = await createGame(ctx)
  if (!created.success) return created
  const { gameId, code } = created.data as { gameId: string; code: string }
  let seat = 1
  for (const p of players) {
    if (p.data.isBot || p.data.userId === userId) continue
    await tools.create('players', {
      gameId, userId: p.data.userId, name: p.data.name, color: SEAT_COLORS[seat], seat, isBot: 0, alive: 1,
      bellsLeft: BELLS_PER_PLAYER, lastActiveAt: Date.now(),
    })
    seat++
  }
  await patchGame(tools, game.id, { nextCode: code })
  return ok({ code })
}

function guard(fn: (ctx: Ctx) => Promise<ActionResult>): ActionHandler<Env> {
  return async (ctx) => {
    try {
      return await fn(ctx)
    } catch (err) {
      console.error('[game action]', err instanceof Error ? err.message : err)
      return fail('Something went wrong on the server. Try again.')
    }
  }
}

export const gameActions: Record<string, ActionHandler<Env>> = {
  'game-create': guard(createGame),
  'game-join': guard(joinGame),
  'game-start': guard(startGame),
  'game-tick': guard(tick),
  'game-pos': guard(reportPos),
  'game-build': guard(buildOrder),
  'game-wreck': guard(wreck),
  'game-lights': guard(lightsOut),
  'game-fix-lights': guard(fixLights),
  'game-report': guard(report),
  'game-bell': guard(ringBell),
  'game-chat': guard(sendChat),
  'game-vote': guard(castVote),
  'game-rematch': guard(rematch),
}

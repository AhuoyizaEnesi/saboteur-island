/**
 * Every game move is a server action. Actions run with RBAC off (see
 * src/server/action-routes.ts), so each one checks for itself that the caller
 * is a player in this game, that the phase allows the move, and, for the
 * Impostor's moves, that the caller's secret role allows it.
 *
 * Timers: the browser of the host (or of any player when the host is away)
 * calls `tick` every couple of seconds. `tick` reads the clock and advances
 * the phase once its deadline has passed, and runs AI players' turns when
 * they come due. Cron's one minute floor is too slow for 20 second votes.
 */

import type { ActionHandler, ActionResult, ActionTools } from 'deepspace/worker'
import type { Env } from '../../worker'
import { BUILD_TYPES, type BuildType } from '../game/catalog'
import {
  BOT_NAMES,
  BUILD_MS,
  CHAT_MAX_CHARS,
  EJECT_MS,
  INTRO_MS,
  LIGHTS_OUT_MS,
  MAX_BUILDS_PER_GAME,
  MAX_PLAYERS,
  MEETING_MS,
  MEETINGS_PER_PLAYER,
  MIN_PLAYERS,
  ORDER_MAX_CHARS,
  ORDERS_PER_ROUND,
  ROUNDS,
  SABOTAGES_PER_ROUND,
  SEAT_COLORS,
  VOTE_MS,
  type Phase,
  type TimeOfDay,
} from '../game/constants'
import { hashString, makeRng, placeOne, type PlacedLike, type Rng } from '../game/placement'
import {
  assignRoles,
  botOrder,
  decideWinner,
  describeOps,
  makeCode,
  normalizeCode,
  pickTheme,
  secretDone,
  tally,
  tasksDone,
  themeById,
} from '../game/rules'
import type {
  BotPlanEntry,
  BuildRow,
  ChatRow,
  EventRow,
  GameRow,
  OrderRow,
  PlayerRow,
  SecretRow,
  VoteRow,
} from '../game/types'
import { runBuilderAgent } from '../server/builder-agent'
import { planMeeting, replyToMention } from '../server/meeting-ai'

type Ctx = Parameters<ActionHandler<Env>>[0]
type Row<T> = { id: string; data: T; createdAt: string }

const ROUND_LIGHT: Record<number, TimeOfDay> = { 1: 'day', 2: 'sunset', 3: 'night' }

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
  d.botPlan = parseJson<BotPlanEntry[]>(d.botPlan, [])
  d.botVotes = parseJson<GameRow['botVotes']>(d.botVotes, [])
  d.reveal = parseJson<GameRow['reveal']>(d.reveal, null)
  return { id: r.data.record.recordId, data: d, createdAt: r.data.record.createdAt }
}

const loadPlayers = async (tools: ActionTools, gameId: string) =>
  (await query<PlayerRow>(tools, 'players', { gameId })).sort((a, b) => a.data.seat - b.data.seat)

const loadSecrets = (tools: ActionTools, gameId: string) => query<SecretRow>(tools, 'secrets', { gameId })
const loadBuilds = (tools: ActionTools, gameId: string) => query<BuildRow>(tools, 'builds', { gameId }, 500)

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

function requirePlayer(players: Row<PlayerRow>[], userId: string) {
  return players.find((p) => p.data.userId === userId) ?? null
}

const rngFor = (...parts: (string | number)[]) => makeRng(hashString(parts.join(':')) ^ (Date.now() & 0xffff))

// ─── starting scenery ────────────────────────────────────────────────────────

/** Wild trees and rocks every island starts with. Records, so placement avoids them. */
async function plantScenery(tools: ActionTools, gameId: string, seed: number) {
  const rng = makeRng(seed)
  const placed: PlacedLike[] = []
  const plan: [BuildType, number, string | undefined][] = [
    ['pine_tree', 7, 'edge'],
    ['round_tree', 3, undefined],
    ['rock', 5, undefined],
    ['flowers', 2, undefined],
  ]
  let seq = 0
  for (const [type, n, near] of plan) {
    for (let i = 0; i < n; i++) {
      const p = placeOne({ type, near }, placed, rng)
      placed.push(p)
      await create<BuildRow>(tools, 'builds', {
        gameId, orderId: '', playerId: 'world', type, x: p.x, z: p.z, rot: p.rot, scale: p.scale,
        color: '', round: 0, seq: seq++, at: 0,
      })
    }
  }
}

// ─── bots ────────────────────────────────────────────────────────────────────

function planBotsForRound(
  bots: Row<PlayerRow>[],
  impostorBotId: string | null,
  round: number,
  buildStart: number,
  rng: Rng,
): BotPlanEntry[] {
  const plan: BotPlanEntry[] = []
  for (const b of bots) {
    if (!b.data.alive) continue
    for (let i = 0; i < ORDERS_PER_ROUND; i++) {
      const slot = (BUILD_MS - 25_000) / ORDERS_PER_ROUND
      const at = buildStart + 8_000 + i * slot + rng() * (slot - 4_000)
      plan.push({ kind: 'order', playerId: b.id, round, at: Math.round(at), done: 0 })
    }
  }
  if (impostorBotId && round >= 2 && rng() < 0.7) {
    plan.push({ kind: 'lights', playerId: impostorBotId, round, at: Math.round(buildStart + 25_000 + rng() * 35_000), done: 0 })
  }
  return plan
}

async function runBotOrder(tools: ActionTools, game: Row<GameRow>, bot: Row<PlayerRow>, secrets: Row<SecretRow>[]) {
  const secret = secrets.find((s) => s.data.playerId === bot.id)
  const impostorSecret = secrets.find((s) => s.data.role === 'impostor')
  const theme = themeById(impostorSecret?.data.themeId ?? '')
  const builds = (await loadBuilds(tools, game.id)).map((b) => b.data)
  const past = (await query<OrderRow>(tools, 'orders', { gameId: game.id, playerId: bot.id })).map((o) => o.data.text)
  const rng = rngFor(game.id, bot.id, past.length)
  const order = botOrder({ role: secret?.data.role ?? 'crew', theme, builds, botPlayerId: bot.id, rng, pastTexts: past })

  const at = Date.now()
  const orderId = await create<OrderRow>(tools, 'orders', {
    gameId: game.id, playerId: bot.id, round: game.data.round, text: order.text, status: 'building', narration: '', at,
  })
  const placed: PlacedLike[] = builds.slice()
  let seq = builds.length
  const made: { type: BuildType; count: number }[] = []
  for (const op of order.ops) {
    let n = 0
    for (let i = 0; i < op.count && placed.length < MAX_BUILDS_PER_GAME; i++) {
      const p = placeOne({ type: op.type, near: op.near, scale: op.scale }, placed, rng)
      placed.push(p)
      n++
      await create<BuildRow>(tools, 'builds', {
        gameId: game.id, orderId, playerId: bot.id, type: p.type, x: p.x, z: p.z, rot: p.rot, scale: p.scale,
        color: bot.data.color, round: game.data.round, seq: seq++, at,
      })
    }
    if (n) made.push({ type: op.type, count: n })
  }
  await must(tools.update('orders', orderId, { status: 'done', narration: describeOps(made) }))
}

// ─── phase transitions ───────────────────────────────────────────────────────

async function startRound(tools: ActionTools, game: Row<GameRow>, round: number) {
  const t = Date.now()
  const players = await loadPlayers(tools, game.id)
  const secrets = await loadSecrets(tools, game.id)
  const alive = players.filter((p) => p.data.alive)
  for (const p of alive) await must(tools.update('players', p.id, { ordersLeft: ORDERS_PER_ROUND }))
  for (const s of secrets) if (s.data.sabotagesUsed) await must(tools.update('secrets', s.id, { sabotagesUsed: 0 }))
  const impostorBot = alive.find((p) => p.data.isBot && secrets.some((s) => s.data.playerId === p.id && s.data.role === 'impostor'))
  const bots = alive.filter((p) => p.data.isBot)
  const plan = planBotsForRound(bots, impostorBot?.id ?? null, round, t, rngFor(game.id, 'plan', round))
  await patchGame(tools, game.id, {
    phase: 'build', round, phaseEndsAt: t + BUILD_MS, buildMsLeft: 0, lightsOutUntil: 0,
    timeOfDay: ROUND_LIGHT[round] ?? 'day', botPlan: plan, ejectedId: '',
  })
  const label = round === 1 ? 'Round 1. Start building the village.' : round === ROUNDS ? `Round ${round}, the last one. Night falls.` : `Round ${round}. The sun is going down.`
  await event(tools, game.id, 'round', label)
}

async function startMeeting(env: Env, tools: ActionTools, game: Row<GameRow>, caller: Row<PlayerRow> | null, final: boolean) {
  const t = Date.now()
  const meetingNo = (game.data.meetingNo || 0) + 1
  const buildMsLeft = game.data.phase === 'build' ? Math.max(0, game.data.phaseEndsAt - t) : 0
  const calledBy = caller ? caller.data.name : 'The island'
  await patchGame(tools, game.id, {
    phase: 'meeting', meetingNo, phaseEndsAt: t + MEETING_MS, buildMsLeft, meetingCalledBy: calledBy,
    finalMeeting: final ? 1 : 0, lightsOutUntil: 0, botVotes: [],
  })
  await event(tools, game.id, 'meeting', final ? 'Final vote. Who is the Impostor?' : `${calledBy} called an emergency meeting!`, caller?.id ?? '')

  const players = await loadPlayers(tools, game.id)
  const secrets = await loadSecrets(tools, game.id)
  const impostorSecret = secrets.find((s) => s.data.role === 'impostor')
  const builds = (await loadBuilds(tools, game.id)).filter((b) => b.data.playerId !== 'world')
  const orders = await query<OrderRow>(tools, 'orders', { gameId: game.id })
  const plan = await planMeeting(env, {
    players: players.map((p) => ({
      id: p.id, name: p.data.name, isBot: Boolean(p.data.isBot), alive: Boolean(p.data.alive),
      isImpostor: impostorSecret?.data.playerId === p.id,
    })),
    builds: builds.map((b) => ({ type: b.data.type, playerId: b.data.playerId, round: b.data.round })),
    orders: orders.map((o) => ({ playerId: o.data.playerId, text: o.data.text, round: o.data.round })),
    calledByName: calledBy,
    final,
    theme: themeById(impostorSecret?.data.themeId ?? ''),
    humanChat: [],
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
      showAt: t + 2_000 + Math.round(rng() * 12_000),
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
    await event(tools, game.id, 'eject', wasImpostor ? `${name} was ejected. ${name} was the Impostor.` : `${name} was ejected. ${name} was crew.`, result.ejectedId)
  } else {
    await event(tools, game.id, 'eject', result.tie ? 'The vote was tied. Nobody was ejected.' : 'The crew skipped. Nobody was ejected.')
  }
  await patchGame(tools, game.id, {
    phase: 'eject', phaseEndsAt: t + EJECT_MS, ejectedId: result.ejectedId ?? '', ejectedWasImpostor: wasImpostor,
  })
}

async function afterEject(tools: ActionTools, game: Row<GameRow>) {
  const players = await loadPlayers(tools, game.id)
  const secrets = await loadSecrets(tools, game.id)
  const builds = (await loadBuilds(tools, game.id)).map((b) => b.data)
  const impostorSecret = secrets.find((s) => s.data.role === 'impostor')
  const impostorId = impostorSecret?.data.playerId ?? ''
  const alive = players.filter((p) => p.data.alive)
  const impostorAlive = alive.some((p) => p.id === impostorId)
  const verdict = decideWinner({
    impostorAlive,
    aliveCrew: alive.filter((p) => p.id !== impostorId).length,
    aliveImpostors: impostorAlive ? 1 : 0,
    finalDone: game.data.finalMeeting === 1,
    tasksComplete: tasksDone(builds),
    secretComplete: impostorId ? secretDone(builds, impostorId, themeById(impostorSecret?.data.themeId ?? '')) : false,
  })
  if (verdict.winner) return finish(tools, game, verdict.winner, verdict.reason, impostorSecret?.data ?? null)
  const t = Date.now()
  await patchGame(tools, game.id, { phase: 'build', phaseEndsAt: t + Math.max(game.data.buildMsLeft, 15_000), ejectedId: '' })
  // AI players whose turns fell inside the meeting take them now.
  const plan = (game.data.botPlan ?? []).map((e) => (!e.done && e.at < t ? { ...e, at: t + 3_000 + Math.random() * 8_000 } : e))
  await patchGame(tools, game.id, { botPlan: plan })
}

async function finish(tools: ActionTools, game: Row<GameRow>, winner: 'crew' | 'impostor', reason: string, impostor: SecretRow | null) {
  const builds = await loadBuilds(tools, game.id)
  const theme = themeById(impostor?.themeId ?? '')
  const sabotageBuildIds = impostor
    ? builds.filter((b) => b.data.playerId === impostor.playerId && theme.targets.includes(b.data.type as BuildType)).map((b) => b.id)
    : []
  await patchGame(tools, game.id, {
    phase: 'over', phaseEndsAt: 0, winner, winReason: reason,
    reveal: { impostorPlayerId: impostor?.playerId ?? '', themeId: theme.id, sabotageBuildIds },
  })
  await event(tools, game.id, 'system', winner === 'crew' ? `Crew wins. ${reason}` : `Impostor wins. ${reason}`)
}

// ─── actions ─────────────────────────────────────────────────────────────────

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
    code, hostId: userId, phase: 'lobby', round: 0, phaseEndsAt: 0, buildMsLeft: 0, timeOfDay: 'day', weather: 'clear',
    lightsOutUntil: 0, meetingNo: 0, meetingCalledBy: '', finalMeeting: 0, ejectedId: '', ejectedWasImpostor: 0,
    winner: '', winReason: '', reveal: null, botPlan: [], botVotes: [], nextCode: '', seed,
  })
  await create<PlayerRow>(tools, 'players', {
    gameId, userId, name: await displayName(tools, userId), color: SEAT_COLORS[0], seat: 0, isBot: 0, alive: 1,
    ordersLeft: 0, meetingsLeft: 0, lastActiveAt: Date.now(),
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
  const me = requirePlayer(players, userId)
  if (me) {
    await must(tools.update('players', me.id, { lastActiveAt: Date.now() }))
    return ok({ gameId: game.id, code: game.data.code, playerId: me.id })
  }
  if (game.data.phase !== 'lobby') return ok({ gameId: game.id, code: game.data.code, spectator: true })
  if (players.length >= MAX_PLAYERS) return fail('That game is full.', 'full')
  const taken = new Set(players.map((p) => p.data.seat))
  const seat = [0, 1, 2, 3, 4, 5].find((s) => !taken.has(s)) ?? players.length
  const playerId = await create<PlayerRow>(tools, 'players', {
    gameId: game.id, userId, name: await displayName(tools, userId), color: SEAT_COLORS[seat], seat, isBot: 0,
    alive: 1, ordersLeft: 0, meetingsLeft: 0, lastActiveAt: Date.now(),
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
      ordersLeft: 0, meetingsLeft: 0, lastActiveAt: Date.now(),
    }
    players.push({ id: await create<PlayerRow>(tools, 'players', data), data, createdAt: '' })
  }
  const rng = makeRng(game.data.seed ^ 0x5eed)
  const roles = assignRoles(players.map((p) => p.id), rng)
  const theme = pickTheme(rng)
  for (const p of players) {
    await create<SecretRow>(tools, 'secrets', {
      gameId: game.id, playerId: p.id, ownerUserId: p.data.userId, role: roles[p.id],
      themeId: roles[p.id] === 'impostor' ? theme.id : '', sabotagesUsed: 0,
    })
    await must(tools.update('players', p.id, { alive: 1, ordersLeft: ORDERS_PER_ROUND, meetingsLeft: MEETINGS_PER_PLAYER }))
  }
  await patchGame(tools, game.id, { phase: 'intro', round: 0, phaseEndsAt: Date.now() + INTRO_MS })
  await event(tools, game.id, 'system', 'Roles are dealt. One of you is the Impostor.')
  return ok({ started: true })
}

async function tick({ env, params, tools }: Ctx): Promise<ActionResult> {
  const game = await loadGame(tools, params.gameId)
  if (!game) return fail('Game not found.')
  const t = Date.now()
  const phase: Phase = game.data.phase
  if (phase === 'intro' && t >= game.data.phaseEndsAt) {
    await startRound(tools, game, 1)
  } else if (phase === 'build') {
    const plan = game.data.botPlan ?? []
    const due = plan.filter((e) => !e.done && e.round === game.data.round && e.at <= t).slice(0, 2)
    if (due.length) {
      // Mark first, so an overlapping tick cannot run the same turn twice.
      const next = plan.map((e) => (due.includes(e) ? { ...e, done: 1 } : e))
      await patchGame(tools, game.id, { botPlan: next })
      const players = await loadPlayers(tools, game.id)
      const secrets = await loadSecrets(tools, game.id)
      for (const e of due) {
        const bot = players.find((p) => p.id === e.playerId)
        if (!bot || !bot.data.alive) continue
        if (e.kind === 'lights') {
          if (game.data.lightsOutUntil < t) {
            await patchGame(tools, game.id, { lightsOutUntil: t + LIGHTS_OUT_MS })
            await event(tools, game.id, 'lights', 'The lights went out! Someone fix them at the lighthouse.')
          }
        } else {
          await runBotOrder(tools, game, bot, secrets)
        }
      }
    }
    // A crew AI player fixes the lights after a while if nobody else does.
    if (game.data.lightsOutUntil > t && game.data.lightsOutUntil - t < LIGHTS_OUT_MS - 9_000) {
      const players = await loadPlayers(tools, game.id)
      const secrets = await loadSecrets(tools, game.id)
      const fixer = players.find((p) => p.data.isBot && p.data.alive && secrets.some((s) => s.data.playerId === p.id && s.data.role === 'crew'))
      if (fixer && Math.random() < 0.4) {
        await patchGame(tools, game.id, { lightsOutUntil: 0 })
        await event(tools, game.id, 'lights', `${fixer.data.name} fixed the lights.`, fixer.id)
      }
    }
    if (t >= game.data.phaseEndsAt) {
      const fresh = await loadGame(tools, game.id)
      if (fresh && fresh.data.phase === 'build') {
        if (fresh.data.round < ROUNDS) await startRound(tools, fresh, fresh.data.round + 1)
        else await startMeeting(env, tools, fresh, null, true)
      }
    }
  } else if (phase === 'meeting' && t >= game.data.phaseEndsAt) {
    await startVote(tools, game)
  } else if (phase === 'vote' && t >= game.data.phaseEndsAt) {
    await resolveVote(tools, game)
  } else if (phase === 'eject' && t >= game.data.phaseEndsAt) {
    await afterEject(tools, game)
  }
  return ok({ phase: game.data.phase, now: Date.now() })
}

async function submitOrder({ env, userId, params, tools }: Ctx): Promise<ActionResult> {
  const game = await loadGame(tools, params.gameId)
  if (!game) return fail('Game not found.')
  if (game.data.phase !== 'build' || Date.now() > game.data.phaseEndsAt) return fail('Orders open during build rounds.')
  const text = typeof params.text === 'string' ? params.text.replace(/\s+/g, ' ').trim().slice(0, ORDER_MAX_CHARS) : ''
  if (!text) return fail('Type an order first.')
  const players = await loadPlayers(tools, game.id)
  const me = requirePlayer(players, userId)
  if (!me) return fail('You are not in this game.')
  if (!me.data.alive) return fail('Ejected players cannot give orders.')
  if (me.data.ordersLeft <= 0) return fail('You used your orders for this round.')
  await must(tools.update('players', me.id, { ordersLeft: me.data.ordersLeft - 1, lastActiveAt: Date.now() }))

  const at = Date.now()
  const orderId = await create<OrderRow>(tools, 'orders', {
    gameId: game.id, playerId: me.id, round: game.data.round, text, status: 'building', narration: '', at,
  })
  const existing = (await loadBuilds(tools, game.id)).map((b) => b.data)
  const result = await runBuilderAgent(env, {
    text, playerName: me.data.name, existing, rng: makeRng(hashString(orderId)), capacity: MAX_BUILDS_PER_GAME - existing.length,
  })
  let seq = existing.length
  for (const p of result.placements) {
    await create<BuildRow>(tools, 'builds', {
      gameId: game.id, orderId, playerId: me.id, type: p.type, x: p.x, z: p.z, rot: p.rot, scale: p.scale,
      color: me.data.color, round: game.data.round, seq: seq++, at,
    })
  }
  if (result.env.timeOfDay || result.env.weather) await patchGame(tools, game.id, result.env)
  await must(tools.update('orders', orderId, { status: result.placements.length || result.env.timeOfDay || result.env.weather ? 'done' : 'failed', narration: result.narration }))
  return ok({ narration: result.narration, placed: result.placements.length, usedModel: result.usedModel })
}

async function callMeeting({ env, userId, params, tools }: Ctx): Promise<ActionResult> {
  const game = await loadGame(tools, params.gameId)
  if (!game) return fail('Game not found.')
  if (game.data.phase !== 'build') return fail('Meetings can only be called during a build round.')
  const players = await loadPlayers(tools, game.id)
  const me = requirePlayer(players, userId)
  if (!me || !me.data.alive) return fail('Only living players can call a meeting.')
  if (me.data.meetingsLeft <= 0) return fail('You already used your emergency meeting.')
  await must(tools.update('players', me.id, { meetingsLeft: me.data.meetingsLeft - 1 }))
  await startMeeting(env, tools, game, me, false)
  return ok({ meeting: true })
}

async function sendChat({ env, userId, params, tools }: Ctx): Promise<ActionResult> {
  const game = await loadGame(tools, params.gameId)
  if (!game) return fail('Game not found.')
  if (game.data.phase !== 'meeting' && game.data.phase !== 'vote') return fail('Chat opens during meetings.')
  const text = typeof params.text === 'string' ? params.text.replace(/\s+/g, ' ').trim().slice(0, CHAT_MAX_CHARS) : ''
  if (!text) return fail('Say something first.')
  const players = await loadPlayers(tools, game.id)
  const me = requirePlayer(players, userId)
  if (!me || !me.data.alive) return fail('Only living players can talk in meetings.')
  const t = Date.now()
  await create<ChatRow>(tools, 'chat', { gameId: game.id, meetingNo: game.data.meetingNo, playerId: me.id, text, showAt: t })

  // An AI player who is named in the message answers once.
  const named = players.find((p) => p.data.isBot && p.data.alive && new RegExp(`\\b${p.data.name}\\b`, 'i').test(text))
  if (named && game.data.phaseEndsAt - t > 4_000) {
    const secrets = await loadSecrets(tools, game.id)
    const isImpostor = secrets.some((s) => s.data.playerId === named.id && s.data.role === 'impostor')
    const builds = (await loadBuilds(tools, game.id)).filter((b) => b.data.playerId === named.id).map((b) => b.data.type)
    const reply = await replyToMention(env, { botName: named.data.name, isImpostor, accuser: me.data.name, message: text, theirBuilds: builds })
    await create<ChatRow>(tools, 'chat', { gameId: game.id, meetingNo: game.data.meetingNo, playerId: named.id, text: reply, showAt: Date.now() + 1_500 })
  }
  return ok({ sent: true })
}

async function castVote({ userId, params, tools }: Ctx): Promise<ActionResult> {
  const game = await loadGame(tools, params.gameId)
  if (!game) return fail('Game not found.')
  if (game.data.phase !== 'vote') return fail('Voting is not open.')
  const players = await loadPlayers(tools, game.id)
  const me = requirePlayer(players, userId)
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
    // Everyone has voted: close the vote shortly so the last beam can land.
    await patchGame(tools, game.id, { phaseEndsAt: Math.min(game.data.phaseEndsAt, Date.now() + 2_500) })
  }
  return ok({ voted: true })
}

async function sabotageLights({ userId, params, tools }: Ctx): Promise<ActionResult> {
  const game = await loadGame(tools, params.gameId)
  if (!game) return fail('Game not found.')
  if (game.data.phase !== 'build') return fail('Sabotage works during build rounds.')
  const players = await loadPlayers(tools, game.id)
  const me = requirePlayer(players, userId)
  if (!me || !me.data.alive) return fail('Not allowed.')
  const secret = (await query<SecretRow>(tools, 'secrets', { gameId: game.id, playerId: me.id }, 1))[0]
  if (!secret || secret.data.role !== 'impostor') return fail('Only the Impostor can do that.', 'forbidden')
  if (secret.data.sabotagesUsed >= SABOTAGES_PER_ROUND) return fail('You already cut the lights this round.')
  const t = Date.now()
  if (game.data.lightsOutUntil > t) return fail('The lights are already out.')
  await must(tools.update('secrets', secret.id, { sabotagesUsed: secret.data.sabotagesUsed + 1 }))
  await patchGame(tools, game.id, { lightsOutUntil: t + LIGHTS_OUT_MS })
  await event(tools, game.id, 'lights', 'The lights went out! Someone fix them at the lighthouse.')
  return ok({ lightsOut: true })
}

async function fixLights({ userId, params, tools }: Ctx): Promise<ActionResult> {
  const game = await loadGame(tools, params.gameId)
  if (!game) return fail('Game not found.')
  if (game.data.lightsOutUntil <= Date.now()) return ok({ alreadyOn: true })
  const players = await loadPlayers(tools, game.id)
  const me = requirePlayer(players, userId)
  if (!me || !me.data.alive) return fail('Only living players can fix the lights.')
  await patchGame(tools, game.id, { lightsOutUntil: 0 })
  await event(tools, game.id, 'lights', `${me.data.name} fixed the lights.`, me.id)
  return ok({ fixed: true })
}

async function rematch(ctx: Ctx): Promise<ActionResult> {
  const { userId, params, tools } = ctx
  const game = await loadGame(tools, params.gameId)
  if (!game) return fail('Game not found.')
  if (game.data.phase !== 'over') return fail('The game is still running.')
  if (game.data.nextCode) return ok({ code: game.data.nextCode })
  const players = await loadPlayers(tools, game.id)
  if (!requirePlayer(players, userId)) return fail('You were not in this game.')
  const created = await createGame(ctx)
  if (!created.success) return created
  const { gameId, code } = created.data as { gameId: string; code: string }
  let seat = 1
  for (const p of players) {
    if (p.data.isBot || p.data.userId === userId) continue
    await tools.create('players', {
      gameId, userId: p.data.userId, name: p.data.name, color: SEAT_COLORS[seat], seat, isBot: 0, alive: 1,
      ordersLeft: 0, meetingsLeft: 0, lastActiveAt: Date.now(),
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
  'game-order': guard(submitOrder),
  'game-meeting': guard(callMeeting),
  'game-chat': guard(sendChat),
  'game-vote': guard(castVote),
  'game-sabotage': guard(sabotageLights),
  'game-fix-lights': guard(fixLights),
  'game-rematch': guard(rematch),
}

/** Exposed for tests. */
export const __test = { planBotsForRound, BUILD_TYPES }

/**
 * What AI players say and how they vote in a meeting.
 *
 * One model call per meeting writes every AI player's chat lines and votes.
 * Crew AI players reason from public evidence only: who walked to which
 * build, and whether it fits a fishing village. The AI Impostor knows its
 * own secret and tries to deflect. If the model is unavailable, a simple
 * suspicion score drives the same output, so meetings always happen.
 */

import { generateText } from 'ai'
import { createDeepSpaceAI } from 'deepspace/worker'
import { GOAL_TEXT } from '../game/constants'
import type { Rng } from '../game/placement'
import type { Theme } from '../game/rules'
import type { Env } from '../../worker'
import { AGENT_MODEL } from './builder-agent'

const VILLAGE_TYPES = new Set([
  'house', 'dock', 'boat', 'lighthouse', 'lantern', 'windmill', 'well', 'fence',
  'flowers', 'tent', 'campfire', 'sheep', 'pine_tree', 'round_tree', 'rock',
])

export interface MeetingPlayer {
  id: string
  name: string
  isBot: boolean
  alive: boolean
  isImpostor: boolean
}

export interface MeetingInput {
  players: MeetingPlayer[]
  builds: { type: string; playerId: string; round: number }[]
  orders: { playerId: string; text: string; round: number }[]
  calledByName: string
  final: boolean
  theme: Theme
  humanChat: { name: string; text: string }[]
  rng: Rng
}

export interface MeetingOutput {
  lines: { playerId: string; text: string }[]
  votes: { playerId: string; targetId: string }[]
  usedModel: boolean
}

export async function planMeeting(env: Env, input: MeetingInput): Promise<MeetingOutput> {
  const bots = input.players.filter((p) => p.isBot && p.alive)
  if (!bots.length) return { lines: [], votes: [], usedModel: false }
  try {
    const out = await modelMeeting(env, input, bots)
    if (out) return out
  } catch (err) {
    console.warn('[meeting-ai] model unavailable, using suspicion score:', err instanceof Error ? err.message : err)
  }
  return heuristicMeeting(input, bots)
}

function evidence(input: MeetingInput): string {
  const nameOf = (id: string) => input.players.find((p) => p.id === id)?.name ?? 'someone'
  const builtLines = input.builds.map((b) => `round ${b.round}: ${nameOf(b.playerId)} walked to a new ${b.type.replace('_', ' ')}`)
  const orderLines = input.orders.map((o) => `round ${o.round}: an order said "${o.text}"`)
  return [...builtLines.slice(-40), ...orderLines.slice(-20)].join('\n')
}

async function modelMeeting(env: Env, input: MeetingInput, bots: MeetingPlayer[]): Promise<MeetingOutput | null> {
  const anthropic = createDeepSpaceAI(env, 'anthropic')
  const alive = input.players.filter((p) => p.alive)
  const roster = alive.map((p) => `${p.name}${p.isBot ? '' : ' (human)'}`).join(', ')
  const botBriefs = bots
    .map((b) =>
      b.isImpostor
        ? `${b.name}: secretly the Impostor. Their hidden plan: ${input.theme.goal} Deflect suspicion, sound helpful, and vote for someone else. Never admit it.`
        : `${b.name}: crew. Suspect whoever walked to builds that do not belong in a fishing village. Be specific about what they saw.`,
    )
    .join('\n')

  const result = await generateText({
    model: anthropic(AGENT_MODEL),
    system: [
      'You write dialogue for AI players in Saboteur Island, a social deduction game.',
      `The crew is building: ${GOAL_TEXT}. One player is a secret Impostor sneaking in things that do not belong.`,
      'Players watch who walks to each new build, so who built what is public.',
      'Write short, casual chat lines, like friends arguing over a game. Under 18 words each. No emojis, no dashes.',
      'Reply with JSON only, matching: {"lines":[{"name":"","text":""}],"votes":[{"name":"","vote":""}]}',
      'Each AI player writes 1 or 2 lines. vote is a living player name or "skip". Nobody votes for themselves.',
    ].join('\n'),
    prompt: [
      `Living players: ${roster}.`,
      `${input.calledByName} ${input.final ? 'is leading the final vote after the last round' : 'called this emergency meeting'}.`,
      'AI players:',
      botBriefs,
      '',
      'What everyone saw:',
      evidence(input) || 'Nothing has been built yet.',
      '',
      input.humanChat.length ? `Chat so far:\n${input.humanChat.map((c) => `${c.name}: ${c.text}`).join('\n')}` : 'Nobody has spoken yet.',
    ].join('\n'),
  })

  const raw = String(result.text || '')
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  const parsed = JSON.parse(raw.slice(start, end + 1)) as {
    lines?: { name?: string; text?: string }[]
    votes?: { name?: string; vote?: string }[]
  }
  const byName = (n: unknown) =>
    typeof n === 'string' ? input.players.find((p) => p.name.toLowerCase() === n.trim().toLowerCase()) : undefined

  const lines: MeetingOutput['lines'] = []
  for (const l of parsed.lines ?? []) {
    const p = byName(l.name)
    if (!p || !p.isBot || !p.alive || typeof l.text !== 'string' || !l.text.trim()) continue
    lines.push({ playerId: p.id, text: l.text.replace(/[—–]/g, ',').trim().slice(0, 160) })
  }
  const votes: MeetingOutput['votes'] = []
  for (const bot of bots) {
    const v = (parsed.votes ?? []).find((x) => byName(x.name)?.id === bot.id)
    const target = v && typeof v.vote === 'string' && v.vote.toLowerCase() === 'skip' ? null : byName(v?.vote)
    const ok = target && target.alive && target.id !== bot.id
    votes.push({ playerId: bot.id, targetId: ok ? target.id : 'skip' })
  }
  if (!lines.length) return null
  return { lines, votes, usedModel: true }
}

/** Suspicion = builds by a player that do not belong in a fishing village. */
export function suspicionScores(input: Pick<MeetingInput, 'players' | 'builds'>): Record<string, number> {
  const scores: Record<string, number> = {}
  for (const p of input.players) scores[p.id] = 0
  for (const b of input.builds) {
    if (!VILLAGE_TYPES.has(b.type) && scores[b.playerId] !== undefined) scores[b.playerId] += 1
  }
  return scores
}

export function heuristicMeeting(input: MeetingInput, bots: MeetingPlayer[]): MeetingOutput {
  const scores = suspicionScores(input)
  const alive = input.players.filter((p) => p.alive)
  const nameOf = (id: string) => input.players.find((p) => p.id === id)?.name ?? 'someone'
  const oddBuildOf = (id: string) => input.builds.filter((b) => b.playerId === id && !VILLAGE_TYPES.has(b.type)).pop()
  const lines: MeetingOutput['lines'] = []
  const votes: MeetingOutput['votes'] = []

  for (const bot of bots) {
    const others = alive.filter((p) => p.id !== bot.id)
    const ranked = [...others].sort((a, b) => (scores[b.id] ?? 0) - (scores[a.id] ?? 0))
    let target = ranked[0] && (scores[ranked[0].id] ?? 0) > 0 ? ranked[0] : null
    if (bot.isImpostor) {
      const crew = others.filter((p) => !p.isImpostor)
      target = crew.length ? crew[Math.floor(input.rng() * crew.length)] : null
    }
    if (target) {
      const odd = oddBuildOf(target.id)
      const text = odd
        ? `I watched ${target.name} walk straight to that ${odd.type.replace('_', ' ')}. That is not village stuff.`
        : `${target.name} has been quiet all game. That feels off to me.`
      lines.push({ playerId: bot.id, text })
      votes.push({ playerId: bot.id, targetId: target.id })
    } else {
      lines.push({ playerId: bot.id, text: `I have not seen anything weird yet. I say we skip.` })
      votes.push({ playerId: bot.id, targetId: 'skip' })
    }
  }
  if (lines.length > 1 && input.rng() < 0.7) {
    const first = lines[0]
    const reply = bots.find((b) => b.id !== first.playerId)
    if (reply) lines.push({ playerId: reply.id, text: `Fair point about ${nameOf(votes[0]?.targetId ?? '')}. I am watching them too.` })
  }
  return { lines, votes, usedModel: false }
}

/** One reply from an AI player who was named in a human's chat message. */
export async function replyToMention(
  env: Env,
  input: { botName: string; isImpostor: boolean; accuser: string; message: string; theirBuilds: string[] },
): Promise<string> {
  const builds = input.theirBuilds.length ? input.theirBuilds.map((b) => b.replace('_', ' ')).join(', ') : 'nothing yet'
  try {
    const anthropic = createDeepSpaceAI(env, 'anthropic')
    const result = await generateText({
      model: anthropic(AGENT_MODEL),
      system: [
        `You are ${input.botName}, an AI player in Saboteur Island, a social deduction game about building a cozy fishing village.`,
        input.isImpostor
          ? 'You are secretly the Impostor. Stay calm, explain your builds innocently, and point suspicion somewhere else. Never admit it.'
          : 'You are crew. Answer honestly about what you built and what you saw.',
        'Reply with one casual chat line under 18 words. No emojis, no dashes, no quotes.',
      ].join('\n'),
      prompt: `You built: ${builds}.\n${input.accuser} just said: "${input.message}"`,
    })
    const line = String(result.text || '').split('\n').filter(Boolean)[0]?.replace(/[—–"]/g, '').trim()
    if (line) return line.slice(0, 160)
  } catch (err) {
    console.warn('[meeting-ai] reply fell back:', err instanceof Error ? err.message : err)
  }
  return input.isImpostor
    ? `Me? I only built ${builds}. Ask who walked to the weird stuff.`
    : `I built ${builds}. All village stuff, check for yourself.`
}

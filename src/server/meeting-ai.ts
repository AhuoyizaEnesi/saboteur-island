/**
 * What AI players say and how they vote in a meeting.
 *
 * Every wreck leaves a private clue on the server: who was near the spot, and
 * which AI players could actually see the Impostor do it. Each AI player only
 * knows its own clues. One model call per meeting turns those notes into chat
 * lines and votes; the AI Impostor knows what it did and blames someone who
 * was nearby. If the model is unavailable, the same notes drive simple rules,
 * so meetings always happen.
 */

import { generateText } from 'ai'
import { createDeepSpaceAI } from 'deepspace/worker'
import type { Rng } from '../game/placement'
import type { Env } from '../../worker'
import { AGENT_MODEL } from './builder-agent'

export interface MeetingPlayer {
  id: string
  name: string
  isBot: boolean
  alive: boolean
  isImpostor: boolean
}

export interface Clue {
  landmark: string
  at: number
  impostorId: string
  /** Everyone within sight of the spot, the Impostor first. */
  nearby: string[]
  /** AI players who saw the Impostor do it. */
  witnesses: string[]
}

export interface MeetingInput {
  players: MeetingPlayer[]
  clues: Clue[]
  callerName: string
  reason: 'bell' | 'report'
  where: string
  rng: Rng
}

export interface MeetingOutput {
  lines: { playerId: string; text: string }[]
  votes: { playerId: string; targetId: string }[]
  usedModel: boolean
}

/** What one AI player knows, in plain words, and who it suspects. */
export interface Notes {
  lines: string[]
  /** Player id this AI player would vote for, or null to skip. */
  suspect: string | null
  /** True when the suspicion comes from seeing it happen. */
  sure: boolean
}

export function notesFor(bot: MeetingPlayer, input: MeetingInput): Notes {
  const nameOf = (id: string) => input.players.find((p) => p.id === id)?.name ?? 'someone'
  const alive = new Set(input.players.filter((p) => p.alive).map((p) => p.id))
  const clues = [...input.clues].sort((a, b) => b.at - a.at)
  if (bot.isImpostor) {
    // The Impostor blames whoever else was near its latest wreck.
    const last = clues[0]
    const pool = (last?.nearby ?? []).filter((id) => id !== bot.id && alive.has(id))
    const fallback = input.players.filter((p) => p.alive && p.id !== bot.id)
    const target = pool.length ? pool[Math.floor(input.rng() * pool.length)] : fallback[Math.floor(input.rng() * fallback.length)]?.id ?? null
    return {
      lines: last ? [`You wrecked the ${last.landmark}. ${target ? `${nameOf(target)} was nearby, so blame them.` : ''}`] : ['You have not wrecked anything yet.'],
      suspect: target,
      sure: false,
    }
  }
  const lines: string[] = []
  let suspect: string | null = null
  let sure = false
  for (const c of clues) {
    if (c.witnesses.includes(bot.id) && alive.has(c.impostorId)) {
      lines.push(`You saw ${nameOf(c.impostorId)} right at the ${c.landmark} when it got wrecked.`)
      if (!sure) {
        suspect = c.impostorId
        sure = true
      }
    } else if (c.nearby.includes(bot.id)) {
      const others = c.nearby.filter((id) => id !== bot.id && alive.has(id))
      if (others.length) {
        lines.push(`You were near the ${c.landmark} when it got wrecked. Also nearby: ${others.map(nameOf).join(', ')}.`)
        if (!suspect) suspect = others[Math.floor(input.rng() * others.length)]
      }
    }
  }
  if (!lines.length) lines.push('You did not see anything suspicious.')
  return { lines: lines.slice(0, 3), suspect, sure }
}

export async function planMeeting(env: Env, input: MeetingInput): Promise<MeetingOutput> {
  const bots = input.players.filter((p) => p.isBot && p.alive)
  if (!bots.length) return { lines: [], votes: [], usedModel: false }
  const notes = new Map(bots.map((b) => [b.id, notesFor(b, input)]))
  try {
    const out = await modelMeeting(env, input, bots, notes)
    if (out) return out
  } catch (err) {
    console.warn('[meeting-ai] model unavailable, using notes:', err instanceof Error ? err.message : err)
  }
  return heuristicMeeting(input, bots, notes)
}

async function modelMeeting(env: Env, input: MeetingInput, bots: MeetingPlayer[], notes: Map<string, Notes>): Promise<MeetingOutput | null> {
  const anthropic = createDeepSpaceAI(env, 'anthropic')
  const alive = input.players.filter((p) => p.alive)
  const roster = alive.map((p) => `${p.name}${p.isBot ? '' : ' (human)'}`).join(', ')
  const briefs = bots
    .map((b) => {
      const n = notes.get(b.id) as Notes
      const role = b.isImpostor ? 'secretly the Impostor. Never admit it. Sound helpful and push suspicion onto someone else.' : 'crew. Only accuse based on your notes. If your notes are empty, say so and lean toward skipping.'
      return `${b.name}: ${role}\n  Notes: ${n.lines.join(' ')}`
    })
    .join('\n')
  const result = await generateText({
    model: anthropic(AGENT_MODEL),
    system: [
      'You write chat for AI players in Saboteur Island, a party game like a cozy social deduction game.',
      'Crew fix up a floating island before night. One secret Impostor wrecks finished work when nobody is looking.',
      'Write short, casual lines, like friends arguing over a game. Under 18 words each. No emojis, no dashes.',
      'Reply with JSON only: {"lines":[{"name":"","text":""}],"votes":[{"name":"","vote":""}]}',
      'Each AI player writes 1 or 2 lines. A crew player who saw it happen should say so clearly. vote is a living player name or "skip". Nobody votes for themselves.',
    ].join('\n'),
    prompt: [
      `Living players: ${roster}.`,
      input.reason === 'report' ? `${input.callerName} found something wrecked at the ${input.where} and called this meeting.` : `${input.callerName} rang the bell.`,
      'AI players and what each one privately knows:',
      briefs,
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
  const byName = (n: unknown) => (typeof n === 'string' ? input.players.find((p) => p.name.toLowerCase() === n.trim().toLowerCase()) : undefined)
  const lines: MeetingOutput['lines'] = []
  for (const l of parsed.lines ?? []) {
    const p = byName(l.name)
    if (!p || !p.isBot || !p.alive || typeof l.text !== 'string' || !l.text.trim()) continue
    lines.push({ playerId: p.id, text: l.text.replace(/[—–]/g, ',').trim().slice(0, 160) })
  }
  const votes: MeetingOutput['votes'] = []
  for (const bot of bots) {
    const n = notes.get(bot.id) as Notes
    const v = (parsed.votes ?? []).find((x) => byName(x.name)?.id === bot.id)
    const target = v && typeof v.vote === 'string' && v.vote.toLowerCase() === 'skip' ? null : byName(v?.vote)
    // An eyewitness never lets the model talk them out of their vote.
    if (n.sure && n.suspect) votes.push({ playerId: bot.id, targetId: n.suspect })
    else votes.push({ playerId: bot.id, targetId: target && target.alive && target.id !== bot.id ? target.id : 'skip' })
  }
  if (!lines.length) return null
  return { lines: lines.slice(0, 10), votes, usedModel: true }
}

export function heuristicMeeting(input: MeetingInput, bots: MeetingPlayer[], notes = new Map(bots.map((b) => [b.id, notesFor(b, input)]))): MeetingOutput {
  const nameOf = (id: string) => input.players.find((p) => p.id === id)?.name ?? 'someone'
  const lines: MeetingOutput['lines'] = []
  const votes: MeetingOutput['votes'] = []
  const witness = bots.map((b) => ({ b, n: notes.get(b.id) as Notes })).find((x) => !x.b.isImpostor && x.n.sure && x.n.suspect)
  const latest = [...input.clues].sort((a, b) => b.at - a.at)[0]
  for (const bot of bots) {
    const n = notes.get(bot.id) as Notes
    if (bot.isImpostor) {
      // With no wreck to point at, the Impostor plays it safe and skips.
      const t = latest ? n.suspect : null
      lines.push({ playerId: bot.id, text: t && latest ? `I passed the ${latest.landmark} and ${nameOf(t)} was hanging around there. Just saying.` : 'I was busy with my tasks. Did anyone actually see anything?' })
      votes.push({ playerId: bot.id, targetId: t ?? 'skip' })
    } else if (n.sure && n.suspect) {
      lines.push({ playerId: bot.id, text: `I saw ${nameOf(n.suspect)} at the ${latest?.landmark ?? 'landmark'} right when it broke. It was them.` })
      votes.push({ playerId: bot.id, targetId: n.suspect })
    } else if (witness && input.rng() < 0.65) {
      lines.push({ playerId: bot.id, text: `If ${nameOf(witness.b.id)} saw it, I believe them. Voting ${nameOf(witness.n.suspect as string)}.` })
      votes.push({ playerId: bot.id, targetId: witness.n.suspect as string })
    } else if (n.suspect && input.rng() < 0.5) {
      lines.push({ playerId: bot.id, text: `${nameOf(n.suspect)} was near the ${latest?.landmark ?? 'landmark'} too. Kind of suspicious.` })
      votes.push({ playerId: bot.id, targetId: n.suspect })
    } else {
      lines.push({ playerId: bot.id, text: 'I did not see anything. I would rather skip than guess.' })
      votes.push({ playerId: bot.id, targetId: 'skip' })
    }
  }
  return { lines, votes, usedModel: false }
}

/** One reply from an AI player who was named in a human's chat message. */
export async function replyToMention(
  env: Env,
  input: { botName: string; isImpostor: boolean; accuser: string; message: string; alibi: string[] },
): Promise<string> {
  const where = input.alibi.length ? input.alibi.join(' and the ') : 'my tasks'
  try {
    const anthropic = createDeepSpaceAI(env, 'anthropic')
    const result = await generateText({
      model: anthropic(AGENT_MODEL),
      system: [
        `You are ${input.botName}, an AI player in Saboteur Island, a party game where crew fix up an island and one Impostor wrecks things.`,
        input.isImpostor
          ? 'You are secretly the Impostor. Stay calm, give a believable alibi at a landmark, and point suspicion elsewhere. Never admit it.'
          : `You are crew. Your tasks are at the ${where}. Answer honestly.`,
        'Reply with one casual chat line under 18 words. No emojis, no dashes, no quotes.',
      ].join('\n'),
      prompt: `${input.accuser} just said: "${input.message}"`,
    })
    const line = String(result.text || '').split('\n').filter(Boolean)[0]?.replace(/[—–"]/g, '').trim()
    if (line) return line.slice(0, 160)
  } catch (err) {
    console.warn('[meeting-ai] reply fell back:', err instanceof Error ? err.message : err)
  }
  return input.isImpostor ? 'Me? I was at the Well the whole time. Ask who was near the smoke.' : `I was working at the ${where}. You can check my stuff there.`
}

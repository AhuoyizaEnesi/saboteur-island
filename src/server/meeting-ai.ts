/**
 * What AI players say and how they vote in a meeting.
 *
 * Every wreck leaves a private clue on the server: who was near the spot,
 * which AI players could actually see the Impostor do it, and where every
 * player was at that moment. Each AI player only knows its own part: where it
 * was, who was there with it, and what it saw. The AI Impostor knows what it
 * did and picks a fake alibi, which someone who was really there can catch.
 *
 * Three kinds of model call, all with plain fallbacks so meetings never stall:
 * - planMeeting: a few opening lines between the AI players.
 * - replyInMeeting: 1 or 2 replies to each human message, and during voting
 *   a chance for unsure AI players to switch their vote.
 * - planVotes: every AI player's vote when voting opens, after the whole chat.
 */

import { generateText } from 'ai'
import { createDeepSpaceAI } from 'deepspace/worker'
import { LANDMARKS } from '../game/landmarks'
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
  /** Where each player was at that moment: player id to landmark name. */
  places?: Record<string, string>
}

export interface ChatLine {
  playerId: string
  text: string
}

export interface MeetingInput {
  players: MeetingPlayer[]
  clues: Clue[]
  callerName: string
  reason: 'bell' | 'report'
  where: string
  rng: Rng
  /** The meeting's chat so far, oldest first. */
  chat?: ChatLine[]
  /** Where each player was working before the meeting: the landmark of their latest task. */
  workedAt?: Record<string, string>
}

export interface MeetingOutput {
  lines: { playerId: string; text: string }[]
  votes: { playerId: string; targetId: string; firm?: boolean }[]
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

// ─── who the AI players are ──────────────────────────────────────────────────

const STYLES: Record<string, string> = {
  Ada: 'careful, asks people to back up what they say',
  Kai: 'chill and a little jokey, but pays attention',
  Juno: 'quick to suspect people, a bit dramatic',
  Rex: 'blunt, very short sentences',
  Mo: 'friendly, tends to agree with whoever sounds sure',
  Zia: 'sharp, notices when stories do not add up',
}
const styleOf = (name: string) => STYLES[name] ?? 'casual and direct'

/** The island as it really is, so AI players never invent places or tasks from other games. */
const WORLD = [
  `The only places on the island are: ${LANDMARKS.map((l) => l.name).join(', ')}. Never name any other place.`,
  'Tasks here are asking the builder to make things at those places: lanterns, fences, trees, boats, flowers, mushrooms, animals.',
  'Never mention wires, pumps, vents, cranes, cannons, ropes, reactors or any task from another game.',
  'Do not talk about an earlier round or meeting unless the chat already did.',
].join('\n')

const CHAT_STYLE = [
  'Write like real people typing in a game chat. Short, under 16 words. Casual, lowercase is fine, contractions.',
  'React to what was just said. Ask questions back. Defend yourself if accused. Agree or argue with others.',
  'Never formal, never robotic, never mention being an AI. No emojis, no dashes, no hashtags, no quotes.',
].join('\n')

// ─── private notes ───────────────────────────────────────────────────────────

/** A fake alibi for the Impostor: a different landmark from the one it wrecked, stable per wreck. */
function fakePlace(clue: Clue, botId: string): string {
  const options = ['Well', 'Windmill', 'Camp', 'Orchard', 'Lighthouse', 'Dock', 'Red Cottage', 'Blue Cottage'].filter((p) => p !== clue.landmark)
  let h = clue.at
  for (const ch of botId) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return options[h % options.length]
}

export function notesFor(bot: MeetingPlayer, input: MeetingInput): Notes {
  const nameOf = (id: string) => input.players.find((p) => p.id === id)?.name ?? 'someone'
  const alive = new Set(input.players.filter((p) => p.alive).map((p) => p.id))
  const clues = [...input.clues].sort((a, b) => b.at - a.at)
  const last = clues[0]
  if (bot.isImpostor) {
    // The Impostor blames whoever else was near its latest wreck, and claims to have been elsewhere.
    const pool = (last?.nearby ?? []).filter((id) => id !== bot.id && alive.has(id))
    const fallback = input.players.filter((p) => p.alive && p.id !== bot.id)
    const target = pool.length ? pool[Math.floor(input.rng() * pool.length)] : fallback[Math.floor(input.rng() * fallback.length)]?.id ?? null
    return {
      lines: last
        ? [
            `You wrecked the ${last.landmark}. ${target ? `${nameOf(target)} was nearby, so blame them.` : ''}`.trim(),
            `If asked, say you were at the ${fakePlace(last, bot.id)}.`,
          ]
        : [`You have not wrecked anything yet. If asked, say you were working at the ${input.workedAt?.[bot.id] ?? fakePlace({ landmark: '', at: 0 } as Clue, bot.id)}.`],
      suspect: target,
      sure: false,
    }
  }
  const lines: string[] = []
  let suspect: string | null = null
  let sure = false
  // Where this AI player was at the latest wreck, and who was there too.
  const place = last?.places?.[bot.id]
  if (last && place) {
    const company = Object.entries(last.places ?? {})
      .filter(([id, p]) => id !== bot.id && p === place && alive.has(id))
      .map(([id]) => nameOf(id))
    lines.push(`When the ${last.landmark} got wrecked you were at the ${place}${company.length ? ` with ${company.join(', ')}` : ', alone'}.`)
  } else if (input.workedAt?.[bot.id]) {
    lines.push(`Before the meeting you were working on your task at the ${input.workedAt[bot.id]}.`)
  }
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
  return { lines: lines.slice(0, 4), suspect, sure }
}

// ─── reading the chat ────────────────────────────────────────────────────────

const ACCUSE = /\b(sus|suspicious|saw|it was|did it|impostor|imposter|liar|lying|vote|voting|wrecked|weird|sketchy|hanging around|just saying|for sure|guilty|caught|did this)\b/i

/** How strongly the chat points at each player: 1 point per accusing line, more for humans. */
export function chatHeat(input: MeetingInput): Map<string, number> {
  const heat = new Map<string, number>()
  for (const line of input.chat ?? []) {
    if (!ACCUSE.test(line.text)) continue
    const speaker = input.players.find((p) => p.id === line.playerId)
    for (const p of input.players) {
      if (!p.alive || p.id === line.playerId) continue
      if (!new RegExp(`\\b${p.name}\\b`, 'i').test(line.text)) continue
      heat.set(p.id, (heat.get(p.id) ?? 0) + (speaker && !speaker.isBot ? 1.5 : 1))
    }
  }
  return heat
}

/**
 * The chat before a new message. The send action saves the message before
 * asking for replies, so the saved copy is dropped here; otherwise the model
 * reads it twice and answers as if the player repeated themselves.
 */
export function chatBefore(chat: ChatLine[], message: ChatLine): ChatLine[] {
  for (let i = chat.length - 1; i >= 0; i--) {
    if (chat[i].playerId === message.playerId && chat[i].text === message.text) return [...chat.slice(0, i), ...chat.slice(i + 1)]
  }
  return chat
}

function chatLog(input: MeetingInput, max = 16): string {
  const nameOf = (id: string) => input.players.find((p) => p.id === id)?.name ?? 'someone'
  const lines = (input.chat ?? []).slice(-max)
  return lines.length ? lines.map((l) => `${nameOf(l.playerId)}: ${l.text}`).join('\n') : '(nobody has said anything yet)'
}

function briefs(input: MeetingInput, bots: MeetingPlayer[], notes: Map<string, Notes>): string {
  return bots
    .map((b) => {
      const n = notes.get(b.id) as Notes
      const role = b.isImpostor
        ? 'secretly the Impostor. Never admit it. Sound helpful, keep your alibi straight, push suspicion onto someone else.'
        : 'crew. Tell the truth about where you were. Accuse based on your notes or a good argument in chat.'
      return `${b.name} (${styleOf(b.name)}): ${role}\n  Knows: ${n.lines.join(' ')}`
    })
    .join('\n')
}

function parseJson(raw: string): Record<string, unknown> | null {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    return JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>
  } catch {
    return null
  }
}

const clean = (t: string) => t.replace(/[—–]/g, ',').replace(/^["']|["']$/g, '').replace(/\s+/g, ' ').trim().slice(0, 160)

function byNameIn(input: MeetingInput) {
  return (n: unknown) => (typeof n === 'string' ? input.players.find((p) => p.name.toLowerCase() === n.trim().toLowerCase()) : undefined)
}

function sceneLine(input: MeetingInput): string {
  return input.reason === 'report' ? `${input.callerName} found something wrecked at the ${input.where} and called this meeting.` : `${input.callerName} rang the bell.`
}

// ─── opening lines ───────────────────────────────────────────────────────────

export async function planMeeting(env: Env, input: MeetingInput): Promise<MeetingOutput> {
  const bots = input.players.filter((p) => p.isBot && p.alive)
  if (!bots.length) return { lines: [], votes: [], usedModel: false }
  const notes = new Map(bots.map((b) => [b.id, notesFor(b, input)]))
  try {
    const anthropic = createDeepSpaceAI(env, 'anthropic')
    const roster = input.players.filter((p) => p.alive).map((p) => `${p.name}${p.isBot ? '' : ' (human)'}`).join(', ')
    const result = await generateText({
      model: anthropic(AGENT_MODEL),
      system: [
        'You write chat for AI players in Saboteur Island, a cozy social deduction party game.',
        'Crew fix up a floating island before night. One secret Impostor wrecks finished work when nobody is looking.',
        WORLD,
        CHAT_STYLE,
        'Write the first 30 seconds of the meeting as a back and forth between the AI players: 4 to 7 lines, each player 1 or 2 lines.',
        'Players react to each other. A crew player who saw it happen says so clearly. Leave room for the humans to talk.',
        'Reply with JSON only: {"lines":[{"name":"","text":""}]}',
      ].join('\n'),
      prompt: [`Living players: ${roster}.`, sceneLine(input), 'AI players and what each one privately knows:', briefs(input, bots, notes)].join('\n'),
    })
    const parsed = parseJson(String(result.text || ''))
    const byName = byNameIn(input)
    const lines: MeetingOutput['lines'] = []
    for (const l of (parsed?.lines as { name?: string; text?: string }[] | undefined) ?? []) {
      const p = byName(l.name)
      if (!p || !p.isBot || !p.alive || typeof l.text !== 'string' || !l.text.trim()) continue
      lines.push({ playerId: p.id, text: clean(l.text) })
    }
    if (lines.length) return { lines: lines.slice(0, 8), votes: [], usedModel: true }
  } catch (err) {
    console.warn('[meeting-ai] opening fell back:', err instanceof Error ? err.message : err)
  }
  return heuristicMeeting(input, bots, notes)
}

// ─── replies to people ───────────────────────────────────────────────────────

export interface ReplyOutput {
  lines: { playerId: string; text: string }[]
  /** During voting: unsure AI players who change their vote. */
  switches: { playerId: string; targetId: string }[]
  usedModel: boolean
}

/** The AI player a message is talking to: named, or the last AI who spoke if the message says "you". */
export function addressedBot(input: MeetingInput, message: ChatLine): MeetingPlayer | null {
  const bots = input.players.filter((p) => p.isBot && p.alive)
  const named = bots.find((b) => new RegExp(`\\b${b.name}\\b`, 'i').test(message.text))
  if (named) return named
  if (/\b(you|u|ur|your)\b/i.test(message.text)) {
    const before = (input.chat ?? []).filter((l) => l.playerId !== message.playerId)
    const lastBot = [...before].reverse().find((l) => bots.some((b) => b.id === l.playerId))
    if (lastBot) return bots.find((b) => b.id === lastBot.playerId) ?? null
  }
  return null
}

export async function replyInMeeting(
  env: Env,
  input: MeetingInput,
  message: ChatLine,
  opts: { voting: boolean; votes: { playerId: string; targetId: string; firm?: boolean }[] },
): Promise<ReplyOutput> {
  const bots = input.players.filter((p) => p.isBot && p.alive)
  if (!bots.length) return { lines: [], switches: [], usedModel: false }
  const notes = new Map(bots.map((b) => [b.id, notesFor(b, input)]))
  const speaker = input.players.find((p) => p.id === message.playerId)
  const target = addressedBot(input, message)
  const nameOf = (id: string) => input.players.find((p) => p.id === id)?.name ?? 'skip'
  // The AI player who spoke last lets someone else answer, unless the message is for them.
  const history = chatBefore(input.chat ?? [], message)
  const lastId = [...history].reverse().find((l) => bots.some((b) => b.id === l.playerId))?.playerId
  const last = lastId && lastId !== target?.id ? bots.find((b) => b.id === lastId) : undefined
  try {
    const anthropic = createDeepSpaceAI(env, 'anthropic')
    const voteLines = opts.voting
      ? `Current AI votes: ${bots.map((b) => {
          const v = opts.votes.find((x) => x.playerId === b.id)
          return `${b.name} votes ${v ? nameOf(v.targetId) : 'skip'}${v?.firm ? ' (saw it, will not change)' : ''}`
        }).join('; ')}.`
      : ''
    const result = await generateText({
      model: anthropic(AGENT_MODEL),
      system: [
        'You write chat replies for AI players in Saboteur Island, a cozy social deduction party game.',
        WORLD,
        CHAT_STYLE,
        'A human just said something in the meeting. Write 1 or 2 replies from AI players.',
        target ? `The message is aimed at ${target.name}, so ${target.name} must answer it directly, using what they know.` : 'Pick the AI player with the most reason to answer. A second player may jump in.',
        last ? `${last.name} spoke last, so ${last.name} does not reply this time.` : '',
        'Each AI player speaks at most once.',
        'Answer the actual question. If asked where you were, give your place. If accused, defend yourself or push back.',
        opts.voting
          ? 'Voting is open. If the human makes a convincing case, AI players who are not sure may switch their vote. Add "switch":[{"name":"","vote":""}] with a living player name or "skip". Only switch when the argument is good.'
          : '',
        'Reply with JSON only: {"lines":[{"name":"","text":""}]' + (opts.voting ? ',"switch":[]' : '') + '}',
      ]
        .filter(Boolean)
        .join('\n'),
      prompt: [
        `Living players: ${input.players.filter((p) => p.alive).map((p) => `${p.name}${p.isBot ? '' : ' (human)'}`).join(', ')}.`,
        sceneLine(input),
        'AI players and what each one privately knows:',
        briefs(input, bots, notes),
        voteLines,
        'Chat so far:',
        chatLog({ ...input, chat: chatBefore(input.chat ?? [], message) }),
        `New message from ${speaker?.name ?? 'someone'}: ${message.text}`,
      ]
        .filter(Boolean)
        .join('\n'),
    })
    const parsed = parseJson(String(result.text || ''))
    const byName = byNameIn(input)
    const lines: ReplyOutput['lines'] = []
    for (const l of (parsed?.lines as { name?: string; text?: string }[] | undefined) ?? []) {
      const p = byName(l.name)
      if (!p || !p.isBot || !p.alive || typeof l.text !== 'string' || !l.text.trim()) continue
      if (lines.some((x) => x.playerId === p.id)) continue
      lines.push({ playerId: p.id, text: clean(l.text) })
    }
    if (last && lines.length > 1) lines.splice(0, lines.length, ...lines.filter((l) => l.playerId !== last.id))
    // The player who was spoken to always answers.
    if (target && !lines.some((l) => l.playerId === target.id)) lines.unshift({ playerId: target.id, text: fallbackReply(target, input, message, notes.get(target.id) as Notes) })
    const switches: ReplyOutput['switches'] = []
    if (opts.voting) {
      for (const sw of (parsed?.switch as { name?: string; vote?: string }[] | undefined) ?? []) {
        const p = byName(sw.name)
        if (!p || !p.isBot || !p.alive) continue
        if (opts.votes.find((v) => v.playerId === p.id)?.firm) continue
        const to = typeof sw.vote === 'string' && sw.vote.toLowerCase() === 'skip' ? null : byName(sw.vote)
        if (to && (!to.alive || to.id === p.id)) continue
        switches.push({ playerId: p.id, targetId: to ? to.id : 'skip' })
      }
    }
    if (lines.length) return { lines: lines.slice(0, 2), switches, usedModel: true }
  } catch (err) {
    console.warn('[meeting-ai] reply fell back:', err instanceof Error ? err.message : err)
  }
  return heuristicReply(input, message, opts, notes)
}

const pick = <T,>(list: T[], rng: Rng): T => list[Math.floor(rng() * list.length)]

function fallbackReply(bot: MeetingPlayer, input: MeetingInput, message: ChatLine, n: Notes): string {
  const last = [...input.clues].sort((a, b) => b.at - a.at)[0]
  const accused = new RegExp(`\\b${bot.name}\\b`, 'i').test(message.text) && ACCUSE.test(message.text)
  const where = bot.isImpostor ? (last ? fakePlace(last, bot.id) : null) : last?.places?.[bot.id] ?? null
  if (accused) {
    return where
      ? pick([`me? nah, i was at the ${where} the whole time`, `wasnt me, i was at the ${where}. ask around`, `why me? i was at the ${where}`], input.rng)
      : pick(['me? i was just doing my tasks', 'wasnt me lol, i was busy building', 'why me? i havent even been near anything'], input.rng)
  }
  if (!bot.isImpostor && n.sure && n.suspect) return `i literally saw ${input.players.find((p) => p.id === n.suspect)?.name} do it`
  return where
    ? pick([`i was at the ${where}. didnt see who did it`, `over at the ${where}, nothing weird there`, `${where}. you?`], input.rng)
    : pick(['honestly i didnt see anything', 'nothing on my side yet', 'just doing tasks, havent seen anything'], input.rng)
}

export function heuristicReply(
  input: MeetingInput,
  message: ChatLine,
  opts: { voting: boolean; votes: { playerId: string; targetId: string; firm?: boolean }[] },
  notes = new Map(input.players.filter((p) => p.isBot && p.alive).map((b) => [b.id, notesFor(b, input)])),
): ReplyOutput {
  const bots = input.players.filter((p) => p.isBot && p.alive)
  const target = addressedBot(input, message) ?? bots[Math.floor(input.rng() * bots.length)]
  if (!target) return { lines: [], switches: [], usedModel: false }
  const lines = [{ playerId: target.id, text: fallbackReply(target, input, message, notes.get(target.id) as Notes) }]
  const switches: ReplyOutput['switches'] = []
  if (opts.voting && ACCUSE.test(message.text)) {
    // A human pointing at someone can pull unsure AI players who were skipping.
    const accused = input.players.find((p) => p.alive && p.id !== message.playerId && new RegExp(`\\b${p.name}\\b`, 'i').test(message.text))
    if (accused) {
      for (const b of bots) {
        const v = opts.votes.find((x) => x.playerId === b.id)
        if (v?.firm || b.id === accused.id || (v && v.targetId !== 'skip')) continue
        if (input.rng() < 0.5) switches.push({ playerId: b.id, targetId: accused.id })
      }
    }
  }
  return { lines, switches, usedModel: false }
}

// ─── votes ───────────────────────────────────────────────────────────────────

export async function planVotes(env: Env, input: MeetingInput): Promise<MeetingOutput['votes']> {
  const bots = input.players.filter((p) => p.isBot && p.alive)
  if (!bots.length) return []
  const notes = new Map(bots.map((b) => [b.id, notesFor(b, input)]))
  const firmOf = (b: MeetingPlayer) => {
    const n = notes.get(b.id) as Notes
    return !b.isImpostor && n.sure && n.suspect ? n.suspect : null
  }
  try {
    const anthropic = createDeepSpaceAI(env, 'anthropic')
    const result = await generateText({
      model: anthropic(AGENT_MODEL),
      system: [
        'You decide votes for AI players in Saboteur Island, a social deduction party game. The player with the most votes is ejected.',
        'Crew vote for whoever has the strongest case from their notes and the chat: an eyewitness, someone two players accuse, someone whose story does not add up.',
        'Crew skip only when there is really nothing to go on. The Impostor votes for whoever the crew suspects most, never itself.',
        'Nobody votes for themselves. Reply with JSON only: {"votes":[{"name":"","vote":""}]} where vote is a living player name or "skip".',
      ].join('\n'),
      prompt: [sceneLine(input), 'AI players and what each one privately knows:', briefs(input, bots, notes), 'The whole chat:', chatLog(input, 40)].join('\n'),
    })
    const parsed = parseJson(String(result.text || ''))
    const byName = byNameIn(input)
    const votes: MeetingOutput['votes'] = []
    for (const bot of bots) {
      const firm = firmOf(bot)
      if (firm) {
        votes.push({ playerId: bot.id, targetId: firm, firm: true })
        continue
      }
      const v = ((parsed?.votes as { name?: string; vote?: string }[] | undefined) ?? []).find((x) => byName(x.name)?.id === bot.id)
      const to = v && typeof v.vote === 'string' && v.vote.toLowerCase() === 'skip' ? null : byName(v?.vote)
      votes.push({ playerId: bot.id, targetId: to && to.alive && to.id !== bot.id ? to.id : 'skip' })
    }
    if (parsed?.votes) return votes
  } catch (err) {
    console.warn('[meeting-ai] votes fell back:', err instanceof Error ? err.message : err)
  }
  return heuristicVotes(input, bots, notes)
}

/** Votes without the model: eyewitnesses, then whoever the chat and clues point at. */
export function heuristicVotes(input: MeetingInput, bots: MeetingPlayer[], notes = new Map(bots.map((b) => [b.id, notesFor(b, input)]))): MeetingOutput['votes'] {
  const heat = chatHeat(input)
  const witness = bots.map((b) => ({ b, n: notes.get(b.id) as Notes })).find((x) => !x.b.isImpostor && x.n.sure && x.n.suspect)
  if (witness?.n.suspect) heat.set(witness.n.suspect, (heat.get(witness.n.suspect) ?? 0) + 2)
  const hottest = (exclude: string) =>
    [...heat.entries()].filter(([id, h]) => id !== exclude && h >= 2 && input.players.some((p) => p.id === id && p.alive)).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
  return bots.map((bot) => {
    const n = notes.get(bot.id) as Notes
    if (!bot.isImpostor && n.sure && n.suspect) return { playerId: bot.id, targetId: n.suspect, firm: true }
    if (bot.isImpostor) {
      const pile = hottest(bot.id)
      const pick = pile ?? (input.clues.length ? n.suspect : null)
      return { playerId: bot.id, targetId: pick && pick !== bot.id ? pick : 'skip' }
    }
    const pick = hottest(bot.id) ?? (n.suspect && input.rng() < 0.5 ? n.suspect : null)
    return { playerId: bot.id, targetId: pick ?? 'skip' }
  })
}

/** Opening lines and votes without the model, from each AI player's notes. */
export function heuristicMeeting(input: MeetingInput, bots: MeetingPlayer[], notes = new Map(bots.map((b) => [b.id, notesFor(b, input)]))): MeetingOutput {
  const nameOf = (id: string) => input.players.find((p) => p.id === id)?.name ?? 'someone'
  const lines: MeetingOutput['lines'] = []
  const witness = bots.map((b) => ({ b, n: notes.get(b.id) as Notes })).find((x) => !x.b.isImpostor && x.n.sure && x.n.suspect)
  const latest = [...input.clues].sort((a, b) => b.at - a.at)[0]
  for (const bot of bots) {
    const n = notes.get(bot.id) as Notes
    if (bot.isImpostor) {
      // With no wreck to point at, the Impostor plays it safe.
      const t = latest ? n.suspect : null
      lines.push({ playerId: bot.id, text: t && latest ? `i passed the ${latest.landmark} and ${nameOf(t)} was hanging around there. just saying` : 'i was busy with my tasks. did anyone actually see anything?' })
    } else if (n.sure && n.suspect) {
      lines.push({ playerId: bot.id, text: `i saw ${nameOf(n.suspect)} at the ${latest?.landmark ?? 'landmark'} right when it broke. it was them` })
    } else if (witness && input.rng() < 0.65) {
      lines.push({ playerId: bot.id, text: `if ${nameOf(witness.b.id)} saw it im with them. ${nameOf(witness.n.suspect as string)}?` })
    } else if (n.suspect && input.rng() < 0.5) {
      lines.push({ playerId: bot.id, text: `${nameOf(n.suspect)} was near the ${latest?.landmark ?? 'landmark'} too. kinda sus` })
    } else {
      const where = latest?.places?.[bot.id]
      lines.push({
        playerId: bot.id,
        text: where
          ? pick([`i was at the ${where}, didnt see anything. who was near it?`, `nothing at the ${where}. who was close to it?`], input.rng)
          : pick(['didnt see anything. anyone got real info?', 'why are we here? who saw something?', 'i got nothing. anyone?', 'all quiet on my side'], input.rng),
      })
    }
  }
  return { lines, votes: heuristicVotes(input, bots, notes), usedModel: false }
}

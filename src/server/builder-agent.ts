/**
 * The builder agent. It reads one player's order and answers with tool calls
 * from a fixed catalog. Tool calls only propose: placement is decided here on
 * the server by src/game/placement.ts, so the model never picks raw
 * coordinates, never writes code, and can never place something off the
 * island or outside the catalog.
 *
 * If the model is unavailable, a keyword parser handles the order instead, so
 * the game never stalls on an AI outage.
 */

import { generateText, stepCountIs, tool } from 'ai'
import { z } from 'zod/v4'
import { createDeepSpaceAI } from 'deepspace/worker'
import { BUILD_TYPES, CATALOG, normalizeBuildType, pluralLabel, type BuildType } from '../game/catalog'
import { GOAL_TEXT, MAX_BUILDS_PER_ORDER, type TimeOfDay, type Weather } from '../game/constants'
import { placeOne, type PlacedLike, type Placement, type Rng } from '../game/placement'
import { describeOps } from '../game/rules'
import type { EnvChange } from '../game/types'
import type { Env } from '../../worker'

export const AGENT_MODEL = 'claude-haiku-5-5'

const TIMES: TimeOfDay[] = ['dawn', 'day', 'sunset', 'night']
const WEATHERS: Weather[] = ['clear', 'rain', 'snow', 'fog', 'fireflies']

export interface AgentResult {
  placements: Placement[]
  env: EnvChange
  narration: string
  usedModel: boolean
}

interface AgentInput {
  text: string
  playerName: string
  existing: PlacedLike[]
  rng: Rng
  /** Builds still allowed in this game before the island is full. */
  capacity: number
}

class Builder {
  placements: Placement[] = []
  env: EnvChange = {}
  log: { type: BuildType; count: number }[] = []
  constructor(private input: AgentInput) {}

  get room() {
    return Math.min(MAX_BUILDS_PER_ORDER - this.placements.length, this.input.capacity - this.placements.length)
  }

  place(rawType: unknown, rawCount: unknown, near?: unknown, scale?: unknown): number {
    const type = normalizeBuildType(rawType)
    if (!type) throw new Error(`Unknown type. Use one of: ${BUILD_TYPES.join(', ')}`)
    const count = Math.max(1, Math.min(8, Math.round(Number(rawCount) || 1), this.room))
    if (count <= 0) throw new Error('No room left for more objects in this order.')
    for (let i = 0; i < count; i++) {
      const p = placeOne(
        { type, near, scale: typeof scale === 'number' ? scale : undefined },
        [...this.input.existing, ...this.placements],
        this.input.rng,
      )
      this.placements.push(p)
    }
    const last = this.log[this.log.length - 1]
    if (last && last.type === type) last.count += count
    else this.log.push({ type, count })
    return count
  }
}

function catalogLines(): string {
  return BUILD_TYPES.map((t) => `- ${t}: ${(CATALOG as Record<string, { hint: string }>)[t].hint}`).join('\n')
}

function summarize(existing: PlacedLike[]): string {
  const counts: Record<string, number> = {}
  for (const b of existing) counts[b.type] = (counts[b.type] ?? 0) + 1
  const list = Object.entries(counts).map(([k, v]) => `${v} ${k}`)
  return list.length ? list.join(', ') : 'only wild trees and rocks'
}

export async function runBuilderAgent(env: Env, input: AgentInput): Promise<AgentResult> {
  const builder = new Builder(input)
  try {
    const anthropic = createDeepSpaceAI(env, 'anthropic')
    const result = await generateText({
      model: anthropic(AGENT_MODEL),
      stopWhen: stepCountIs(6),
      system: [
        'You are the builder agent in Saboteur Island, a multiplayer game on a small floating island.',
        'Players send you short orders. You build them only by calling tools. The server decides exact positions.',
        `The shared goal is: ${GOAL_TEXT}.`,
        'Follow each order literally, even if it does not fit the goal. Never judge, refuse or question a player. Never reveal or guess who might be lying.',
        'If something is not in the catalog, build the closest catalog items instead.',
        `Place at most ${MAX_BUILDS_PER_ORDER} objects per order.`,
        'When done, reply with one plain sentence under 16 words saying what you built. No emojis, no dashes.',
        '',
        'Catalog:',
        catalogLines(),
      ].join('\n'),
      prompt: `Island right now: ${summarize(input.existing)}.\nOrder from ${input.playerName}: "${input.text}"`,
      tools: {
        place_object: tool({
          description:
            'Place one or more objects of a single catalog type. Use near to cluster them by another type, or by pond, edge or center.',
          inputSchema: z.object({
            type: z.enum(BUILD_TYPES as [BuildType, ...BuildType[]]),
            count: z.number().int().min(1).max(8).optional(),
            near: z.string().max(40).optional(),
            scale: z.number().min(0.5).max(2).optional(),
          }),
          execute: async ({ type, count, near, scale }) => {
            const placed = builder.place(type, count ?? 1, near, scale)
            return { placed, roomLeftThisOrder: builder.room }
          },
        }),
        set_time_of_day: tool({
          description: 'Change the light on the island.',
          inputSchema: z.object({ time: z.enum(TIMES as [TimeOfDay, ...TimeOfDay[]]) }),
          execute: async ({ time }) => {
            builder.env.timeOfDay = time
            return { ok: true }
          },
        }),
        set_weather: tool({
          description: 'Change the weather. fireflies adds glowing fireflies. clear removes everything.',
          inputSchema: z.object({ weather: z.enum(WEATHERS as [Weather, ...Weather[]]) }),
          execute: async ({ weather }) => {
            builder.env.weather = weather
            return { ok: true }
          },
        }),
      },
    })
    const line = String(result.text || '')
      .trim()
      .split('\n')
      .filter(Boolean)
      .pop()
    const narration = cleanLine(line) || describeOps(builder.log)
    return { placements: builder.placements, env: builder.env, narration, usedModel: true }
  } catch (err) {
    console.warn('[builder-agent] model unavailable, using keyword builder:', err instanceof Error ? err.message : err)
    // Keep anything the model already placed, then let the parser fill in.
    if (!builder.placements.length && !builder.env.timeOfDay && !builder.env.weather) {
      return keywordBuilder(input)
    }
    return { placements: builder.placements, env: builder.env, narration: describeOps(builder.log), usedModel: true }
  }
}

function cleanLine(s: string | undefined): string {
  if (!s) return ''
  return s.replace(/[—–]/g, ',').replace(/\s+/g, ' ').slice(0, 160).trim()
}

const NUMS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  couple: 2, few: 3, some: 3, several: 4, many: 6, lots: 6, bunch: 5,
}

const WORD_TO_TYPE: Record<string, BuildType> = {}
for (const t of BUILD_TYPES) for (const w of (CATALOG as Record<string, { words: string[] }>)[t].words) WORD_TO_TYPE[w] = t

/** Offline fallback: understands counts, object words, time and weather. */
export function keywordBuilder(input: AgentInput): AgentResult {
  const builder = new Builder(input)
  const s = input.text.toLowerCase()
  const words = s.replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean)
  const notes: string[] = []
  if (/\bnight|midnight/.test(s)) builder.env.timeOfDay = 'night'
  else if (/sunset|dusk|evening/.test(s)) builder.env.timeOfDay = 'sunset'
  else if (/dawn|sunrise|morning/.test(s)) builder.env.timeOfDay = 'dawn'
  else if (/\bday\b|daytime|noon/.test(s)) builder.env.timeOfDay = 'day'
  if (/rain|storm/.test(s)) builder.env.weather = 'rain'
  else if (/snow|winter/.test(s)) builder.env.weather = 'snow'
  else if (/\bfog|mist/.test(s)) builder.env.weather = 'fog'
  else if (/firefl/.test(s)) builder.env.weather = 'fireflies'
  else if (/clear sky|stop the rain|stop raining/.test(s)) builder.env.weather = 'clear'
  if (builder.env.timeOfDay) notes.push(`set the sky to ${builder.env.timeOfDay}`)
  if (builder.env.weather) notes.push(`made it ${builder.env.weather}`)

  const near = /edge|cliff|shore/.test(s) ? 'edge' : /middle|center|hill/.test(s) ? 'center' : /pond|water|lake/.test(s) ? 'pond' : undefined
  const seen = new Set<BuildType>()
  for (let i = 0; i < words.length; i++) {
    const t = WORD_TO_TYPE[words[i]]
    if (!t || seen.has(t)) continue
    seen.add(t)
    let n: number | null = null
    for (let b = 1; b <= 2; b++) {
      const w = words[i - b]
      if (!w) break
      if (/^\d+$/.test(w)) {
        n = parseInt(w, 10)
        break
      }
      if (NUMS[w] !== undefined) {
        n = NUMS[w]
        break
      }
    }
    if (n === null) n = words[i] === 'village' ? 3 : /s$/.test(words[i]) && t !== 'sheep' ? 3 : 1
    if (builder.room <= 0) break
    const placed = builder.place(t, n, (CATALOG as Record<string, { water?: boolean }>)[t].water ? undefined : near)
    notes.push(`placed ${pluralLabel(t, placed)}`)
  }
  const narration = notes.length
    ? (notes.join(', ').replace(/, ([^,]*)$/, ' and $1').replace(/^./, (c) => c.toUpperCase()) + '.')
    : 'Nothing in that order matched something I can build.'
  return { placements: builder.placements, env: builder.env, narration, usedModel: false }
}

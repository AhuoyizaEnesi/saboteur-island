/**
 * The builder agent. A player standing at a landmark types an order; the
 * agent answers only with tool calls from a fixed catalog and a fixed color
 * list. Tool calls only propose: the server decides exact spots with
 * src/game/tasks.ts, so the model never picks coordinates, never writes code,
 * and can never put something off the island.
 *
 * The same agent runs in wreck mode for the Impostor. There it can only knock
 * over, paint or take away things that already stand at the landmark.
 *
 * The agent never sees anyone's task list or role. It follows orders
 * literally, so it cannot quietly help or hurt anyone.
 *
 * If the model is unavailable, a keyword parser handles the order instead, so
 * the game never stalls on an AI outage.
 */

import { generateText, stepCountIs, tool } from 'ai'
import { z } from 'zod/v4'
import { createDeepSpaceAI } from 'deepspace/worker'
import { BUILD_TYPES, CATALOG, COLOR_NAMES, normalizeBuildType, normalizeColor, pluralLabel, type BuildType, type ColorName } from '../game/catalog'
import { GUESS_RATE, MAX_ITEMS_PER_ORDER } from '../game/constants'
import type { Env } from '../../worker'

export const AGENT_MODEL = 'claude-haiku-5-5'

export interface BuildItem {
  type: BuildType
  color: ColorName | null
}

export interface BuildPlan {
  items: BuildItem[]
  narration: string
  usedModel: boolean
}

export interface WreckTarget {
  id: string
  type: string
  colorName: string
}

export type WreckKind = 'knock' | 'paint' | 'remove'

export interface WreckAct {
  targetId: string
  kind: WreckKind
  color: ColorName
}

export interface WreckPlan {
  acts: WreckAct[]
  narration: string
  usedModel: boolean
}

const catalogLines = () => BUILD_TYPES.map((t) => `- ${t}: ${(CATALOG as Record<string, { hint: string }>)[t].hint}`).join('\n')
const nice = (type: string) => type.replace('_', ' ')

function cleanLine(s: string | undefined): string {
  if (!s) return ''
  return s.replace(/[—–]/g, ',').replace(/\s+/g, ' ').slice(0, 160).trim()
}

function lastLine(text: string | undefined): string {
  return cleanLine(String(text || '').trim().split('\n').filter(Boolean).pop())
}

// ─── build mode ──────────────────────────────────────────────────────────────

class ItemList {
  items: BuildItem[] = []
  constructor(private cap: number) {}
  get room() {
    return Math.max(0, Math.min(MAX_ITEMS_PER_ORDER, this.cap) - this.items.length)
  }
  add(type: BuildType, color: ColorName | null, count: number): number {
    const n = Math.max(0, Math.min(Math.round(count) || 1, this.room))
    for (let i = 0; i < n; i++) this.items.push({ type, color })
    return n
  }
}

export function describeItems(items: BuildItem[]): string {
  if (!items.length) return 'Nothing in that order matched something I can build.'
  const groups: { type: BuildType; color: ColorName | null; n: number }[] = []
  for (const it of items) {
    const g = groups.find((x) => x.type === it.type && x.color === it.color)
    if (g) g.n++
    else groups.push({ ...it, n: 1 })
  }
  const parts = groups.map((g) => {
    const label = pluralLabel(g.type, g.n)
    return g.color ? label.replace(/^(a|\d+) /, (m) => `${m}${g.color} `) : label
  })
  const line = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0]
  return `Built ${line}.`
}

export async function runBuilderAgent(
  env: Env,
  input: { text: string; landmarkName: string; here: string[]; capacity: number },
): Promise<BuildPlan> {
  const list = new ItemList(input.capacity)
  try {
    const anthropic = createDeepSpaceAI(env, 'anthropic')
    const result = await generateText({
      model: anthropic(AGENT_MODEL),
      stopWhen: stepCountIs(4),
      system: [
        'You are the builder in Saboteur Island, a party game on a small floating island.',
        'A player stands at one landmark and gives you a short order. You build it only by calling place_object.',
        'Everything you place goes at that landmark; the server picks the exact spot.',
        'Follow the order literally. Never judge, refuse, add extras or question the player.',
        'If something is not in the catalog, use the closest catalog item. Only use colors from the color list.',
        `Place at most ${MAX_ITEMS_PER_ORDER} objects. If the order says how many, place exactly that many. If it does not, place one.`,
        'Only give a color when the order names one.',
        'When done, reply with one plain sentence under 14 words saying what you built. No emojis, no dashes.',
        '',
        `Colors: ${COLOR_NAMES.join(', ')}`,
        'Catalog:',
        catalogLines(),
      ].join('\n'),
      prompt: `Landmark: ${input.landmarkName}. Already here: ${input.here.length ? input.here.join(', ') : 'nothing yet'}.\nOrder: "${input.text}"`,
      tools: {
        place_object: tool({
          description: 'Place one or more objects of one catalog type at this landmark, optionally in one color.',
          inputSchema: z.object({
            type: z.enum(BUILD_TYPES as [BuildType, ...BuildType[]]),
            color: z.enum(COLOR_NAMES as [ColorName, ...ColorName[]]).optional(),
            count: z.number().int().min(1).max(MAX_ITEMS_PER_ORDER).optional(),
          }),
          execute: async ({ type, color, count }) => {
            const placed = list.add(type, color ?? null, count ?? 1)
            return { placed, roomLeft: list.room }
          },
        }),
      },
    })
    if (!list.items.length) return keywordBuild(input)
    return { items: list.items, narration: lastLine(result.text) || describeItems(list.items), usedModel: true }
  } catch (err) {
    console.warn('[builder] model unavailable, using keyword builder:', err instanceof Error ? err.message : err)
    if (list.items.length) return { items: list.items, narration: describeItems(list.items), usedModel: true }
    return keywordBuild(input)
  }
}

const NUMS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, couple: 2, few: 3, some: 2, pair: 2 }
const WORD_TO_TYPE: Record<string, BuildType> = {}
for (const t of BUILD_TYPES) for (const w of (CATALOG as Record<string, { words: string[] }>)[t].words) WORD_TO_TYPE[w] = t
const MULTI: [RegExp, BuildType][] = [
  [/\bfruit tree|apple tree|round tree|oak\b/, 'round_tree'],
  [/\bpine tree|fir tree|christmas tree\b/, 'pine_tree'],
  [/\bbee ?hive\b/, 'beehive'],
  [/\bcamp ?fire|bon ?fire\b/, 'campfire'],
]

/** Offline fallback: understands counts, colors and object words. */
export function keywordBuild(input: { text: string; capacity: number }): BuildPlan {
  const list = new ItemList(input.capacity)
  const s = input.text.toLowerCase()
  const words = s.replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean)
  const seen = new Set<BuildType>()
  const found: { type: BuildType; at: number }[] = []
  for (const [re, t] of MULTI) {
    const m = re.exec(s)
    if (m) {
      found.push({ type: t, at: s.slice(0, m.index).split(/\s+/).filter(Boolean).length })
      seen.add(t)
    }
  }
  words.forEach((w, i) => {
    const t = WORD_TO_TYPE[w]
    if (t && !seen.has(t) && !(t === 'pine_tree' && seen.has('round_tree'))) {
      seen.add(t)
      found.push({ type: t, at: i })
    }
  })
  found.sort((a, b) => a.at - b.at)
  for (const f of found) {
    let n = 1
    let color: ColorName | null = null
    for (let b = 1; b <= 3; b++) {
      const w = words[f.at - b]
      if (!w) break
      if (/^\d+$/.test(w)) n = parseInt(w, 10)
      else if (NUMS[w] !== undefined) n = NUMS[w]
      const c = normalizeColor(w)
      if (c && !color) color = c
    }
    list.add(f.type, color, n)
    if (!list.room) break
  }
  return { items: list.items, narration: describeItems(list.items), usedModel: false }
}

// ─── vague prompts ───────────────────────────────────────────────────────────

const COUNT_WORDS = /\b(\d+|a|an|one|two|three|four|single|pair|couple|both)\b/
const VAGUE_WORDS = /\b(some|few|several|many|lots|bunch|multiple)\b/

/** Did the prompt name a color? */
export function saidColor(text: string): boolean {
  return text.toLowerCase().split(/[^a-z]+/).some((w) => normalizeColor(w) !== null)
}

/** Did the prompt say how many? "some ducks" and "a few" do not count. */
export function saidCount(text: string): boolean {
  const s = text.toLowerCase()
  return COUNT_WORDS.test(s) && !VAGUE_WORDS.test(s)
}

export interface TaskNeed {
  type: BuildType
  color?: ColorName
  count?: number
}

export interface Guess {
  type: BuildType
  color?: ColorName
  count?: number
}

/**
 * When a prompt leaves out a detail one of the player's tasks here needs, the
 * builder fills the gap itself, like a model making something up. The guess
 * matches the task GUESS_RATE of the time. Specific prompts are left alone.
 */
export function fillGaps(items: BuildItem[], needs: TaskNeed[], text: string, rng: () => number): { items: BuildItem[]; guessed: Guess[] } {
  const colorSaid = saidColor(text)
  const countSaid = saidCount(text)
  let out = items.slice()
  const guessed: Guess[] = []
  for (const need of needs) {
    const mine = out.filter((it) => it.type === need.type)
    if (!mine.length) continue
    const g: Guess = { type: need.type }
    let color = mine[0].color
    if (need.color && !colorSaid) {
      const others = COLOR_NAMES.filter((c) => c !== need.color)
      color = rng() < GUESS_RATE ? need.color : others[Math.floor(rng() * others.length)]
      g.color = color
    }
    let n = mine.length
    const want = need.count ?? 1
    if (want > 1 && !countSaid) {
      const others = [1, 2, 3, 4].filter((k) => k !== want)
      n = rng() < GUESS_RATE ? want : others[Math.floor(rng() * others.length)]
      g.count = n
    }
    if (g.color === undefined && g.count === undefined) continue
    out = [...out.filter((it) => it.type !== need.type), ...Array.from({ length: n }, () => ({ type: need.type, color }))]
    guessed.push(g)
  }
  return { items: out.slice(0, MAX_ITEMS_PER_ORDER), guessed }
}

// ─── wreck mode ──────────────────────────────────────────────────────────────

function describeWreck(acts: WreckAct[], targets: WreckTarget[]): string {
  if (!acts.length) return 'Nothing here was touched.'
  const name = (id: string) => nice(targets.find((t) => t.id === id)?.type ?? 'thing')
  const verb = (a: WreckAct) => (a.kind === 'knock' ? `Knocked over the ${name(a.targetId)}` : a.kind === 'paint' ? `Painted the ${name(a.targetId)} ${a.color}` : `Took away the ${name(a.targetId)}`)
  return acts.map(verb).join(' and ') + '.'
}

/** A quick wreck from a button: no model call. */
export function quickWreck(kind: WreckKind, targets: WreckTarget[]): WreckPlan {
  const t = targets[0]
  if (!t) return { acts: [], narration: 'There is nothing here to wreck.', usedModel: false }
  const acts: WreckAct[] = [{ targetId: t.id, kind, color: 'black' }]
  return { acts, narration: describeWreck(acts, targets), usedModel: false }
}

export async function runWreckAgent(env: Env, input: { text: string; landmarkName: string; targets: WreckTarget[] }): Promise<WreckPlan> {
  const acts: WreckAct[] = []
  const targets = input.targets
  if (!targets.length) return { acts, narration: 'There is nothing here to wreck.', usedModel: false }
  const ids = targets.map((t) => t.id) as [string, ...string[]]
  const pushAct = (a: WreckAct) => {
    if (acts.length >= 2 || acts.some((x) => x.targetId === a.targetId)) return false
    acts.push(a)
    return true
  }
  try {
    const anthropic = createDeepSpaceAI(env, 'anthropic')
    const result = await generateText({
      model: anthropic(AGENT_MODEL),
      stopWhen: stepCountIs(3),
      system: [
        'You are the builder in Saboteur Island. This player wants to mess something up at a landmark.',
        'You can only knock over, paint, or take away things already standing here, by calling one tool per thing.',
        'Pick the thing the order points at; if it is unclear, pick the first one listed. Change at most 2 things.',
        'Reply with one plain sentence under 12 words saying what you did. No emojis, no dashes.',
        `Colors: ${COLOR_NAMES.join(', ')}`,
      ].join('\n'),
      prompt: `Landmark: ${input.landmarkName}. Things here:\n${targets.map((t) => `- ${t.id}: ${t.colorName ? `${t.colorName} ` : ''}${nice(t.type)}`).join('\n')}\nOrder: "${input.text}"`,
      tools: {
        knock_over: tool({
          description: 'Knock a thing over so it lies on its side.',
          inputSchema: z.object({ target: z.enum(ids) }),
          execute: async ({ target }) => ({ ok: pushAct({ targetId: target, kind: 'knock', color: 'black' }) }),
        }),
        paint: tool({
          description: 'Paint a thing a different color.',
          inputSchema: z.object({ target: z.enum(ids), color: z.enum(COLOR_NAMES as [ColorName, ...ColorName[]]) }),
          execute: async ({ target, color }) => ({ ok: pushAct({ targetId: target, kind: 'paint', color }) }),
        }),
        take_away: tool({
          description: 'Take a thing away completely.',
          inputSchema: z.object({ target: z.enum(ids) }),
          execute: async ({ target }) => ({ ok: pushAct({ targetId: target, kind: 'remove', color: 'black' }) }),
        }),
      },
    })
    if (acts.length) return { acts, narration: lastLine(result.text) || describeWreck(acts, targets), usedModel: true }
  } catch (err) {
    console.warn('[builder] wreck model unavailable, using keywords:', err instanceof Error ? err.message : err)
  }
  return keywordWreck(input.text, targets)
}

export function keywordWreck(text: string, targets: WreckTarget[]): WreckPlan {
  const s = text.toLowerCase()
  const kind: WreckKind = /paint|colou?r|dye|spray/.test(s) ? 'paint' : /take|remove|steal|away|gone|delete|vanish|hide/.test(s) ? 'remove' : 'knock'
  const named = targets.find((t) => s.includes(nice(t.type)) || (CATALOG as Record<string, { words: string[] }>)[t.type]?.words.some((w) => s.includes(w)))
  const color = (s.split(/\W+/).map(normalizeColor).find(Boolean) as ColorName | undefined) ?? 'black'
  const target = named ?? targets[0]
  const acts: WreckAct[] = [{ targetId: target.id, kind, color }]
  return { acts, narration: describeWreck(acts, targets), usedModel: false }
}

export const __test = { keywordBuild, keywordWreck, describeItems, normalizeBuildType }

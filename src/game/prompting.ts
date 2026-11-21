/**
 * How the builder reads a prompt, in plain rules both server and tests share.
 *
 * - Places: a few words decide where things go at a landmark ("on the roof",
 *   "by the door", "in the pond"). Leave the place out and the builder sets
 *   things down anywhere at the landmark.
 * - Defaults: leave out the color and the builder uses its own usual color for
 *   that object (birds come out brown). Leave out how many and it makes one,
 *   or three for a plural like "ducks".
 * - Reading: after every prompt the player sees how each part was read, so a
 *   miss always has a reason they can fix.
 */

import { COLOR_NAMES, normalizeColor, pluralLabel, type BuildType, type ColorName } from './catalog'

export type PlaceTag = 'roof' | 'door' | 'front' | 'dock' | 'pond' | 'path'

export const PLACES: Record<PlaceTag, { label: string; words: RegExp }> = {
  roof: { label: 'on the roof', words: /\b(roof|rooftop|on top|up high|high up|top of)\b/ },
  door: { label: 'by the door', words: /\b(door|doorway|entrance|porch|doorstep|step)\b/ },
  front: { label: 'out front', words: /\b(front|yard)\b/ },
  dock: { label: 'at the dock', words: /\b(dock|pier|jetty|tied|tie)\b/ },
  pond: { label: 'in the pond', words: /\b(pond|water|swim|swimming|float|floating|lake)\b/ },
  path: { label: 'along the path', words: /\b(path|walkway|trail|along)\b/ },
}

/** Every place the prompt mentions, in the order it mentions them. */
export function placesIn(text: string): PlaceTag[] {
  const s = text.toLowerCase()
  return (Object.keys(PLACES) as PlaceTag[])
    .map((tag) => ({ tag, at: s.search(PLACES[tag].words) }))
    .filter((x) => x.at >= 0)
    .sort((a, b) => a.at - b.at)
    .map((x) => x.tag)
}

/** The builder's own color when a prompt names none. Null keeps the object's natural look. */
export const DEFAULT_COLOR: Partial<Record<BuildType, ColorName>> = {
  bird: 'brown',
  tent: 'green',
  mushroom: 'red',
  flag: 'white',
  house: 'white',
  crystal: 'blue',
}

/** Objects whose color you can change. */
export const COLORABLE = new Set<BuildType>(['house', 'tent', 'crystal', 'mushroom', 'bird', 'bench', 'scarecrow', 'flag', 'beehive', 'boat', 'flowers', 'fence', 'campfire'])

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

/** What one part of an order turned into, for the "I read" card. */
export interface Reading {
  type: BuildType
  count: number
  color: ColorName | null
  colorSaid: boolean
  place: PlaceTag | null
  placeSaid: boolean
  /** Where it went when no known place was asked for, like "by the Dock". */
  landmarkName: string
}

const them = (n: number) => (n === 1 ? 'it' : 'them')

/** Plain lines for the "I read" card, one fact per line. */
export function readingLines(r: Reading): string[] {
  const lines = [`I read: ${pluralLabel(r.type, r.count).replace(/^(a|\d+) /, (m) => (r.color && r.colorSaid ? `${m}${r.color} ` : m))}.`]
  if (COLORABLE.has(r.type) && !r.colorSaid) {
    lines.push(r.color ? `Color: you didn't say, so I made ${them(r.count)} ${r.color}.` : `Color: you didn't say, so I left ${them(r.count)} plain.`)
  }
  if (r.placeSaid && r.place) lines.push(`Place: ${PLACES[r.place].label}, like you said.`)
  else if (r.placeSaid) lines.push(`Place: there is no spot like that here, so I put ${them(r.count)} by the ${r.landmarkName}.`)
  else lines.push(`Place: you didn't say, so I put ${them(r.count)} by the ${r.landmarkName}.`)
  return lines
}

export { COLOR_NAMES }

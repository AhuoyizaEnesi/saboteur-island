/**
 * The fixed catalog of things the builder agent may place. The agent never
 * writes code: every tool call names one of these types, and the server
 * rejects anything else before it becomes a record.
 */

export interface CatalogEntry {
  /** Footprint radius on the island, used for spacing. */
  fp: number
  /** Floats on the pond instead of standing on grass. */
  water?: boolean
  /** Prefers the island's edge when no spot is requested. */
  edge?: boolean
  /** Words the local fallback parser maps to this type. */
  words: string[]
  /** One line the agent reads to decide what to use. */
  hint: string
}

export const CATALOG = {
  house: { fp: 0.62, words: ['house', 'houses', 'cottage', 'cottages', 'home', 'homes', 'cabin', 'cabins', 'hut', 'huts', 'village'], hint: 'small cottage with a chimney' },
  pine_tree: { fp: 0.4, words: ['pine', 'pines', 'tree', 'trees', 'forest', 'woods'], hint: 'tall pine tree' },
  round_tree: { fp: 0.45, words: ['oak', 'oaks', 'bush', 'bushes', 'autumn', 'orchard'], hint: 'round leafy tree' },
  rock: { fp: 0.3, words: ['rock', 'rocks', 'stone', 'stones', 'boulder', 'boulders'], hint: 'grey boulder' },
  lantern: { fp: 0.22, words: ['lantern', 'lanterns', 'lamp', 'lamps', 'lights', 'streetlight'], hint: 'lantern on a post, glows at night' },
  boat: { fp: 0.42, water: true, words: ['boat', 'boats', 'canoe', 'ship', 'ships', 'fishing'], hint: 'small fishing boat, floats on the pond' },
  dock: { fp: 0.5, words: ['dock', 'docks', 'pier', 'jetty'], hint: 'wooden dock on the pond shore' },
  windmill: { fp: 0.55, words: ['windmill', 'windmills', 'mill'], hint: 'windmill with turning sails' },
  campfire: { fp: 0.42, words: ['campfire', 'campfires', 'fire', 'bonfire'], hint: 'campfire with smoke' },
  lighthouse: { fp: 0.5, edge: true, words: ['lighthouse', 'lighthouses', 'tower'], hint: 'striped lighthouse with a sweeping beam' },
  well: { fp: 0.36, words: ['well', 'wells'], hint: 'stone water well' },
  fence: { fp: 0.55, words: ['fence', 'fences'], hint: 'short wooden fence' },
  flowers: { fp: 0.32, words: ['flower', 'flowers', 'garden', 'gardens'], hint: 'flower bed' },
  tent: { fp: 0.42, words: ['tent', 'tents', 'camp'], hint: 'camping tent' },
  crystal: { fp: 0.35, words: ['crystal', 'crystals', 'gem', 'gems', 'magic'], hint: 'glowing floating crystals' },
  mushroom: { fp: 0.38, words: ['mushroom', 'mushrooms', 'shroom', 'shrooms', 'toadstool'], hint: 'giant spotted mushroom' },
  sheep: { fp: 0.3, words: ['sheep', 'lamb', 'lambs', 'animals', 'flock'], hint: 'fluffy sheep' },
  duck: { fp: 0.2, water: true, words: ['duck', 'ducks', 'duckling', 'ducklings'], hint: 'yellow rubber duck, floats on the pond' },
  volcano: { fp: 0.85, words: ['volcano', 'volcanoes', 'lava', 'magma'], hint: 'small volcano with glowing lava and smoke' },
  pirate_flag: { fp: 0.22, words: ['pirate', 'pirates', 'jolly'], hint: 'black pirate flag on a pole' },
  totem: { fp: 0.3, words: ['totem', 'totems', 'idol', 'statue', 'statues'], hint: 'carved wooden totem pole with glowing eyes' },
  cactus: { fp: 0.3, words: ['cactus', 'cacti', 'desert'], hint: 'tall green cactus' },
  bird: { fp: 0.15, words: ['bird', 'birds', 'chick', 'robin', 'canary', 'sparrow', 'parrot', 'birdie'], hint: 'small round bird; can sit on a roof' },
  bench: { fp: 0.35, words: ['bench', 'benches', 'seat', 'seats'], hint: 'wooden park bench' },
  scarecrow: { fp: 0.3, words: ['scarecrow', 'scarecrows', 'strawman'], hint: 'scarecrow with a straw hat' },
  flag: { fp: 0.2, words: ['flag', 'flags', 'banner', 'banners', 'pennant'], hint: 'flag on a tall pole, any color' },
  beehive: { fp: 0.25, words: ['beehive', 'beehives', 'hive', 'hives', 'bees', 'bee', 'honey'], hint: 'wooden beehive box with bees' },
} satisfies Record<string, CatalogEntry>

/** The colors the builder can paint things. Tasks name colors from this list, so checks are exact. */
export const COLORS = {
  red: '#e0473f',
  orange: '#f08a2c',
  yellow: '#ffd23f',
  green: '#4caf50',
  blue: '#3f7fe0',
  pink: '#ff7ab8',
  purple: '#9b6cf0',
  white: '#f4f1ea',
  black: '#1f1b2a',
  brown: '#8b5a3c',
} as const

export type ColorName = keyof typeof COLORS
export const COLOR_NAMES = Object.keys(COLORS) as ColorName[]

export function normalizeColor(value: unknown): ColorName | null {
  if (typeof value !== 'string') return null
  const v = value.toLowerCase().trim()
  if ((COLOR_NAMES as string[]).includes(v)) return v as ColorName
  const alias: Record<string, ColorName> = { gold: 'yellow', golden: 'yellow', grey: 'white', gray: 'white', violet: 'purple', crimson: 'red', navy: 'blue', teal: 'blue', cyan: 'blue', lime: 'green', tan: 'brown' }
  return alias[v] ?? null
}

export type BuildType = keyof typeof CATALOG
export const BUILD_TYPES = Object.keys(CATALOG) as BuildType[]

export function isBuildType(value: unknown): value is BuildType {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(CATALOG, value)
}

export function normalizeBuildType(value: unknown): BuildType | null {
  if (typeof value !== 'string') return null
  const v = value.toLowerCase().trim().replace(/[\s-]+/g, '_')
  if (isBuildType(v)) return v
  if (isBuildType(v.replace(/s$/, ''))) return v.replace(/s$/, '') as BuildType
  return null
}

export function pluralLabel(type: BuildType, n: number): string {
  const nice = type.replace('_', ' ')
  if (n === 1) return `a ${nice}`
  if (type === 'sheep') return `${n} sheep`
  if (type === 'flowers') return `${n} flower beds`
  if (type === 'cactus') return `${n} cacti`
  if (/o$/.test(nice)) return `${n} ${nice}es`
  return `${n} ${nice}s`
}

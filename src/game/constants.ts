/**
 * Shared game constants. Imported by the worker (server actions) and the
 * browser, so both sides agree on timings, limits and island geometry.
 */

export const MIN_PLAYERS = 5
export const MAX_PLAYERS = 6
export const ROUNDS = 3

export const INTRO_MS = 7_000
export const BUILD_MS = 90_000
export const MEETING_MS = 45_000
export const VOTE_MS = 20_000
export const EJECT_MS = 9_000
export const LIGHTS_OUT_MS = 20_000

export const ORDERS_PER_ROUND = 2
export const MEETINGS_PER_PLAYER = 1
export const SABOTAGES_PER_ROUND = 1
export const ORDER_MAX_CHARS = 140
export const CHAT_MAX_CHARS = 160
export const MAX_BUILDS_PER_ORDER = 8
export const MAX_BUILDS_PER_GAME = 160

/** Seat colors. Index = seat number. */
export const SEAT_COLORS = ['#7cf7ff', '#ff7ad9', '#ffd166', '#a48cff', '#5dff9b', '#ff9a5a']
export const SEAT_COLOR_NAMES = ['cyan', 'pink', 'gold', 'violet', 'green', 'orange']

export const BOT_NAMES = ['Ada', 'Kai', 'Juno', 'Rex', 'Mo', 'Zia']

export const GOAL_TEXT = 'Build a cozy fishing village'

/** Island geometry shared by placement (server) and rendering (browser). */
export const ISLAND = {
  TOP_R: 6.2,
  DOME_H: 0.42,
  USABLE_R: 5.3,
  POND: { x: 2.25, z: 1.45, r: 1.38 },
  POND_Y: 0.2,
} as const

/** Where everyone gathers for meetings: the bell sits here. */
export const MEETING_SPOT = { x: -1.2, z: -0.9 } as const

export type Phase = 'lobby' | 'intro' | 'build' | 'meeting' | 'vote' | 'eject' | 'over'
export type TimeOfDay = 'dawn' | 'day' | 'sunset' | 'night'
export type Weather = 'clear' | 'rain' | 'snow' | 'fog' | 'fireflies'
export type Role = 'crew' | 'impostor'

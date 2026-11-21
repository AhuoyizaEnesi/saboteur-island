/**
 * Shared game constants. Imported by the worker (server actions) and the
 * browser, so both sides agree on timings, limits and island geometry.
 */

export const MIN_PLAYERS = 5
export const MAX_PLAYERS = 6
export const TASKS_PER_CREW = 3
/** Tasks in a practice round, each at a different landmark. */
export const PRACTICE_TASKS = 4

export const INTRO_MS = 7_000
/** Play time until night falls, not counting meetings. */
export const PLAY_MS = 7 * 60_000
export const MEETING_MS = 60_000
export const VOTE_MS = 30_000
/** Once every living player has voted, voting closes this long after the last vote. */
export const VOTE_GRACE_MS = 3_000
export const EJECT_MS = 9_000
/** How often the ticking browser advances the game. */
export const TICK_MS = 1_000

export const LIGHTS_OUT_MS = 30_000
export const LIGHTS_COOLDOWN_MS = 45_000
export const WRECK_COOLDOWN_MS = 30_000
export const FIRST_WRECK_MS = 20_000
export const BELL_LOCK_MS = 15_000
export const BELLS_PER_PLAYER = 1
/** A player can send one order to the builder this often. */
export const ORDER_COOLDOWN_MS = 4_000
/** Building or fixing a task takes this long standing at the landmark. */
export const BUILD_MS = 8_000
/** A wreck takes half as long as a build. */
export const WRECK_MS = 4_000
/** How early a finish may arrive, for network lag; and how long a started job stays valid. */
export const JOB_SLACK_MS = 1_200
export const JOB_EXPIRES_MS = 30_000
/** A prompt that only changes what you already built (recolor, move, remove) is quicker. */
export const EDIT_MS = 3_000

/** AI Impostor pacing, slower than a human's cooldowns. */
export const BOT_FIRST_WRECK_MS = 75_000
export const BOT_WRECK_MIN_MS = 60_000
export const BOT_WRECK_MAX_MS = 80_000
export const BOT_LIGHTS_MAX = 2
export const BOT_LIGHTS_COOLDOWN_MS = 120_000
/** AI reply calls allowed per meeting, across all human messages. */
export const MAX_REPLY_CALLS = 10

/** Distances, in island units. */
export const TASK_RANGE = 3.0
export const REPORT_RANGE = 2.5
export const BELL_RANGE = 2.4
export const SHED_RANGE = 2.4
export const VISION = { crew: 5, impostor: 6, lightsOut: 1.8 } as const

export const ORDER_MAX_CHARS = 140
export const CHAT_MAX_CHARS = 160
export const MAX_ITEMS_PER_ORDER = 4
export const MAX_BUILDS_PER_GAME = 220

/** Walking speed in island units per second. */
export const WALK_SPEED = 2.6
/** How often a browser sends its position to the server. */
export const CHECKPOINT_MS = 1_500
/** How often a browser broadcasts its position to other browsers. */
export const PRESENCE_MS = 100
/** Extra distance the server allows on top of walking speed, for lag. */
export const POS_SLACK = 1.5

/** Seat colors. Index = seat number. */
export const SEAT_COLORS = ['#7cf7ff', '#ff7ad9', '#ffd166', '#a48cff', '#5dff9b', '#ff9a5a']
export const SEAT_COLOR_NAMES = ['cyan', 'pink', 'gold', 'violet', 'green', 'orange']

export const BOT_NAMES = ['Ada', 'Kai', 'Juno', 'Rex', 'Mo', 'Zia']

/** Island geometry shared by placement (server) and rendering (browser). */
export const ISLAND = {
  TOP_R: 11,
  DOME_H: 0.7,
  USABLE_R: 10,
  POND: { x: 4.6, z: 3.2, r: 2.0 },
  POND_Y: 0.3,
} as const

/** Where everyone gathers for meetings: the bell sits here. */
export const MEETING_SPOT = { x: 0, z: 0 } as const

export type Phase = 'lobby' | 'intro' | 'play' | 'meeting' | 'vote' | 'eject' | 'over'
export type TimeOfDay = 'dawn' | 'day' | 'sunset' | 'night'
export type Weather = 'clear' | 'rain' | 'snow' | 'fog' | 'fireflies'
export type Role = 'crew' | 'impostor'

/** How many times more likely a person is to be the Impostor than one AI player. Alone, that makes it about 1 game in 2. */
export const HUMAN_IMPOSTOR_WEIGHT = 4

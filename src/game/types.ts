/** Record shapes for the game collections (see src/schemas/game-schemas.ts). */

import type { Leg } from './bots'
import type { Phase, Role, TimeOfDay, Weather } from './constants'

export interface GameRow {
  code: string
  hostId: string
  phase: Phase
  /** Deadline for intro, meeting, vote and eject. */
  phaseEndsAt: number
  /** When night falls. Only meaningful during play. */
  nightAt: number
  /** Play time left, saved when a meeting pauses the night clock. */
  playMsLeft: number
  tasksDone: number
  tasksTotal: number
  timeOfDay: TimeOfDay
  weather: Weather
  lightsOutUntil: number
  bellLockUntil: number
  meetingNo: number
  meetingCalledBy: string
  /** 'bell' or 'report'. */
  meetingReason: string
  /** Landmark name of the reported broken task, shown in the meeting. */
  meetingWhere: string
  ejectedId: string
  ejectedWasImpostor: number
  winner: '' | 'crew' | 'impostor'
  winReason: string
  reveal: Reveal | null
  botVotes: { playerId: string; targetId: string }[] | null
  /** Set when someone starts a rematch, so everyone follows to the new code. */
  nextCode: string
  seed: number
}

export interface Reveal {
  impostorPlayerId: string
  wrecks: number
}

export interface PlayerRow {
  gameId: string
  userId: string
  name: string
  color: string
  seat: number
  isBot: number
  alive: number
  bellsLeft: number
  lastActiveAt: number
  /** Last position checkpoint, sent by the player's browser every 1.5 seconds. */
  x?: number
  z?: number
  posAt?: number
  /** Last order to the builder, for the cooldown. */
  lastOrderAt?: number
}

export interface SecretRow {
  gameId: string
  playerId: string
  ownerUserId: string
  role: Role
  /** The Impostor's fake task list (template ids). */
  fakeTasks: string[] | string
  wreckReadyAt: number
  lightsReadyAt: number
}

export type TaskStatus = 'todo' | 'done' | 'broken'

export interface TaskRow {
  gameId: string
  playerId: string
  ownerUserId: string
  templateId: string
  landmarkId: string
  status: TaskStatus
  doneAt: number
}

export type BuildState = 'ok' | 'knocked' | 'painted'

export interface BuildRow {
  gameId: string
  orderId: string
  playerId: string
  landmarkId: string
  type: string
  x: number
  z: number
  /** Height above the ground, for things on roofs. */
  lift: number
  rot: number
  scale: number
  color: string
  colorName: string
  state: BuildState
  seq: number
  at: number
}

export interface BreakRow {
  gameId: string
  landmarkId: string
  x: number
  z: number
  at: number
  reported: number
  fixed: number
}

export interface RouteRow {
  gameId: string
  playerId: string
  legs: Leg[] | string
  /** The plan the AI player is on, like 'task:red_bird' or 'wreck'. */
  goal: string
}

export interface ClueRow {
  gameId: string
  landmarkId: string
  at: number
  impostorId: string
  /** Players within sight of the spot when it was wrecked. */
  nearby: string[] | string
  /** AI players who could see the Impostor at the spot. */
  witnesses: string[] | string
}

export interface VoteRow {
  gameId: string
  meetingNo: number
  voterId: string
  targetId: string
  showAt: number
}

export interface ChatRow {
  gameId: string
  meetingNo: number
  playerId: string
  text: string
  showAt: number
}

export interface EventRow {
  gameId: string
  kind: 'system' | 'lights' | 'meeting' | 'eject' | 'night' | 'task'
  text: string
  playerId: string
  at: number
}

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
  /** AI votes for the current meeting. Firm votes (eyewitnesses) never change. */
  botVotes: { playerId: string; targetId: string; firm?: boolean }[] | null
  /** AI reply calls used in the current meeting. */
  replyCalls?: number
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
  /** Lights outs used this game (the AI Impostor stops at a limit). */
  lightsUsed?: number
  /** A build or wreck in progress: finished by a second call once its time is up. */
  pending?: PendingJob | string | null
}

export interface PendingJob {
  kind: 'build' | 'wreck'
  landmarkId: string
  startedAt: number
  readyAt: number
  narration: string
  /** Builds: what to place. */
  items?: { type: string; color: string | null }[]
  /** Builds: details the builder had to guess, to explain a miss. */
  guessed?: { color?: string; count?: number; type?: string }[]
  /** Wrecks: what to do to which target. */
  acts?: { targetId: string; kind: string; color: string }[]
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
  /** Orders placed at this task's landmark before it was first done. */
  tries?: number
  /** 1 when the task was finished on the first prompt. */
  firstTry?: number
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
  /** Where every living player was at that moment: player id to nearest landmark id. */
  places?: Record<string, string> | string
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

/** Record shapes for the game collections (see src/schemas/game-schemas.ts). */

import type { Phase, Role, TimeOfDay, Weather } from './constants'

export interface GameRow {
  code: string
  hostId: string
  phase: Phase
  round: number
  phaseEndsAt: number
  /** Build time left in the round when a meeting interrupted it. */
  buildMsLeft: number
  timeOfDay: TimeOfDay
  weather: Weather
  lightsOutUntil: number
  meetingNo: number
  meetingCalledBy: string
  /** 1 while the closing meeting after the last round is running. */
  finalMeeting: number
  ejectedId: string
  ejectedWasImpostor: number
  winner: '' | 'crew' | 'impostor'
  winReason: string
  reveal: Reveal | null
  botPlan: BotPlanEntry[] | null
  botVotes: { playerId: string; targetId: string }[] | null
  /** Set when the host starts a rematch, so everyone follows to the new code. */
  nextCode: string
  seed: number
}

export interface Reveal {
  impostorPlayerId: string
  themeId: string
  sabotageBuildIds: string[]
}

export interface BotPlanEntry {
  kind: 'order' | 'lights'
  playerId: string
  round: number
  at: number
  done: number
}

export interface PlayerRow {
  gameId: string
  userId: string
  name: string
  color: string
  seat: number
  isBot: number
  alive: number
  ordersLeft: number
  meetingsLeft: number
  lastActiveAt: number
}

export interface SecretRow {
  gameId: string
  playerId: string
  ownerUserId: string
  role: Role
  themeId: string
  sabotagesUsed: number
}

export interface OrderRow {
  gameId: string
  playerId: string
  round: number
  text: string
  status: 'building' | 'done' | 'failed'
  narration: string
  at: number
}

export interface BuildRow {
  gameId: string
  orderId: string
  playerId: string
  type: string
  x: number
  z: number
  rot: number
  scale: number
  color: string
  round: number
  seq: number
  at: number
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
  kind: 'system' | 'order' | 'lights' | 'meeting' | 'eject' | 'round'
  text: string
  playerId: string
  at: number
}

/** Environment changes the agent can make, applied to the game row. */
export interface EnvChange {
  timeOfDay?: TimeOfDay
  weather?: Weather
}

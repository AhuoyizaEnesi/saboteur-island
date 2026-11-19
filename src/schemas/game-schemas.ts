/**
 * Game collections.
 *
 * Every write goes through a server action in src/actions/game.ts, which runs
 * with RBAC off and checks phase, range, cooldowns and role itself. So
 * browsers get read access only: no role can create, update or delete game
 * rows directly.
 *
 * Private collections:
 * - `secrets` and `tasks` use the player's user id as owner, and every role
 *   reads only its own rows. The server, not the UI, keeps roles and task
 *   lists hidden from everyone else.
 * - `clues` is readable by nobody. Only server actions (RBAC off) touch it.
 */

import type { CollectionSchema, ColumnDefinition, RolePermissions } from 'deepspace/schema'

const text = (name: string, maxLength?: number): ColumnDefinition => ({
  name,
  storage: 'text',
  interpretation: 'plain',
  ...(maxLength ? { maxLength } : {}),
})
const num = (name: string): ColumnDefinition => ({ name, storage: 'number', interpretation: 'plain' })
const json = (name: string): ColumnDefinition => ({ name, storage: 'text', interpretation: { kind: 'json' } })

const READ_ONLY: RolePermissions = { read: true, create: false, update: false, delete: false }
const READ_OWN: RolePermissions = { read: 'own', create: false, update: false, delete: false }
const NONE: RolePermissions = { read: false, create: false, update: false, delete: false }
const publicRead = { '*': READ_ONLY, anonymous: READ_ONLY, viewer: READ_ONLY, member: READ_ONLY, admin: READ_ONLY }
const ownRead = { '*': READ_OWN, anonymous: READ_OWN, viewer: READ_OWN, member: READ_OWN, admin: READ_OWN }
const serverOnly = { '*': NONE, anonymous: NONE, viewer: NONE, member: NONE, admin: NONE }

export const gamesSchema: CollectionSchema = {
  name: 'games',
  columns: [
    text('code', 8),
    text('hostId'),
    text('phase'),
    num('phaseEndsAt'),
    num('nightAt'),
    num('playMsLeft'),
    num('tasksDone'),
    num('tasksTotal'),
    text('timeOfDay'),
    text('weather'),
    num('lightsOutUntil'),
    num('bellLockUntil'),
    num('meetingNo'),
    text('meetingCalledBy'),
    text('meetingReason'),
    text('meetingWhere'),
    text('ejectedId'),
    num('ejectedWasImpostor'),
    text('winner'),
    text('winReason', 300),
    json('reveal'),
    json('botVotes'),
    text('nextCode', 8),
    num('seed'),
  ],
  permissions: publicRead,
}

export const playersSchema: CollectionSchema = {
  name: 'players',
  columns: [
    text('gameId'),
    text('userId'),
    text('name', 40),
    text('color'),
    num('seat'),
    num('isBot'),
    num('alive'),
    num('bellsLeft'),
    num('lastActiveAt'),
    // Last position checkpoint the browser sent, used for range checks.
    num('x'),
    num('z'),
    num('posAt'),
    num('lastOrderAt'),
  ],
  uniqueOn: ['gameId', 'userId'],
  permissions: publicRead,
}

export const secretsSchema: CollectionSchema = {
  name: 'secrets',
  columns: [
    text('gameId'),
    text('playerId'),
    text('ownerUserId'),
    text('role'),
    json('fakeTasks'),
    num('wreckReadyAt'),
    num('lightsReadyAt'),
  ],
  ownerField: 'ownerUserId',
  permissions: ownRead,
}

export const tasksSchema: CollectionSchema = {
  name: 'tasks',
  columns: [
    text('gameId'),
    text('playerId'),
    text('ownerUserId'),
    text('templateId'),
    text('landmarkId'),
    text('status'),
    num('doneAt'),
  ],
  ownerField: 'ownerUserId',
  permissions: ownRead,
}

export const buildsSchema: CollectionSchema = {
  name: 'builds',
  columns: [
    text('gameId'),
    text('orderId'),
    text('playerId'),
    text('landmarkId'),
    text('type'),
    num('x'),
    num('z'),
    num('lift'),
    num('rot'),
    num('scale'),
    text('color'),
    text('colorName'),
    text('state'),
    num('seq'),
    num('at'),
  ],
  permissions: publicRead,
}

export const breaksSchema: CollectionSchema = {
  name: 'breaks',
  columns: [text('gameId'), text('landmarkId'), num('x'), num('z'), num('at'), num('reported'), num('fixed')],
  permissions: publicRead,
}

export const routesSchema: CollectionSchema = {
  name: 'routes',
  columns: [text('gameId'), text('playerId'), json('legs'), text('goal')],
  uniqueOn: ['gameId', 'playerId'],
  permissions: publicRead,
}

export const cluesSchema: CollectionSchema = {
  name: 'clues',
  columns: [text('gameId'), text('landmarkId'), num('at'), text('impostorId'), json('nearby'), json('witnesses')],
  permissions: serverOnly,
}

export const votesSchema: CollectionSchema = {
  name: 'votes',
  columns: [text('gameId'), num('meetingNo'), text('voterId'), text('targetId'), num('showAt')],
  uniqueOn: ['gameId', 'meetingNo', 'voterId'],
  permissions: publicRead,
}

export const chatSchema: CollectionSchema = {
  name: 'chat',
  columns: [text('gameId'), num('meetingNo'), text('playerId'), text('text', 200), num('showAt')],
  permissions: publicRead,
}

export const eventsSchema: CollectionSchema = {
  name: 'events',
  columns: [text('gameId'), text('kind'), text('text', 300), text('playerId'), num('at')],
  permissions: publicRead,
}

export const gameSchemas: CollectionSchema[] = [
  gamesSchema,
  playersSchema,
  secretsSchema,
  tasksSchema,
  buildsSchema,
  breaksSchema,
  routesSchema,
  cluesSchema,
  votesSchema,
  chatSchema,
  eventsSchema,
]

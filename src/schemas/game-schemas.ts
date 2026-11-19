/**
 * Game collections.
 *
 * Every write goes through a server action in src/actions/game.ts, which runs
 * with RBAC off and checks phase, turn and role itself. So browsers get read
 * access only: no role can create, update or delete game rows directly.
 *
 * The one private collection is `secrets`. Its owner column is the player's
 * user id and every role reads only its own rows, so the server, not the UI,
 * keeps each player's role hidden from everyone else.
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
const publicRead = { '*': READ_ONLY, anonymous: READ_ONLY, viewer: READ_ONLY, member: READ_ONLY, admin: READ_ONLY }

export const gamesSchema: CollectionSchema = {
  name: 'games',
  columns: [
    text('code', 8),
    text('hostId'),
    text('phase'),
    num('round'),
    num('phaseEndsAt'),
    num('buildMsLeft'),
    text('timeOfDay'),
    text('weather'),
    num('lightsOutUntil'),
    num('meetingNo'),
    text('meetingCalledBy'),
    num('finalMeeting'),
    text('ejectedId'),
    num('ejectedWasImpostor'),
    text('winner'),
    text('winReason', 300),
    json('reveal'),
    json('botPlan'),
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
    num('ordersLeft'),
    num('meetingsLeft'),
    num('lastActiveAt'),
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
    text('themeId'),
    num('sabotagesUsed'),
  ],
  ownerField: 'ownerUserId',
  permissions: { '*': READ_OWN, anonymous: READ_OWN, viewer: READ_OWN, member: READ_OWN, admin: READ_OWN },
}

export const ordersSchema: CollectionSchema = {
  name: 'orders',
  columns: [
    text('gameId'),
    text('playerId'),
    num('round'),
    text('text', 200),
    text('status'),
    text('narration', 300),
    num('at'),
  ],
  permissions: publicRead,
}

export const buildsSchema: CollectionSchema = {
  name: 'builds',
  columns: [
    text('gameId'),
    text('orderId'),
    text('playerId'),
    text('type'),
    num('x'),
    num('z'),
    num('rot'),
    num('scale'),
    text('color'),
    num('round'),
    num('seq'),
    num('at'),
  ],
  permissions: publicRead,
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
  ordersSchema,
  buildsSchema,
  votesSchema,
  chatSchema,
  eventsSchema,
]

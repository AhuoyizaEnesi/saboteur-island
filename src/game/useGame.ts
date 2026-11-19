/** Live game state from the records layer, plus a ticking clock. */

import { useEffect, useMemo, useState } from 'react'
import { useQuery } from 'deepspace'
import { serverNow } from './api'
import type { BuildRow, ChatRow, EventRow, GameRow, OrderRow, PlayerRow, SecretRow, VoteRow } from './types'

export interface Rec<T> {
  id: string
  data: T
  createdAt: string
}

function parseJson<T>(v: unknown, fallback: T): T {
  if (v === null || v === undefined || v === '') return fallback
  if (typeof v === 'string') {
    try {
      return JSON.parse(v) as T
    } catch {
      return fallback
    }
  }
  return v as T
}

const toRecs = <T,>(records: { recordId: string; data: T; createdAt: string }[]): Rec<T>[] =>
  records.map((r) => ({ id: r.recordId, data: r.data, createdAt: r.createdAt }))

export function useGameData(code: string) {
  const games = useQuery<GameRow>('games', { where: { code }, limit: 20 })
  const game = useMemo(() => {
    const list = toRecs(games.records).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    const g = list[0]
    if (!g) return null
    return {
      ...g,
      data: {
        ...g.data,
        reveal: parseJson<GameRow['reveal']>(g.data.reveal, null),
        botPlan: parseJson<GameRow['botPlan']>(g.data.botPlan, []),
        botVotes: parseJson<GameRow['botVotes']>(g.data.botVotes, []),
      },
    }
  }, [games.records])
  const gameId = game?.id ?? '__none__'
  const where = { gameId }
  const players = useQuery<PlayerRow>('players', { where, limit: 12 })
  const secrets = useQuery<SecretRow>('secrets', { where, limit: 12 })
  const builds = useQuery<BuildRow>('builds', { where, limit: 500 })
  const orders = useQuery<OrderRow>('orders', { where, limit: 200 })
  const chat = useQuery<ChatRow>('chat', { where, limit: 300 })
  const votes = useQuery<VoteRow>('votes', { where, limit: 120 })
  const events = useQuery<EventRow>('events', { where, limit: 200 })

  return {
    loading: games.status === 'loading',
    game,
    players: useMemo(() => toRecs(players.records).sort((a, b) => a.data.seat - b.data.seat), [players.records]),
    secrets: useMemo(() => toRecs(secrets.records), [secrets.records]),
    builds: useMemo(() => toRecs(builds.records).sort((a, b) => a.data.seq - b.data.seq), [builds.records]),
    orders: useMemo(() => toRecs(orders.records).sort((a, b) => a.data.at - b.data.at), [orders.records]),
    chat: useMemo(() => toRecs(chat.records).sort((a, b) => a.data.showAt - b.data.showAt), [chat.records]),
    votes: useMemo(() => toRecs(votes.records), [votes.records]),
    events: useMemo(() => toRecs(events.records).sort((a, b) => a.data.at - b.data.at), [events.records]),
  }
}

/** Server-synced "now" that re-renders a few times a second. */
export function useNow(intervalMs = 250): number {
  const [now, setNow] = useState(serverNow())
  useEffect(() => {
    const id = window.setInterval(() => setNow(serverNow()), intervalMs)
    return () => window.clearInterval(id)
  }, [intervalMs])
  return now
}

export const fmtClock = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

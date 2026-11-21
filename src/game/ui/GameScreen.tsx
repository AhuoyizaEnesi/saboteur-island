/**
 * The game screen: the 3D island plus every HUD panel and overlay. Records
 * come in through useGameData; moves go out through server actions.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth, usePresenceRoom } from 'deepspace'
import { Bell, Ghost, Hammer, Link as LinkIcon, LogOut, Megaphone, Moon, Paintbrush, Power, SendHorizontal, Sun, Sunset, Trash2, Undo2, Volume2, VolumeX, Wrench, X, Zap } from 'lucide-react'
import { isMuted, play, setMuted, unlockSound } from '../sound'
import { callAction, serverNow } from '../api'
import {
  BELL_RANGE,
  BUILD_MS,
  EDIT_MS,
  CHAT_MAX_CHARS,
  CHECKPOINT_MS,
  EJECT_MS,
  MIN_PLAYERS,
  ORDER_MAX_CHARS,
  PLAY_MS,
  PRESENCE_MS,
  REPORT_RANGE,
  SEAT_COLORS,
  SHED_RANGE,
  TASK_RANGE,
  TICK_MS,
  VISION,
  VOTE_GRACE_MS,
  WRECK_MS,
} from '../constants'
import { LANDMARKS, landmarkById, type Landmark } from '../landmarks'
import { taskTemplate } from '../tasks'
import type { IslandScene } from '../scene/IslandScene'
import { fmtClock, useGameData, useNow, type Rec } from '../useGame'
import type { PlayerRow } from '../types'
import { IslandView } from './IslandView'
import { IslanderIcon } from './IslanderIcon'
import { MiniMap } from './MiniMap'
import '../game.css'

type Banner = { key: number; title: string; sub?: string; tone: 'crew' | 'bad' | 'gold' }
type Pos = { x: number; z: number }

const dist = (a: Pos, b: Pos) => Math.hypot(a.x - b.x, a.z - b.z)
const isTyping = (e: KeyboardEvent) => {
  const t = e.target as HTMLElement | null
  return Boolean(t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable))
}

export function GameScreen({ code }: { code: string }) {
  const { userId } = useAuth()
  const navigate = useNavigate()
  const { loading, game, players, secrets, tasks, builds, breaks, routes, chat, votes, events } = useGameData(code)
  const now = useNow()
  const [scene, setScene] = useState<IslandScene | null>(null)
  const [webglFailed, setWebglFailed] = useState(false)
  const [banner, setBanner] = useState<Banner | null>(null)
  const [toast, setToast] = useState<{ text: string; good?: boolean } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [orderFor, setOrderFor] = useState<Landmark | null>(null)
  const [orderText, setOrderText] = useState('')
  const [wreckText, setWreckText] = useState('')
  /** A build or wreck in progress: the player has to stay at the landmark until it lands. */
  const [job, setJob] = useState<{ kind: 'build' | 'wreck'; landmarkId: string; t0: number; ms: number; text: string; reading?: string[] } | null>(null)
  const jobToken = useRef(0)
  /** What the last order did, shown in the order box so the player can fix the prompt. */
  const [result, setResult] = useState<{ text: string; feedback: string[]; good: boolean; reading?: string[] } | null>(null)
  const [chatText, setChatText] = useState('')
  const [hideOver, setHideOver] = useState(false)
  /** The leave / end menu, and which choice is waiting for its second click. */
  const [menuOpen, setMenuOpen] = useState(false)
  const [confirming, setConfirming] = useState<'leave' | 'end' | null>(null)
  useEffect(() => {
    if (!confirming) return
    const id = window.setTimeout(() => setConfirming(null), 4_000)
    return () => window.clearTimeout(id)
  }, [confirming])
  const [showOver, setShowOver] = useState(false)
  const [here, setHere] = useState<Pos | null>(null)

  const gameId = game?.id ?? ''
  const g = game?.data
  const phase = g?.phase ?? 'lobby'
  const me = players.find((p) => p.data.userId === userId) ?? null
  const meId = me?.id ?? ''
  const mySecret = me ? secrets.find((s) => s.data.playerId === me.id) ?? null : null
  const role = mySecret?.data.role ?? null
  const isImpostor = role === 'impostor'
  const isHost = Boolean(g && userId && g.hostId === userId)
  const alive = Boolean(me?.data.alive)
  const ghost = Boolean(me && !alive && phase !== 'lobby')
  const lightsOut = Boolean(g && g.lightsOutUntil > now)
  const presence = usePresenceRoom(`game:${gameId || 'pending'}`)
  const nameOf = useCallback((id: string) => players.find((p) => p.id === id)?.data.name ?? 'Someone', [players])
  const colorOf = useCallback((id: string) => players.find((p) => p.id === id)?.data.color ?? SEAT_COLORS[0], [players])

  const [muted, setMutedState] = useState(isMuted)
  useEffect(() => {
    const unlock = () => unlockSound()
    window.addEventListener('pointerdown', unlock)
    window.addEventListener('keydown', unlock)
    return () => {
      window.removeEventListener('pointerdown', unlock)
      window.removeEventListener('keydown', unlock)
    }
  }, [])

  const flash = useCallback((text: string, good = false) => {
    setToast({ text, good })
    window.setTimeout(() => setToast((t) => (t?.text === text ? null : t)), 3400)
  }, [])

  const myPos = useRef<Pos | null>(null)
  const act = useCallback(
    async (name: string, params: Record<string, unknown> = {}, label?: string) => {
      if (label) setBusy(label)
      try {
        const p = myPos.current
        return await callAction(name, { gameId, ...(p ? { x: p.x, z: p.z } : {}), ...params })
      } catch (e) {
        flash(e instanceof Error ? e.message : 'Something went wrong.')
        return null
      } finally {
        if (label) setBusy(null)
      }
    },
    [gameId, flash],
  )

  // Visiting an invite link joins the lobby automatically.
  const joinTried = useRef(false)
  useEffect(() => {
    if (!game || me || joinTried.current || !userId || game.data.phase !== 'lobby') return
    joinTried.current = true
    callAction('game-join', { code }).catch((e) => flash(e instanceof Error ? e.message : 'Could not join.'))
  }, [game, me, userId, code, flash])

  // ─── drive the 3D scene from records ──────────────────────────────────────
  useEffect(() => {
    scene?.setClock(serverNow)
  }, [scene])

  const buildsSynced = useRef(false)
  useEffect(() => {
    if (!scene) return
    const list = builds.map((b) => ({ id: b.id, ...b.data }))
    scene.setBuilds(list, buildsSynced.current)
    if (list.length) buildsSynced.current = true
  }, [scene, builds])

  useEffect(() => {
    scene?.setBreaks(breaks.filter((b) => !b.data.fixed).map((b) => ({ id: b.id, x: b.data.x, z: b.data.z })))
  }, [scene, breaks])

  useEffect(() => {
    scene?.setRoutes(routes)
  }, [scene, routes])

  useEffect(() => {
    if (!scene) return
    scene.setPlayers(
      players.map((p) => ({
        id: p.id,
        name: p.data.name,
        color: p.data.color,
        alive: Boolean(p.data.alive) || (phase === 'eject' && g?.ejectedId === p.id),
        isMe: p.id === meId,
        seat: p.data.seat,
        wanders: false,
        // Only ghosts can see ghosts.
        ghost: !p.data.alive && ghost && phase !== 'eject',
      })),
    )
  }, [scene, players, meId, phase, g?.ejectedId, ghost])

  useEffect(() => {
    if (scene && g) scene.setEnvironment(g.timeOfDay || 'day', 'clear')
  }, [scene, g?.timeOfDay, g])

  useEffect(() => {
    scene?.setLightsOut(lightsOut && !isImpostor && !ghost)
  }, [scene, lightsOut, isImpostor, ghost])

  useEffect(() => {
    scene?.setMeeting(phase === 'meeting' || phase === 'vote')
  }, [scene, phase])

  // Vision: crew see 5 units, the Impostor 6, crew in a blackout 1.8. Ghosts see everything.
  const visionRef = useRef<HTMLDivElement>(null)
  const visionR = phase !== 'play' || !me || ghost ? null : isImpostor ? VISION.impostor : lightsOut ? VISION.lightsOut : VISION.crew
  useEffect(() => {
    scene?.setVision(visionR, visionRef.current)
  }, [scene, visionR])

  const flown = useRef(false)
  useEffect(() => {
    if (scene && !flown.current) {
      flown.current = true
      scene.introFlight()
    }
  }, [scene])

  const ejectedShown = useRef('')
  useEffect(() => {
    if (!scene || phase !== 'eject' || !g?.ejectedId) return
    const key = `${g.meetingNo}:${g.ejectedId}`
    if (ejectedShown.current === key) return
    ejectedShown.current = key
    window.setTimeout(() => scene.eject(g.ejectedId), 600)
  }, [scene, phase, g?.ejectedId, g?.meetingNo, g])

  useEffect(() => {
    if (phase !== 'over') return
    const id = window.setTimeout(() => setShowOver(true), 1500)
    return () => window.clearTimeout(id)
  }, [phase])

  // ─── walking: my islander, other humans over presence, checkpoints ───────
  const { peers, updateState } = presence
  const canWalk = Boolean(me && (phase === 'lobby' || phase === 'play') && (alive || ghost))
  const following = Boolean(me) && phase !== 'over' && phase !== 'intro'
  useEffect(() => {
    if (!scene) return
    scene.setControlled(meId || null, canWalk && !orderFor)
    scene.setCameraMode(following ? 'follow' : 'orbit')
  }, [scene, meId, canWalk, following, orderFor])

  const lastPeerPos = useRef(new Map<string, string>())
  useEffect(() => {
    if (!scene) return
    for (const peer of peers) {
      const st = peer.state as { pid?: string; x?: number; z?: number }
      if (!st.pid || st.pid === meId || typeof st.x !== 'number' || typeof st.z !== 'number') continue
      const key = `${st.x.toFixed(2)},${st.z.toFixed(2)}`
      if (lastPeerPos.current.get(st.pid) === key) continue
      lastPeerPos.current.set(st.pid, key)
      scene.walkTo(st.pid, st.x, st.z, true)
    }
  }, [scene, peers, meId])

  // Whether this tab is in front. Browsers slow timers in background tabs, so
  // a hidden tab should not be the one running the game clock.
  const [visible, setVisible] = useState(() => typeof document === 'undefined' || !document.hidden)
  useEffect(() => {
    const on = () => setVisible(!document.hidden)
    document.addEventListener('visibilitychange', on)
    return () => document.removeEventListener('visibilitychange', on)
  }, [])

  // Broadcast my position to other browsers about ten times a second.
  const lastSent = useRef(0)
  const pendingSend = useRef<number | null>(null)
  const broadcast = useCallback(() => {
    pendingSend.current = null
    const p = myPos.current
    if (!meId) return
    lastSent.current = performance.now()
    updateState({ pid: meId, vis: visible, ...(p ? { x: Math.round(p.x * 100) / 100, z: Math.round(p.z * 100) / 100 } : {}) })
  }, [meId, updateState, visible])
  useEffect(() => {
    broadcast()
  }, [broadcast])
  const onMyMove = useCallback(
    (x: number, z: number) => {
      myPos.current = { x, z }
      if (pendingSend.current !== null) return
      const wait = Math.max(0, PRESENCE_MS - (performance.now() - lastSent.current))
      pendingSend.current = window.setTimeout(broadcast, wait)
    },
    [broadcast],
  )
  useEffect(
    () => () => {
      if (pendingSend.current !== null) window.clearTimeout(pendingSend.current)
    },
    [],
  )

  // Keep my position fresh even when I stand still (meetings move everyone).
  useEffect(() => {
    if (!scene || !meId) return
    const id = window.setInterval(() => {
      const p = scene.getCharacterPos(meId)
      if (!p) return
      const prev = myPos.current
      if (!prev || dist(prev, p) > 0.01) onMyMove(p.x, p.z)
      setHere((h) => (h && dist(h, p) < 0.05 ? h : p))
    }, 200)
    return () => window.clearInterval(id)
  }, [scene, meId, onMyMove])

  // Checkpoints: the server cannot read presence, so it gets my position too.
  const lastCheckpoint = useRef('')
  useEffect(() => {
    if (!gameId || !canWalk) return
    const id = window.setInterval(() => {
      const p = myPos.current
      if (!p) return
      const key = `${p.x.toFixed(2)},${p.z.toFixed(2)}`
      if (key === lastCheckpoint.current) return
      lastCheckpoint.current = key
      callAction('game-pos', { gameId, x: p.x, z: p.z }).catch(() => undefined)
    }, CHECKPOINT_MS)
    return () => window.clearInterval(id)
  }, [gameId, canWalk])

  // ─── the clock: one browser advances the game ─────────────────────────────
  // The host's browser ticks if its tab is in front; otherwise the first
  // human whose tab is in front; if every tab is hidden, any online human.
  const onlineUserIds = useMemo(() => new Set([...(userId ? [userId] : []), ...peers.map((p) => p.userId)]), [userId, peers])
  const visibleUserIds = useMemo(() => {
    const out = new Set<string>()
    if (userId && visible) out.add(userId)
    for (const p of peers) if ((p.state as { vis?: boolean })?.vis !== false) out.add(p.userId)
    return out
  }, [userId, visible, peers])
  const ticker = useMemo(() => {
    if (!g) return null
    const humans = players.filter((p) => !p.data.isBot)
    const pick = (ids: Set<string>) => (ids.has(g.hostId) ? g.hostId : humans.find((p) => ids.has(p.data.userId))?.data.userId ?? null)
    return pick(visibleUserIds) ?? pick(onlineUserIds)
  }, [g, players, onlineUserIds, visibleUserIds])
  const iTick = Boolean(userId && ticker === userId)
  const inflight = useRef(false)
  useEffect(() => {
    if (!gameId || !iTick || phase === 'lobby' || phase === 'over') return
    const id = window.setInterval(() => {
      if (inflight.current) return
      inflight.current = true
      callAction('game-tick', { gameId })
        .catch(() => undefined)
        .finally(() => {
          inflight.current = false
        })
    }, TICK_MS)
    return () => window.clearInterval(id)
  }, [gameId, iTick, phase])

  // ─── banners on phase changes and events ──────────────────────────────────
  const lastPhase = useRef<string>('')
  useEffect(() => {
    if (!g) return
    const key = `${phase}:${g.meetingNo}`
    if (lastPhase.current === key) return
    const first = lastPhase.current === ''
    lastPhase.current = key
    if (first) return
    if (phase === 'play' && g.meetingNo === 0) {
      setBanner(
        g.mode === 'practice'
          ? { key: Date.now(), title: 'Practice your prompts', sub: 'Walk to a task and tell the builder what to make', tone: 'crew' }
          : { key: Date.now(), title: 'Fix up the island', sub: 'Night falls in 7 minutes', tone: 'crew' },
      )
    }
    else if (phase === 'play') setBanner({ key: Date.now(), title: 'Back to work', sub: 'The night clock is running again', tone: 'crew' })
    else if (phase === 'meeting') {
      setOrderFor(null)
      play('bell')
      setBanner({
        key: Date.now(),
        title: g.meetingReason === 'report' ? 'Something was wrecked' : 'Emergency meeting',
        sub: g.meetingReason === 'report' ? `${g.meetingCalledBy} found it at the ${g.meetingWhere}` : `${g.meetingCalledBy} rang the bell`,
        tone: 'bad',
      })
    } else if (phase === 'vote') {
      play('tick')
      setBanner({ key: Date.now(), title: 'Vote now', sub: 'Pick who to eject, or skip', tone: 'gold' })
    } else if (phase === 'eject') play('whoosh')
  }, [phase, g])

  const seenEvents = useRef<Set<string> | null>(null)
  useEffect(() => {
    if (!events.length) return
    if (!seenEvents.current) {
      seenEvents.current = new Set(events.map((e) => e.id))
      return
    }
    for (const e of events) {
      if (seenEvents.current.has(e.id)) continue
      seenEvents.current.add(e.id)
      if (e.data.kind === 'lights') {
        if (e.data.text.includes('went out')) play('alarm')
        setBanner({ key: Date.now(), title: e.data.text.includes('went out') ? 'Lights out' : 'Lights are back', sub: e.data.text, tone: 'bad' })
      }
      if (e.data.kind === 'night') setBanner({ key: Date.now(), title: 'Night is coming', sub: e.data.text, tone: 'gold' })
    }
  }, [events])

  // A task of mine just broke: tell me (only the owner learns which one).
  const myTasks = useMemo(() => (me ? tasks.filter((t) => t.data.playerId === me.id) : []), [tasks, me])
  const seenBroken = useRef(new Set<string>())
  useEffect(() => {
    for (const t of myTasks) {
      if (t.data.status !== 'broken' || seenBroken.current.has(`${t.id}:${t.data.doneAt}`)) continue
      seenBroken.current.add(`${t.id}:${t.data.doneAt}`)
      const lm = landmarkById(t.data.landmarkId)
      play('crash')
      setBanner({ key: Date.now(), title: 'Your task was wrecked', sub: `Go back to the ${lm?.name ?? 'landmark'} and redo it`, tone: 'bad' })
    }
  }, [myTasks])

  // ─── where am I, and what can I do here ───────────────────────────────────
  const playing = phase === 'play'
  const nearLandmark = useMemo(() => {
    if (!here || !playing) return null
    let best: Landmark | null = null
    let bestD = Infinity
    for (const l of LANDMARKS) {
      if (!l.area) continue
      const d = dist(l, here)
      if (d <= TASK_RANGE && d < bestD) {
        best = l
        bestD = d
      }
    }
    return best
  }, [here, playing])
  const nearBell = Boolean(here && playing && alive && dist(here, LANDMARKS[0]) <= BELL_RANGE)
  const shed = landmarkById('power_shed') as Landmark
  const nearShed = Boolean(here && playing && alive && dist(here, shed) <= SHED_RANGE)
  const nearBreak = useMemo(() => {
    if (!here || !playing || !alive) return null
    return breaks.find((b) => !b.data.reported && !b.data.fixed && dist(b.data, here) <= REPORT_RANGE) ?? null
  }, [here, playing, alive, breaks])
  const canBuild = Boolean(nearLandmark && (alive || (ghost && !isImpostor)))

  useEffect(() => {
    if (!scene) return
    if (orderFor) scene.setFocus({ x: orderFor.x, z: orderFor.z, r: 1.3 })
    else if (nearLandmark && canBuild) scene.setFocus({ x: nearLandmark.x, z: nearLandmark.z, r: 1.3 })
    else scene.setFocus(null)
  }, [scene, nearLandmark, canBuild, orderFor])

  const cancelJob = useCallback(
    (why?: string) => {
      jobToken.current++
      setJob(null)
      if (why) flash(why)
    },
    [flash],
  )

  // Leaving the landmark closes the order box and stops a build or wreck in progress.
  useEffect(() => {
    if (job && (!nearLandmark || nearLandmark.id !== job.landmarkId)) cancelJob(job.kind === 'build' ? 'You walked away, so the build stopped.' : 'You walked away, so the wreck stopped.')
    if (orderFor && (!nearLandmark || nearLandmark.id !== orderFor.id)) setOrderFor(null)
  }, [nearLandmark, orderFor, job, cancelJob])
  useEffect(() => {
    if (phase !== 'play' && job) cancelJob()
  }, [phase, job, cancelJob])

  // The box starts empty: turning the task into a prompt is the player's job.
  const openOrder = useCallback((l: Landmark) => {
    setOrderText('')
    setWreckText('')
    setResult(null)
    setOrderFor(l)
  }, [])

  // ─── moves ────────────────────────────────────────────────────────────────
  /** Start a timed job, wait at the landmark, then finish it. Returns the finish result. */
  const runJob = async (kind: 'build' | 'wreck', l: Landmark, start: Record<string, unknown>): Promise<Record<string, unknown> | null> => {
    const token = ++jobToken.current
    const t0 = Date.now()
    const ms = kind === 'build' ? BUILD_MS : WRECK_MS
    setResult(null)
    setJob({ kind, landmarkId: l.id, t0, ms, text: kind === 'build' ? 'The builder is reading your prompt' : 'Getting to work' })
    const r = await act(kind === 'build' ? 'game-build' : 'game-wreck', { landmarkId: l.id, ...start })
    if (jobToken.current !== token) return null
    if (!r || !r.pending) {
      setJob(null)
      if (r?.narration) setResult({ text: String(r.narration), feedback: [], good: false })
      return null
    }
    // Edits to things already built are quicker; the server says how long this one takes.
    const realMs = Number(r.ms) > 0 ? Number(r.ms) : ms
    setJob((j) => (j ? { ...j, ms: realMs, text: String(r.narration ?? ''), reading: (r.reading as string[] | undefined) ?? [] } : j))
    const wait = Math.max(t0 + realMs - Date.now(), Number(r.readyIn ?? 0))
    await new Promise((res) => window.setTimeout(res, Math.max(0, wait)))
    if (jobToken.current !== token) return null
    const finish = kind === 'build' ? 'game-build-finish' : 'game-wreck-finish'
    let f = await callAction(finish, { gameId, ...(myPos.current ?? {}) }).catch((e: unknown) => e)
    if (f instanceof Error && /Stay a moment/.test(f.message)) {
      await new Promise((res) => window.setTimeout(res, 900))
      f = await callAction(finish, { gameId, ...(myPos.current ?? {}) }).catch((e: unknown) => e)
    }
    if (jobToken.current !== token) return null
    setJob(null)
    if (f instanceof Error) {
      flash(f.message)
      return null
    }
    return f as Record<string, unknown>
  }

  const sendOrder = async () => {
    const text = orderText.trim()
    if (!text || !orderFor || job) return
    const f = await runJob('build', orderFor, { text })
    if (!f) return
    const done = (f.completed as string[] | undefined) ?? []
    const feedback = (f.feedback as string[] | undefined) ?? []
    play('pop')
    if (feedback.length) {
      // A miss: keep the box open with the player's own prompt, and how it was read, so they can fix it.
      setResult({ text: String(f.narration ?? 'Built.'), feedback, good: done.length > 0, reading: (f.reading as string[] | undefined) ?? [] })
      return
    }
    flash(done.length ? `Task done. ${String(f.narration ?? '')}` : String(f.narration ?? 'Built.'), done.length > 0)
    setOrderText('')
    setOrderFor(null)
  }
  const sendWreck = async (kind: 'knock' | 'paint' | 'remove' | null) => {
    if (!orderFor || job) return
    const f = await runJob('wreck', orderFor, { kind: kind ?? 'knock', text: kind ? '' : wreckText.trim() })
    if (!f) return
    play('crash')
    flash(String(f.narration ?? 'Done.'), true)
    setOrderFor(null)
  }
  const leave = async () => {
    if (confirming !== 'leave') {
      setConfirming('leave')
      return
    }
    cancelJob()
    await act('game-leave', {}, 'leave')
    navigate('/play')
  }
  const endForAll = async () => {
    if (confirming !== 'end') {
      setConfirming('end')
      return
    }
    await act('game-end', {}, 'end')
    setMenuOpen(false)
    setConfirming(null)
  }
  const report = () => act('game-report', {}, 'report')
  const ringBell = () => act('game-bell', {}, 'bell')
  const fixLights = () => act('game-fix-lights', {}, 'fix')
  const cutLights = () => act('game-lights', {}, 'lights')
  const sendChat = async () => {
    const t = chatText.trim()
    if (!t) return
    setChatText('')
    await act('game-chat', { text: t })
  }

  // Keyboard: E opens the order box, R reports, Esc closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (job) cancelJob(job.kind === 'build' ? 'Build cancelled.' : 'Wreck cancelled.')
        setOrderFor(null)
        return
      }
      if (isTyping(e) || e.metaKey || e.ctrlKey || e.altKey) return
      const k = e.key.toLowerCase()
      if (k === 'e' && nearLandmark && canBuild && !orderFor) {
        e.preventDefault()
        openOrder(nearLandmark)
      } else if (k === 'r' && nearBreak) {
        e.preventDefault()
        report()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // ─── derived view data ────────────────────────────────────────────────────
  const practice = g?.mode === 'practice'
  const nightLeft = g ? (playing ? g.nightAt - now : phase === 'meeting' || phase === 'vote' || phase === 'eject' ? g.playMsLeft : 0) : 0
  // Practice has no clock: keep it a bright afternoon.
  const elapsed = practice ? 0.2 : 1 - Math.max(0, Math.min(1, nightLeft / PLAY_MS))
  const SkyIcon = elapsed < 0.45 ? Sun : elapsed < 0.85 ? Sunset : Moon
  const taskPct = g && g.tasksTotal ? Math.round((g.tasksDone / g.tasksTotal) * 100) : 0
  const fakeList = isImpostor && Array.isArray(mySecret?.data.fakeTasks) ? (mySecret?.data.fakeTasks as string[]) : []
  const wreckWait = mySecret ? Math.max(0, mySecret.data.wreckReadyAt - now) : 0
  const lightsWait = mySecret ? Math.max(0, mySecret.data.lightsReadyAt - now) : 0
  const meetingNo = g?.meetingNo ?? 0
  const visibleChat = chat.filter((c) => c.data.meetingNo === meetingNo && c.data.showAt <= now)
  // AI lines waiting to appear show as "typing", like a real chat.
  const typingIds = [...new Set(chat.filter((c) => c.data.meetingNo === meetingNo && c.data.showAt > now && c.data.showAt - now < 3_500).map((c) => c.data.playerId))]
  const meetingVotes = votes.filter((v) => v.data.meetingNo === meetingNo)
  const myVote = me ? meetingVotes.find((v) => v.data.voterId === me.id) : undefined
  const shownVotes = meetingVotes.filter((v) => v.data.showAt <= now)
  const votedIds = new Set(shownVotes.map((v) => v.data.voterId))
  // Once every living player has voted, voting closes a few seconds after the last vote.
  const livingIds = players.filter((p) => p.data.alive).map((p) => p.id)
  const allVoted = phase === 'vote' && livingIds.length > 0 && livingIds.every((id) => votedIds.has(id))
  const voteCloseAt = allVoted ? Math.max(...shownVotes.map((v) => v.data.showAt)) + VOTE_GRACE_MS : Infinity
  const timeLeft = g ? Math.min(g.phaseEndsAt, voteCloseAt) - now : 0
  const chatEnd = useRef<HTMLDivElement>(null)
  useEffect(() => {
    chatEnd.current?.scrollIntoView({ block: 'end' })
  }, [visibleChat.length])
  const feed = events.slice(-6)

  // ─── render ───────────────────────────────────────────────────────────────
  if (!loading && !game) {
    return (
      <div className="si">
        <div className="si-overlay dim">
          <div className="si-panel si-center">
            <h2>No game called {code}</h2>
            <p className="si-small">Check the code, or start a new game.</p>
            <div className="si-row si-mt">
              <Link className="si-btn primary" to="/play">
                Back to the menu
              </Link>
            </div>
          </div>
        </div>
      </div>
    )
  }

  const ejected = g?.ejectedId ? players.find((p) => p.id === g.ejectedId) : null
  const impostorId = g?.reveal?.impostorPlayerId ?? ''

  return (
    <div className={`si phase-${phase}`}>
      <IslandView onReady={setScene} onMyMove={onMyMove} onFail={() => setWebglFailed(true)} />
      <div className="si-vignette" />
      <div ref={visionRef} className={`si-vision ${visionR === null ? 'off' : ''} ${visionR !== null && visionR < 3 ? 'dark' : ''}`} />
      {webglFailed && (
        <div className="si-overlay dim">
          <div className="si-panel">
            <h2>3D is not available here</h2>
            <p className="si-small">This browser could not start WebGL. Try Chrome or Edge on a laptop.</p>
          </div>
        </div>
      )}

      {/* ── lobby ── */}
      {g && phase === 'lobby' && (
        <div className="si-lobby">
          <div className="si-panel">
            <div className="si-eyebrow">Game code</div>
            <div className="si-row si-between">
              <div className="si-lobby-code">{g.code}</div>
              <button
                className="si-btn"
                onClick={() => {
                  navigator.clipboard?.writeText(`${window.location.origin}/g/${g.code}`).then(
                    () => flash('Invite link copied.', true),
                    () => flash(`Share this link: ${window.location.origin}/g/${g.code}`),
                  )
                }}
              >
                <LinkIcon size={15} /> Copy invite link
              </button>
            </div>
            <p className="si-small si-gap">
              Friends join with this code. Empty seats fill with AI players when the host starts. Walk around while you wait: WASD, the arrow keys, or click the ground.
            </p>
            <div className="si-seats">
              {[0, 1, 2, 3, 4, 5].map((seat) => {
                const p = players.find((x) => x.data.seat === seat)
                return (
                  <div key={seat} className={`si-seat ${p ? 'filled' : ''}`} style={{ ['--c' as string]: p?.data.color ?? SEAT_COLORS[seat] }}>
                    <span className="si-dot" />
                    {p ? `${p.data.name}${p.id === meId ? ' (you)' : ''}${p.data.userId === g.hostId ? ' · host' : ''}` : seat < MIN_PLAYERS ? 'AI player' : 'Open seat'}
                  </div>
                )
              })}
            </div>
            <div className="si-row si-between si-mt">
              <button className="si-btn" disabled={busy === 'leave'} onClick={leave}>
                <LogOut size={15} /> {confirming === 'leave' ? 'Click again to leave' : 'Leave'}
              </button>
              {isHost ? (
                <button className="si-btn primary big" disabled={busy === 'start'} onClick={() => act('game-start', {}, 'start')}>
                  {busy === 'start' ? 'Dealing roles...' : 'Start the game'}
                </button>
              ) : (
                <span className="si-pill">Waiting for the host to start</span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── role reveal ── */}
      {g && phase === 'intro' && (
        <div className="si-overlay dim">
          <div>
            <div className="si-eyebrow si-eyebrow-lg">You are</div>
            <div className={`si-big ${role === 'impostor' ? 'impostor' : role === 'crew' ? 'crew' : 'watch'}`}>{role === 'impostor' ? 'THE IMPOSTOR' : role === 'crew' ? 'CREW' : 'WATCHING'}</div>
            <div className="si-sub">
              {role === 'impostor'
                ? 'Wreck finished tasks when nobody is looking, and cut the lights to hide. If the island is not finished by night, you win.'
                : role === 'crew'
                  ? 'Walk to your tasks and tell the builder what to make. Finish every task before night, or vote out the Impostor.'
                  : 'You joined after the game started, so you can watch but not play.'}
            </div>
          </div>
        </div>
      )}

      {/* ── HUD during play ── */}
      {g && phase !== 'lobby' && phase !== 'intro' && (
        <>
          <div className="si-hud-left">
            <div className="si-row si-brandrow">
              <div className="si-title si-brand">SABOTEUR ISLAND</div>
              {phase !== 'over' && me && (
                <button
                  className="si-icon-btn"
                  aria-label="Leave or end the game"
                  aria-expanded={menuOpen}
                  onClick={() => {
                    setMenuOpen((o) => !o)
                    setConfirming(null)
                  }}
                >
                  <LogOut size={15} />
                </button>
              )}
            </div>
            {menuOpen && phase !== 'over' && me && (
              <div className="si-card si-gamemenu">
                <button className="si-btn" disabled={busy === 'leave'} onClick={leave}>
                  <LogOut size={15} /> {confirming === 'leave' ? 'Click again to leave' : practice ? 'Leave practice' : 'Leave game'}
                </button>
                {!practice && <span className="si-small">An AI player takes over your islander.</span>}
                {isHost && !practice && (
                  <>
                    <button className="si-btn red si-mt-sm" disabled={busy === 'end'} onClick={endForAll}>
                      <Power size={15} /> {confirming === 'end' ? 'Click again to end it for everyone' : 'End game for everyone'}
                    </button>
                    <span className="si-small">Nobody wins. Everyone sees who the Impostor was.</span>
                  </>
                )}
              </div>
            )}
            <div className={`si-card si-tasks-card ${isImpostor ? 'si-imp' : ''}`}>
              <div className="si-eyebrow">{isImpostor ? 'Fake tasks: pretend to do these' : ghost ? 'Your tasks (you are a ghost)' : 'Your tasks'}</div>
              {isImpostor
                ? fakeList.map((id) => {
                    const t = taskTemplate(id)
                    return t ? (
                      <div key={id} className="si-task fake">
                        <span className="box" />
                        <span>
                          <em>
                            {landmarkById(t.landmarkId)?.name} · {t.who}
                          </em>
                          <span className="si-req">{t.request}</span>
                        </span>
                      </div>
                    ) : null
                  })
                : myTasks.map((task) => {
                    const t = taskTemplate(task.data.templateId)
                    if (!t) return null
                    return (
                      <div key={task.id} className={`si-task ${task.data.status}`}>
                        <span className="box">{task.data.status === 'done' ? '✓' : task.data.status === 'broken' ? '!' : ''}</span>
                        <span>
                          <em>
                            {task.data.status === 'broken' ? `Wrecked at the ${landmarkById(t.landmarkId)?.name}` : landmarkById(t.landmarkId)?.name} · {t.who}
                          </em>
                          {task.data.status === 'done' ? (
                            <b>Done: {t.text}</b>
                          ) : task.data.status === 'broken' ? (
                            <span className="si-req">Someone wrecked it. Go back and build it again: {t.text}.</span>
                          ) : (
                            <span className="si-req">{t.request}</span>
                          )}
                        </span>
                      </div>
                    )
                  })}
              <div className="si-eyebrow si-mt-sm">Crew task bar</div>
              <div className="si-progress">
                <i style={{ width: `${taskPct}%` }} />
              </div>
              <div className="si-small">
                {g.tasksDone} of {g.tasksTotal} tasks done
              </div>
            </div>
            {isImpostor && alive && playing && (
              <div className="si-card si-imp">
                <div className="si-eyebrow">Impostor tricks</div>
                <div className="si-small">Wreck: {wreckWait > 0 ? `ready in ${Math.ceil(wreckWait / 1000)}s` : 'ready. Walk up to a finished task.'}</div>
                <button className="si-btn red wide si-mt-sm" disabled={lightsWait > 0 || lightsOut || busy === 'lights'} onClick={cutLights}>
                  <Zap size={15} /> {lightsWait > 0 ? `Cut the lights (${Math.ceil(lightsWait / 1000)}s)` : 'Cut the lights'}
                </button>
              </div>
            )}
            {feed.length > 0 && (
              <div className="si-card si-feed-card">
                <div className="si-feed">
                  {feed.map((e) => (
                    <div key={e.id} className={`si-entry sys ${e.data.kind === 'eject' || e.data.kind === 'lights' || e.data.kind === 'meeting' ? 'bad' : ''}`}>
                      {e.data.text}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="si-hud-right">
            <div className="si-card">
              <div className="si-row si-between">
                <div>
                  <div className="si-eyebrow si-tight">{practice ? 'Practice' : phase === 'over' ? 'Game over' : phase === 'play' ? 'Night falls in' : 'Clock paused'}</div>
                  {practice ? (
                    <div className="si-timer si-practice-timer">No clock</div>
                  ) : (
                    <div className={`si-timer ${nightLeft < 60_000 && phase === 'play' ? 'low' : ''}`}>{phase === 'over' ? '0:00' : fmtClock(nightLeft)}</div>
                  )}
                </div>
                <div className="si-row">
                  <SkyIcon size={30} className="si-sky" />
                  <button
                    className="si-icon-btn"
                    aria-label={muted ? 'Turn sound on' : 'Mute'}
                    onClick={() => {
                      setMuted(!muted)
                      setMutedState(!muted)
                    }}
                  >
                    {muted ? <VolumeX size={15} /> : <Volume2 size={15} />}
                  </button>
                </div>
              </div>
              {practice ? (
                <div className="si-small si-mt-sm">Just you and the builder. Take your time.</div>
              ) : (
                <div className="si-skybar">
                  <i style={{ width: `${Math.round(elapsed * 100)}%` }} />
                </div>
              )}
            </div>
            {(playing || phase === 'meeting' || phase === 'vote') && (
              <div className="si-card si-map-card">
                <MiniMap
                  me={here}
                  todo={new Set(isImpostor ? fakeList.map((id) => taskTemplate(id)?.landmarkId ?? '') : myTasks.filter((t) => t.data.status === 'todo').map((t) => t.data.landmarkId))}
                  broken={new Set(myTasks.filter((t) => t.data.status === 'broken').map((t) => t.data.landmarkId))}
                  lightsOut={lightsOut}
                />
              </div>
            )}
            <div className="si-card si-players">
              <div className="si-eyebrow">Players</div>
              {players.map((p) => (
                <PlayerLine key={p.id} p={p} me={meId} impostorId={phase === 'over' ? impostorId : ''} voted={phase === 'vote' && votedIds.has(p.id)} />
              ))}
            </div>
          </div>

          {playing && me && (alive || ghost) && !orderFor && (
            <div className="si-actions">
              {canBuild && (
                <button className="si-btn primary" onClick={() => nearLandmark && openOrder(nearLandmark)}>
                  <Hammer size={16} /> {isImpostor ? 'Use' : 'Build'} at the {nearLandmark?.name} <kbd>E</kbd>
                </button>
              )}
              {nearBreak && (
                <button className="si-btn red" disabled={busy === 'report'} onClick={report}>
                  <Megaphone size={16} /> Report the wreck <kbd>R</kbd>
                </button>
              )}
              {nearShed && lightsOut && (
                <button className="si-btn" disabled={busy === 'fix'} onClick={fixLights}>
                  <Wrench size={16} /> Fix the lights
                </button>
              )}
              {nearBell && !practice && (
                <button className="si-btn red" disabled={(me.data.bellsLeft ?? 0) <= 0 || busy === 'bell' || (g?.bellLockUntil ?? 0) > now} onClick={ringBell}>
                  <Bell size={16} /> {(me.data.bellsLeft ?? 0) > 0 ? 'Ring the bell' : 'Bell already used'}
                </button>
              )}
            </div>
          )}

          {playing && me && !orderFor && (
            <div className="si-walkhint">
              {ghost ? (
                <>
                  <Ghost size={13} /> You are a ghost. Finish your tasks to help the crew.
                </>
              ) : (
                'WASD or click to walk. Swipe with two fingers or drag to look around. Walk up to a landmark to work there.'
              )}
            </div>
          )}

          {orderFor && playing && (
            <div className="si-order">
              <div className="si-card">
                <div className="si-row si-between">
                  <div>
                    <div className="si-eyebrow si-tight">At the</div>
                    <div className="si-role">{orderFor.name}</div>
                  </div>
                  <button
                    className="si-icon-btn"
                    aria-label="Close"
                    onClick={() => {
                      if (job) cancelJob(job.kind === 'build' ? 'Build cancelled.' : 'Wreck cancelled.')
                      setOrderFor(null)
                    }}
                  >
                    <X size={16} />
                  </button>
                </div>
                {(() => {
                  // What this player is here for: the task details, never a ready made prompt.
                  const ids = isImpostor ? fakeList : myTasks.filter((t) => t.data.status !== 'done').map((t) => t.data.templateId)
                  const here = ids.map((id) => taskTemplate(id)).filter((t) => t && t.landmarkId === orderFor.id)
                  if (!here.length) return <div className="si-small si-mt-sm">{isImpostor ? 'None of your fake tasks are here.' : 'You have no task here. You can still build.'}</div>
                  return here.map((t) =>
                    t ? (
                      <div key={t.id} className="si-taskhere">
                        <div className="si-eyebrow si-tight">{isImpostor ? `Fake task: ${t.who} asks` : `${t.who} asks`}</div>
                        <span className="si-req">{t.request}</span>
                      </div>
                    ) : null,
                  )
                })()}
                {isImpostor && (
                  <div className="si-wreck">
                    <div className="si-eyebrow si-mt-sm">Wreck a finished task here {wreckWait > 0 ? `(ready in ${Math.ceil(wreckWait / 1000)}s)` : ''}</div>
                    <div className="si-row">
                      <button className="si-btn red" disabled={wreckWait > 0 || !!job} onClick={() => sendWreck('knock')}>
                        <Undo2 size={15} /> Knock over
                      </button>
                      <button className="si-btn red" disabled={wreckWait > 0 || !!job} onClick={() => sendWreck('paint')}>
                        <Paintbrush size={15} /> Paint black
                      </button>
                      <button className="si-btn red" disabled={wreckWait > 0 || !!job} onClick={() => sendWreck('remove')}>
                        <Trash2 size={15} /> Take away
                      </button>
                    </div>
                    <form
                      className="si-bar si-mt-sm"
                      onSubmit={(e) => {
                        e.preventDefault()
                        if (wreckText.trim()) sendWreck(null)
                      }}
                    >
                      <input value={wreckText} maxLength={ORDER_MAX_CHARS} onChange={(e) => setWreckText(e.target.value)} placeholder="Or say it: paint the bird green" />
                      <button className="si-send red" type="submit" disabled={!wreckText.trim() || wreckWait > 0 || !!job} aria-label="Wreck">
                        <SendHorizontal size={18} />
                      </button>
                    </form>
                    <div className="si-eyebrow si-mt">Or build something to look busy</div>
                  </div>
                )}
                {job && (
                  <div className={`si-job ${job.kind}`} role="status" aria-live="polite">
                    <svg className="si-ring" viewBox="0 0 36 36" aria-hidden="true">
                      <circle className="track" cx="18" cy="18" r="15.5" />
                      <circle key={job.t0} className="fill" cx="18" cy="18" r="15.5" style={{ animationDuration: `${job.ms}ms` }} />
                    </svg>
                    <div>
                      <b>
                        {job.kind === 'wreck' ? 'Wrecking' : job.ms <= EDIT_MS ? 'Changing' : 'Building'} {Math.max(0, Math.ceil((job.t0 + job.ms - Date.now()) / 1000))}s
                      </b>
                      {job.reading?.length ? (
                        job.reading.map((l) => <span key={l}>{l}</span>)
                      ) : (
                        <span>{job.kind === 'build' ? 'The builder is reading your prompt' : job.text.replace(/\.+$/, '')}. Stay here until it is done.</span>
                      )}
                    </div>
                  </div>
                )}
                {result && !job && (
                  <div className={`si-result ${result.good ? 'good' : ''}`} role="status" aria-live="polite">
                    {result.reading?.length ? result.reading.map((l) => <i key={l}>{l}</i>) : <b>{result.text}</b>}
                    {result.feedback.map((f) => (
                      <span key={f}>{f}</span>
                    ))}
                    <small>Try again, or fix it: "make it yellow", "move them to the pond", "remove one".</small>
                  </div>
                )}
                <form
                  className="si-bar si-mt-sm"
                  onSubmit={(e) => {
                    e.preventDefault()
                    sendOrder()
                  }}
                >
                  <input
                    autoFocus={!isImpostor}
                    value={orderText}
                    maxLength={ORDER_MAX_CHARS}
                    onChange={(e) => setOrderText(e.target.value)}
                    placeholder="Write your prompt: what, how many, what color, and where"
                    disabled={!!job}
                  />
                  <button className="si-send" type="submit" disabled={!orderText.trim() || !!job} aria-label="Build">
                    <SendHorizontal size={18} />
                  </button>
                </form>
                <div className="si-small si-mt-sm">The builder follows your words. Anything you leave out, it fills in its own way. Esc to close.</div>
              </div>
            </div>
          )}

          {lightsOut && playing && (
            <div className="si-lights">
              <Zap size={15} /> {isImpostor ? 'You cut the lights.' : 'The lights are out. Fix them at the Power Shed.'} {fmtClock(g.lightsOutUntil - now)}
            </div>
          )}
        </>
      )}

      {/* ── meeting and vote ── */}
      {g && (phase === 'meeting' || phase === 'vote') && (
        <div className="si-meeting">
          <div className="si-card si-meeting-head">
            <div className="si-row si-between">
              <div>
                <div className="si-eyebrow si-tight">{g.meetingReason === 'report' ? `Wrecked at the ${g.meetingWhere}` : `Called by ${g.meetingCalledBy}`}</div>
                <div className="si-role">{phase === 'meeting' ? 'Discuss' : 'Vote'}</div>
              </div>
              <div className={`si-timer ${timeLeft < 10_000 ? 'low' : ''}`}>{fmtClock(timeLeft)}</div>
            </div>
          </div>
          <div className="si-card si-grow">
            <div className="si-eyebrow">Chat</div>
            <div className="si-chat">
              {visibleChat.length === 0 && <div className="si-small">Nobody has spoken yet. Who was near the wreck?</div>}
              {visibleChat.map((c) => (
                <div key={c.id} className={`si-msg ${c.data.playerId === meId ? 'mine' : ''}`} style={{ ['--c' as string]: colorOf(c.data.playerId) }}>
                  <span className="av" />
                  <div className="b">
                    <b>{nameOf(c.data.playerId)}</b>
                    {c.data.text}
                  </div>
                </div>
              ))}
              {typingIds.length > 0 && (
                <div className="si-typing">
                  <span className="si-dots">
                    <i />
                    <i />
                    <i />
                  </span>
                  {typingIds.map(nameOf).join(' and ')} {typingIds.length > 1 ? 'are' : 'is'} typing
                </div>
              )}
              <div ref={chatEnd} />
            </div>
            {me && alive && (
              <form
                className="si-bar si-mt-sm"
                onSubmit={(e) => {
                  e.preventDefault()
                  sendChat()
                }}
              >
                <input value={chatText} maxLength={CHAT_MAX_CHARS} onChange={(e) => setChatText(e.target.value)} placeholder="Say something. Name someone to ask them directly." />
                <button className="si-send" type="submit" disabled={!chatText.trim()} aria-label="Send message">
                  <SendHorizontal size={18} />
                </button>
              </form>
            )}
            {ghost && <div className="si-small si-mt-sm">Ghosts cannot talk or vote.</div>}
          </div>
          {phase === 'vote' && (
            <div className="si-card">
              <div className="si-eyebrow">
                {allVoted ? 'Everyone has voted. Closing now' : myVote ? 'You voted. You can change it until time runs out' : me && alive ? 'Who is the Impostor?' : 'Votes'}
              </div>
              <div className="si-votes">
                {players
                  .filter((p) => p.data.alive)
                  .map((p) => (
                    <button
                      key={p.id}
                      className={`si-vote ${myVote?.data.targetId === p.id ? 'picked' : ''}`}
                      style={{ ['--c' as string]: p.data.color }}
                      disabled={!me || !alive || p.id === meId || myVote?.data.targetId === p.id}
                      onClick={() => act('game-vote', { targetId: p.id })}
                    >
                      <span className="si-dot" />
                      {p.data.name}
                      {votedIds.has(p.id) && <span className="voted">voted</span>}
                    </button>
                  ))}
                <button className={`si-vote skip ${myVote?.data.targetId === 'skip' ? 'picked' : ''}`} disabled={!me || !alive || myVote?.data.targetId === 'skip'} onClick={() => act('game-vote', { targetId: 'skip' })}>
                  Skip vote
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── ejection ── */}
      {g && phase === 'eject' && <Ejection key={`${g.meetingNo}`} name={ejected?.data.name ?? ''} color={ejected?.data.color ?? SEAT_COLORS[0]} wasImpostor={Boolean(g.ejectedWasImpostor)} />}

      {/* ── game over ── */}
      {g && phase === 'over' && showOver && !hideOver && (
        <div className="si-overlay dim">
          <div className="si-panel">
            <div className={`si-eyebrow ${g.winner === 'crew' ? 'good' : g.winner ? 'bad' : ''}`}>
              {practice ? 'Practice' : g.winner === 'crew' ? 'Crew wins' : g.winner ? 'Impostor wins' : 'Game ended'}
            </div>
            <h2>
              {practice
                ? g.winner
                  ? 'Practice complete'
                  : 'Practice ended'
                : !g.winner
                ? 'No winner this time'
                : role
                  ? (g.winner === 'crew') === (role === 'crew')
                    ? 'You won'
                    : 'You lost'
                  : g.winner === 'crew'
                    ? 'The crew won'
                    : 'The Impostor won'}
            </h2>
            <p className="si-small">{g.winReason}</p>
            {impostorId && (
            <div className="si-card si-imp si-mt">
              <div className="si-eyebrow">The Impostor was</div>
              <div className="si-row">
                <IslanderIcon color={colorOf(impostorId)} size={44} />
                <div className="si-role impostor">{impostorId === meId ? 'You' : nameOf(impostorId)}</div>
              </div>
              <div className="si-small si-mt-sm">
                {g.reveal?.wrecks ? `They wrecked ${g.reveal.wrecks} finished ${g.reveal.wrecks === 1 ? 'task' : 'tasks'}.` : 'They never wrecked a finished task.'} The crew finished {g.tasksDone} of {g.tasksTotal} tasks.
              </div>
            </div>
            )}
            {role === 'crew' && myTasks.length > 0 && (
              <div className="si-card si-mt-sm si-prompts">
                <div className="si-eyebrow">Your prompts</div>
                <div className="si-small">
                  {(() => {
                    const first = myTasks.filter((t) => t.data.firstTry).length
                    const tries = myTasks.reduce((n, t) => n + (t.data.tries ?? 0), 0)
                    return `${first} of ${myTasks.length} tasks done on the first prompt. ${tries} ${tries === 1 ? 'prompt' : 'prompts'} sent for your tasks.`
                  })()}
                </div>
              </div>
            )}
            <div className="si-row si-between si-mt">
              <button className="si-btn" onClick={() => setHideOver(true)}>
                Look around
              </button>
              <div className="si-row">
                <Link className="si-btn" to="/play">
                  Menu
                </Link>
                {practice ? (
                  <button
                    className="si-btn primary"
                    disabled={busy === 'practice'}
                    onClick={async () => {
                      const r = await act('game-practice', {}, 'practice')
                      if (r && typeof r.code === 'string') navigate(`/g/${r.code}`)
                    }}
                  >
                    Practice again
                  </button>
                ) : g.nextCode ? (
                  <button className="si-btn primary" onClick={() => navigate(`/g/${g.nextCode}`)}>
                    Join the rematch
                  </button>
                ) : me ? (
                  <button
                    className="si-btn primary"
                    disabled={busy === 'rematch'}
                    onClick={async () => {
                      const r = await act('game-rematch', {}, 'rematch')
                      if (r && typeof r.code === 'string') navigate(`/g/${r.code}`)
                    }}
                  >
                    Play again
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      )}
      {g && phase === 'over' && hideOver && (
        <div className="si-actions">
          <button className="si-btn primary" onClick={() => setHideOver(false)}>
            Show results
          </button>
        </div>
      )}

      {banner && (
        <div className={`si-banner ${banner.tone}`} key={banner.key}>
          <div className="t">
            {banner.title}
            {banner.sub && <small>{banner.sub}</small>}
          </div>
        </div>
      )}
      {toast && <div className={`si-toast ${toast.good ? 'good' : ''}`}>{toast.text}</div>}
      {loading && (
        <div className="si-overlay">
          <span className="si-pill">Loading the island...</span>
        </div>
      )}
    </div>
  )
}

function PlayerLine({ p, me, impostorId, voted }: { p: Rec<PlayerRow>; me?: string; impostorId: string; voted: boolean }) {
  const tag = p.id === impostorId ? 'Impostor' : p.id === me ? 'You' : p.data.isBot ? 'AI' : ''
  return (
    <div className={`p ${p.data.alive ? '' : 'out'}`}>
      <span className="si-dot" style={{ ['--c' as string]: p.data.color }} />
      <span className="nm">{p.data.name}</span>
      {voted && <span className="tag good">voted</span>}
      {tag && <span className={`tag ${p.id === impostorId ? 'bad' : ''}`}>{tag}</span>}
    </div>
  )
}

function Ejection({ name, color, wasImpostor }: { name: string; color: string; wasImpostor: boolean }) {
  const full = name ? `${name} was ${wasImpostor ? 'the Impostor.' : 'not the Impostor.'}` : 'Nobody was ejected.'
  const [shown, setShown] = useState('')
  useEffect(() => {
    let i = 0
    let id = 0
    const start = window.setTimeout(() => {
      id = window.setInterval(() => {
        i++
        setShown(full.slice(0, i))
        if (i >= full.length) window.clearInterval(id)
      }, 70)
    }, 1600)
    return () => {
      window.clearTimeout(start)
      window.clearInterval(id)
    }
  }, [full])
  return (
    <div className="si-eject" style={{ animation: `si-in .5s ease both, si-fade-out .6s ease ${EJECT_MS / 1000 - 0.7}s both` }}>
      <div className="stars" />
      {name && (
        <div className="who">
          <IslanderIcon color={color} />
        </div>
      )}
      <div className="line">
        {shown}
        <span className="caret">|</span>
      </div>
    </div>
  )
}

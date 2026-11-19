/**
 * The game screen: the 3D island plus every HUD panel and overlay. Records
 * come in through useGameData; moves go out through server actions.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth, usePresenceRoom } from 'deepspace'
import { callAction } from '../api'
import { CHAT_MAX_CHARS, EJECT_MS, GOAL_TEXT, MIN_PLAYERS, ORDER_MAX_CHARS, ROUNDS, SEAT_COLORS } from '../constants'
import type { BuildType } from '../catalog'
import { secretStatus, taskProgress, taskStatus, themeById } from '../rules'
import type { IslandScene } from '../scene/IslandScene'
import { fmtClock, useGameData, useNow, type Rec } from '../useGame'
import type { PlayerRow } from '../types'
import { IslandView } from './IslandView'
import { IslanderIcon } from './IslanderIcon'
import '../game.css'

const CHIPS = ['Three cottages by the pond', 'A dock and a fishing boat', 'A lighthouse on the cliff', 'Lanterns along the paths', 'Make it rain']

type Banner = { key: number; title: string; sub?: string; color?: string }

export function GameScreen({ code }: { code: string }) {
  const { userId } = useAuth()
  const navigate = useNavigate()
  const { loading, game, players, secrets, builds, orders, chat, votes, events } = useGameData(code)
  const now = useNow()
  const [scene, setScene] = useState<IslandScene | null>(null)
  const [webglFailed, setWebglFailed] = useState(false)
  const [banner, setBanner] = useState<Banner | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [orderText, setOrderText] = useState('')
  const [chatText, setChatText] = useState('')
  const [hideOver, setHideOver] = useState(false)
  const [showOver, setShowOver] = useState(false)

  const gameId = game?.id ?? ''
  const g = game?.data
  const phase = g?.phase ?? 'lobby'
  const me = players.find((p) => p.data.userId === userId) ?? null
  const mySecret = me ? secrets.find((s) => s.data.playerId === me.id) ?? null : null
  const role = mySecret?.data.role ?? null
  const isHost = Boolean(g && userId && g.hostId === userId)
  const alive = Boolean(me?.data.alive)
  const lightsOut = Boolean(g && g.lightsOutUntil > now)
  const presence = usePresenceRoom(`game:${gameId || 'pending'}`)
  const nameOf = useCallback((id: string) => players.find((p) => p.id === id)?.data.name ?? 'Someone', [players])
  const colorOf = useCallback((id: string) => players.find((p) => p.id === id)?.data.color ?? '#7cf7ff', [players])

  const flash = useCallback((msg: string) => {
    setToast(msg)
    window.setTimeout(() => setToast((t) => (t === msg ? null : t)), 3200)
  }, [])

  const act = useCallback(
    async (name: string, params: Record<string, unknown> = {}, label?: string) => {
      if (label) setBusy(label)
      try {
        return await callAction(name, { gameId, ...params })
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
  const buildsSynced = useRef(false)
  useEffect(() => {
    if (!scene) return
    const list = builds.map((b) => ({ id: b.id, ...b.data }))
    scene.setBuilds(list, buildsSynced.current)
    if (list.length) buildsSynced.current = true
  }, [scene, builds])

  useEffect(() => {
    if (!scene) return
    scene.setPlayers(
      players.map((p) => ({ id: p.id, name: p.data.name, color: p.data.color, alive: Boolean(p.data.alive) || (phase === 'eject' && g?.ejectedId === p.id), isMe: p.id === me?.id, seat: p.data.seat })),
    )
  }, [scene, players, me?.id, phase, g?.ejectedId])

  useEffect(() => {
    if (scene && g) scene.setEnvironment(g.timeOfDay || 'day', g.weather || 'clear')
  }, [scene, g?.timeOfDay, g?.weather, g])

  useEffect(() => {
    scene?.setLightsOut(lightsOut)
  }, [scene, lightsOut])

  useEffect(() => {
    scene?.setMeeting(phase === 'meeting' || phase === 'vote')
  }, [scene, phase])

  const building = orders.some((o) => o.data.status === 'building')
  useEffect(() => {
    scene?.setAgentWorking(building ? '#7cf7ff' : null)
  }, [scene, building])

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

  const revealed = useRef(false)
  useEffect(() => {
    if (!scene || phase !== 'over' || !g?.reveal || revealed.current) return
    revealed.current = true
    const ids = g.reveal.sabotageBuildIds ?? []
    window.setTimeout(() => scene.revealBuilds(ids), 1200)
    window.setTimeout(() => setShowOver(true), ids.length ? 5200 : 1500)
  }, [scene, phase, g?.reveal, g])

  // ─── presence: walking, and who is online ─────────────────────────────────
  const { peers, updateState } = presence
  const lastPeerPos = useRef(new Map<string, string>())
  useEffect(() => {
    if (!scene) return
    for (const peer of peers) {
      const st = peer.state as { pid?: string; x?: number; z?: number }
      if (!st.pid || typeof st.x !== 'number' || typeof st.z !== 'number') continue
      const key = `${st.x.toFixed(2)},${st.z.toFixed(2)}`
      if (lastPeerPos.current.get(st.pid) === key) continue
      lastPeerPos.current.set(st.pid, key)
      scene.walkTo(st.pid, st.x, st.z, true)
    }
  }, [scene, peers])

  const onGroundClick = useCallback(
    (x: number, z: number) => {
      if (!scene || !me || !alive || (phase !== 'build' && phase !== 'lobby' && phase !== 'intro')) return
      scene.walkTo(me.id, x, z)
      updateState({ pid: me.id, x, z })
    },
    [scene, me, alive, phase, updateState],
  )

  // ─── the clock: one browser advances the game ─────────────────────────────
  const onlineUserIds = useMemo(() => new Set([...(userId ? [userId] : []), ...peers.map((p) => p.userId)]), [userId, peers])
  const ticker = useMemo(() => {
    if (!g) return null
    if (onlineUserIds.has(g.hostId)) return g.hostId
    const humans = players.filter((p) => !p.data.isBot && onlineUserIds.has(p.data.userId))
    return humans[0]?.data.userId ?? null
  }, [g, players, onlineUserIds])
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
    }, 2000)
    return () => window.clearInterval(id)
  }, [gameId, iTick, phase])

  // ─── banners on phase changes and events ──────────────────────────────────
  const lastPhase = useRef<string>('')
  useEffect(() => {
    if (!g) return
    const key = `${phase}:${g.round}:${g.meetingNo}`
    if (lastPhase.current === key) return
    const first = lastPhase.current === ''
    lastPhase.current = key
    if (first) return
    if (phase === 'build' && g.ejectedId === '') {
      const sub = g.round === 1 ? 'Give the agent your orders' : g.round === ROUNDS ? 'The last round. Night falls.' : 'The sun is going down'
      setBanner({ key: Date.now(), title: `Round ${g.round}`, sub, color: '#7cf7ff' })
    } else if (phase === 'meeting') {
      setBanner({ key: Date.now(), title: g.finalMeeting ? 'Final vote' : 'Emergency meeting', sub: g.finalMeeting ? 'Last chance to catch the Impostor' : `Called by ${g.meetingCalledBy}`, color: '#ff4d6d' })
    } else if (phase === 'vote') {
      setBanner({ key: Date.now(), title: 'Vote now', sub: 'Pick who to eject, or skip', color: '#ffd166' })
    }
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
      if (e.data.kind === 'lights') setBanner({ key: Date.now(), title: e.data.text.includes('fixed') ? 'Lights are back' : 'Lights out!', sub: e.data.text, color: '#ff4d6d' })
    }
  }, [events])

  // ─── moves ────────────────────────────────────────────────────────────────
  const sendOrder = async (text: string) => {
    const t = text.trim()
    if (!t || busy) return
    setOrderText('')
    if (me && scene) {
      const pos = scene.getCharacterPos(me.id)
      if (pos) updateState({ pid: me.id, x: pos.x, z: pos.z })
    }
    await act('game-order', { text: t }, 'order')
  }
  const sendChat = async () => {
    const t = chatText.trim()
    if (!t) return
    setChatText('')
    await act('game-chat', { text: t })
  }
  const callMeeting = () => {
    if (phase === 'build' && alive && (me?.data.meetingsLeft ?? 0) > 0) act('game-meeting', {}, 'meeting')
  }

  // ─── derived view data ────────────────────────────────────────────────────
  const buildData = useMemo(() => builds.map((b) => b.data), [builds])
  const progress = taskProgress(buildData)
  const tasks = taskStatus(buildData)
  const theme = mySecret?.data.themeId ? themeById(mySecret.data.themeId) : null
  const secretList = theme && me ? secretStatus(buildData, me.id, theme) : []
  const timeLeft = g ? g.phaseEndsAt - now : 0
  const meetingNo = g?.meetingNo ?? 0
  const visibleChat = chat.filter((c) => c.data.meetingNo === meetingNo && c.data.showAt <= now)
  const meetingVotes = votes.filter((v) => v.data.meetingNo === meetingNo)
  const myVote = me ? meetingVotes.find((v) => v.data.voterId === me.id) : undefined
  const votedIds = new Set(meetingVotes.filter((v) => v.data.showAt <= now).map((v) => v.data.voterId))
  const chatEnd = useRef<HTMLDivElement>(null)
  useEffect(() => {
    chatEnd.current?.scrollIntoView({ block: 'end' })
  }, [visibleChat.length])

  const feed = useMemo(() => {
    const items: { at: number; key: string; kind: 'order' | 'sys' | 'bad'; text: string; narration?: string }[] = []
    for (const o of orders) items.push({ at: o.data.at, key: o.id, kind: 'order', text: o.data.text, narration: o.data.status === 'building' ? 'Building...' : o.data.narration })
    for (const e of events) items.push({ at: e.data.at, key: e.id, kind: e.data.kind === 'eject' || e.data.kind === 'lights' ? 'bad' : 'sys', text: e.data.text })
    return items.sort((a, b) => a.at - b.at).slice(-60)
  }, [orders, events])
  const feedEnd = useRef<HTMLDivElement>(null)
  useEffect(() => {
    feedEnd.current?.scrollIntoView({ block: 'end' })
  }, [feed.length])

  // ─── render ───────────────────────────────────────────────────────────────
  if (!loading && !game) {
    return (
      <div className="si">
        <div className="si-overlay dim">
          <div className="si-panel" style={{ textAlign: 'center' }}>
            <h2>No game called {code}</h2>
            <p className="si-small">Check the code, or start a new game.</p>
            <div className="si-row" style={{ justifyContent: 'center', marginTop: 16 }}>
              <Link className="si-btn primary" to="/play">Back to the menu</Link>
            </div>
          </div>
        </div>
      </div>
    )
  }

  const ejected = g?.ejectedId ? players.find((p) => p.id === g.ejectedId) : null
  const impostorId = g?.reveal?.impostorPlayerId ?? ''
  const revealTheme = g?.reveal ? themeById(g.reveal.themeId) : null
  const sabotageTypes = g?.reveal
    ? [...new Set(g.reveal.sabotageBuildIds.map((id) => builds.find((b) => b.id === id)?.data.type).filter(Boolean) as string[])]
    : []

  return (
    <div className="si">
      <IslandView onReady={setScene} onGroundClick={onGroundClick} onBellClick={callMeeting} onFail={() => setWebglFailed(true)} />
      <div className={`si-vignette ${lightsOut ? 'dark' : ''}`} />
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
        <div className="si-overlay dim">
          <div className="si-panel">
            <div className="si-eyebrow">Game code</div>
            <div className="si-row" style={{ justifyContent: 'space-between' }}>
              <div className="si-lobby-code">{g.code}</div>
              <button
                className="si-btn"
                onClick={() => {
                  navigator.clipboard?.writeText(`${window.location.origin}/g/${g.code}`).then(
                    () => flash('Invite link copied.'),
                    () => flash(`Share this link: ${window.location.origin}/g/${g.code}`),
                  )
                }}
              >
                Copy invite link
              </button>
            </div>
            <p className="si-small" style={{ margin: '6px 0 16px' }}>
              Friends join with this code. Empty seats fill with AI players when the host starts, so one person can play a full game.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {[0, 1, 2, 3, 4, 5].map((seat) => {
                const p = players.find((x) => x.data.seat === seat)
                return (
                  <div key={seat} className={`si-seat ${p ? 'filled' : ''}`} style={{ ['--c' as string]: p?.data.color ?? SEAT_COLORS[seat] }}>
                    <span className="si-dot" />
                    {p ? `${p.data.name}${p.id === me?.id ? ' (you)' : ''}${p.data.userId === g.hostId ? ' · host' : ''}` : seat < MIN_PLAYERS ? 'AI player' : 'Open seat'}
                  </div>
                )
              })}
            </div>
            <div className="si-row" style={{ marginTop: 18, justifyContent: 'space-between' }}>
              <Link className="si-btn" to="/play">Leave</Link>
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
            <div className="si-eyebrow" style={{ fontSize: 12 }}>You are</div>
            {role ? (
              <div className="si-big" style={{ color: role === 'impostor' ? '#ff4d6d' : '#7cf7ff', textShadow: `0 0 40px ${role === 'impostor' ? 'rgba(255,77,109,.6)' : 'rgba(124,247,255,.5)'}` }}>
                {role === 'impostor' ? 'THE IMPOSTOR' : 'CREW'}
              </div>
            ) : (
              <div className="si-big" style={{ color: '#a9a3d6' }}>WATCHING</div>
            )}
            <div className="si-sub">
              {role === 'impostor' && theme
                ? `Secret goal: ${theme.goal} Phrase your orders so they sound harmless. You can also cut the lights once per round.`
                : role === 'crew'
                  ? `${GOAL_TEXT}. Watch who walks to every new build. One player is sneaking in things that do not belong.`
                  : 'You joined after the game started, so you can watch but not play.'}
            </div>
          </div>
        </div>
      )}

      {/* ── HUD during play ── */}
      {g && phase !== 'lobby' && phase !== 'intro' && (
        <>
          <div className="si-hud-left">
            <div className="si-title si-brand">SABOTEUR ISLAND</div>
            <div className="si-card">
              <div className="si-row" style={{ justifyContent: 'space-between' }}>
                <div>
                  <div className="si-eyebrow" style={{ marginBottom: 2 }}>
                    {phase === 'meeting' ? 'Meeting' : phase === 'vote' ? 'Voting' : phase === 'over' ? 'Game over' : `Round ${g.round} of ${ROUNDS}`}
                  </div>
                  <div className={`si-timer ${timeLeft < 10_000 && phase !== 'over' ? 'low' : ''}`}>{phase === 'over' ? '0:00' : fmtClock(timeLeft)}</div>
                </div>
                {me ? (
                  <span className="si-pill">
                    <span className="si-dot" style={{ ['--c' as string]: me.data.color }} />
                    {alive ? 'Alive' : 'Ejected'}
                  </span>
                ) : (
                  <span className="si-pill">Watching</span>
                )}
              </div>
            </div>
            <div className="si-card si-tasks-card">
              <div className="si-eyebrow">Crew tasks</div>
              <div className="si-progress"><i style={{ width: `${Math.round(progress * 100)}%` }} /></div>
              {tasks.map((t) => (
                <div key={t.type} className={`si-task ${t.done ? 'done' : ''}`}>
                  <span className="box">{t.done ? '✓' : ''}</span>
                  {t.label} <span style={{ marginLeft: 'auto', color: 'var(--muted)' }}>{t.have}/{t.need}</span>
                </div>
              ))}
            </div>
            {role === 'impostor' && theme && (
              <div className="si-card si-imp">
                <div className="si-eyebrow">Your secret goal</div>
                <div className="si-role impostor" style={{ fontSize: 16, marginBottom: 6 }}>{theme.title}</div>
                {secretList.map((s) => (
                  <div key={s.target} className={`si-task ${s.done ? 'done' : ''}`}>
                    <span className="box" style={s.done ? { background: 'var(--red)', borderColor: 'var(--red)' } : undefined}>{s.done ? '✓' : ''}</span>
                    {labelFor(s.target)}
                  </div>
                ))}
                <button
                  className="si-btn red wide"
                  style={{ marginTop: 10 }}
                  disabled={phase !== 'build' || lightsOut || (mySecret?.data.sabotagesUsed ?? 0) >= 1 || !alive}
                  onClick={() => act('game-sabotage', {}, 'sabotage')}
                >
                  Cut the lights
                </button>
              </div>
            )}
            {role === 'crew' && (
              <div className="si-card">
                <div className="si-eyebrow">Your role</div>
                <div className="si-role crew">Crew</div>
                <div className="si-small">Watch who walks to each new build. Ring the bell if something does not belong.</div>
              </div>
            )}
          </div>

          <div className="si-hud-right">
            <div className="si-card si-players">
              <div className="si-eyebrow">Players</div>
              {players.map((p) => (
                <PlayerLine key={p.id} p={p} me={me?.id} impostorId={phase === 'over' ? impostorId : ''} voted={phase === 'vote' && votedIds.has(p.id)} />
              ))}
            </div>
            {phase !== 'meeting' && phase !== 'vote' && (
              <div className="si-card si-feed-card" style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                <div className="si-eyebrow">Island feed</div>
                <div className="si-feed">
                  {feed.map((f) =>
                    f.kind === 'order' ? (
                      <div key={f.key} className="si-entry">
                        <span className="q">"{f.text}"</span>
                        {f.narration && <span className="n">{f.narration}</span>}
                      </div>
                    ) : (
                      <div key={f.key} className={`si-entry sys ${f.kind === 'bad' ? 'bad' : ''}`}>{f.text}</div>
                    ),
                  )}
                  <div ref={feedEnd} />
                </div>
              </div>
            )}
          </div>

          {phase === 'build' && me && alive && (
            <div className="si-actions">
              <button className="si-btn red" disabled={(me.data.meetingsLeft ?? 0) <= 0 || busy === 'meeting'} onClick={callMeeting}>
                🔔 {busy === 'meeting' ? 'Calling...' : (me.data.meetingsLeft ?? 0) > 0 ? 'Emergency meeting' : 'Meeting used'}
              </button>
              {lightsOut && (
                <button className="si-btn" onClick={() => act('game-fix-lights', {}, 'fix')}>
                  💡 Fix the lights
                </button>
              )}
            </div>
          )}

          {phase === 'build' && me && alive && (
            <div className="si-command">
              {busy === 'order' && (
                <div className="si-status">
                  <span className="si-dots"><i /><i /><i /></span>The agent is building your order
                </div>
              )}
              <div className="si-chips">
                {CHIPS.map((c) => (
                  <button key={c} className="si-chip" disabled={!!busy || me.data.ordersLeft <= 0} onClick={() => sendOrder(c)}>{c}</button>
                ))}
              </div>
              <form
                className="si-bar"
                onSubmit={(e) => {
                  e.preventDefault()
                  sendOrder(orderText)
                }}
              >
                <input
                  value={orderText}
                  maxLength={ORDER_MAX_CHARS}
                  onChange={(e) => setOrderText(e.target.value)}
                  placeholder={me.data.ordersLeft > 0 ? `Tell the agent what to build (${me.data.ordersLeft} order${me.data.ordersLeft === 1 ? '' : 's'} left)` : 'No orders left this round'}
                  disabled={me.data.ordersLeft <= 0 || busy === 'order'}
                />
                <button className="si-send" type="submit" disabled={!orderText.trim() || me.data.ordersLeft <= 0 || busy === 'order'} aria-label="Send order">➤</button>
              </form>
            </div>
          )}

          {lightsOut && phase === 'build' && (
            <div className="si-lights">⚠ The lights are out. {fmtClock(g.lightsOutUntil - now)}</div>
          )}
        </>
      )}

      {/* ── meeting and vote ── */}
      {g && (phase === 'meeting' || phase === 'vote') && (
        <div className="si-meeting">
          <div className="si-card" style={{ borderColor: 'rgba(255,77,109,.45)' }}>
            <div className="si-row" style={{ justifyContent: 'space-between' }}>
              <div>
                <div className="si-eyebrow" style={{ color: '#ff9fb2', marginBottom: 2 }}>{g.finalMeeting ? 'Final vote' : `Called by ${g.meetingCalledBy}`}</div>
                <div className="si-role" style={{ fontSize: 18 }}>{phase === 'meeting' ? 'Discuss' : 'Vote'}</div>
              </div>
              <div className={`si-timer ${timeLeft < 10_000 ? 'low' : ''}`}>{fmtClock(timeLeft)}</div>
            </div>
          </div>
          <div className="si-card" style={{ flex: 1 }}>
            <div className="si-eyebrow">Chat</div>
            <div className="si-chat">
              {visibleChat.length === 0 && <div className="si-small">Nobody has said anything yet. Who walked to the weird stuff?</div>}
              {visibleChat.map((c) => (
                <div key={c.id} className={`si-msg ${c.data.playerId === me?.id ? 'mine' : ''}`} style={{ ['--c' as string]: colorOf(c.data.playerId) }}>
                  <span className="av" />
                  <div className="b"><b>{nameOf(c.data.playerId)}</b>{c.data.text}</div>
                </div>
              ))}
              <div ref={chatEnd} />
            </div>
            {me && alive && (
              <form
                className="si-bar"
                style={{ marginTop: 10, borderRadius: 14 }}
                onSubmit={(e) => {
                  e.preventDefault()
                  sendChat()
                }}
              >
                <input value={chatText} maxLength={CHAT_MAX_CHARS} onChange={(e) => setChatText(e.target.value)} placeholder="Say something. Name someone to ask them." />
                <button className="si-send" type="submit" disabled={!chatText.trim()} aria-label="Send message">➤</button>
              </form>
            )}
          </div>
          {phase === 'vote' && (
            <div className="si-card">
              <div className="si-eyebrow">{myVote ? 'You voted' : me && alive ? 'Who is the Impostor?' : 'Votes'}</div>
              <div className="si-votes">
                {players.map((p) => (
                  <button
                    key={p.id}
                    className={`si-vote ${myVote?.data.targetId === p.id ? 'picked' : ''} ${p.data.alive ? '' : 'dead'}`}
                    style={{ ['--c' as string]: p.data.color }}
                    disabled={!me || !alive || Boolean(myVote) || !p.data.alive || p.id === me?.id}
                    onClick={() => act('game-vote', { targetId: p.id })}
                  >
                    <span className="si-dot" />
                    {p.data.name}
                    {votedIds.has(p.id) && <span className="voted">voted</span>}
                  </button>
                ))}
                <button
                  className={`si-vote ${myVote?.data.targetId === 'skip' ? 'picked' : ''}`}
                  style={{ ['--c' as string]: '#a9a3d6' }}
                  disabled={!me || !alive || Boolean(myVote)}
                  onClick={() => act('game-vote', { targetId: 'skip' })}
                >
                  Skip vote
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── ejection ── */}
      {g && phase === 'eject' && <Ejection key={`${g.meetingNo}`} name={ejected?.data.name ?? ''} color={ejected?.data.color ?? '#a9a3d6'} wasImpostor={Boolean(g.ejectedWasImpostor)} />}

      {/* ── game over ── */}
      {g && phase === 'over' && showOver && !hideOver && (
        <div className="si-overlay dim">
          <div className="si-panel">
            <div className="si-eyebrow" style={{ color: g.winner === 'crew' ? '#5dff9b' : '#ff4d6d' }}>{g.winner === 'crew' ? 'Crew wins' : 'Impostor wins'}</div>
            <h2>
              {role ? ((g.winner === 'crew') === (role === 'crew') ? 'You won' : 'You lost') : g.winner === 'crew' ? 'The crew won' : 'The Impostor won'}
            </h2>
            <p className="si-small">{g.winReason}</p>
            <div className="si-card si-imp" style={{ marginTop: 14 }}>
              <div className="si-eyebrow">The Impostor was</div>
              <div className="si-row">
                <IslanderIcon color={colorOf(impostorId)} size={44} />
                <div className="si-role impostor" style={{ fontSize: 22 }}>{impostorId === me?.id ? 'You' : nameOf(impostorId)}</div>
              </div>
              {revealTheme && (
                <>
                  <div className="si-small" style={{ marginTop: 10 }}>Secret goal: {revealTheme.goal}</div>
                  <ul style={{ margin: '8px 0 0 18px', fontSize: 13, color: '#ffd6de', lineHeight: 1.7 }}>
                    {sabotageTypes.length ? sabotageTypes.map((t) => <li key={t}>{revealTheme.reveals[t as BuildType] ?? t}</li>) : <li>They never got anything onto the island.</li>}
                  </ul>
                </>
              )}
            </div>
            <div className="si-row" style={{ marginTop: 18, justifyContent: 'space-between' }}>
              <button className="si-btn" onClick={() => setHideOver(true)}>Look around</button>
              <div className="si-row">
                <Link className="si-btn" to="/play">Menu</Link>
                {g.nextCode ? (
                  <button className="si-btn primary" onClick={() => navigate(`/g/${g.nextCode}`)}>Join the rematch</button>
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
          <button className="si-btn primary" onClick={() => setHideOver(false)}>Show results</button>
        </div>
      )}

      {banner && (
        <div className="si-banner" key={banner.key} style={{ ['--c' as string]: banner.color }}>
          <div className="t">
            {banner.title}
            {banner.sub && <small>{banner.sub}</small>}
          </div>
        </div>
      )}
      {toast && <div className="si-toast">{toast}</div>}
      {loading && <div className="si-overlay"><span className="si-pill">Loading the island...</span></div>}
    </div>
  )
}

function labelFor(type: string) {
  const t = type.replace('_', ' ')
  return t.charAt(0).toUpperCase() + t.slice(1)
}

function PlayerLine({ p, me, impostorId, voted }: { p: Rec<PlayerRow>; me?: string; impostorId: string; voted: boolean }) {
  const tag = p.id === impostorId ? 'Impostor' : p.id === me ? 'You' : p.data.isBot ? 'AI' : ''
  return (
    <div className={`p ${p.data.alive ? '' : 'out'}`}>
      <span className="si-dot" style={{ ['--c' as string]: p.data.color }} />
      <span className="nm">{p.data.name}</span>
      {voted && <span className="tag" style={{ color: '#5dff9b' }}>voted</span>}
      {tag && <span className="tag" style={p.id === impostorId ? { color: '#ff4d6d', borderColor: 'rgba(255,77,109,.5)' } : undefined}>{tag}</span>}
    </div>
  )
}

function Ejection({ name, color, wasImpostor }: { name: string; color: string; wasImpostor: boolean }) {
  const full = name ? `${name} was ${wasImpostor ? 'the Impostor.' : 'crew.'}` : 'Nobody was ejected.'
  const [shown, setShown] = useState('')
  useEffect(() => {
    let i = 0
    const start = window.setTimeout(() => {
      const id = window.setInterval(() => {
        i++
        setShown(full.slice(0, i))
        if (i >= full.length) window.clearInterval(id)
      }, 70)
    }, 1600)
    return () => window.clearTimeout(start)
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

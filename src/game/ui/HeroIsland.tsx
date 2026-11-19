/**
 * The landing page's hero: the real game island, slowly turning, with a few
 * islanders wandering and some finished tasks standing. No network: it is
 * built from the same landmark list and placement rules the game uses.
 */

import { useEffect, useRef, useState } from 'react'
import { SEAT_COLORS, BOT_NAMES } from '../constants'
import { LANDMARKS, landmarkById } from '../landmarks'
import { makeRng, placeOne, type PlacedLike } from '../placement'
import { COLORS } from '../catalog'
import { TASKS, spotAtLandmark } from '../tasks'
import type { IslandScene, SceneBuild } from '../scene/IslandScene'

export function HeroIsland() {
  const host = useRef<HTMLDivElement>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let scene: IslandScene | null = null
    let cancelled = false
    import('../scene/IslandScene')
      .then(({ IslandScene }) => {
        if (cancelled || !host.current) return
        scene = new IslandScene(host.current, { labels: false })
        if (window.innerWidth > 760) scene.setViewShift(0.2)
        const rng = makeRng(7)
        const placed: PlacedLike[] = []
        const builds: SceneBuild[] = []
        const clear = (x: number, z: number) => LANDMARKS.every((l) => Math.hypot(x - l.x, z - l.z) > Math.max(l.area, 1.6) + 0.5)
        for (const [type, n, near] of [['pine_tree', 18, 'edge'], ['round_tree', 7, undefined], ['rock', 8, undefined], ['flowers', 4, undefined]] as const) {
          for (let i = 0; i < n; i++) {
            const p = placeOne({ type, near }, placed, rng)
            if (!clear(p.x, p.z)) continue
            placed.push(p)
            builds.push({ id: `w${builds.length}`, ...p, color: '', playerId: 'world', orderId: '', seq: builds.length })
          }
        }
        const here: { type: string; x: number; z: number }[] = []
        for (const t of TASKS.filter((_, i) => i % 2 === 0)) {
          const l = landmarkById(t.landmarkId)
          if (!l) continue
          const s = spotAtLandmark(l, t.need.type, here, rng)
          const c = t.need.color
          here.push({ type: t.need.type, x: s.x, z: s.z })
          builds.push({ id: `t${t.id}`, type: t.need.type, x: s.x, z: s.z, lift: s.lift, rot: s.rot, scale: 1, color: c ? COLORS[c] : '', colorName: c ?? '', playerId: 'p', orderId: '', seq: builds.length })
        }
        scene.setBuilds(builds, false)
        scene.setPlayers(BOT_NAMES.slice(0, 5).map((name, i) => ({ id: `h${i}`, name, color: SEAT_COLORS[i], alive: true, isMe: false, seat: i, wanders: true })))
        scene.setEnvironment('sunset', 'clear')
        scene.introFlight()
      })
      .catch(() => setFailed(true))
    return () => {
      cancelled = true
      scene?.dispose()
    }
  }, [])

  return <div ref={host} className={`si-hero-stage ${failed ? 'failed' : ''}`} aria-hidden="true" />
}

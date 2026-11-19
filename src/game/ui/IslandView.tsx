/** Mounts the 3D island once and hands the scene to the game page. */

import { useEffect, useRef } from 'react'
import { IslandScene } from '../scene/IslandScene'

interface Props {
  onReady: (scene: IslandScene | null) => void
  onGroundClick?: (x: number, z: number) => void
  onBellClick?: () => void
  onFail?: () => void
}

export function IslandView(props: Props) {
  const host = useRef<HTMLDivElement>(null)
  const handlers = useRef(props)
  handlers.current = props

  useEffect(() => {
    if (!host.current) return
    let s: IslandScene | null = null
    try {
      s = new IslandScene(host.current, {
        onGroundClick: (x, z) => handlers.current.onGroundClick?.(x, z),
        onBellClick: () => handlers.current.onBellClick?.(),
      })
      handlers.current.onReady(s)
    } catch (err) {
      console.error('3D scene failed to start', err)
      handlers.current.onFail?.()
    }
    return () => {
      s?.dispose()
      handlers.current.onReady(null)
    }
  }, [])

  return <div ref={host} className="si-stage" />
}

/**
 * A small map of the island: landmarks, the pond, where you are, and which
 * landmarks hold your tasks (gold) or your wrecked tasks (red). It never shows
 * other players, so it gives away nothing your vision circle hides.
 */

import { ISLAND } from '../constants'
import { LANDMARKS } from '../landmarks'

const R = ISLAND.TOP_R

interface Props {
  me: { x: number; z: number } | null
  todo: Set<string>
  broken: Set<string>
  lightsOut: boolean
}

export function MiniMap({ me, todo, broken, lightsOut }: Props) {
  return (
    <svg className="si-minimap" viewBox={`${-R - 1} ${-R - 1} ${2 * R + 2} ${2 * R + 2}`} role="img" aria-label="Island map">
      <circle className="land" cx={0} cy={0} r={R} />
      <circle className="pond" cx={ISLAND.POND.x} cy={ISLAND.POND.z} r={ISLAND.POND.r} />
      {LANDMARKS.map((l) => {
        const cls = broken.has(l.id) ? 'mark broken' : todo.has(l.id) ? 'mark todo' : l.id === 'power_shed' && lightsOut ? 'mark alarm' : l.id === 'bell' ? 'mark bell' : 'mark'
        return (
          <g key={l.id} transform={`translate(${l.x} ${l.z})`}>
            {(cls.includes('todo') || cls.includes('broken') || cls.includes('alarm')) && <circle className="halo" r={1.5} />}
            <circle className={cls} r={0.75} />
            <title>{l.name}</title>
          </g>
        )
      })}
      {me && <circle className="me" cx={me.x} cy={me.z} r={0.7} />}
    </svg>
  )
}

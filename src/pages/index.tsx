/**
 * Landing page. Static and prerendered: no auth call, no realtime socket.
 * The game itself lives behind /play, which requires sign in.
 */

import { Link } from 'react-router-dom'
import { Seo } from '../components/Seo'
import { seo } from '../seo'
import { IslanderIcon } from '../game/ui/IslanderIcon'
import '../game/game.css'

export default function Landing() {
  return (
    <>
      <Seo {...seo} path="/" />
      <div data-testid="static-landing" className="si-menu">
        <div style={{ position: 'relative', textAlign: 'center', maxWidth: 760 }}>
          <div className="si-row" style={{ justifyContent: 'center', gap: 6, marginBottom: 18 }}>
            {['#7cf7ff', '#ff7ad9', '#ffd166', '#a48cff', '#5dff9b'].map((c, i) => (
              <div key={c} style={{ transform: `translateY(${i % 2 ? 8 : 0}px)` }}>
                <IslanderIcon color={c} size={64} />
              </div>
            ))}
          </div>
          <div className="si-eyebrow" style={{ letterSpacing: '0.32em' }}>A multiplayer game with an AI builder</div>
          <h1 style={{ marginTop: 10 }}>SABOTEUR<br />ISLAND</h1>
          <p style={{ maxWidth: 560, margin: '20px auto 0' }}>
            Build a floating fishing village by giving orders to an AI agent. One of your crew is secretly
            sneaking in things that do not belong. Watch who walks where, ring the bell, and vote them off the island.
          </p>
          <div style={{ marginTop: 30 }}>
            <Link to="/play" className="si-btn primary big">Play now</Link>
          </div>
          <p className="si-small" style={{ marginTop: 16 }}>Play with friends, or alone with AI players. Built on DeepSpace.</p>
        </div>
      </div>
    </>
  )
}

/**
 * Landing page. Static and prerendered: no auth call, no realtime socket.
 * The game itself lives behind /play, which requires sign in.
 *
 * Design Direction
 * ----------------
 * A floating island at dusk, hanging in deep space. The page is the game's
 * own world, not a description of it: the live 3D island fills the screen and
 * slowly turns while islanders wander between the cottages, the windmill and
 * the lighthouse. Everything sits on deep navy. Cyan marks the crew and the
 * one action on the page, coral red marks danger, gold marks tasks and place
 * names, the same way they do inside the game. Type is Unbounded for the
 * headline, heavy and rounded like the islanders, and Sora for everything
 * else. Copy is short and plain: what you do, what goes wrong, how you win.
 * No feature cards, no screenshots, no gradients: the island does the selling.
 */

import { Link } from 'react-router-dom'
import { Seo } from '../components/Seo'
import { seo } from '../seo'
import { HeroIsland } from '../game/ui/HeroIsland'
import '../game/game.css'

export default function Landing() {
  return (
    <>
      <Seo {...seo} path="/" />
      <div data-testid="static-landing" className="si-landing">
        <HeroIsland />
        <div className="si-landing-shade" />
        <header className="si-landing-top">
          <span className="si-wordmark">SABOTEUR ISLAND</span>
          <Link to="/play" className="si-landing-link">
            Sign in and play
          </Link>
        </header>
        <main className="si-landing-copy">
          <div className="si-eyebrow">A party game for 5 or 6</div>
          <h1>Someone keeps wrecking the island.</h1>
          <p>Fix up a floating island with an AI builder before night falls. One of you is secretly undoing the work.</p>
          <div className="si-landing-cta">
            <Link to="/play" className="si-btn primary big">
              Play now
            </Link>
            <span className="si-small">With friends, or alone against AI players.</span>
          </div>
        </main>
        <ol className="si-landing-how">
          <li>
            <b>Walk</b> to a landmark and tell the builder what to make.
          </li>
          <li>
            <b>Smoke</b> means a finished task was wrecked. Report it.
          </li>
          <li>
            <b>Vote</b> the wrecker off before night falls.
          </li>
        </ol>
        <footer className="si-landing-foot">Built on DeepSpace</footer>
      </div>
    </>
  )
}

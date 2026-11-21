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
          <div className="si-eyebrow">Solo or with friends</div>
          <h1>Saboteur Island</h1>
          <p>Prompt an AI to build. Catch the wrecker before night falls.</p>
          <div className="si-landing-cta">
            <Link to="/play" className="si-btn primary big">
              Play now
            </Link>
          </div>
        </main>
        <ol className="si-landing-how">
          <li>
            <b>Prompt</b> to build
          </li>
          <li>
            <b>Report</b> the smoke
          </li>
          <li>
            <b>Vote</b> out the wrecker
          </li>
        </ol>
        <footer className="si-landing-foot">Someone keeps wrecking the island.</footer>
      </div>
    </>
  )
}

/**
 * Gated routes. Any file under src/pages/(app)/(protected)/ requires sign-in.
 * The `(protected)` folder is a Generouted route group — parentheses mean
 * it doesn't appear in the URL. For a dynamic page that does NOT require
 * sign-in, put it directly under src/pages/(app)/; for a static page, put it
 * at the top level of src/pages/.
 *
 * Children may call data hooks like `useUser()` safely because the parent
 * (app)/_layout.tsx mounts <RecordProvider> above this layout.
 *
 * The `fallback` keeps signed-out visitors inside the app's own chrome
 * (without it, AuthGate shows the SDK's full-screen, non-dismissible
 * overlay). The sign-in overlay opens on demand and can be dismissed.
 */

import { useState } from 'react'
import { Link, Outlet } from 'react-router-dom'
import { AuthGate, AuthOverlay } from 'deepspace'
import { Button } from '@/components/ui'
import '../../../game/game.css'

export default function ProtectedLayout() {
  return (
    <AuthGate fallback={<SignedOutPanel />}>
      <Outlet />
    </AuthGate>
  )
}

function SignedOutPanel() {
  const [showAuthModal, setShowAuthModal] = useState(false)

  return (
    <div className="si-menu">
      <div className="si-signin">
        <div className="si-title">SABOTEUR ISLAND</div>
        <p className="si-small">Sign in so the game knows who you are. Your role and your tasks stay secret from everyone else.</p>
        <Button className="w-full" onClick={() => setShowAuthModal(true)}>
          Sign in to play
        </Button>
        <Link to="/" className="si-small">
          Back to the island
        </Link>
      </div>

      {showAuthModal && <AuthOverlay onClose={() => setShowAuthModal(false)} />}
    </div>
  )
}

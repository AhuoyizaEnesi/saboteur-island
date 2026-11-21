/**
 * Dynamic app boundary — the auth + realtime data layer.
 *
 * `(app)` is a Generouted route group: the parentheses mean it does NOT appear
 * in the URL, so (app)/home.tsx is served at /home. Every page under this
 * folder is wrapped in the DeepSpace providers below, so it may call `useAuth`,
 * `useQuery`, `useMutations`, presence/Yjs hooks, etc.
 *
 * Pages OUTSIDE this folder (top level of src/pages/) get none of this — they
 * render as static pages with no auth fetch and no records WebSocket. Move a
 * page in or out of (app)/ to flip it between dynamic and static. Require
 * sign-in on top of the data layer by nesting under (app)/(protected)/.
 *
 * This is where the app chrome (Navigation) lives, so static pages can present
 * their own layout without inheriting it.
 */

import { Suspense, useEffect, type ReactNode } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import Navigation from '@/components/Navigation'
import { DeepSpaceAuthProvider, useAuthStatus } from 'deepspace'
import { RecordProvider, RecordScope, AgentTools } from 'deepspace'
import { useToast } from '@/components/ui'
import { APP_NAME, SCOPE_ID } from '../../constants'
import { schemas } from '../../schemas'

export default function AppLayout() {
  useFreshAfterBack()
  return (
    <DeepSpaceAuthProvider>
      {/* The prerendered landing owns the document <title> and React drops it
          when <Seo> unmounts, so every route without <Seo> sets its own. */}
      <title>{APP_NAME}</title>
      <AuthBoot>
        <Shell />
      </AuthBoot>
    </DeepSpaceAuthProvider>
  )
}

/**
 * The back button can restore this page from the browser's memory, frozen as it
 * was when you left. The SDK's sign-in box disables all its buttons the moment
 * you pick GitHub or Google, so backing out of that page left every button dead.
 * A fresh load on return resets the box (and reconnects live data).
 */
function useFreshAfterBack() {
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted) window.location.reload()
    }
    window.addEventListener('pageshow', onShow)
    return () => window.removeEventListener('pageshow', onShow)
  }, [])
}

/** A game (/g/CODE) is full screen with no app chrome; menus get the nav bar. */
function Shell() {
  const { pathname } = useLocation()
  const inGame = pathname.startsWith('/g/')
  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      {!inGame && <Navigation />}
      <div className="relative min-h-0 flex-1">
        <Suspense fallback={<div className="flex h-full items-center justify-center text-muted-foreground">Loading...</div>}>
          <Outlet />
        </Suspense>
      </div>
    </div>
  )
}

/**
 * Waits for auth to resolve, then mounts the data layer. Distinct from the SDK's `AuthGate`.
 *
 * While the initial session check is in flight, renders a fixed full-viewport
 * panel in the theme background — visually identical to the pre-JS page
 * (index.html primes <html> with the same color), so a cold load shows a
 * steady theme-colored screen until the shell appears. No spinner text: the
 * check is one round-trip, and in-flow placeholders read as a layout jump.
 */
function AuthBoot({ children }: { children: ReactNode }) {
  const { isLoaded } = useAuthStatus()
  // Record writes (`create`/`put`/`remove`) are fire-and-forget — they resolve
  // before the server answers, so a denied or invalid write only surfaces
  // through onWriteError. Route rejections to toasts so they're never a
  // silent no-op. Keep this wiring when customizing the layout.
  const { error, warning } = useToast()

  if (!isLoaded) {
    return <div aria-busy="true" className="fixed inset-0 bg-background" />
  }

  return (
    <RecordProvider
      allowAnonymous
      onWriteError={(e) =>
        e.kind === 'permission' ? warning(e.title, e.detail) : error(e.title, e.detail)
      }
    >
      <RecordScope roomId={SCOPE_ID} schemas={schemas}>
        <AgentTools />
        {children}
      </RecordScope>
    </RecordProvider>
  )
}

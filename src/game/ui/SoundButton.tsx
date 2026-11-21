import { Volume2, VolumeX } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { syncMusic } from '../music'
import { isMuted, setMuted, unlockSound } from '../sound'

/**
 * The one mute button for music and effects. It sits in the same corner on
 * every game screen (lobby, intro, play, meetings, game over), above every
 * overlay, and the choice is remembered for the next game.
 */
export function SoundButton({ className = '' }: { className?: string }) {
  const [muted, setMutedState] = useState(isMuted)
  return (
    <button
      className={`si-sound-btn ${className}`}
      aria-label={muted ? 'Turn sound on' : 'Mute sound'}
      title={muted ? 'Turn sound on' : 'Mute sound'}
      aria-pressed={muted}
      onClick={() => {
        setMuted(!muted)
        setMutedState(!muted)
        syncMusic()
      }}
    >
      {muted ? <VolumeX size={17} /> : <Volume2 size={17} />}
    </button>
  )
}

/**
 * Mounted once for the whole app: starts sound on the first click or key on
 * any page, and shows the mute button on pages outside a game. The game
 * screen places its own button around its panels.
 */
export function GlobalSound() {
  const { pathname } = useLocation()
  useEffect(() => {
    const unlock = () => {
      unlockSound()
      syncMusic()
    }
    window.addEventListener('pointerdown', unlock)
    window.addEventListener('keydown', unlock)
    return () => {
      window.removeEventListener('pointerdown', unlock)
      window.removeEventListener('keydown', unlock)
    }
  }, [])
  if (pathname.startsWith('/g/')) return null
  return <SoundButton key={pathname} className="global" />
}

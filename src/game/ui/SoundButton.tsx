import { Volume2, VolumeX } from 'lucide-react'
import { useState } from 'react'
import { syncMusic } from '../music'
import { isMuted, setMuted } from '../sound'

/**
 * The one mute button for music and effects. It sits in the same corner on
 * every game screen (lobby, intro, play, meetings, game over), above every
 * overlay, and the choice is remembered for the next game.
 */
export function SoundButton() {
  const [muted, setMutedState] = useState(isMuted)
  return (
    <button
      className="si-sound-btn"
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

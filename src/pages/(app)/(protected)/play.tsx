/** Menu: start a new game or join one with a code. */

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { callAction } from '../../../game/api'
import { SEAT_COLORS } from '../../../game/constants'
import { normalizeCode } from '../../../game/rules'
import { IslanderIcon } from '../../../game/ui/IslanderIcon'
import '../../../game/game.css'

export default function PlayPage() {
  const navigate = useNavigate()
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState<'create' | 'join' | 'practice' | null>(null)
  const [error, setError] = useState('')

  const create = async () => {
    setBusy('create')
    setError('')
    try {
      const r = await callAction<{ code: string }>('game-create')
      navigate(`/g/${r.code}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create a game.')
      setBusy(null)
    }
  }
  const practice = async () => {
    setBusy('practice')
    setError('')
    try {
      const r = await callAction<{ code: string }>('game-practice')
      navigate(`/g/${r.code}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start practice.')
      setBusy(null)
    }
  }
  const join = async () => {
    const c = normalizeCode(code)
    if (c.length !== 4) {
      setError('Codes are 4 letters.')
      return
    }
    setBusy('join')
    setError('')
    try {
      const r = await callAction<{ code: string }>('game-join', { code: c })
      navigate(`/g/${r.code}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not join that game.')
      setBusy(null)
    }
  }

  return (
    <div className="si-menu">
      <div className="si-menu-inner">
        <div>
          <div className="si-icons">
            {SEAT_COLORS.slice(0, 5).map((c) => (
              <div key={c}>
                <IslanderIcon color={c} size={54} />
              </div>
            ))}
          </div>
          <h1>
            Fix the island.
            <br />
            <span className="accent">Catch the wrecker.</span>
          </h1>
          <p>Walk to your tasks and tell the AI builder what to make. One of you is secretly wrecking finished work. Finish before night falls, or vote them off.</p>
          <div className="si-steps">
            <div>
              <b>01</b>Walk with WASD. At a landmark, type your task to the builder.
            </div>
            <div>
              <b>02</b>Smoke means something was wrecked. Report it, or ring the bell.
            </div>
            <div>
              <b>03</b>Argue, vote, and launch the Impostor into space.
            </div>
          </div>
        </div>
        <div className="si-menu-card">
          <div className="si-eyebrow">New game</div>
          <button className="si-btn primary big wide" disabled={busy !== null} onClick={create}>
            {busy === 'create' ? 'Raising the island...' : 'Create a game'}
          </button>
          <p className="si-small">AI players fill any empty seats, so you can play alone.</p>
          <div className="si-eyebrow">Practice your prompts</div>
          <button className="si-btn wide" disabled={busy !== null} onClick={practice}>
            {busy === 'practice' ? 'Setting up...' : 'Practice with the builder'}
          </button>
          <p className="si-small">Just you and the builder: 4 tasks, no Impostor, no meetings, no clock.</p>
          <div className="si-eyebrow">Join with a code</div>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              join()
            }}
          >
            <input className="si-input" value={code} maxLength={4} placeholder="ABCD" aria-label="Game code" onChange={(e) => setCode(normalizeCode(e.target.value))} />
            <button className="si-btn wide" type="submit" disabled={busy !== null}>
              {busy === 'join' ? 'Joining...' : 'Join game'}
            </button>
          </form>
          {error && <div className="si-error">{error}</div>}
        </div>
      </div>
    </div>
  )
}

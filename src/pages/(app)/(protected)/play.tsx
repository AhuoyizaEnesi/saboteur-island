/** Menu: start a new game or join one with a code. */

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { callAction } from '../../../game/api'
import { normalizeCode } from '../../../game/rules'
import { IslanderIcon } from '../../../game/ui/IslanderIcon'
import '../../../game/game.css'

export default function PlayPage() {
  const navigate = useNavigate()
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState<'create' | 'join' | null>(null)
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
          <div className="si-row" style={{ gap: 4, marginBottom: 14 }}>
            {['#7cf7ff', '#ff7ad9', '#ffd166', '#a48cff', '#5dff9b'].map((c, i) => (
              <div key={c} style={{ transform: `translateY(${i % 2 ? 6 : 0}px)` }}>
                <IslanderIcon color={c} size={54} />
              </div>
            ))}
          </div>
          <h1>SABOTEUR<br />ISLAND</h1>
          <p>Build a floating fishing village with an AI agent. One of your crew is secretly sneaking in things that do not belong. Catch them before the island is ruined.</p>
          <div className="si-steps">
            <div><b>01</b>Give the agent orders. Your islander walks to whatever it builds.</div>
            <div><b>02</b>Watch who walks where. Ring the bell if something looks wrong.</div>
            <div><b>03</b>Argue, vote, and launch the Impostor into space.</div>
          </div>
        </div>
        <div className="si-card" style={{ padding: 22, background: 'rgba(16,13,40,.7)', border: '1px solid rgba(255,255,255,.1)', borderRadius: 22 }}>
          <div className="si-eyebrow">New game</div>
          <button className="si-btn primary big wide" disabled={busy !== null} onClick={create}>
            {busy === 'create' ? 'Raising the island...' : 'Create a game'}
          </button>
          <p className="si-small" style={{ margin: '10px 0 20px' }}>AI players fill any empty seats, so you can play alone.</p>
          <div className="si-eyebrow">Join with a code</div>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              join()
            }}
          >
            <input className="si-input" value={code} maxLength={4} placeholder="ABCD" onChange={(e) => setCode(normalizeCode(e.target.value))} />
            <button className="si-btn wide" style={{ marginTop: 10, justifyContent: 'center' }} type="submit" disabled={busy !== null}>
              {busy === 'join' ? 'Joining...' : 'Join game'}
            </button>
          </form>
          {error && <div className="si-small" style={{ color: '#ff8aa0', marginTop: 12 }}>{error}</div>}
        </div>
      </div>
    </div>
  )
}

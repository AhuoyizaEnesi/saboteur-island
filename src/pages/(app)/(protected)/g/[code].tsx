import { useParams } from 'react-router-dom'
import { GameScreen } from '../../../../game/ui/GameScreen'
import { normalizeCode } from '../../../../game/rules'

export default function GamePage() {
  const { code } = useParams()
  return <GameScreen key={normalizeCode(code)} code={normalizeCode(code)} />
}

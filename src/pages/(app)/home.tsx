/** The old starter home now just sends players to the game menu. */

import { Navigate } from 'react-router-dom'

export default function HomePage() {
  return <Navigate to="/play" replace />
}

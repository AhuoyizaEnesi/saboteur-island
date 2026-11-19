/** Browser side of the game's server actions. */

import { getAuthToken } from 'deepspace'

export class ActionError extends Error {
  code?: string
  constructor(message: string, code?: string) {
    super(message)
    this.code = code
  }
}

/** Difference between the server clock and this browser's clock, in ms. */
let serverOffset = 0
export const serverNow = () => Date.now() + serverOffset

export async function callAction<T = Record<string, unknown>>(name: string, params: Record<string, unknown> = {}): Promise<T> {
  const token = await getAuthToken()
  const sentAt = Date.now()
  const res = await fetch(`/api/actions/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(params),
  })
  const body = (await res.json().catch(() => null)) as
    | { success: true; data: T & { now?: number } }
    | { success: false; error: string; code?: string }
    | { error?: string }
    | null
  if (!res.ok || !body || !('success' in body) || !body.success) {
    const msg = (body && 'error' in body && body.error) || `Request failed (${res.status})`
    throw new ActionError(String(msg), body && 'code' in body ? body.code : undefined)
  }
  const now = body.data?.now
  if (typeof now === 'number') {
    const rtt = Date.now() - sentAt
    serverOffset = now + rtt / 2 - Date.now()
  }
  return body.data
}

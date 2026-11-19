/** Flat drawing of the islander character for 2D screens (ejection, menus). */

import { ISLANDER_INK as INK } from '../scene/palette'

export function IslanderIcon({ color, size = 120 }: { color: string; size?: number }) {
  const id = `fur-${color.replace(/[^a-z0-9]/gi, '')}`
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" aria-hidden="true">
      <defs>
        <radialGradient id={id} cx="40%" cy="35%" r="70%">
          <stop offset="0%" stopColor={INK.furLight} />
          <stop offset="100%" stopColor={INK.furShade} />
        </radialGradient>
      </defs>
      <path d="M60 22 C 58 14, 56 10, 60 6" stroke={INK.stem} strokeWidth="3" fill="none" strokeLinecap="round" />
      <ellipse cx="50" cy="12" rx="10" ry="4.5" fill={INK.leaf} transform="rotate(-25 50 12)" />
      <ellipse cx="70" cy="12" rx="10" ry="4.5" fill={INK.leaf} transform="rotate(25 70 12)" />
      <circle cx="60" cy="62" r="40" fill={`url(#${id})`} />
      <ellipse cx="46" cy="58" rx="6" ry="8.5" fill={INK.eye} />
      <ellipse cx="74" cy="58" rx="6" ry="8.5" fill={INK.eye} />
      <circle cx="48" cy="55" r="2" fill={INK.furLight} />
      <circle cx="76" cy="55" r="2" fill={INK.furLight} />
      <ellipse cx="36" cy="70" rx="6" ry="3.5" fill={INK.cheek} />
      <ellipse cx="84" cy="70" rx="6" ry="3.5" fill={INK.cheek} />
      <path d="M24 82 Q 60 98 96 82 L 96 90 Q 60 106 24 90 Z" fill={color} />
      <rect x="70" y="88" width="10" height="20" rx="3" fill={color} transform="rotate(-12 75 98)" />
      <ellipse cx="44" cy="104" rx="10" ry="6" fill={INK.feet} />
      <ellipse cx="76" cy="104" rx="10" ry="6" fill={INK.feet} />
    </svg>
  )
}

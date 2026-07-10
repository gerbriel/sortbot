import type { ReactElement } from 'react'

interface IconProps {
  name: IconName
  size?: number
  className?: string
  fill?: string
  strokeWidth?: number
}

export type IconName =
  | 'star'
  | 'heart'
  | 'heart-filled'
  | 'search'
  | 'dumbbell'
  | 'pin'
  | 'users'
  | 'ruler'
  | 'bolt'
  | 'check'
  | 'close'
  | 'chevron-left'
  | 'chevron-right'
  | 'calendar'
  | 'clock'
  | 'shield'
  | 'trophy'
  | 'plus'
  | 'arrow-left'

const PATHS: Record<IconName, ReactElement> = {
  star: <path d="M12 2l2.9 6.3 6.9.8-5.1 4.7 1.4 6.8L12 17.8 5.9 20.6l1.4-6.8L2.2 9.1l6.9-.8z" />,
  heart: (
    <path d="M12 21s-7.5-4.6-10-9.3C.4 8.4 2 5 5.3 5c2 0 3.4 1.1 4.2 2.3l.5.8.5-.8C11.3 6.1 12.7 5 14.7 5 18 5 19.6 8.4 22 11.7 19.5 16.4 12 21 12 21z" />
  ),
  'heart-filled': (
    <path d="M12 21s-7.5-4.6-10-9.3C.4 8.4 2 5 5.3 5c2 0 3.4 1.1 4.2 2.3l.5.8.5-.8C11.3 6.1 12.7 5 14.7 5 18 5 19.6 8.4 22 11.7 19.5 16.4 12 21 12 21z" />
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <line x1="16.5" y1="16.5" x2="21" y2="21" />
    </>
  ),
  dumbbell: (
    <>
      <rect x="1.5" y="9" width="3" height="6" rx="1" />
      <rect x="4.5" y="7.5" width="2.5" height="9" rx="1" />
      <line x1="7" y1="12" x2="17" y2="12" />
      <rect x="17" y="7.5" width="2.5" height="9" rx="1" />
      <rect x="19.5" y="9" width="3" height="6" rx="1" />
    </>
  ),
  pin: (
    <>
      <path d="M12 22s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12z" />
      <circle cx="12" cy="10" r="2.5" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
      <path d="M16 5.5a3.2 3.2 0 0 1 0 6" />
      <path d="M17 14.2a6.5 6.5 0 0 1 4.5 5.8" />
    </>
  ),
  ruler: (
    <>
      <rect x="2.5" y="7" width="19" height="10" rx="1.5" transform="rotate(0 12 12)" />
      <line x1="7" y1="7" x2="7" y2="11" />
      <line x1="12" y1="7" x2="12" y2="12" />
      <line x1="17" y1="7" x2="17" y2="11" />
    </>
  ),
  bolt: <path d="M13 2L4 14h6l-1 8 9-12h-6z" />,
  check: <path d="M4 12l5 5L20 6" />,
  close: (
    <>
      <line x1="5" y1="5" x2="19" y2="19" />
      <line x1="19" y1="5" x2="5" y2="19" />
    </>
  ),
  'chevron-left': <path d="M15 5l-7 7 7 7" />,
  'chevron-right': <path d="M9 5l7 7-7 7" />,
  'arrow-left': (
    <>
      <line x1="20" y1="12" x2="4" y2="12" />
      <path d="M10 6l-6 6 6 6" />
    </>
  ),
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="16" rx="2" />
      <line x1="3.5" y1="9.5" x2="20.5" y2="9.5" />
      <line x1="8" y1="3" x2="8" y2="6.5" />
      <line x1="16" y1="3" x2="16" y2="6.5" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.5 2" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6z" />
      <path d="M9 12l2 2 4-4" />
    </>
  ),
  trophy: (
    <>
      <path d="M7 4h10v4a5 5 0 0 1-10 0z" />
      <path d="M7 5H4v1a3 3 0 0 0 3 3" />
      <path d="M17 5h3v1a3 3 0 0 1-3 3" />
      <line x1="12" y1="13" x2="12" y2="17" />
      <path d="M8.5 20h7l-1-3h-5z" />
    </>
  ),
  plus: (
    <>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </>
  ),
}

const FILLED: IconName[] = ['star', 'heart-filled', 'bolt']

export default function Icon({ name, size = 20, className, fill, strokeWidth = 2 }: IconProps) {
  const isFilled = FILLED.includes(name) || fill === 'currentColor'
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={isFilled ? (fill ?? 'currentColor') : 'none'}
      stroke={isFilled && name !== 'star' && name !== 'heart-filled' ? 'none' : 'currentColor'}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  )
}

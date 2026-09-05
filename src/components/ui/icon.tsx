/**
 * 셸에서 쓰는 아이콘. 외부 아이콘 패키지를 넣지 않고 24×24 stroke path만 들고 간다.
 * 라이브러리를 붙이면 200개 중 20개를 쓰려고 번들을 키우게 된다.
 */

export type IconName =
  | 'home'
  | 'layers'
  | 'check-circle'
  | 'sparkles'
  | 'calendar'
  | 'clipboard'
  | 'folder'
  | 'building'
  | 'coin'
  | 'users'
  | 'book'
  | 'target'
  | 'cart'
  | 'factory'
  | 'flask'
  | 'server'
  | 'shield'
  | 'settings'
  | 'chevron-right'
  | 'chevron-down'
  | 'search'
  | 'bell'
  | 'plus'
  | 'crown'
  | 'grid'
  | 'cpu'
  | 'stamp'
  | 'file-text'
  | 'mail'
  | 'video'
  | 'message'

const PATHS: Record<IconName, string> = {
  home: 'M3 10.5 12 3l9 7.5M5.5 9.5V20h13V9.5',
  layers: 'm12 3 9 5-9 5-9-5 9-5ZM3 13l9 5 9-5M3 17l9 5 9-5',
  'check-circle': 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM8.5 12l2.5 2.5 4.5-5',
  sparkles: 'm12 3 1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8L12 3ZM18 16l.9 2.1 2.1.9-2.1.9L18 22l-.9-2.1-2.1-.9 2.1-.9L18 16Z',
  calendar: 'M4 6.5h16V20H4V6.5ZM8 3v4M16 3v4M4 11h16',
  clipboard: 'M9 4.5h6v2H9v-2ZM7 5.5H5.5V20h13V5.5H17M9 11h6M9 15h4',
  folder: 'M3.5 6.5h6l2 2.5h9V19h-17V6.5Z',
  building: 'M4 20V4.5h9V20M13 10h7v10M7 8h3M7 12h3M7 16h3M16 13h1M16 17h1M2.5 20h19',
  coin: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 7v10M14.5 9.5h-4a1.75 1.75 0 0 0 0 3.5h3a1.75 1.75 0 0 1 0 3.5h-4',
  users: 'M8.5 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM3 20v-1.5A4.5 4.5 0 0 1 7.5 14h2a4.5 4.5 0 0 1 4.5 4.5V20M16 5.5a3 3 0 0 1 0 6M17 14h.5a4.5 4.5 0 0 1 4.5 4.5V20',
  book: 'M4 4.5h6a3 3 0 0 1 3 3V20a2.5 2.5 0 0 0-2.5-2.5H4v-13ZM20 4.5h-6a3 3 0 0 0-3 3V20a2.5 2.5 0 0 1 2.5-2.5H20v-13Z',
  target: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 16.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9ZM12 13.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z',
  cart: 'M3 5h2.5l2 10h10l2-7H6M9.5 19.5a1 1 0 1 0 0-2 1 1 0 0 0 0 2ZM17 19.5a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z',
  factory: 'M3 20V10l5.5 3.5V10L14 13.5V7l7 4.5V20H3ZM7 17h2M13 17h2M18 17h1',
  flask: 'M10 3h4M10.5 3v6L5.5 18a2 2 0 0 0 1.8 3h9.4a2 2 0 0 0 1.8-3l-5-9V3M7.8 14h8.4',
  server: 'M4 4.5h16v5H4v-5ZM4 14.5h16v5H4v-5ZM7.5 7h.01M7.5 17h.01',
  shield: 'M12 3 4.5 6v6c0 4.5 3 7.6 7.5 9 4.5-1.4 7.5-4.5 7.5-9V6L12 3ZM9 12l2 2 4-4',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM19.4 14a1.5 1.5 0 0 0 .3 1.7l.1.1a1.8 1.8 0 1 1-2.6 2.6l-.1-.1a1.5 1.5 0 0 0-2.6 1V20a1.8 1.8 0 1 1-3.6 0v-.2a1.5 1.5 0 0 0-2.6-1l-.1.1a1.8 1.8 0 1 1-2.6-2.6l.1-.1a1.5 1.5 0 0 0-1-2.6H4a1.8 1.8 0 1 1 0-3.6h.2a1.5 1.5 0 0 0 1-2.6l-.1-.1a1.8 1.8 0 1 1 2.6-2.6l.1.1a1.5 1.5 0 0 0 2.6-1V4a1.8 1.8 0 1 1 3.6 0v.2a1.5 1.5 0 0 0 2.6 1l.1-.1a1.8 1.8 0 1 1 2.6 2.6l-.1.1a1.5 1.5 0 0 0 1 2.6H20a1.8 1.8 0 1 1 0 3.6h-.2a1.5 1.5 0 0 0-1.4.9Z',
  'chevron-right': 'm9.5 5.5 6.5 6.5-6.5 6.5',
  'chevron-down': 'm5.5 9.5 6.5 6.5 6.5-6.5',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM20 20l-4-4',
  bell: 'M18 15.5V10a6 6 0 1 0-12 0v5.5L4.5 18h15L18 15.5ZM9.5 18a2.5 2.5 0 0 0 5 0',
  plus: 'M12 5v14M5 12h14',
  crown: 'm3.5 7 3.5 3.5L12 5l5 5.5L20.5 7l-1.5 11h-14L3.5 7Z',
  grid: 'M4 4.5h6v6H4v-6ZM14 4.5h6v6h-6v-6ZM4 13.5h6v6H4v-6ZM14 13.5h6v6h-6v-6Z',
  cpu: 'M8 8h8v8H8V8ZM5 5h14v14H5V5ZM9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3',
  stamp: 'M9 3.5h6l-1 6.5h3.5a2 2 0 0 1 2 2V16H4.5v-4a2 2 0 0 1 2-2H10L9 3.5ZM4 19.5h16',
  'file-text': 'M13.5 3H6.5v18h11V7l-4-4ZM13.5 3v4h4M9 12h6M9 16h4',
  mail: 'M3.5 6h17v12h-17V6ZM4 6.5l8 6 8-6',
  video: 'M3.5 6.5h11v11h-11v-11ZM14.5 10.5l6-3.5v10l-6-3.5',
  message: 'M20.5 12.5c0 4-3.8 7-8.5 7-1.2 0-2.4-.2-3.4-.6L4 20.5l1.3-3.4A6.7 6.7 0 0 1 3.5 12.5c0-4 3.8-7 8.5-7s8.5 3 8.5 7Z',
}

interface IconProps {
  name: IconName
  className?: string
  /** 채워야 읽히는 아이콘(왕관 등)만 true. 나머지는 stroke로 그린다. */
  filled?: boolean
}

export function Icon({ name, className = 'size-[18px]', filled = false }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill={filled ? 'currentColor' : 'none'}
      stroke={filled ? 'none' : 'currentColor'}
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={PATHS[name]} />
    </svg>
  )
}

import type { Coordinates } from '@/lib/cities'

/**
 * 세계시간 · 관심 도시 날씨의 도시 표 — **한 벌**(2026-09-29 회장 지시).
 *
 * 전에는 도시 목록이 세 벌이었다: 헤더 칩(world-clocks.tsx) · 아침 인사 칸(greeting-clock.tsx) ·
 * 날씨(cities.ts BUSINESS_CITIES). 셋이 각자 네 곳 · 네 곳 · 여섯 곳을 들고 있어 한 곳을 바꾸면
 * 나머지가 낡았다. 이제 시계와 날씨가 같은 목록을 본다 — 시간대(tz)와 좌표를 한 줄에 같이 둔다.
 *
 * 무엇을 보일지는 사람마다 다르다 — user_settings.app_prefs.world_cities(0030의 jsonb 주머니)에
 * **도시 id만** 저장한다. DB는 id를 모른다(마이그레이션 없음). 모르는 id는 읽을 때 조용히 빠진다.
 *
 * 이 파일은 타입 외에 아무것도 import하지 않는다 — 클라이언트(설정 편집기 · 시계)와
 * 서버(날씨)가 같이 쓴다. cities.ts와 같은 사정이다.
 */

export interface WorldCity {
  id: string
  nameKo: string
  /** 폭이 좁은 칸(대시보드 카드)에서 쓰는 이름. 없으면 nameKo. */
  shortKo?: string
  tz: string
  coordinates: Coordinates
}

/** 고를 수 있는 도시 전부. 앞 열 곳이 기본값 순서다. */
export const WORLD_CITIES: WorldCity[] = [
  { id: 'seoul', nameKo: '서울', tz: 'Asia/Seoul', coordinates: { latitude: 37.5665, longitude: 126.978 } },
  { id: 'ho-chi-minh', nameKo: '호치민', tz: 'Asia/Ho_Chi_Minh', coordinates: { latitude: 10.8231, longitude: 106.6297 } },
  { id: 'dubai', nameKo: '두바이', tz: 'Asia/Dubai', coordinates: { latitude: 25.2048, longitude: 55.2708 } },
  { id: 'new-york', nameKo: '뉴욕', tz: 'America/New_York', coordinates: { latitude: 40.7128, longitude: -74.006 } },
  { id: 'istanbul', nameKo: '이스탄불', tz: 'Europe/Istanbul', coordinates: { latitude: 41.0082, longitude: 28.9784 } },
  { id: 'jakarta', nameKo: '자카르타', tz: 'Asia/Jakarta', coordinates: { latitude: -6.2088, longitude: 106.8456 } },
  { id: 'beijing', nameKo: '베이징', tz: 'Asia/Shanghai', coordinates: { latitude: 39.9042, longitude: 116.4074 } },
  { id: 'san-francisco', nameKo: '샌프란시스코', shortKo: 'SF', tz: 'America/Los_Angeles', coordinates: { latitude: 37.7749, longitude: -122.4194 } },
  { id: 'london', nameKo: '런던', tz: 'Europe/London', coordinates: { latitude: 51.5074, longitude: -0.1278 } },
  { id: 'frankfurt', nameKo: '프랑크푸르트', tz: 'Europe/Berlin', coordinates: { latitude: 50.1109, longitude: 8.6821 } },
  // 여기부터는 기본값에 없고, 설정에서 더할 수 있는 도시다.
  { id: 'singapore', nameKo: '싱가폴', tz: 'Asia/Singapore', coordinates: { latitude: 1.3521, longitude: 103.8198 } },
  { id: 'shanghai', nameKo: '상하이', tz: 'Asia/Shanghai', coordinates: { latitude: 31.2304, longitude: 121.4737 } },
  { id: 'hanoi', nameKo: '하노이', tz: 'Asia/Ho_Chi_Minh', coordinates: { latitude: 21.0278, longitude: 105.8342 } },
  { id: 'tokyo', nameKo: '도쿄', tz: 'Asia/Tokyo', coordinates: { latitude: 35.6762, longitude: 139.6503 } },
  { id: 'hong-kong', nameKo: '홍콩', tz: 'Asia/Hong_Kong', coordinates: { latitude: 22.3193, longitude: 114.1694 } },
  { id: 'bangkok', nameKo: '방콕', tz: 'Asia/Bangkok', coordinates: { latitude: 13.7563, longitude: 100.5018 } },
  { id: 'mumbai', nameKo: '뭄바이', tz: 'Asia/Kolkata', coordinates: { latitude: 19.076, longitude: 72.8777 } },
  { id: 'riyadh', nameKo: '리야드', tz: 'Asia/Riyadh', coordinates: { latitude: 24.7136, longitude: 46.6753 } },
  { id: 'paris', nameKo: '파리', tz: 'Europe/Paris', coordinates: { latitude: 48.8566, longitude: 2.3522 } },
  { id: 'toronto', nameKo: '토론토', tz: 'America/Toronto', coordinates: { latitude: 43.6532, longitude: -79.3832 } },
  { id: 'los-angeles', nameKo: '로스앤젤레스', shortKo: 'LA', tz: 'America/Los_Angeles', coordinates: { latitude: 34.0522, longitude: -118.2437 } },
  { id: 'sydney', nameKo: '시드니', tz: 'Australia/Sydney', coordinates: { latitude: -33.8688, longitude: 151.2093 } },
]

/** 서울은 늘 첫 자리다 — 빼거나 옮길 수 없다(회장 지시 «서울은 항상 첫 번째·크게»). */
export const HOME_CITY_ID = 'seoul'

export const DEFAULT_WORLD_CITY_IDS: string[] = [
  'seoul', 'ho-chi-minh', 'dubai', 'new-york', 'istanbul',
  'jakarta', 'beijing', 'san-francisco', 'london', 'frankfurt',
]

/** 세 줄(5개씩)까지. 더 늘면 대시보드 카드의 268px 안에 서지 못한다. */
export const WORLD_CITIES_MAX = 15

const BY_ID = new Map(WORLD_CITIES.map((c) => [c.id, c]))

/**
 * 저장된 값을 id 목록으로 편다. 배열이 아니면(한 번도 고친 적 없음) 기본값이다.
 * 모르는 id · 중복은 빠지고, 서울은 어디 있든 맨 앞으로 온다. 최대 개수에서 자른다.
 */
export function normalizeWorldCityIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [...DEFAULT_WORLD_CITY_IDS]
  const rest = [
    ...new Set(raw.filter((v): v is string => typeof v === 'string' && BY_ID.has(v) && v !== HOME_CITY_ID)),
  ]
  return [HOME_CITY_ID, ...rest].slice(0, WORLD_CITIES_MAX)
}

export function worldCitiesOf(ids: string[]): WorldCity[] {
  return ids.flatMap((id) => {
    const c = BY_ID.get(id)
    return c ? [c] : []
  })
}

/* ------------------------------------------------------------------ 시차 */

/** 그 시간대의 UTC 오프셋(분). Intl의 'longOffset'이 'GMT+09:00' 모양을 낸다. */
export function tzOffsetMinutes(tz: string, now: Date): number {
  const part = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' })
    .formatToParts(now)
    .find((p) => p.type === 'timeZoneName')?.value
  const m = part?.match(/GMT([+-])(\d{2}):(\d{2})/)
  if (!m) return 0 // 'GMT' 그대로 = UTC
  const sign = m[1] === '-' ? -1 : 1
  return sign * (Number(m[2]) * 60 + Number(m[3]))
}

/** 분 차이를 '+8h' · '−13h' · '+5h30' · '0h'로. 빼기는 하이픈이 아니라 마이너스 기호다. */
export function formatOffsetDiff(minutes: number): string {
  if (minutes === 0) return '0h'
  const sign = minutes > 0 ? '+' : '−'
  const abs = Math.abs(minutes)
  const h = Math.floor(abs / 60)
  const m = abs % 60
  return m === 0 ? `${sign}${h}h` : `${sign}${h}h${String(m).padStart(2, '0')}`
}

/** 그 도시의 지금이 낮인가 — 현지 06:00~17:59를 낮으로 친다. 일출 계산까지는 하지 않는다. */
export function isDaytimeIn(tz: string, now: Date): boolean {
  const h = Number(
    new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hourCycle: 'h23' }).format(now),
  )
  return h >= 6 && h < 18
}

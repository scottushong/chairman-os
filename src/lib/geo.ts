import { headers } from 'next/headers'

/**
 * 아침 화면(P5-5)의 위치 해석. 회장이 지금 어디 있는지 + 사업하는 6개 도시 좌표표.
 *
 * 좌표는 절대 URL 쿼리나 클라이언트로 나가는 어떤 것에도 싣지 않는다 — 서버 컴포넌트가
 * resolveLocation()을 직접 불러 그 자리에서 쓰고, weather.ts로 넘길 때도 서버 안에서만 돈다.
 */

export interface Coordinates {
  latitude: number
  longitude: number
}

/** 회장이 사업하는 6개 도시. weather.ts가 이 배열 순서 그대로 Open-Meteo에 묻는다. */
export interface BusinessCity {
  id: string
  nameKo: string
  coordinates: Coordinates
}

export const BUSINESS_CITIES: BusinessCity[] = [
  { id: 'ho-chi-minh', nameKo: '호치민', coordinates: { latitude: 10.8231, longitude: 106.6297 } },
  { id: 'singapore', nameKo: '싱가폴', coordinates: { latitude: 1.3521, longitude: 103.8198 } },
  { id: 'shanghai', nameKo: '상하이', coordinates: { latitude: 31.2304, longitude: 121.4737 } },
  { id: 'dubai', nameKo: '두바이', coordinates: { latitude: 25.2048, longitude: 55.2708 } },
  { id: 'toronto', nameKo: '토론토', coordinates: { latitude: 43.6532, longitude: -79.3832 } },
  { id: 'sf', nameKo: 'SF', coordinates: { latitude: 37.7749, longitude: -122.4194 } },
]

/**
 * Vercel 엣지가 없을 때(로컬 dev, 또는 Vercel 밖 배포)의 명시적 기본값 — 서울.
 * 헤더가 그냥 비어 있는 채로 화면에 올라가면 '위치 없음'이 조용히 흘러가므로,
 * 회장 사무실 기준으로 폴백 값을 못 박아 둔다.
 */
const DEFAULT_LOCATION = {
  latitude: 37.5665,
  longitude: 126.978,
  city: '서울',
} as const

export interface ResolvedLocation extends Coordinates {
  city: string
  /** Vercel IP 헤더로 구했는지, 로컬/기본값으로 떨어졌는지. 패널이 출처를 밝힐 수 있게 남긴다. */
  source: 'vercel-ip' | 'default'
}

/**
 * 서버 컴포넌트 전용. `headers()`는 Next 16에서 비동기 API라 await가 필요하다.
 * x-vercel-ip-latitude / -longitude / -city 는 Vercel 엣지가 요청을 라우팅할 때 채운다 —
 * 로컬 `next dev`와 Vercel 밖 어디에도 이 헤더가 없다. 그때는 DEFAULT_LOCATION(서울)으로
 * 떨어진다. 좌표 하나라도 숫자로 못 읽으면(빈 문자열, 손상된 값) 통째로 기본값을 쓴다 —
 * 위도만 있고 경도가 이상한 반쪽 좌표로 날씨를 부르는 것보다 명확한 기본값이 낫다.
 */
export async function resolveLocation(): Promise<ResolvedLocation> {
  const h = await headers()
  const rawLatitude = h.get('x-vercel-ip-latitude')
  const rawLongitude = h.get('x-vercel-ip-longitude')
  const rawCity = h.get('x-vercel-ip-city')

  const latitude = rawLatitude ? Number(rawLatitude) : NaN
  const longitude = rawLongitude ? Number(rawLongitude) : NaN

  if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
    return {
      latitude,
      longitude,
      // Vercel 문서상 도시명은 URI 인코딩되어 온다(예: "Ho%20Chi%20Minh%20City").
      city: rawCity ? decodeURIComponent(rawCity) : DEFAULT_LOCATION.city,
      source: 'vercel-ip',
    }
  }

  return { ...DEFAULT_LOCATION, source: 'default' }
}

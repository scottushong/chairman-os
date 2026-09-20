import 'server-only'

import { headers } from 'next/headers'

import type { Coordinates } from '@/lib/cities'


/**
 * 아침 화면(P5-5)의 위치 해석 — 회장이 지금 어디 있는가. 요청 헤더를 읽으므로 서버 전용이다.
 *
 * **import 'server-only'가 맨 위에 있다.** 이 파일이 클라이언트 번들에 닿으면 빌드가
 * 그 자리에서 멈춘다. 예전에는 조용히 끌려 들어가 next/headers 에러로만 드러났고,
 * 그 에러는 원인 파일이 아니라 끌고 들어온 파일을 가리켜 읽기 어려웠다.
 *
 * 좌표 타입과 도시 표는 lib/cities.ts로 옮겼다 — 클라이언트도 알아야 하는 어휘라
 * 서버 전용 모듈에 같이 둘 수 없다.
 *
 * 좌표는 절대 URL 쿼리나 클라이언트로 나가는 어떤 것에도 싣지 않는다 — 서버 컴포넌트가
 * resolveLocation()을 직접 불러 그 자리에서 쓰고, weather.ts로 넘길 때도 서버 안에서만 돈다.
 */

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

/**
 * Vercel 문서상 도시명은 URI 인코딩되어 온다(예: "Ho%20Chi%20Minh%20City").
 *
 * **decodeURIComponent를 맨손으로 부르면 안 된다.** 인코딩이 깨진 값("%", "%E0%A4%A")이
 * 오면 URIError를 던지는데, 이 함수는 서버 컴포넌트가 직접 부르므로 그 예외가 그대로
 * 올라가 /ai 전체를 500으로 만든다 — 회장이 아침에 가장 먼저 여는 화면이다.
 * 이 헤더는 로컬에도 Vercel 밖에도 없어서 이 경로는 여기서 한 번도 돌아 본 적이 없고,
 * 배포하는 순간 모든 요청에서 돈다. 못 읽으면 좌표는 그대로 쓰고 도시 이름만 기본값으로
 * 떨어뜨린다 — 이름 하나 때문에 날씨까지 버릴 이유는 없다.
 */
function decodeCity(rawCity: string | null): string {
  if (!rawCity) return DEFAULT_LOCATION.city
  try {
    return decodeURIComponent(rawCity) || DEFAULT_LOCATION.city
  } catch {
    return DEFAULT_LOCATION.city
  }
}

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
      city: decodeCity(rawCity),
      source: 'vercel-ip',
    }
  }

  return { ...DEFAULT_LOCATION, source: 'default' }
}

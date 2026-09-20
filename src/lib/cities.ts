/**
 * 좌표 어휘 — 타입과 도시 표. **이 파일은 아무것도 import하지 않는다.**
 *
 * lib/geo.ts에서 갈라져 나온 이유가 그것이다. 그쪽은 next/headers로 요청 헤더를 읽는
 * 서버 전용 모듈인데, 좌표 타입과 도시 목록은 클라이언트도 알아야 한다
 * (use-geolocation.ts가 브라우저 좌표를 다루고, weather-panel.tsx가 도시를 그린다).
 *
 * 한 파일에 있으면 값 하나를 가져다 쓰는 순간 next/headers가 브라우저 번들로 끌려 들어가
 * 빌드가 깨진다. lib/weather-codes.ts와 같은 사정이고 같은 해법이다 —
 * 순수한 어휘는 서버에 닿는 것과 한 파일에 두지 않는다.
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

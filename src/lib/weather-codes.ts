/**
 * WMO 날씨 코드의 어휘 — 라벨과 그림. **이 파일은 아무것도 import하지 않는다.**
 *
 * lib/weather.ts에서 갈라져 나온 이유가 그것이다. 그쪽은 Open-Meteo를 부르느라
 * lib/geo.ts를 거쳐 next/headers에 닿고, next/headers는 서버 전용이다.
 * 'use client' 컴포넌트(weather-panel.tsx)가 코드→그림 하나를 쓰려고 그 파일을 값으로
 * import하면 서버 전용 모듈이 통째로 브라우저 번들에 끌려 들어가 빌드가 깨진다.
 *
 * 타입만 쓸 때는 import type이라 지워지므로 드러나지 않는다. 그래서 경계가 조용하다 —
 * 값 하나를 가져다 쓰는 순간에만 터진다. 순수한 어휘를 여기 따로 두면 그 함정이 없어진다.
 */

/** WMO weather_code → 한국어 라벨. 저장소의 *_LABEL_KO 관례와 같다 — 날것의 숫자는 화면에 못 나간다. */
export const WEATHER_CODE_LABEL_KO: Record<number, string> = {
  0: '맑음',
  1: '대체로 맑음',
  2: '구름 조금',
  3: '흐림',
  45: '안개',
  48: '서리 안개',
  51: '이슬비(약)',
  53: '이슬비(보통)',
  55: '이슬비(강)',
  56: '어는 이슬비(약)',
  57: '어는 이슬비(강)',
  61: '비(약)',
  63: '비(보통)',
  65: '비(강)',
  66: '어는 비(약)',
  67: '어는 비(강)',
  71: '눈(약)',
  73: '눈(보통)',
  75: '눈(강)',
  77: '싸락눈',
  80: '소나기(약)',
  81: '소나기(보통)',
  82: '소나기(강)',
  85: '소나기눈(약)',
  86: '소나기눈(강)',
  95: '뇌우',
  96: '뇌우(약한 우박)',
  99: '뇌우(강한 우박)',
}

export function weatherLabel(code: number): string {
  return WEATHER_CODE_LABEL_KO[code] ?? '알 수 없음'
}

/**
 * 그림 여섯 개. WMO 28개를 여기로 접는다.
 *
 * 스물여덟 개를 다 그리지 않는 이유는 아침에 필요한 정보가 '우산을 드나, 코트를 입나'이지
 * '이슬비인가 약한 비인가'가 아니기 때문이다. 세밀한 구분은 라벨이 이미 한다 —
 * 그림은 한눈에 읽히는 쪽이고, 라벨은 정확한 쪽이다.
 */
export const WEATHER_ICON_NAMES = ['sun', 'cloud', 'fog', 'rain', 'snow', 'thunder'] as const
export type WeatherIconName = (typeof WEATHER_ICON_NAMES)[number]

/**
 * WMO 코드 → 그림.
 *
 * 어는 비(56·57·66·67)는 **비** 쪽이다. 떨어질 때 액체라 우산을 드는 날씨고,
 * 눈 그림을 띄우면 화면이 거짓말을 한다. 얼어붙는다는 사실은 라벨이 말한다.
 * 모르는 코드는 구름으로 떨어진다 — Open-Meteo가 코드를 늘려도 칸이 비면 안 된다.
 */
export function weatherIconFor(code: number): WeatherIconName {
  if (code === 0 || code === 1) return 'sun'
  if (code === 2 || code === 3) return 'cloud'
  if (code === 45 || code === 48) return 'fog'
  if (code >= 95 && code <= 99) return 'thunder'
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow'
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return 'rain'
  return 'cloud'
}

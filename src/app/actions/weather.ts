'use server'

import { currentUser } from '@/lib/auth/session'
import { getCurrentLocationWeather, type WeatherCurrent } from '@/lib/weather'

/**
 * 브라우저가 알려 준 좌표의 현재 날씨 (P5-5c 상단 날씨 칸의 '현재 위치' 버튼).
 *
 * 왜 Server Action인가. lib/weather.ts는 lib/geo.ts를 import하고 geo.ts는 next/headers를
 * 쓴다 — 클라이언트 번들로 넘어갈 수 없는 모듈이다. 그렇다고 Open-Meteo 호출을 브라우저에
 * 다시 구현하면 P5-5b가 만든 실패 처리(널 수렴·30분 캐시·응답 정규화)를 두 벌 갖게 된다.
 * 그래서 좌표만 받아 서버에서 같은 함수를 부른다.
 *
 * 좌표는 여기서 끝난다. 로그에도 URL에도 남기지 않는다 — geo.ts 머리 주석과 같은 원칙이고,
 * 방향만 반대다(서버가 정한 좌표를 클라이언트로 내리지 않는다 / 회장이 준 좌표를 저장하지 않는다).
 *
 * 세션이 없으면 아무것도 하지 않는다. Server Action은 공개된 입구라, 이걸 열어 두면
 * 로그인하지 않은 누구나 이 앱을 통해 외부 API를 부를 수 있다.
 */
export async function weatherAtCoordinates(input: {
  latitude: unknown
  longitude: unknown
}): Promise<WeatherCurrent | null> {
  const user = await currentUser()
  if (!user) return null

  const latitude = Number(input.latitude)
  const longitude = Number(input.longitude)
  // 반쪽 좌표·범위 밖 좌표는 부르지 않는다. 실패는 전부 null로 수렴하고 패널이 그걸 그린다.
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null

  return getCurrentLocationWeather({ latitude, longitude })
}

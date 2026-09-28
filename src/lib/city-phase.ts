import 'server-only'

import { headers } from 'next/headers'

import { DEFAULT_TIMEZONE, isValidTimezone, localHourIn } from '@/lib/chairman-timezone'
import { phaseAt, type CityPhase } from '@/lib/city'

/**
 * 전경을 낮으로 걸지 저녁으로 걸지 — **보는 사람의 현지 시각**으로 정한다(원문 "현지 시각으로
 * 낮/저녁").
 *
 * 시간대는 Vercel 엣지가 채우는 `x-vercel-ip-timezone`에서 읽는다(날씨 카드가 좌표를 읽는
 * lib/geo.ts와 같은 원천). 로컬 `next dev`처럼 헤더가 없으면 서울이다.
 *
 * **서버에서 정한다.** 브라우저 시계로 정하면 첫 그림이 낮으로 서고 hydration 뒤에 저녁으로
 * 바뀌어 밤마다 번쩍인다. 로그인 전 화면(/login)도 같은 판정을 쓴다 — 세션이 필요 없다.
 */
export async function cityPhase(now = new Date()): Promise<CityPhase> {
  const raw = (await headers()).get('x-vercel-ip-timezone')
  const tz = isValidTimezone(raw) ? raw : DEFAULT_TIMEZONE
  const hour = localHourIn(tz, now)
  return Number.isFinite(hour) ? phaseAt(hour) : 'day'
}

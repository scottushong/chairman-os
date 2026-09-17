import { timingSafeEqual } from 'node:crypto'

import type { NextRequest } from 'next/server'

/**
 * Vercel Cron 요청인가. Vercel이 Authorization: Bearer ${CRON_SECRET} 을 실어 보낸다.
 * CRON_SECRET이 없으면 누구도 통과하지 못한다 — 비밀이 빈 문자열인 채로 열리는 일을 없앤다.
 *
 * Cron 입구(/api/cron/*)가 같은 판정을 쓴다. 두 벌이면 한쪽만 고쳐지는 날이 온다.
 */
export function isCronAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const given = Buffer.from(request.headers.get('authorization') ?? '')
  const expected = Buffer.from(`Bearer ${secret}`)
  return given.length === expected.length && timingSafeEqual(given, expected)
}

import { NextResponse } from 'next/server'

import { currentUser } from '@/lib/auth/session'
import { loadCitySnapshot } from '@/lib/city-live-load'
import { getRepository } from '@/lib/repository'

/**
 * /api/city/live — 살아 있는 그룹 시티의 1분 폴링 (Phase 8 G-3).
 *
 * 건물(매출 · 단계)과 사람 · 서류 · 차량을 한 장으로 돌려준다(lib/city-live.ts CitySnapshot).
 * 3D 씬과 그림 + 레이어가 같은 응답을 읽는다.
 *
 * **열람 기록을 남기지 않는다.** 1분마다 부르는 요청이 audit_log에 read를 쌓으면 접속 기록이
 * 폴링으로 채워지고, 그 기록이 다시 «지금 접속해 있다»가 된다 — 화면을 켜 둔 것만으로 영원히 접속한 사람이 된다.
 * 권한은 세션의 RLS가 그대로 건다.
 */
export const dynamic = 'force-dynamic'

export async function GET() {
  const user = await currentUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  try {
    const repo = await getRepository()
    const snapshot = await loadCitySnapshot(repo, user.role)
    return NextResponse.json(snapshot, { headers: { 'cache-control': 'no-store' } })
  } catch (e) {
    console.error('[city/live]', e instanceof Error ? e.message : String(e))
    return NextResponse.json({ error: 'load failed' }, { status: 500 })
  }
}

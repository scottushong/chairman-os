import { NextResponse, type NextRequest } from 'next/server'

import { getRepository } from '@/lib/repository'
import { investmentApiGate } from '@/lib/investment/screen'

/**
 * /api/investment/data?what=sources|disclosures|changes|securities — 대표 · «/investment» 지정자 전용 JSON(내려받기 · 다른 화면용).
 * 로그인 없거나 직원이면 403(화면 숨김 · RLS와 별개로 서버에서 한 번 더). 스위치가 꺼지면 404.
 */
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const gate = await investmentApiGate()
  if (gate.status !== 200) return NextResponse.json({ error: gate.status === 404 ? '꺼진 기능입니다.' : '권한이 없습니다.' }, { status: gate.status })
  const repo = await getRepository()
  const what = request.nextUrl.searchParams.get('what')
  try {
    if (what === 'sources') return NextResponse.json(await repo.invSources())
    if (what === 'disclosures') return NextResponse.json(await repo.invDisclosures())
    if (what === 'securities') return NextResponse.json(await repo.invSecurities())
    if (what === 'changes') {
      const to = request.nextUrl.searchParams.get('to')
      if (!to || !/^[0-9a-f-]{36}$/i.test(to)) return NextResponse.json({ error: 'to=<공시 id>가 필요합니다.' }, { status: 400 })
      return NextResponse.json(await repo.invChanges({ toDisclosures: [to] }))
    }
    return NextResponse.json({ error: 'what=sources|disclosures|changes|securities' }, { status: 400 })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error && e.message === 'investment_unavailable' ? '0094 적용 전입니다.' : '읽지 못했습니다.' }, { status: 500 })
  }
}

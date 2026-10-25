import { NextResponse, type NextRequest } from 'next/server'

import { currentUser } from '@/lib/auth/session'
import { boardWidgetData } from '@/lib/dashboard/widgets'
import { homeAccess, kindAllowed, type DataScope } from '@/lib/home/data'
import { filterOf, widgetDef } from '@/lib/home/widgets'
import { getRepository } from '@/lib/repository'

/**
 * 0097 위젯 한 칸의 내용 — GET /api/home/widget?kind=<종류>&filter=<표시 범위>&biz=<all|회사 id>&project=<프로젝트 id>
 * 화면(대표 첫 화면 · 직원 홈)이 위젯마다 따로 부른다(한 위젯 실패가 홈 전체를 막지 않는다).
 *   403  로그인 없음 · «내 홈» 꺼짐 · 이 사람이 넣을 수 없는 위젯(직원의 재무 · 투자 위젯 등) · 볼 수 없는 회사 · 프로젝트 범위.
 *   400  모르는 종류 · 범위 모양 틀림.
 * 판정은 서버에서 한 번 더(화면 목록과 별개) — 그 뒤 내용은 각 기능의 기존 조회 · RLS로 읽는다.
 */
export const dynamic = 'force-dynamic'

const deny = (text: string) => NextResponse.json({ state: 'denied', text }, { status: 403 })

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams
  const user = await currentUser()
  if (!user) return deny('로그인이 필요합니다.')
  const access = await homeAccess(user)
  if (!access.home) return deny('«내 홈»을 쓸 수 없는 계정입니다.')
  const def = widgetDef(q.get('kind') ?? '')
  if (!def) return NextResponse.json({ state: 'error', text: '알 수 없는 위젯입니다.' }, { status: 400 })
  if (!kindAllowed(access, def.kind)) return deny('이 계정으로는 쓸 수 없는 위젯입니다.')

  const biz = q.get('biz') || 'all'
  const project = q.get('project') || null
  if (!/^(all|[a-z][a-z0-9_]{1,40})$/.test(biz) || (project !== null && !/^[A-Za-z0-9_-]{1,60}$/.test(project))) {
    return NextResponse.json({ state: 'error', text: '범위 모양이 올바르지 않습니다.' }, { status: 400 })
  }
  const scope: DataScope = { biz: def.scoped ? biz : 'all', project: def.scoped === 'project' ? project : null }
  // 범위는 «내가 볼 수 있는 회사 · 프로젝트» 안에서만(RLS로 읽은 목록) — 남의 회사 id를 넣어 넓히지 못한다.
  if (scope.biz !== 'all' || scope.project) {
    const repo = await getRepository()
    const [businesses, projects] = await Promise.all([repo.listBusinesses(), scope.project ? repo.listProjects() : Promise.resolve([])])
    if (scope.biz !== 'all' && !businesses.some((b) => b.business_id === scope.biz)) return deny('볼 수 없는 회사입니다.')
    if (scope.project && !projects.some((p) => p.project_id === scope.project)) return deny('볼 수 없는 프로젝트입니다.')
  }
  const filter = filterOf({ kind: def.kind, settings: { filter: q.get('filter') ?? undefined } })
  const data = await boardWidgetData(user, access, def.kind, filter, scope)
  return NextResponse.json(data, { status: data.state === 'denied' ? 403 : 200, headers: { 'cache-control': 'no-store' } })
}

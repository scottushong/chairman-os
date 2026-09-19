import Link from 'next/link'

import { CreateInitiative } from '@/components/initiatives/create-initiative'
import { InitiativeTable } from '@/components/initiatives/initiative-table'
import { PageHeader } from '@/components/layout/page-header'
import { FilterChips, type FilterOption } from '@/components/ui/filter-chips'
import { currentUser } from '@/lib/auth/session'
import { kstToday } from '@/lib/chairman-project'
import { orderInitiatives } from '@/lib/initiative'
import { firstParam, oneOf, withParams } from '@/lib/query'
import { getRepository } from '@/lib/repository'
import {
  INITIATIVE_KIND, INITIATIVE_KIND_LABEL_KO,
  INITIATIVE_STATUS, INITIATIVE_STATUS_LABEL_KO,
  type Initiative,
} from '@/types'

/**
 * /initiatives — 회사 밖에서 굴러가는 건 목록 (Phase 4-A).
 *
 * 칸반이 아니라 표다. 단계가 여섯이라 칸반으로 펴면 노트북 폭에서 카드가 세로로 길어진다.
 * 대신 stage로 묶어 소제목을 준다 — 회장이 보는 것은 '어느 단계에 몇 건이 쌓였나'다.
 *
 * 기본 필터는 status=Active다. 접은 건까지 늘 보이면 목록이 쓰레기통이 된다.
 *
 * 필터는 URL에 있다(lib/query.ts) — tasks/page.tsx와 같은 이유다. 칩의 숫자는
 * '나머지 필터가 걸린 상태에서 이걸 누르면 몇 건이 보이나'라, 각자 자기 필터만 뺀 채로 센다.
 */
const BASE = '/initiatives'

export default async function InitiativesPage(props: PageProps<'/initiatives'>) {
  const params = await props.searchParams
  const repo = await getRepository()
  const [initiatives, businesses, user] = await Promise.all([
    repo.listInitiatives(),
    repo.listBusinesses(),
    currentUser(),
  ])
  const today = kstToday()
  // initiatives/[id]/page.tsx와 같은 판단이다 — canEdit은 안내일 뿐, 실제 저장은 항상
  // 0017의 initiatives_write(Chairman·GroupCFO)가 다시 본다.
  const canEdit = user?.role === 'Chairman' || user?.role === 'GroupCFO'

  const kind = oneOf(firstParam(params.kind), INITIATIVE_KIND)
  const status = oneOf(firstParam(params.status), INITIATIVE_STATUS) ?? 'Active'
  const business = firstParam(params.business)

  const match = (i: Initiative, skip?: 'kind' | 'status' | 'business') =>
    (skip === 'kind' || !kind || i.kind === kind) &&
    (skip === 'status' || i.status === status) &&
    (skip === 'business' || !business || i.business_id === business)

  const byStatus = initiatives.filter((i) => match(i, 'status'))
  const byKind = initiatives.filter((i) => match(i, 'kind'))
  const byBusiness = initiatives.filter((i) => match(i, 'business'))

  const shown = orderInitiatives(initiatives.filter((i) => match(i)))

  const statusOptions: FilterOption[] = INITIATIVE_STATUS.map((s) => ({
    label: INITIATIVE_STATUS_LABEL_KO[s],
    href: withParams(BASE, { kind, status: s, business }),
    active: status === s,
    count: byStatus.filter((i) => i.status === s).length,
  }))

  const kindOptions: FilterOption[] = [
    { label: '전체', href: withParams(BASE, { kind: undefined, status, business }), active: !kind },
    ...INITIATIVE_KIND.map((k) => ({
      label: INITIATIVE_KIND_LABEL_KO[k],
      href: withParams(BASE, { kind: k, status, business }),
      active: kind === k,
      count: byKind.filter((i) => i.kind === k).length,
    })),
  ]

  const businessOptions: FilterOption[] = [
    { label: '전체', href: withParams(BASE, { kind, status, business: undefined }), active: !business },
    ...businesses.map((b) => ({
      label: b.name,
      href: withParams(BASE, { kind, status, business: b.business_id }),
      active: business === b.business_id,
      count: byBusiness.filter((i) => i.business_id === b.business_id).length,
    })),
  ]

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-5">
      <PageHeader
        icon="target"
        code="Phase 4-A"
        title="이니셔티브"
        description="회사 다섯 곳 밖에서 회장이 직접 굴리는 건입니다."
      >
        <Link href="/calendar" className="text-[12px] text-accent underline-offset-2 hover:underline">
          캘린더에서 보기
        </Link>
      </PageHeader>

      {canEdit ? <CreateInitiative /> : null}

      <div className="mt-4 space-y-2">
        <FilterChips label="상태" options={statusOptions} />
        <FilterChips label="유형" options={kindOptions} />
        <FilterChips label="회사" options={businessOptions} />
      </div>

      <InitiativeTable
        initiatives={shown}
        businesses={businesses}
        today={today}
        hasAny={initiatives.length > 0}
      />

      <p className="mt-6 text-[11px] text-ink-dim">
        보이는 범위는 이 화면이 아니라 0017의 RLS가 정합니다. 회장과 그룹 CFO만 읽습니다.
      </p>
    </div>
  )
}

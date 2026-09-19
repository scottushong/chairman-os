import Link from 'next/link'

import { CreateInitiative } from '@/components/initiatives/create-initiative'
import { InitiativeCards } from '@/components/initiatives/initiative-cards'
import { InitiativeTable } from '@/components/initiatives/initiative-table'
import { PageHeader } from '@/components/layout/page-header'
import { FilterChips, type FilterOption } from '@/components/ui/filter-chips'
import { GlassCard } from '@/components/ui/glass-card'
import { currentUser } from '@/lib/auth/session'
import { kstToday } from '@/lib/chairman-project'
import { orderInitiatives } from '@/lib/initiative'
import { firstParam, oneOf, withParams } from '@/lib/query'
import { getRepository } from '@/lib/repository'
import {
  INITIATIVE_KIND, INITIATIVE_KIND_LABEL_KO,
  INITIATIVE_STAGE, INITIATIVE_STAGE_LABEL_KO,
  INITIATIVE_STATUS, INITIATIVE_STATUS_LABEL_KO,
  type Initiative,
} from '@/types'

/**
 * /initiatives — 회사 밖에서 굴러가는 건 목록 (Phase 4-A → P5-3에서 카드 그리드로).
 *
 * 기본은 카드 그리드다(Step 3·4) — 열네 건을 넘기면 제목만으로는 못 찾고 로고로 찾게 된다는
 * 것이 이 화면을 다시 만든 이유다. 옛 단계별 표는 `?view=table`로 남겨 둔다.
 *
 * 기본 필터는 status=Active다. 접은 건까지 늘 보이면 목록이 쓰레기통이 된다.
 * 표가 단계로 묶어 주던 것을 그리드에서는 못 하니, 그 대신 단계 필터 탭을 맨 위에 둔다.
 *
 * 필터는 URL에 있다(lib/query.ts) — tasks/page.tsx와 같은 이유다. 칩의 숫자는
 * '나머지 필터가 걸린 상태에서 이걸 누르면 몇 건이 보이나'라, 각자 자기 필터만 뺀 채로 센다.
 *
 * 필터 칩(FilterChips)은 라벨·비활성 텍스트에 text-ink-muted를 쓴다 — 맨 배경 위에서는
 * 3.36:1로 AA 미달이라(globals.css) GlassCard 한 장으로 감싸 유리 면 위에 올린다.
 */
const BASE = '/initiatives'
const VIEW = ['cards', 'table'] as const

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
  const stage = oneOf(firstParam(params.stage), INITIATIVE_STAGE)
  // 기본 view는 카드다(Step 3·4). 옛 단계별 표는 ?view=table로만 남는다.
  const view = oneOf(firstParam(params.view), VIEW) ?? 'cards'

  const match = (i: Initiative, skip?: 'kind' | 'status' | 'business' | 'stage') =>
    (skip === 'kind' || !kind || i.kind === kind) &&
    (skip === 'status' || i.status === status) &&
    (skip === 'business' || !business || i.business_id === business) &&
    (skip === 'stage' || !stage || i.stage === stage)

  const byStatus = initiatives.filter((i) => match(i, 'status'))
  const byKind = initiatives.filter((i) => match(i, 'kind'))
  const byBusiness = initiatives.filter((i) => match(i, 'business'))
  const byStage = initiatives.filter((i) => match(i, 'stage'))

  const shown = orderInitiatives(initiatives.filter((i) => match(i)))

  // withParams는 임의 키를 받는다(lib/query.ts) — stage·view도 kind·status·business와
  // 같은 자리에 그대로 얹는다.
  const stageOptions: FilterOption[] = [
    { label: '전체', href: withParams(BASE, { kind, status, business, stage: undefined, view }), active: !stage },
    ...INITIATIVE_STAGE.map((s) => ({
      label: INITIATIVE_STAGE_LABEL_KO[s],
      href: withParams(BASE, { kind, status, business, stage: s, view }),
      active: stage === s,
      count: byStage.filter((i) => i.stage === s).length,
    })),
  ]

  const statusOptions: FilterOption[] = INITIATIVE_STATUS.map((s) => ({
    label: INITIATIVE_STATUS_LABEL_KO[s],
    href: withParams(BASE, { kind, status: s, business, stage, view }),
    active: status === s,
    count: byStatus.filter((i) => i.status === s).length,
  }))

  const kindOptions: FilterOption[] = [
    { label: '전체', href: withParams(BASE, { kind: undefined, status, business, stage, view }), active: !kind },
    ...INITIATIVE_KIND.map((k) => ({
      label: INITIATIVE_KIND_LABEL_KO[k],
      href: withParams(BASE, { kind: k, status, business, stage, view }),
      active: kind === k,
      count: byKind.filter((i) => i.kind === k).length,
    })),
  ]

  const businessOptions: FilterOption[] = [
    { label: '전체', href: withParams(BASE, { kind, status, business: undefined, stage, view }), active: !business },
    ...businesses.map((b) => ({
      label: b.name,
      href: withParams(BASE, { kind, status, business: b.business_id, stage, view }),
      active: business === b.business_id,
      count: byBusiness.filter((i) => i.business_id === b.business_id).length,
    })),
  ]

  // 카드 그리드에 보일 로고만 한 번에 서명한다(item 2) — 카드마다 부르면 14장 그리드가
  // 14요청이 된다. 표 보기에서는 로고를 안 그리니 아예 부르지 않는다.
  const logoUrls =
    view === 'cards'
      ? await repo.signInitiativeLogos(
          [...new Set(shown.map((i) => i.logo_url).filter((p): p is string => p !== null))],
        )
      : {}

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-5">
      <PageHeader
        icon="target"
        code="Phase 4-A"
        title="이니셔티브"
        description="회사 다섯 곳 밖에서 회장이 직접 굴리는 건입니다."
      >
        <Link
          href={withParams(BASE, { kind, status, business, stage, view: view === 'table' ? undefined : 'table' })}
          className="text-[12px] text-accent underline-offset-2 hover:underline"
        >
          {view === 'table' ? '카드로 보기' : '단계별 표로 보기'}
        </Link>
        <Link href="/calendar" className="text-[12px] text-accent underline-offset-2 hover:underline">
          캘린더에서 보기
        </Link>
      </PageHeader>

      {canEdit ? <CreateInitiative /> : null}

      {/* 필터 칩은 라벨·비활성 텍스트가 text-ink-muted다 — 맨 배경 위에서는 AA 미달이라
          GlassCard로 감싸 유리 면 위에 올린다(item D). 단계 탭을 맨 위에 둔다(Step 4) —
          카드 그리드가 표처럼 단계로 묶어 주지 않는 대신이다. */}
      <GlassCard as="section" padding="p-3.5" className="mt-4 space-y-2">
        <FilterChips label="단계" options={stageOptions} />
        <FilterChips label="상태" options={statusOptions} />
        <FilterChips label="유형" options={kindOptions} />
        <FilterChips label="회사" options={businessOptions} />
      </GlassCard>

      {view === 'table' ? (
        <InitiativeTable
          initiatives={shown}
          businesses={businesses}
          today={today}
          hasAny={initiatives.length > 0}
        />
      ) : (
        <InitiativeCards
          initiatives={shown}
          businesses={businesses}
          logoUrls={logoUrls}
          today={today}
          hasAny={initiatives.length > 0}
        />
      )}

      <p className="mt-6 text-[11px] text-ink-dim">
        보이는 범위는 이 화면이 아니라 0017의 RLS가 정합니다. 회장과 그룹 CFO만 읽습니다.
      </p>
    </div>
  )
}

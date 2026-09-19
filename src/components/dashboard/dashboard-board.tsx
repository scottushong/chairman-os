'use client'

import { useMemo, useState } from 'react'

import { createBusiness } from '@/app/actions/businesses'
import { saveHiddenBusinesses, savePinnedBusinesses } from '@/app/actions/settings'
import {
  AddBusinessModal,
  type AddBusinessInput,
} from '@/components/dashboard/add-business-modal'
import { BusinessCard, type BusinessMetrics } from '@/components/dashboard/business-card'
import { DdayHero } from '@/components/dashboard/dday-hero'
import { FinanceTrend } from '@/components/dashboard/finance-trend'
import { KpiStrip } from '@/components/dashboard/kpi-strip'
import { Icon } from '@/components/ui/icon'
import { effectivePinned } from '@/lib/business-pins'
import { businessProgress, groupFigure, hasFinanceData, latestPeriodOf, valueOf } from '@/lib/finance'
import type { UserSettings } from '@/lib/repository'
import type { Business, ChairmanProject, FinanceKpi, Project } from '@/types'

/**
 * Business 카드(CH-001~005)와 그룹 KPI(CH-006~010)를 한 상태 위에 올린다.
 * 카드를 숨기면 KPI 합계에서도 빠져야 하므로 표시 목록을 여기서 한 번만 들고 있는다.
 * 핀(CH-004)은 순서만 바꾼다 — 합계는 '표시 중'만 보므로 핀에 영향받지 않는다.
 *
 * 숨김·핀은 서버(user_settings)에 있다. 서버 응답을 기다렸다 그리면 클릭이 굼떠 보이므로
 * 화면은 먼저 바꾸고 저장은 뒤따르게 하되, 실패하면 되돌린다 —
 * 저장 안 된 상태를 저장된 것처럼 보여 주면 새로고침에서 그대로 튄다.
 *
 * P5-2부터 히어로(DdayHero + FinanceTrend)도 여기서 그린다. FinanceTrend는 '표시 중인
 * 회사'만 합산해야 하는데(CH-006~010 Acceptance) 그 목록(`shown`)이 이 컴포넌트의
 * 클라이언트 상태(hidden/pinned)에서만 나온다. page.tsx(서버 컴포넌트)로 히어로를
 * 올리면 같은 필터링 로직을 두 곳에 둬야 하고, 그러면 언젠가 KPI 합계와 FinanceTrend
 * 합계가 서로 다른 회사를 세는 날이 온다 — 그래서 히어로째로 이 컴포넌트가 데리고 있는다.
 */

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

interface DashboardBoardProps {
  businesses: Business[]
  financeKpis: FinanceKpi[]
  projects: Project[]
  settings: UserSettings
  /** DdayHero용. ChairmanDdayCard(인사말 알약)와 같은 원천을 히어로 크기로 다시 그린다. */
  chairmanProjects: ChairmanProject[]
}

/**
 * 이니셜은 회사에 붙는 이름표다. sort_order 기준으로 한 번 정해 두고 고정한다.
 * 화면 순서로 매기면 핀을 누를 때마다 A와 B가 자리를 바꿔 카드를 다시 읽어야 한다.
 */
function letterMap(all: Business[]): Map<string, string> {
  return new Map(
    [...all]
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((b, i) => [b.business_id, LETTERS[i] ?? '?'] as const),
  )
}

export function DashboardBoard({
  businesses,
  financeKpis,
  projects,
  settings,
  chairmanProjects,
}: DashboardBoardProps) {
  const [hidden, setHidden] = useState<string[]>(settings.hidden_businesses)
  const [pinned, setPinned] = useState<string[]>(() =>
    effectivePinned(businesses, settings.pinned_businesses),
  )
  const [error, setError] = useState<string | null>(null)

  const [adding, setAdding] = useState(false)

  const letters = useMemo(() => letterMap(businesses), [businesses])

  /** 핀 우선, 그다음 sort_order. 드래그 순서(CH-005)는 아직 sort_order를 그대로 쓴다. */
  const ordered = useMemo(
    () =>
      businesses
        .filter((b) => b.visible)
        .sort(
          (a, b) =>
            Number(pinned.includes(b.business_id)) - Number(pinned.includes(a.business_id)) ||
            a.sort_order - b.sort_order,
        ),
    [businesses, pinned],
  )

  /**
   * 카드 세 숫자를 여기서 한 번에 낸다. 카드마다 원천 배열을 훑으면
   * 회사 수 × 지표 수만큼 같은 배열을 다시 도는 셈이 된다.
   */
  const metrics = useMemo(() => {
    const period = latestPeriodOf(financeKpis)
    return new Map<string, BusinessMetrics>(
      ordered.map((b) => [
        b.business_id,
        {
          revenue: valueOf(financeKpis, b.business_id, 'Revenue', period),
          ebitda: valueOf(financeKpis, b.business_id, 'EBITDA', period),
          progress: businessProgress(projects, b.business_id),
          hasFinance: hasFinanceData(financeKpis, b.business_id),
          revenueBasis: groupFigure(financeKpis, 'Revenue', period, [b.business_id])?.basis ?? null,
          ebitdaBasis: groupFigure(financeKpis, 'EBITDA', period, [b.business_id])?.basis ?? null,
        },
      ]),
    )
  }, [ordered, financeKpis, projects])

  /** 낙관적으로 먼저 바꾸고, 저장이 실패하면 이전 값으로 되돌린다. */
  function persist(
    next: string[],
    previous: string[],
    apply: (value: string[]) => void,
    save: (ids: string[]) => Promise<{ error?: string }>,
  ) {
    setError(null)
    apply(next)
    void save(next).then((result) => {
      if (result.error) {
        apply(previous)
        setError(result.error)
      }
    })
  }

  function toggle(businessId: string) {
    const next = hidden.includes(businessId)
      ? hidden.filter((id) => id !== businessId)
      : [...hidden, businessId]
    persist(next, hidden, setHidden, saveHiddenBusinesses)
  }

  function togglePin(businessId: string) {
    const next = pinned.includes(businessId)
      ? pinned.filter((id) => id !== businessId)
      : [...pinned, businessId]
    persist(next, pinned, setPinned, savePinnedBusinesses)
  }

  /**
   * CH-002. 서버가 만들고 나면 revalidatePath('/')로 대시보드가 다시 그려지므로
   * 여기서 카드 목록을 직접 건드리지 않는다. 낙관적으로 먼저 그리면
   * 권한 거부로 실패했을 때 카드가 한 번 떴다가 사라진다.
   */
  async function create(input: AddBusinessInput): Promise<string | null> {
    const result = await createBusiness(input)
    return result.error ?? null
  }

  const shown = ordered.filter((b) => !hidden.includes(b.business_id))
  const hiddenList = ordered.filter((b) => hidden.includes(b.business_id))

  const empty: BusinessMetrics = { revenue: 0, ebitda: 0, progress: 0, hasFinance: false, revenueBasis: null, ebitdaBasis: null }

  return (
    <div className="space-y-5">
      {/* 히어로(P5-2 Step 2). 좌 400px D-day + 우 재무 추이. 좁은 화면에서는 세로로 쌓는다. */}
      <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-[400px_1fr]">
        <DdayHero projects={chairmanProjects} />
        <FinanceTrend kpis={financeKpis} businessIds={shown.map((b) => b.business_id)} />
      </div>

      <section aria-label="내 비즈니스">
        <div className="mb-2 flex items-baseline gap-2">
          <h2 className="text-[13px] font-semibold">내 비즈니스 (A,B,C)</h2>
          <span className="text-[11px] text-ink-muted tnum">
            {shown.length} / {ordered.length}개 표시 중
          </span>
          {error ? (
            <span role="alert" className="text-[11px] text-critical">
              {error}
            </span>
          ) : null}
        </div>

        {/* 카드는 남는 폭을 균등하게 나눠 갖고, 추가 버튼만 좁게 끝에 붙인다.
            lg 이상에서는 줄을 넘기지 않는다 — 다섯 장 중 한 장만 아랫줄로 떨어지면 그 회사만 커 보인다.
            그 아래 폭에서는 숫자가 안 읽히므로 접는다. */}
        <div className="flex flex-wrap items-stretch gap-2 lg:flex-nowrap">
          {shown.map((b) => (
            <div key={b.business_id} className="min-w-[180px] flex-1 lg:min-w-0 lg:basis-0">
              <BusinessCard
                business={b}
                metrics={metrics.get(b.business_id) ?? empty}
                letter={letters.get(b.business_id) ?? '?'}
                pinned={pinned.includes(b.business_id)}
                onToggleVisible={toggle}
                onTogglePinned={togglePin}
              />
            </div>
          ))}

          {/* CH-002. 카드 줄 끝에 붙어 있어야 '한 장 더 추가'로 읽힌다. */}
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="flex w-[64px] shrink-0 flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-line text-ink-muted transition-colors hover:border-accent hover:text-ink"
          >
            <Icon name="plus" className="size-5" />
            <span className="text-center text-[11px] leading-tight break-keep">기업 추가</span>
          </button>
        </div>

        {hiddenList.length > 0 ? (
          <div className="mt-2.5 flex flex-wrap items-center gap-2 rounded-lg border border-line-soft bg-panel px-3 py-2">
            <span className="flex items-center gap-1.5 text-[11px] text-ink-muted">
              <Icon name="eye-off" className="size-3.5" />
              숨김 {hiddenList.length}개 (데이터는 그대로 있습니다)
            </span>
            {hiddenList.map((b) => (
              <button
                key={b.business_id}
                type="button"
                onClick={() => toggle(b.business_id)}
                className="flex items-center gap-1 rounded-md bg-raised px-2 py-1 text-[11px] text-ink-dim transition-colors hover:text-ink"
              >
                {b.name}
                <span className="text-ink-muted">다시 표시</span>
              </button>
            ))}
          </div>
        ) : null}
      </section>

      {/* 재배치(P5-2 Step 3): 회사 카드 줄 → KpiStrip. FinanceTrend는 위 히어로로 옮겼다. */}
      <KpiStrip kpis={financeKpis} businessIds={shown.map((b) => b.business_id)} />

      {adding ? <AddBusinessModal onClose={() => setAdding(false)} onCreate={create} /> : null}
    </div>
  )
}

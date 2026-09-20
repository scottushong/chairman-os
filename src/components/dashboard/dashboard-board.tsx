'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'

import { createBusiness } from '@/app/actions/businesses'
import { saveHiddenBusinesses, savePinnedBusinesses } from '@/app/actions/settings'
import {
  AddBusinessModal,
  type AddBusinessInput,
} from '@/components/dashboard/add-business-modal'
import { BusinessCard, type BusinessMetrics } from '@/components/dashboard/business-card'
import { FinanceTrend } from '@/components/dashboard/finance-trend'
import { KpiStrip } from '@/components/dashboard/kpi-strip'
import { ProcessChartCard } from '@/components/dashboard/process-chart-card'
import { InitiativeCards } from '@/components/initiatives/initiative-cards'
import { Icon } from '@/components/ui/icon'
import { effectivePinned } from '@/lib/business-pins'
import { businessProgress, groupFigure, hasFinanceData, latestPeriodOf, valueOf } from '@/lib/finance'
import type { UserSettings } from '@/lib/repository'
import type { Business, FinanceKpi, Initiative, IsoDate, ProcessChart, Project } from '@/types'

/**
 * Business 카드(CH-001~005)와 그룹 KPI(CH-006~010)를 한 상태 위에 올린다.
 * 카드를 숨기면 KPI 합계에서도 빠져야 하므로 표시 목록을 여기서 한 번만 들고 있는다.
 * 핀(CH-004)은 순서만 바꾼다 — 합계는 '표시 중'만 보므로 핀에 영향받지 않는다.
 *
 * 숨김·핀은 서버(user_settings)에 있다. 서버 응답을 기다렸다 그리면 클릭이 굼떠 보이므로
 * 화면은 먼저 바꾸고 저장은 뒤따르게 하되, 실패하면 되돌린다 —
 * 저장 안 된 상태를 저장된 것처럼 보여 주면 새로고침에서 그대로 튄다.
 *
 * 배치는 Phase 5-D에서 3줄로 바뀌었다. 1줄(AI 브리핑·D-day·날씨)은 page.tsx가 그리고,
 * 여기는 2줄(이니셔티브 + 프로세스차트)과 3줄(재무 추이 + 회사 카드)을 맡는다.
 * FinanceTrend는 '표시 중인
 * 회사'만 합산해야 하는데(CH-006~010 Acceptance) 그 목록(`shown`)이 이 컴포넌트의
 * 클라이언트 상태(hidden/pinned)에서만 나온다. page.tsx(서버 컴포넌트)로 히어로를
 * 올리면 같은 필터링 로직을 두 곳에 둬야 하고, 그러면 언젠가 KPI 합계와 FinanceTrend
 * 합계가 서로 다른 회사를 세는 날이 온다 — 그래서 히어로째로 이 컴포넌트가 데리고 있는다.
 *
 * P5-3부터 이니셔티브 카드 요약(item B)도 여기서 그린다. 고르는 로직(진행 중 상위 6건)과
 * 서명 URL 발급은 page.tsx가 미리 해서 내려준다 — 이 컴포넌트는 골라진 목록을 그릴 뿐이다.
 * DecisionPanel·WaitingOnMe·AlertPanel은 page.tsx 아래쪽에 그대로 남아 있다(안 지운다) —
 * '내 결정 사항'은 내비 항목이기도 해서다.
 */

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

interface DashboardBoardProps {
  businesses: Business[]
  financeKpis: FinanceKpi[]
  projects: Project[]
  settings: UserSettings
  /** 프로세스차트(0021). 권한 밖 회사의 행은 아예 오지 않으므로 여기서 다시 거르지 않는다. */
  processCharts: ProcessChart[]
  /** item B. page.tsx가 이미 '진행 중 상위 6건'으로 고른 요약이다 — 여기서 다시 거르지 않는다. */
  initiativeSummary: Initiative[]
  /** signInitiativeLogos(paths)가 initiativeSummary 몫만 한 번에 서명한 맵. */
  initiativeLogoUrls: Record<string, string>
  /** 요약이 아닌 전체 '진행 중' 건수. 헤더 줄의 'N / M건'에 쓴다. */
  initiativeCount: number
  today: IsoDate
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
  processCharts,
  initiativeSummary,
  initiativeLogoUrls,
  initiativeCount,
  today,
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
      {/*
       * 2줄 (Phase 5-D 배치). 이니셔티브 2/3 + 프로세스차트 1/3.
       * 이니셔티브가 0건이면 그 칸이 비고 프로세스차트가 오른쪽에 그대로 선다 —
       * 두 칸의 표시 조건이 다르므로 그리드는 항상 그린다.
       */}
      <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-[2fr_1fr]">
        <div className="min-w-0">
        {/* item B. 진행 중인 이니셔티브 요약 — 목록 화면(/initiatives)의 전체 그리드를
            복제하지 않는다. 0건이면 섹션째로 숨긴다(InitiativeStat과 같은 판단: 빈 카드 줄은
            인사말 아래 이미 있는 요약과 겹쳐 의미 없이 자리만 차지한다).
            이 헤더 줄은 카드 밖(맨 배경) 위다 — text-ink-dim만 쓴다(item D, globals.css
            '유리 없이 글자를 놓지 마라'). text-ink-muted는 여기서 3.36:1로 AA 미달이다. */}
        {initiativeSummary.length > 0 ? (
          <section aria-label="이니셔티브">
            <div className="mb-2 flex items-baseline gap-2">
              <h2 className="text-[13px] font-semibold">이니셔티브</h2>
              <span className="text-[11px] text-ink-dim tnum">
                진행 중 {initiativeCount}건 중 {initiativeSummary.length}건
              </span>
              {/* 열 줄 위의 규칙이 이 링크에도 걸린다. 골드(.text-accent → #855a11)는 맨 배경에서
                  3.39:1이라 유리 없이는 못 쓴다(globals.css:284-286). 링크만 유리 한 장 위로
                  올리면 헤더 줄이 어긋나므로 색을 ink-dim(5.73:1)으로 내리고, 밑줄 hover로
                  '누를 수 있다'를 남긴다. */}
              <Link
                href="/initiatives"
                className="ml-auto text-[11.5px] text-ink-dim underline-offset-2 hover:text-ink hover:underline"
              >
                전체 보기
              </Link>
            </div>
            <InitiativeCards
              initiatives={initiativeSummary}
              businesses={businesses}
              logoUrls={initiativeLogoUrls}
              today={today}
              hasAny
            />
          </section>
        ) : null}
        </div>
        {/* 카드가 옆 칸만큼 높아지도록 최소 높이를 준다. iframe이 남는 높이를 다 쓴다. */}
        <div className="min-h-[320px]">
          <ProcessChartCard charts={processCharts} businesses={businesses} />
        </div>
      </div>

      {/* 3줄. 그룹 재무 추이 1/2 + 회사 카드 1/2. */}
      <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-2">
        <div className="min-w-0">
          <FinanceTrend kpis={financeKpis} businessIds={shown.map((b) => b.business_id)} />
        </div>
        <div className="min-w-0">
        <section aria-label="내 비즈니스">
          {/* 이 줄도 카드 밖(맨 배경)이다 — 아래 이니셔티브 헤더와 같은 규칙을 받는다.
              보조 숫자는 ink-muted(3.35:1)에서 ink-dim(5.73:1)으로 올린다.
              오류는 색을 뺄 수 없는 자리라(위험색) 글자 대신 **면을 깐다** — 맨 그라데이션 위의
              text-critical은 3.33:1이고, bg-critical/10 톤 칩으로 감싸도 4.16:1로 모자란다.
              bg-raised(흰 72%)를 깔면 최악점에서 5.08:1이 된다 — globals.css가 허용 면으로
              적어 둔 넷(.glass / .glass-nav / bg-panel / bg-raised) 중 하나다. */}
          <div className="mb-2 flex items-baseline gap-2">
            <h2 className="text-[13px] font-semibold">내 비즈니스 (A,B,C)</h2>
            <span className="text-[11px] text-ink-dim tnum">
              {shown.length} / {ordered.length}개 표시 중
            </span>
            {error ? (
              <span
                role="alert"
                className="rounded-md border border-critical/40 bg-raised px-2 py-0.5 text-[11px] text-critical"
              >
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

            {/* CH-002. 카드 줄 끝에 붙어 있어야 '한 장 더 추가'로 읽힌다.
                이 버튼은 카드 줄 끝의 빈 자리라 뒤가 맨 그라데이션이다 — ink-muted는 3.35:1이라
                ink-dim(5.73:1)으로 올린다. */}
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="flex w-[64px] shrink-0 flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-line text-ink-dim transition-colors hover:border-accent hover:text-ink"
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
        </div>
      </div>


      {/* 재배치(P5-2 Step 3): 회사 카드 줄 → KpiStrip. FinanceTrend는 위 히어로로 옮겼다. */}
      <KpiStrip kpis={financeKpis} businessIds={shown.map((b) => b.business_id)} />

      {adding ? <AddBusinessModal onClose={() => setAdding(false)} onCreate={create} /> : null}
    </div>
  )
}

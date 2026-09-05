'use client'

import { useMemo, useState, useSyncExternalStore } from 'react'

import { AddBusinessModal } from '@/components/dashboard/add-business-modal'
import { BusinessCard, type BusinessMetrics } from '@/components/dashboard/business-card'
import { FinanceTrend } from '@/components/dashboard/finance-trend'
import { KpiStrip } from '@/components/dashboard/kpi-strip'
import { Icon } from '@/components/ui/icon'
import { businessProgress, hasFinanceData, latestPeriodOf, valueOf } from '@/lib/finance'
import type { Business, FinanceKpi, Project } from '@/types'
import {
  getServerSnapshot,
  getSnapshot,
  parseHidden,
  setHidden,
  subscribe,
} from '@/lib/hidden-businesses'
import {
  addBusiness,
  getServerSnapshot as addedServerSnapshot,
  getSnapshot as addedSnapshot,
  parseAdded,
  subscribe as subscribeAdded,
} from '@/lib/added-businesses'
import {
  getServerSnapshot as pinnedServerSnapshot,
  getSnapshot as pinnedSnapshot,
  parsePinned,
  setPinned,
  subscribe as subscribePinned,
} from '@/lib/pinned-businesses'

/**
 * Business 카드(CH-001~005)와 그룹 KPI(CH-006~010)를 한 상태 위에 올린다.
 * 카드를 숨기면 KPI 합계에서도 빠져야 하므로 표시 목록을 여기서 한 번만 들고 있는다.
 * 핀(CH-004)은 순서만 바꾼다 — 합계는 '표시 중'만 보므로 핀에 영향받지 않는다.
 *
 * 원천 데이터는 서버 컴포넌트가 repository에서 읽어 props로 내려준다.
 * 이 파일이 시드를 직접 import 하면 live 모드에서도 시드가 그려진다.
 */

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

interface DashboardBoardProps {
  businesses: Business[]
  financeKpis: FinanceKpi[]
  projects: Project[]
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

export function DashboardBoard({ businesses, financeKpis, projects }: DashboardBoardProps) {
  const raw = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
  const hidden = useMemo(() => parseHidden(raw), [raw])

  const pinnedRaw = useSyncExternalStore(subscribePinned, pinnedSnapshot, pinnedServerSnapshot)
  const pinned = useMemo(() => parsePinned(pinnedRaw, businesses), [pinnedRaw, businesses])

  const addedRaw = useSyncExternalStore(subscribeAdded, addedSnapshot, addedServerSnapshot)
  const added = useMemo(() => parseAdded(addedRaw), [addedRaw])

  const [adding, setAdding] = useState(false)

  const letters = useMemo(() => letterMap([...businesses, ...added]), [businesses, added])

  /** 핀 우선, 그다음 sort_order. 드래그 순서(CH-005)는 아직 sort_order를 그대로 쓴다. */
  const ordered = useMemo(
    () =>
      [...businesses.filter((b) => b.visible), ...added.filter((b) => b.visible)].sort(
        (a, b) =>
          Number(pinned.includes(b.business_id)) - Number(pinned.includes(a.business_id)) ||
          a.sort_order - b.sort_order,
      ),
    [businesses, pinned, added],
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
        },
      ]),
    )
  }, [ordered, financeKpis, projects])

  function toggle(businessId: string) {
    setHidden(
      hidden.includes(businessId)
        ? hidden.filter((id) => id !== businessId)
        : [...hidden, businessId],
    )
  }

  function togglePin(businessId: string) {
    setPinned(
      pinned.includes(businessId)
        ? pinned.filter((id) => id !== businessId)
        : [...pinned, businessId],
    )
  }

  const shown = ordered.filter((b) => !hidden.includes(b.business_id))
  const hiddenList = ordered.filter((b) => hidden.includes(b.business_id))

  const empty: BusinessMetrics = { revenue: 0, ebitda: 0, progress: 0, hasFinance: false }

  return (
    <div className="space-y-5">
      <section aria-label="내 비즈니스">
        <div className="mb-2 flex items-baseline gap-2">
          <h2 className="text-[13px] font-semibold">내 비즈니스 (A,B,C)</h2>
          <span className="text-[11px] text-ink-muted tnum">
            {shown.length} / {ordered.length}개 표시 중
          </span>
        </div>

        {/* 카드는 남는 폭을 균등하게 나눠 갖고, 추가 버튼만 좁게 끝에 붙인다.
            grid로 잡으면 추가 버튼이 카드 한 장 폭을 통째로 먹어 회사명이 잘린다. */}
        <div className="flex flex-wrap items-stretch gap-2.5">
          {shown.map((b) => (
            <div key={b.business_id} className="min-w-[212px] flex-1">
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
            className="flex w-[92px] shrink-0 flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-line text-ink-muted transition-colors hover:border-accent hover:text-ink"
          >
            <Icon name="plus" className="size-5" />
            <span className="text-[12px]">기업 추가</span>
          </button>
        </div>

        {hiddenList.length > 0 ? (
          <div className="mt-2.5 flex flex-wrap items-center gap-2 rounded-lg border border-line-soft bg-panel/60 px-3 py-2">
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

      <KpiStrip kpis={financeKpis} businessIds={shown.map((b) => b.business_id)} />

      <FinanceTrend kpis={financeKpis} businessIds={shown.map((b) => b.business_id)} />

      {adding ? (
        <AddBusinessModal onClose={() => setAdding(false)} onCreate={addBusiness} />
      ) : null}
    </div>
  )
}

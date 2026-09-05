'use client'

import { useMemo, useSyncExternalStore } from 'react'

import { BusinessCard } from '@/components/dashboard/business-card'
import { KpiStrip } from '@/components/dashboard/kpi-strip'
import { Icon } from '@/components/ui/icon'
import { businesses, visibleBusinesses } from '@/data'
import {
  getServerSnapshot,
  getSnapshot,
  parseHidden,
  setHidden,
  subscribe,
} from '@/lib/hidden-businesses'
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
 */

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

/**
 * 이니셜은 회사에 붙는 이름표다. sort_order 기준으로 한 번 정해 두고 고정한다.
 * 화면 순서로 매기면 핀을 누를 때마다 A와 B가 자리를 바꿔 카드를 다시 읽어야 한다.
 */
const LETTER_BY_ID = new Map(
  [...businesses]
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((b, i) => [b.business_id, LETTERS[i] ?? '?'] as const),
)

export function DashboardBoard() {
  const raw = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
  const hidden = useMemo(() => parseHidden(raw), [raw])

  const pinnedRaw = useSyncExternalStore(subscribePinned, pinnedSnapshot, pinnedServerSnapshot)
  const pinned = useMemo(() => parsePinned(pinnedRaw), [pinnedRaw])

  /** 핀 우선, 그다음 sort_order. 드래그 순서(CH-005)는 아직 sort_order를 그대로 쓴다. */
  const ordered = useMemo(
    () =>
      [...visibleBusinesses()].sort(
        (a, b) =>
          Number(pinned.includes(b.business_id)) - Number(pinned.includes(a.business_id)) ||
          a.sort_order - b.sort_order,
      ),
    [pinned],
  )

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
                letter={LETTER_BY_ID.get(b.business_id) ?? '?'}
                pinned={pinned.includes(b.business_id)}
                onToggleVisible={toggle}
                onTogglePinned={togglePin}
              />
            </div>
          ))}

          {/* CH-002 자리. 카드 줄 끝에 붙어 있어야 '한 장 더 추가'로 읽힌다. */}
          <button
            type="button"
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

      <KpiStrip businessIds={shown.map((b) => b.business_id)} />
    </div>
  )
}

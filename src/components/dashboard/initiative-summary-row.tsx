import Link from 'next/link'

import { InitiativeCards } from '@/components/initiatives/initiative-cards'
import type { Business, Initiative, IsoDate } from '@/types'

/**
 * HOME 3줄 — 진행 중인 이니셔티브 요약 (Phase 8 G-2b에서 도시 띠 아래로 옮겼다. 전에는 DashboardBoard 안 2줄).
 *
 * 목록 화면(/initiatives)의 전체 그리드를 복제하지 않는다. 0건이면 섹션째로 숨긴다(InitiativeStat과 같은
 * 판단: 빈 카드 줄은 인사말 아래 이미 있는 요약과 겹쳐 의미 없이 자리만 차지한다).
 * 이 헤더 줄은 카드 밖(맨 배경) 위다 — text-ink-dim만 쓴다(item D, globals.css '유리 없이 글자를 놓지 마라').
 */
export function InitiativeSummaryRow({
  initiatives,
  count,
  businesses,
  logoUrls,
  today,
}: {
  /** page.tsx가 이미 '진행 중 상위 6건'으로 고른 요약이다 — 여기서 다시 거르지 않는다. */
  initiatives: Initiative[]
  /** 요약이 아닌 전체 '진행 중' 건수. */
  count: number
  businesses: Business[]
  logoUrls: Record<string, string>
  today: IsoDate
}) {
  if (initiatives.length === 0) return null
  return (
    <section aria-label="이니셔티브">
      <div className="mb-2 flex items-baseline gap-2">
        <h2 className="text-t13 font-semibold">이니셔티브</h2>
        <span className="text-t11 text-ink-dim tnum">
          진행 중 {count}건 중 {initiatives.length}건
        </span>
        {/* 골드(.text-accent)는 맨 배경에서 3.39:1이라 유리 없이는 못 쓴다 — ink-dim + 밑줄 hover. */}
        <Link
          href="/initiatives"
          className="ml-auto text-t11h text-ink-dim underline-offset-2 hover:text-ink hover:underline"
        >
          전체 보기
        </Link>
      </div>
      <InitiativeCards initiatives={initiatives} businesses={businesses} logoUrls={logoUrls} today={today} hasAny />
    </section>
  )
}

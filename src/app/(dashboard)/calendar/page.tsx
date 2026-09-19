import Link from 'next/link'

import { MonthGridClient } from '@/components/calendar/month-grid-client'
import { TwoWeekList } from '@/components/calendar/two-week-list'
import { PageHeader } from '@/components/layout/page-header'
import { currentUser } from '@/lib/auth/session'
import { kstToday } from '@/lib/chairman-project'
import { monthGrid, parseMonth, shiftMonth, twoWeekRange } from '@/lib/calendar'
import { firstParam } from '@/lib/query'
import { getRepository } from '@/lib/repository'

/**
 * `/calendar` — 이벤트·다음 행동·회사 마일스톤·결재 마감을 한 판에 모은 달력 (Task 8).
 *
 * 네 원천을 0017 calendar_items 뷰 하나로 받는다(repo.listCalendarItems). 화면은 그 결과를
 * 다시 나누지 않고 kind로만 모양을 가른다 — event=●, next_action=○, milestone=◆, decision=!.
 * 색은 지난 next_action·decision에만 오른다(month-grid.tsx).
 *
 * 질의는 한 번이다. 월 격자 범위와 2주 목록 범위(늘 오늘부터 14일, 보고 있는 달과 무관)의
 * 합집합을 한 구간으로 잡아 listCalendarItems를 한 번만 부른다 — 두 번 부르면 같은 항목이
 * 두 모양으로 들어오거나, 두 질의가 서로 다른 순간을 봐서 달력과 옆 목록이 다른 말을 한다.
 *
 * 앞뒤 달 이동은 <Link>다. 버튼+router.push를 쓰면 뒤로 가기가 달을 되돌리지 못한다 —
 * FilterChips가 <Link>인 것과 같은 이유다.
 *
 * 주소창의 month 값은 믿지 않는다 — parseMonth가 'YYYY-MM' 형식이 아니면 걸러 오늘 달로 되돌린다.
 *
 * 날짜 칸을 누르면 그 날의 팝업이 뜬다(다듬기 2번). 칸이 <button>이라 격자 자체는
 * 클라이언트 컴포넌트다 — 질의와 범위 계산은 그대로 서버에 남는다.
 */
export default async function CalendarPage(props: PageProps<'/calendar'>) {
  const params = await props.searchParams
  const month = parseMonth(firstParam(params.month)) ?? kstToday().slice(0, 7)

  const grid = monthGrid(month)
  const today = kstToday()
  const twoWeek = twoWeekRange(today)

  // 두 범위의 합집합 한 구간 — 문자열 비교로 충분하다(ISO 날짜는 사전순이 곧 시간순이다).
  const from = grid[0][0] < twoWeek.from ? grid[0][0] : twoWeek.from
  const to = grid[5][6] > twoWeek.to ? grid[5][6] : twoWeek.to

  const repo = await getRepository()
  // 이벤트 원본을 같이 읽는다. calendar_items 뷰에는 kind(Trip/Meeting/…)도 location도 없어
  // 모달에서 고칠 수가 없다. 전건이라 한 번 더 읽어도 수십 행이다.
  const [items, events, user] = await Promise.all([
    repo.listCalendarItems(from, to),
    repo.listEvents(),
    currentUser(),
  ])
  const canEdit = user?.role === 'Chairman' || user?.role === 'GroupCFO'

  const [y, m] = month.split('-')

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-5">
      <PageHeader
        icon="calendar"
        title="캘린더"
        code="Phase 4-A"
        description="이벤트·다음 행동·회사 마일스톤·결재 마감을 한 판에 모읍니다."
      >
        <Link
          href={`/calendar?month=${shiftMonth(month, -1)}`}
          className="rounded-md border border-line bg-panel px-2.5 py-1.5 text-[11.5px] text-ink-dim transition-colors hover:border-accent hover:text-ink"
        >
          지난달
        </Link>
        <Link
          href="/calendar"
          className="rounded-md border border-line bg-panel px-2.5 py-1.5 text-[11.5px] text-ink-dim transition-colors hover:border-accent hover:text-ink"
        >
          이번달
        </Link>
        <Link
          href={`/calendar?month=${shiftMonth(month, 1)}`}
          className="rounded-md border border-line bg-panel px-2.5 py-1.5 text-[11.5px] text-ink-dim transition-colors hover:border-accent hover:text-ink"
        >
          다음달
        </Link>
      </PageHeader>

      <p className="mt-1 text-[12px] text-ink-muted tnum">
        {y}년 {Number(m)}월
      </p>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <MonthGridClient
          grid={grid}
          items={items}
          events={events}
          month={month}
          today={today}
          canEdit={canEdit}
        />

        <aside className="rounded-xl border border-line-soft bg-panel p-4 xl:sticky xl:top-4 xl:self-start">
          <TwoWeekList items={items} range={twoWeek} />
        </aside>
      </div>
    </div>
  )
}

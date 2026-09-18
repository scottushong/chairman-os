import Link from 'next/link'

import { initiativeClock, stalenessDays } from '@/lib/initiative'
import { CALENDAR_ITEM_LABEL_KO, type CalendarItem, type Initiative, type IsoDate } from '@/types'

/**
 * /ai 아침 루틴의 "오늘·이번 주" 블록 (Task 9). 선언문과 야간 브리핑 사이에 선다 —
 * 장기 프로젝트 카운터 → 선언문 → 여기 → 야간 브리핑이 아침에 읽는 순서다.
 *
 * 세 묶음(오늘 일정 / 7일 내 다음 행동 / 14일 이상 멈춘 건) 모두 비면 블록 자체가 없다.
 * 역할을 여기서 보지 않는다 — Chairman이 아닌 역할에게는 RLS가 셋 다 빈 배열을 주므로
 * 이 경로로 조용히 사라진다.
 *
 * 색은 지난 다음 행동(overdue D-day)에만 오른다. "멈춰 있는 건"은 제목·부가 문구만
 * 흐리게 하고, D-day 배지·정체 일수 자체는 100% 밝기로 둔다 — 조상에 opacity를 걸면
 * 가장 급한 항목의 빨강이 죽는다(Task 6·8에서 두 번 반복된 실수, 이번엔 세 번째가 아니다).
 */
export function TodayAndWeek({
  todayItems,
  upcoming,
  stale,
  today,
}: {
  /** 오늘에 걸치는 항목(occursOn으로 이미 걸러져 들어온다) */
  todayItems: CalendarItem[]
  /** 7일 내(지난 것 포함) 다음 행동이 있는 Active 건 */
  upcoming: Initiative[]
  /** 14일 이상 손 안 댄 Active 건 */
  stale: Initiative[]
  today: IsoDate
}) {
  if (todayItems.length === 0 && upcoming.length === 0 && stale.length === 0) return null

  const orderedUpcoming = [...upcoming].sort((a, b) =>
    (a.next_action_date ?? '').localeCompare(b.next_action_date ?? ''),
  )

  return (
    <section
      aria-label="오늘·이번 주"
      className="mt-8 grid gap-4 border-b border-line-soft pb-10 [grid-template-columns:repeat(auto-fit,minmax(220px,1fr))]"
    >
      {todayItems.length > 0 ? (
        <div>
          <h2 className="text-[13px] font-semibold">오늘</h2>
          <ul className="mt-2 space-y-1.5">
            {todayItems.map((it) => (
              <li key={`${it.kind}-${it.source_id}`}>
                <Link
                  href={it.href}
                  className="block truncate text-[12.5px] text-ink-dim hover:text-ink hover:underline"
                >
                  <span className="text-ink-muted">{CALENDAR_ITEM_LABEL_KO[it.kind]}</span> · {it.title}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {orderedUpcoming.length > 0 ? (
        <div>
          <h2 className="text-[13px] font-semibold">이번 주 행동</h2>
          <ul className="mt-2 space-y-1.5">
            {orderedUpcoming.map((i) => {
              const clock = initiativeClock(i, today)
              return (
                <li key={i.initiative_id}>
                  <Link
                    href={`/initiatives/${i.initiative_id}`}
                    className="flex items-baseline gap-2 text-[12.5px] hover:underline"
                  >
                    <span className="min-w-0 flex-1 truncate text-ink-dim">{i.title}</span>
                    {clock ? (
                      <span
                        className={`shrink-0 font-semibold tnum ${clock.overdue ? 'text-critical' : 'text-ink'}`}
                      >
                        {clock.label}
                      </span>
                    ) : null}
                  </Link>
                </li>
              )
            })}
          </ul>
        </div>
      ) : null}

      {stale.length > 0 ? (
        <div>
          <h2 className="text-[13px] font-semibold">멈춰 있는 건</h2>
          <ul className="mt-2 space-y-1.5">
            {stale.map((i) => {
              const clock = initiativeClock(i, today)
              return (
                <li key={i.initiative_id}>
                  <Link
                    href={`/initiatives/${i.initiative_id}`}
                    className="flex items-baseline gap-2 text-[12.5px] hover:underline"
                  >
                    {/* 흐리게는 제목·부가 문구에만. D-day 배지·정체 일수는 조상에서 opacity를 물려받지 않는다. */}
                    <span className="min-w-0 flex-1 truncate text-ink-dim opacity-55">{i.title}</span>
                    <span className="shrink-0 text-ink-muted tnum">{stalenessDays(i, today)}일째</span>
                    {clock ? (
                      <span
                        className={`shrink-0 font-semibold tnum ${clock.overdue ? 'text-critical' : 'text-ink'}`}
                      >
                        {clock.label}
                      </span>
                    ) : null}
                  </Link>
                </li>
              )
            })}
          </ul>
        </div>
      ) : null}
    </section>
  )
}

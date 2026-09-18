import Link from 'next/link'

import { CALENDAR_ITEM_LABEL_KO, type CalendarItem, type CalendarItemKind, type IsoDate } from '@/types'

const WEEKDAY_KO = ['월', '화', '수', '목', '금', '토', '일']

/** 종류는 색이 아니라 모양으로 가른다 — 넷을 다 칠하면 무엇이 급한지 안 보인다. */
const KIND_MARK: Record<CalendarItemKind, string> = {
  event: '●',
  next_action: '○',
  milestone: '◆',
  decision: '!',
}

/** 한 칸에 3건까지만 그리고 나머지는 "+N"으로 접는다 — 안 그러면 6주 격자가 무너진다. */
const MAX_PER_CELL = 3

export function MonthGrid({
  grid,
  items,
  month,
  today,
}: {
  grid: IsoDate[][]
  items: CalendarItem[]
  /** 'YYYY-MM'. 격자 밖(앞뒤 달) 칸을 흐리게 그리는 기준이다. */
  month: string
  today: IsoDate
}) {
  return (
    <div className="rounded-xl border border-line-soft bg-panel p-3">
      <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-semibold text-ink-muted">
        {WEEKDAY_KO.map((w) => (
          <div key={w} className="py-1">
            {w}
          </div>
        ))}
      </div>

      <div className="mt-1 grid grid-cols-7 gap-1">
        {grid.flat().map((day) => {
          const dayItems = items.filter((it) => occursOn(it, day))
          const shown = dayItems.slice(0, MAX_PER_CELL)
          const overflow = dayItems.length - shown.length
          const inMonth = day.slice(0, 7) === month
          const isToday = day === today

          return (
            <div
              key={day}
              className={[
                'min-h-[92px] rounded-md border p-1.5 text-left',
                isToday ? 'border-2 border-ink' : 'border-line-soft',
                inMonth ? '' : 'opacity-40',
              ].join(' ')}
            >
              <div className={['text-[11px] tnum', isToday ? 'font-bold text-ink' : 'text-ink-dim'].join(' ')}>
                {Number(day.slice(8, 10))}
              </div>

              <div className="mt-1 space-y-0.5">
                {shown.map((it) => (
                  <Link
                    key={`${it.kind}-${it.source_id}-${day}`}
                    href={it.href}
                    title={CALENDAR_ITEM_LABEL_KO[it.kind]}
                    className={[
                      'flex items-center gap-1 truncate text-[10.5px] leading-tight hover:underline',
                      isPastRisk(it, today) ? 'text-critical' : 'text-ink-dim',
                    ].join(' ')}
                  >
                    <span aria-hidden className="shrink-0">
                      {KIND_MARK[it.kind]}
                    </span>
                    <span className="truncate">{it.title}</span>
                  </Link>
                ))}
                {overflow > 0 ? <div className="text-[10px] text-ink-muted">+{overflow}</div> : null}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/**
 * listCalendarItems(from, to)는 구간에 걸치는 항목을 준다 — 여러 날짜 이벤트는 시작일 하루가
 * 아니라 걸치는 모든 날짜 칸에 나타나야 한다. on_date === day로만 비교하면 9/25~10/02 출장이
 * 10/25 하루짜리로 찍히고 나머지 7일이 빈 것처럼 보인다. 문자열 비교로 충분하다
 * (ISO 날짜는 사전순이 곧 시간순이다) — Date 객체를 만들지 않는다.
 */
function occursOn(item: CalendarItem, day: IsoDate): boolean {
  return item.on_date <= day && day <= (item.ends_on ?? item.on_date)
}

/** 색이 오르는 유일한 경우: 지난(오늘보다 이전) next_action·decision. 지나간 이벤트는 위험이 아니다. */
function isPastRisk(item: CalendarItem, today: IsoDate): boolean {
  return (item.kind === 'next_action' || item.kind === 'decision') && item.on_date < today
}

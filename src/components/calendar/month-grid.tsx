import Link from 'next/link'

import { occursOn } from '@/lib/calendar'
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
            // opacity는 이 컨테이너가 아니라 안쪽의 무채색 요소(날짜 숫자·비위험 항목·+N)에만
            // 건다. 컨테이너에 걸면 그 안의 text-critical(지난달 말미에 놓인 연체 항목일수록
            // 흔하다)까지 40%로 죽어, 가장 위험한 칸에서 위험 신호가 가장 약해지는
            // 역효과가 난다(initiative-table.tsx의 stale 처리와 같은 이유).
            <div
              key={day}
              className={[
                'min-h-[92px] rounded-md border p-1.5 text-left',
                isToday ? 'border-2 border-ink' : 'border-line-soft',
              ].join(' ')}
            >
              <div
                className={[
                  'text-[11px] tnum',
                  isToday ? 'font-bold text-ink' : 'text-ink-dim',
                  inMonth ? '' : 'opacity-40',
                ].join(' ')}
              >
                {Number(day.slice(8, 10))}
              </div>

              <div className="mt-1 space-y-0.5">
                {shown.map((it) => {
                  const risk = isPastRisk(it, today)
                  return (
                    <Link
                      key={`${it.kind}-${it.source_id}-${day}`}
                      href={it.href}
                      title={CALENDAR_ITEM_LABEL_KO[it.kind]}
                      className={[
                        'flex items-center gap-1 truncate text-[10.5px] leading-tight hover:underline',
                        risk ? 'text-critical' : 'text-ink-dim',
                        // 위험 항목은 월 밖이어도 흐리게 하지 않는다 — 연체는 조용히 넘어가면 안 된다.
                        !risk && !inMonth ? 'opacity-40' : '',
                      ].join(' ')}
                    >
                      <span aria-hidden className="shrink-0">
                        {KIND_MARK[it.kind]}
                      </span>
                      <span className="truncate">{it.title}</span>
                    </Link>
                  )
                })}
                {overflow > 0 ? (
                  <div className={['text-[10px] text-ink-muted', inMonth ? '' : 'opacity-40'].join(' ')}>
                    +{overflow}
                  </div>
                ) : null}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** 색이 오르는 유일한 경우: 지난(오늘보다 이전) next_action·decision. 지나간 이벤트는 위험이 아니다. */
function isPastRisk(item: CalendarItem, today: IsoDate): boolean {
  return (item.kind === 'next_action' || item.kind === 'decision') && item.on_date < today
}

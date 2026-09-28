'use client'

import { useState } from 'react'

import { DayModal, type PersonOption } from '@/components/calendar/day-modal'
import { KIND_MARK, isPastRisk } from '@/components/calendar/month-grid'
import { occursOn } from '@/lib/calendar'
import { CALENDAR_ITEM_LABEL_KO, type CalendarItem, type ChairmanEvent, type IsoDate } from '@/types'

const WEEKDAY_KO = ['월', '화', '수', '목', '금', '토', '일']
const MAX_PER_CELL = 3

/**
 * 달력 격자의 클라이언트판 (Phase 4-A 다듬기 2번).
 *
 * 서버판 month-grid.tsx와 그리는 규칙이 같다 — KIND_MARK와 isPastRisk를 그 파일에서 가져온다.
 * 복사하면 두 격자가 서로 다른 날을 빨갛게 칠하는 날이 온다.
 *
 * 달라진 것은 하나다: 칸이 <div>가 아니라 <button>이고, 누르면 DayModal이 뜬다.
 * 칸 안의 항목은 이제 <Link>가 아니다 — 링크를 남기면 항목을 누를 때는 페이지가 넘어가고
 * 여백을 누를 때만 모달이 떠서, 같은 칸이 두 가지로 동작한다. 항목 링크는 모달 안에 있다.
 */
export function MonthGridClient({
  grid,
  items,
  events,
  month,
  today,
  canEdit,
  people = [],
}: {
  grid: IsoDate[][]
  items: CalendarItem[]
  events: ChairmanEvent[]
  month: string
  today: IsoDate
  canEdit: boolean
  /** 0040. 미팅 참석자 후보. */
  people?: PersonOption[]
}) {
  const [open, setOpen] = useState<IsoDate | null>(null)

  const dayItems = (day: IsoDate) => items.filter((it) => occursOn(it, day))
  // events는 calendar_items 뷰가 아니라 원본 테이블이라 같은 구간을 starts_on/ends_on으로
  // 부른다. occursOn의 시그니처(on_date·ends_on)에 맞춰 두 필드짜리 어댑터로 감싼다 —
  // 여기서 판정을 새로 짜면 격자와 모달이 하루 수를 서로 다르게 셀 수 있다.
  const dayEvents = (day: IsoDate) =>
    events.filter((e) => occursOn({ on_date: e.starts_on, ends_on: e.ends_on }, day))

  /*
   * 폰(640px 미만): 칸 하나가 44px 터치 과녁이라 7칸 + 간격 + 여백이 360px 화면을 넘쳤다(371px).
   * 그래서 폰에서만 여백 p-1 · 간격 1px로 줄여 칸 폭 ≈45px를 만들고, 칸 안에는 제목 대신 종류 표식만 둔다
   * (45px에 제목은 두 글자도 안 들어간다). 누르면 뜨는 DayModal과 아래 «앞으로 2주»가 제목을 보여 준다.
   */
  return (
    <div className="rounded-xl border border-line-soft bg-panel p-3 max-sm:p-1">
      <div className="grid grid-cols-7 gap-1 text-center max-sm:gap-px text-t10 font-semibold text-ink-muted">
        {WEEKDAY_KO.map((w) => (
          <div key={w} className="py-1">
            {w}
          </div>
        ))}
      </div>

      <div className="mt-1 grid grid-cols-7 gap-1 max-sm:gap-px">
        {grid.flat().map((day) => {
          const all = dayItems(day)
          const shown = all.slice(0, MAX_PER_CELL)
          const overflow = all.length - shown.length
          const inMonth = day.slice(0, 7) === month
          const isToday = day === today

          return (
            <button
              key={day}
              type="button"
              onClick={() => setOpen(day)}
              aria-label={`${Number(day.slice(5, 7))}월 ${Number(day.slice(8, 10))}일, ${all.length}건`}
              className={[
                'min-h-[92px] rounded-md border p-1.5 text-left transition-colors hover:border-accent max-sm:min-h-16 max-sm:min-w-0 max-sm:p-1',
                isToday ? 'border-2 border-ink' : 'border-line-soft',
              ].join(' ')}
            >
              {/* opacity는 이 컨테이너가 아니라 안쪽 무채색 요소에만 건다 — 컨테이너에 걸면
                  그 안의 text-critical까지 40%로 죽어 가장 위험한 칸에서 신호가 가장 약해진다. */}
              <div
                className={[
                  'text-t11 tnum',
                  isToday ? 'font-bold text-ink' : 'text-ink-dim',
                  inMonth ? '' : 'opacity-40',
                ].join(' ')}
              >
                {Number(day.slice(8, 10))}
              </div>

              <div className="mt-1 space-y-0.5 max-sm:flex max-sm:flex-wrap max-sm:gap-0.5 max-sm:space-y-0">
                {shown.map((it) => {
                  const risk = isPastRisk(it, today)
                  return (
                    <span
                      key={`${it.kind}-${it.source_id}-${day}`}
                      title={CALENDAR_ITEM_LABEL_KO[it.kind]}
                      className={[
                        'flex items-center gap-1 truncate text-t10h leading-tight',
                        risk ? 'text-critical' : 'text-ink-dim',
                        !risk && !inMonth ? 'opacity-40' : '',
                      ].join(' ')}
                    >
                      <span aria-hidden className="shrink-0">
                        {KIND_MARK[it.kind]}
                      </span>
                      <span className="truncate max-sm:hidden">{it.title}</span>
                    </span>
                  )
                })}
                {overflow > 0 ? (
                  <div className={['text-t10 text-ink-muted', inMonth ? '' : 'opacity-40'].join(' ')}>
                    +{overflow}
                  </div>
                ) : null}
              </div>
            </button>
          )
        })}
      </div>

      {open ? (
        <DayModal
          day={open}
          items={dayItems(open)}
          events={dayEvents(open)}
          canEdit={canEdit}
          people={people}
          onClose={() => setOpen(null)}
        />
      ) : null}
    </div>
  )
}

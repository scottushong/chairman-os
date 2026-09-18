import Link from 'next/link'

import { occursOn } from '@/lib/calendar'
import { CALENDAR_ITEM_LABEL_KO, type CalendarItem, type IsoDate } from '@/types'

const WEEKDAY_SHORT_KO = ['일', '월', '화', '수', '목', '금', '토']

/**
 * 달력 옆 <aside>의 2주 목록. 보고 있는 달과 무관하게 늘 오늘부터 14일이다 —
 * 지난달을 보고 있어도 이 목록은 앞으로의 2주를 말한다. 그게 이 목록의 쓸모다.
 */
export function TwoWeekList({ items, range }: { items: CalendarItem[]; range: { from: IsoDate; to: IsoDate } }) {
  const rows = eachDay(range.from, range.to)
    .map((day) => ({ day, items: items.filter((it) => occursOn(it, day)) }))
    .filter((row) => row.items.length > 0)

  return (
    <div>
      <h2 className="text-[13px] font-semibold">앞으로 2주</h2>
      <p className="mt-1 text-[11px] text-ink-muted">보고 있는 달과 무관하게 오늘부터 14일입니다.</p>

      {rows.length === 0 ? (
        <p className="mt-3 text-[11.5px] text-ink-muted">2주 안에 예정된 항목이 없습니다.</p>
      ) : (
        <div className="mt-3 space-y-3">
          {rows.map(({ day, items: dayItems }) => (
            <div key={day}>
              <h3 className="text-[11px] font-semibold text-ink-dim">{formatDay(day)}</h3>
              <ul className="mt-1 space-y-1">
                {dayItems.map((it) => (
                  <li key={`${it.kind}-${it.source_id}-${day}`}>
                    <Link
                      href={it.href}
                      className="block truncate text-[11.5px] text-ink-dim hover:text-ink hover:underline"
                    >
                      <span className="text-ink-muted">{CALENDAR_ITEM_LABEL_KO[it.kind]}</span> · {it.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/** from~to(포함) 사이의 날짜를 하루씩 나열한다. 소제목을 뽑을 날짜 목록일 뿐, 겹침 판정과는 무관하다. */
function eachDay(from: IsoDate, to: IsoDate): IsoDate[] {
  const days: IsoDate[] = []
  let cur = from
  while (cur <= to) {
    days.push(cur)
    cur = new Date(Date.parse(`${cur}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10) as IsoDate
  }
  return days
}

function formatDay(day: IsoDate): string {
  const d = new Date(`${day}T00:00:00Z`)
  return `${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일 (${WEEKDAY_SHORT_KO[d.getUTCDay()]})`
}

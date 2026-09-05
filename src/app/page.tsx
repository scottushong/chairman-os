import { Icon } from '@/components/ui/icon'
import { visibleBusinesses } from '@/data'

/**
 * 메인 대시보드. 지금은 셸 확인용 빈 화면이고,
 * 아래 자리표시자 순서대로 CH-001~019 카드가 들어온다.
 */

const TABS = ['전체 요약', '중요 지표', '예산 vs 실적', '리스크', 'AI 요약'] as const

/** 다음 단계에 채울 영역. 무엇이 어디에 들어가는지 화면에서 바로 보이게 둔다. */
const SLOTS: { id: string; title: string; note: string; span: string; height: string }[] = [
  {
    id: 'CH-001~005',
    title: '내 비즈니스 (A,B,C)',
    note: '5개사 카드 · 매출/EBITDA/진행률 · 숨김·Pin·순서변경',
    span: 'col-span-12',
    height: 'h-[188px]',
  },
  {
    id: 'CH-006~010',
    title: 'KPI 스트립 (8개 + 스파크라인)',
    note: '매출 · 비용 · EBITDA · 영업이익 · 순이익 · Cash · AR · AP',
    span: 'col-span-12',
    height: 'h-[104px]',
  },
  {
    id: 'CH-011~014',
    title: 'Strategic Coordinates',
    note: 'Top Goal · Monthly Priority · Critical Risk · Next Milestone',
    span: 'col-span-12',
    height: 'h-[128px]',
  },
  {
    id: 'CH-015~017',
    title: '내 결정 사항 / Waiting on Me',
    note: '오늘 결정할 3~5건 · 승인/거절/수정/위임',
    span: 'col-span-12 lg:col-span-4',
    height: 'h-[232px]',
  },
  {
    id: 'CH-018',
    title: '알림 / 리스크',
    note: 'Cash · AR · 생산 · 품질 · 계약 · HR Red Alert',
    span: 'col-span-12 lg:col-span-4',
    height: 'h-[232px]',
  },
  {
    id: 'CH-019',
    title: 'AI Did Last Night',
    note: '야간 AI 완료 작업 · 결과물 링크 · Task 전환',
    span: 'col-span-12 lg:col-span-4',
    height: 'h-[232px]',
  },
]

export default function DashboardPage() {
  const businesses = visibleBusinesses()
  const today = new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  }).format(new Date())

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-[22px] font-bold tracking-tight">
            안녕하세요, Chairman님
            <Icon name="crown" className="size-5 text-gold" filled />
          </h1>
          <p className="mt-1 text-[12px] text-ink-muted">
            표시 중인 회사 {businesses.length}개 · 오늘도 성공적인 하루 되세요.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[12px] text-ink-dim tnum">{today}</span>
          <button
            type="button"
            className="flex items-center gap-1.5 rounded-md border border-line bg-panel px-3 py-1.5 text-[12px] text-ink-dim transition-colors hover:text-ink"
          >
            월간
            <Icon name="chevron-down" className="size-3.5" />
          </button>
        </div>
      </div>

      <div className="mt-4 flex gap-1 border-b border-line-soft">
        {TABS.map((tab, i) => (
          <button
            key={tab}
            type="button"
            className={[
              'rounded-t-md px-4 py-2 text-[13px] transition-colors',
              i === 0
                ? 'bg-panel font-semibold text-ink'
                : 'text-ink-muted hover:bg-panel/60 hover:text-ink-dim',
            ].join(' ')}
          >
            {tab}
          </button>
        ))}
      </div>

      <div className="mt-4 grid grid-cols-12 gap-3.5 pb-6">
        {SLOTS.map((slot) => (
          <section
            key={slot.id}
            className={`${slot.span} ${slot.height} flex flex-col justify-center rounded-xl border border-dashed border-raised bg-panel/50 px-5`}
          >
            <div className="flex items-baseline gap-2">
              <span className="rounded bg-raised px-1.5 py-0.5 text-[10px] font-semibold text-ink-muted tnum">
                {slot.id}
              </span>
              <h2 className="text-[13px] font-semibold text-ink-dim">{slot.title}</h2>
            </div>
            <p className="mt-1.5 text-[12px] text-ink-muted">{slot.note}</p>
          </section>
        ))}
      </div>
    </div>
  )
}

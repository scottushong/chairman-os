import { AiNightPanel } from '@/components/dashboard/ai-night-panel'
import { DashboardBoard } from '@/components/dashboard/dashboard-board'
import { DecisionPanel } from '@/components/dashboard/decision-panel'
import { StrategicCoordinates } from '@/components/dashboard/strategic-coordinates'
import { Icon } from '@/components/ui/icon'

/**
 * 메인 대시보드.
 * CH-001~016과 CH-019는 붙었고, 아래 자리표시자 순서대로 CH-017~018이 들어온다.
 */

const TABS = ['전체 요약', '중요 지표', '예산 vs 실적', '리스크', 'AI 요약'] as const

/** 다음 단계에 채울 영역. 무엇이 어디에 들어가는지 화면에서 바로 보이게 둔다. */
const SLOTS: { id: string; title: string; note: string; span: string; height: string }[] = [
  {
    id: 'CH-017',
    title: 'Waiting on Me',
    note: '내 승인 때문에 멈춰 있는 업무',
    span: 'col-span-12 lg:col-span-6 xl:col-span-3',
    height: 'h-[268px]',
  },
  {
    id: 'CH-018',
    title: '알림 / 리스크',
    note: 'Cash · AR · 생산 · 품질 · 계약 · HR Red Alert',
    span: 'col-span-12 lg:col-span-6 xl:col-span-3',
    height: 'h-[268px]',
  },
]

export default function DashboardPage() {
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
          {/* 표시 개수는 카드 줄 머리에서 말한다. 여기서 또 세면 숨김 후 두 숫자가 어긋난다. */}
          <p className="mt-1 text-[12px] text-ink-muted">오늘도 성공적인 하루 되세요.</p>
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

      <div className="mt-4 space-y-5">
        <DashboardBoard />
        <StrategicCoordinates />
      </div>

      <div className="mt-5 grid grid-cols-12 gap-3.5 pb-6">
        {/* 결정 → 대기 → 알림 → 야간 AI. 아침에 훑는 순서 그대로 왼쪽에서 오른쪽으로 놓는다. */}
        <div className="col-span-12 h-[268px] lg:col-span-6 xl:col-span-3">
          <DecisionPanel />
        </div>

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

        <div className="col-span-12 h-[268px] lg:col-span-6 xl:col-span-3">
          <AiNightPanel />
        </div>
      </div>
    </div>
  )
}

import { Icon } from '@/components/ui/icon'
import type { BusinessStrategy } from '@/types'

/**
 * CH-024 전략 좌표.
 *
 * 이 패널에는 숫자가 하나도 없다. 전부 사람이 쓴 문장이다 —
 * 그게 이 화면이 위쪽 KPI 8타일과 다른 이유고, 둘을 같은 카드에 섞지 않는 이유다.
 * 위는 '얼마인가', 여기는 '어디로 가고 무엇이 막고 있나'다.
 *
 * Gap과 Bottleneck을 크게 둔다. 나머지 넷은 잘 바뀌지 않는 값이고,
 * 회장이 이 화면을 여는 이유는 대개 그 둘 때문이다.
 */
export function CoordinatesPanel({ strategy }: { strategy: BusinessStrategy | null }) {
  if (!strategy) {
    return (
      <section className="rounded-xl border border-line-soft bg-panel px-4 py-8 text-center">
        <p className="text-[12.5px] text-ink-muted">
          이 회사의 전략 좌표가 아직 등록되지 않았습니다.
        </p>
        <p className="mt-1 text-[11px] text-ink-muted">
          CH-002로 방금 추가한 회사라면 정상입니다 — Mission부터 채우면 여기에 뜹니다.
        </p>
      </section>
    )
  }

  return (
    <section className="rounded-xl border border-line-soft bg-panel p-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-[13px] font-semibold">전략 좌표</h2>
        <span className="text-[9px] text-ink-muted tnum">CH-024</span>
      </div>

      <p className="mt-2.5 border-l-2 border-gold/60 pl-3 text-[14px] leading-snug font-semibold">
        {strategy.mission || '—'}
      </p>

      <div className="mt-3.5 grid gap-2.5 md:grid-cols-2 xl:grid-cols-4">
        <Cell label="1년 목표" value={strategy.goal_1y} />
        <Cell label="3년 목표" value={strategy.goal_3y} />
        <Cell label="현재 위치" value={strategy.current_position} />
        <Cell label="목표 위치" value={strategy.target_position} />
      </div>

      {/* 이 둘만 테두리를 준다. 나머지는 배경, 이건 지금 손대야 하는 것이다. */}
      <div className="mt-2.5 grid gap-2.5 md:grid-cols-2">
        <Highlight
          icon="arrow-up"
          label="Gap"
          value={strategy.gap}
          tone="border-warning/40 bg-warning/5"
        />
        <Highlight
          icon="shield"
          label="Bottleneck"
          value={strategy.bottleneck}
          tone="border-critical/40 bg-critical/5"
        />
      </div>

      <div className="mt-2.5 grid gap-2.5 md:grid-cols-2">
        <Cell label="Top KPI" value={strategy.top_kpi} />
        <Cell label="현재 우선순위" value={strategy.current_priority} />
      </div>

      {strategy.chairman_comment ? (
        <p className="mt-3 flex items-start gap-2 rounded-lg bg-raised px-3 py-2.5 text-[12px] leading-relaxed text-ink-dim">
          <Icon name="crown" className="mt-0.5 size-3.5 shrink-0 text-gold" filled />
          {strategy.chairman_comment}
        </p>
      ) : null}
    </section>
  )
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-raised/60 px-3 py-2.5">
      <p className="text-[10px] font-semibold tracking-[0.08em] text-ink-muted">{label}</p>
      <p className="mt-1 text-[12.5px] leading-snug text-ink-dim">{value || '—'}</p>
    </div>
  )
}

function Highlight({
  icon,
  label,
  value,
  tone,
}: {
  icon: 'arrow-up' | 'shield'
  label: string
  value: string
  tone: string
}) {
  return (
    <div className={`rounded-lg border px-3 py-2.5 ${tone}`}>
      <p className="flex items-center gap-1.5 text-[10px] font-semibold tracking-[0.08em] text-ink-muted">
        <Icon name={icon} className="size-3.5" />
        {label}
      </p>
      <p className="mt-1 text-[12.5px] leading-relaxed text-ink">{value || '—'}</p>
    </div>
  )
}

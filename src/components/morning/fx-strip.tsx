import type { FxStrip as FxStripData } from '@/lib/fx'

/**
 * 상단 3칸 아래 가로 띠 — 주요 통화의 원화 환산.
 *
 * 옆이 아니라 아래에 두는 이유는 폭 때문이다. 사이드바를 펼치면 본문이 136px 줄어드는데,
 * 상단이 이미 3칸(인사·날씨·체크인)이라 거기에 네 칸째를 끼우면 펼친 상태에서 전부 좁아진다.
 * 가로 띠는 줄바꿈으로 흡수한다.
 *
 * 숫자만 있고 상호작용이 없어 서버 컴포넌트다. 'use client'를 붙이지 않는다 —
 * 붙이면 환율 다섯 줄 때문에 번들이 늘고 얻는 것이 없다.
 *
 * null이면 띠 자체를 그리지 않는다. "환율을 불러오지 못했습니다" 한 줄을 남기는 쪽도
 * 생각했지만, 아침 화면에서 그 줄은 회장이 할 수 있는 일이 없는 자리를 차지할 뿐이다.
 * 날씨와 다르다 — 날씨 칸은 '현재 위치' 버튼이 있어 실패해도 누를 것이 있다.
 */
export function FxStrip({ data }: { data: FxStripData | null }) {
  if (!data) return null

  return (
    <section
      aria-label={`환율 — ${data.asOf} 고시 기준`}
      className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border border-line-soft bg-raised/50 px-4 py-2.5"
    >
      {data.chips.map((chip) => (
        <span key={chip.code} className="flex items-baseline gap-1.5 text-[12px]">
          <span className="font-semibold text-ink-dim">{chip.code}</span>
          <span className="font-semibold text-ink tnum">
            {chip.krw.toLocaleString('ko-KR', {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
          </span>
          <DeltaMark chip={chip} />
        </span>
      ))}

      {/*
       * 기준일을 반드시 적는다. ECB는 주말·공휴일에 고시하지 않아서 토·일 아침에는
       * 금요일 숫자가 그대로 서 있다 — 날짜가 없으면 회장이 '왜 안 변하지'를 묻게 된다.
       * 그 물음은 화면이 미리 답해야 한다.
       */}
      <span className="ml-auto text-[11px] text-ink-muted">
        {data.asOf} 고시 · 전일({data.comparedTo}) 대비
      </span>
    </section>
  )
}

/**
 * 전일비. 화살표만으로는 색맹 사용자에게 방향이 안 가므로 부호를 같이 적는다
 * (WCAG 1.4.1 — 색만으로 정보를 전하지 않는다). 보합은 가로줄이다.
 */
function DeltaMark({ chip }: { chip: FxStripData['chips'][number] }) {
  if (chip.direction === 'flat') {
    return (
      <span className="text-[11px] text-ink-muted tnum">— 0.00%</span>
    )
  }

  const up = chip.direction === 'up'
  const sign = up ? '+' : '−'
  return (
    <span className={`text-[11px] tnum ${up ? 'text-critical' : 'text-ok'}`}>
      {/* 원화 기준 상승은 '원화가 약해졌다'는 뜻이라 빨강이다. 주가와 반대 방향이 아니다 —
          회장이 보는 것은 수입 원가이고, 환율이 오르면 그쪽이 나빠진다. */}
      {up ? '▲' : '▼'} {sign}
      {Math.abs(chip.deltaPct).toFixed(2)}%
    </span>
  )
}

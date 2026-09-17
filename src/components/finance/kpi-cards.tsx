import Link from 'next/link'

import type { KpiCardData, RunwayData } from '@/lib/ledger/analysis'

import { FigureText } from './figure'

/**
 * 재무 KPI 카드. 당월 / YTD / TTM 세 숫자와 전년동월비.
 *
 * 숫자를 누르면 손익계산서의 그 합계 줄로 내려간다. '이 숫자가 어디서 왔나'가 한 번의 클릭이어야
 * 카드를 믿는다. 링크 주소는 서버가 만든다(anchorHref) — 카드가 URL 규칙을 따로 갖지 않는다.
 */

const LABEL: Record<KpiCardData['metric'], { label: string; upIsGood: boolean }> = {
  Revenue: { label: '매출', upIsGood: true },
  Cost: { label: '매출원가', upIsGood: false },
  EBITDA: { label: 'EBITDA', upIsGood: true },
  OperatingProfit: { label: '영업이익', upIsGood: true },
  NetIncome: { label: '당기순이익', upIsGood: true },
}

export function KpiCards({
  cards,
  runway,
  hrefFor,
}: {
  cards: KpiCardData[]
  runway: RunwayData
  hrefFor: (metric: KpiCardData['metric'] | 'Cash') => string
}) {
  return (
    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-6">
      {cards.map((c) => {
        const meta = LABEL[c.metric]
        return (
          <article key={c.metric} className="rounded-xl border border-line-soft bg-panel px-3.5 py-3">
            <Link
              href={hrefFor(c.metric)}
              className="group block"
              aria-label={`${meta.label} — 손익계산서 해당 줄로`}
            >
              <p className="flex items-center justify-between text-[11px] text-ink-dim">
                {meta.label}
                <span className="text-[9.5px] text-ink-muted group-hover:text-accent">계정 보기 →</span>
              </p>
              <p className="mt-1 text-[19px] leading-tight font-semibold group-hover:underline">
                <FigureText figure={c.month} unit="eok" />
              </p>
            </Link>
            <p className="mt-0.5 text-[11px] text-ink-muted">
              전년동월{' '}
              <FigureText figure={c.yoyPct} unit="pct" compact signTone={{ upIsGood: meta.upIsGood }} />
            </p>
            <dl className="mt-2 grid grid-cols-2 gap-1 border-t border-line-soft pt-2 text-[11px]">
              <div>
                <dt className="text-[10px] text-ink-muted">YTD</dt>
                <dd><FigureText figure={c.ytd} unit="eok" compact /></dd>
              </div>
              <div>
                <dt className="text-[10px] text-ink-muted">TTM</dt>
                <dd><FigureText figure={c.ttm} unit="eok" compact /></dd>
              </div>
            </dl>
          </article>
        )
      })}

      <article className="rounded-xl border border-line-soft bg-panel px-3.5 py-3">
        <Link href={hrefFor('Cash')} className="group block" aria-label="현금 — 재무상태표 해당 줄로">
          <p className="flex items-center justify-between text-[11px] text-ink-dim">
            현금 (월말)
            <span className="text-[9.5px] text-ink-muted group-hover:text-accent">계정 보기 →</span>
          </p>
          <p className="mt-1 text-[19px] leading-tight font-semibold group-hover:underline">
            <FigureText figure={runway.cash} unit="eok" />
          </p>
        </Link>
        <p className="mt-0.5 text-[11px] text-ink-muted">최근 3개월 평균 순소진 기준</p>
        <dl className="mt-2 grid grid-cols-2 gap-1 border-t border-line-soft pt-2 text-[11px]">
          <div>
            <dt className="text-[10px] text-ink-muted">Runway</dt>
            <dd
              className={
                runway.status === 'burning' && runway.months && runway.months.value < 12
                  ? 'font-semibold text-critical'
                  : ''
              }
            >
              {runway.status === 'burning' ? (
                <FigureText figure={runway.months} unit="months" compact />
              ) : runway.status === 'not_burning' ? (
                <span className="text-ink-dim">소진 없음</span>
              ) : (
                <span className="text-ink-muted">—</span>
              )}
            </dd>
          </div>
          <div>
            {/* 소진이 음수면 들어오는 돈이다. '순소진 -0.2억'을 빨갛게 쓰면 좋은 소식이 경고로 읽힌다. */}
            <dt className="text-[10px] text-ink-muted">
              {runway.burn && runway.burn.value < 0 ? '월 순유입' : '월 순소진'}
            </dt>
            <dd>
              <FigureText
                figure={runway.burn && runway.burn.value < 0 ? { ...runway.burn, value: -runway.burn.value } : runway.burn}
                unit="eok"
                compact
              />
            </dd>
          </div>
        </dl>
      </article>
    </div>
  )
}

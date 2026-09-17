import { formatDeltaPct, formatEok } from '@/lib/format'
import { ACCOUNT_CATEGORY_LABEL_KO, FIGURE_BASIS_LABEL_KO, type Figure, type FinanceLedger } from '@/types'

import { closingDiff, costStructure, runway } from './analysis'
import { ledgerScope } from './scope'

/**
 * 야간 브리핑에 넘길 재무 컨텍스트 (Phase 2-A). 원가 드라이버 변화 · 잠정-확정 차이 · Runway.
 *
 * 재무 화면과 **같은 함수**(analysis.ts)로 만든다. 화면의 Runway와 브리핑의 Runway가 다르면 둘 다 못 믿는다.
 *
 * 숫자는 여기서 문자열로 만들어 넘긴다 — 모델이 원 단위를 나누다 틀리는 일을 없앤다(night-brief.ts와 같은 이유).
 * 문자열마다 꼬리표를 붙인다: "18.7억 [잠정]". 모델이 잠정 숫자를 확정처럼 쓰지 않게 하려면
 * 꼬리표가 숫자에 붙어서 가야 한다. 따로 넘기면 떨어진다.
 */

export interface FinanceBriefContext {
  period: string
  /** '월 결산' | '전표(마감 전)' | '결산·전표 혼합' */
  basis_note: string
  runway: {
    cash: string | null
    monthly_burn: string | null
    months: string | null
    status: 'burning' | 'not_burning' | 'unknown'
  }
  /** 비용 전년비와 지수 전년비가 둘 다 있는 대분류만. 둘의 차이가 큰 순 */
  cost_drivers: {
    category: string
    share_of_revenue: string | null
    cost_yoy: string
    driver: string
    driver_yoy: string
    /** 비용 전년비 − 지수 전년비(%p). 양수면 지수보다 비용이 더 올랐다 = 가격이 아니라 우리 쪽 문제일 수 있다 */
    gap_pp: string
  }[]
  /** 가장 최근 확정 마감 달의 마감 전 값 vs 확정값. 차이가 없으면 빈 배열 */
  provisional_vs_confirmed: { period: string; metric: string; provisional: string; confirmed: string; diff: string }[]
}

const tag = (f: Figure) => `[${FIGURE_BASIS_LABEL_KO[f.basis]}]`
const eok = (f: Figure | null) => (f ? `${formatEok(f.value, 2)} ${tag(f)}` : null)
const pct = (f: Figure) => `${formatDeltaPct(f.value)} ${tag(f)}`

const METRIC_KO: Record<string, string> = {
  Revenue: '매출',
  Cost: '매출원가',
  EBITDA: 'EBITDA',
  OperatingProfit: '영업이익',
  NetIncome: '당기순이익',
  Cash: '현금',
  AR: '매출채권',
  AP: '매입채무',
}

export function financeBriefContext(ledger: FinanceLedger, businessIds: string[]): FinanceBriefContext | null {
  const scope = ledgerScope(ledger, businessIds)
  const period = scope.periods.at(-1)
  if (!period) return null

  const origin = scope.originAt(period)
  const r = runway(scope, period)
  const cs = costStructure(scope, ledger, period)
  const diff = closingDiff(ledger, scope)

  return {
    period,
    basis_note: origin === 'closing' ? '월 결산' : origin === 'journal' ? '전표(마감 전)' : '결산·전표 혼합',
    runway: {
      cash: eok(r.cash),
      monthly_burn: eok(r.burn),
      months: r.months ? `${r.months.value.toFixed(1)}개월 ${tag(r.months)}` : null,
      status: r.status,
    },
    cost_drivers: cs.rows
      .filter((row) => row.yoyPct && row.driver?.yoyPct)
      .map((row) => ({
        row,
        gap: row.yoyPct!.value - row.driver!.yoyPct!.value,
      }))
      .sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap))
      .map(({ row, gap }) => ({
        category: ACCOUNT_CATEGORY_LABEL_KO[row.category],
        share_of_revenue: row.share ? `${row.share.value.toFixed(1)}% ${tag(row.share)}` : null,
        cost_yoy: pct(row.yoyPct!),
        driver: row.driver!.label,
        driver_yoy: pct(row.driver!.yoyPct!),
        gap_pp: `${gap > 0 ? '+' : ''}${gap.toFixed(1)}%p`,
      })),
    provisional_vs_confirmed: diff
      ? diff.metrics
          .filter((m) => Math.round(m.diff.value / 1_000_000) !== 0)
          .map((m) => ({
            period: diff.period,
            metric: METRIC_KO[m.metric] ?? m.metric,
            provisional: eok(m.provisional)!,
            confirmed: eok(m.confirmed)!,
            diff: eok(m.diff)!,
          }))
      : [],
  }
}

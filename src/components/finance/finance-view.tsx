import Link from 'next/link'

import { closingDiff, costStructure, kpiCards, runway } from '@/lib/ledger/analysis'
import { ledgerScope } from '@/lib/ledger/scope'
import { METRIC_ANCHOR, STATEMENT_LABEL_KO, statementRows, type StatementKind } from '@/lib/ledger/statements'
import { withParams } from '@/lib/query'
import { FIGURE_BASIS, FIGURE_BASIS_LABEL_KO, type FinanceLedger } from '@/types'

import { CostStructurePanel, ClosingDiffPanel } from './cost-structure'
import { BasisTag } from './figure'
import { KpiCards } from './kpi-cards'
import { MonthSelect } from './month-select'
import { StatementTable } from './statement-table'

/**
 * 재무 화면 한 판. 회사 하나(/finance/[business_id])와 그룹(/finance)이 같은 구조를 쓴다.
 * 다른 것은 범위(businessIds)와 머리글뿐이다 — 두 벌로 만들면 그룹과 회사가 다른 KPI를 말하게 된다
 * (kpi-strip.tsx가 대시보드와 회사 상세에서 같은 컴포넌트를 쓰는 이유와 같다).
 *
 * 순서는 '얼마인가 → 왜 그런가 → 원본'이다.
 *   KPI 카드(당월·YTD·TTM·전년비, 현금·Runway)
 *   원가 구조(비중·전년비·지수) | 잠정→확정 차이
 *   재무제표 3탭(계정별 원본)
 *
 * 조회 월과 탭은 URL에 있다(?month= / ?tab=). 기본값이면 키를 뺀다.
 */

export const STATEMENT_TABS: readonly StatementKind[] = ['is', 'bs', 'cf']

export function FinanceView({
  ledger,
  businessIds,
  basePath,
  month,
  tab,
}: {
  ledger: FinanceLedger
  businessIds: string[]
  basePath: string
  /** URL에서 온 값. 데이터에 없는 달이면 최신 달로 본다 */
  month: string | undefined
  tab: StatementKind
}) {
  const scope = ledgerScope(ledger, businessIds)
  const latest = scope.periods.at(-1)

  if (!latest) {
    return (
      <section className="mt-4 rounded-xl border border-line-soft bg-panel px-4 py-10 text-center">
        <p className="text-[13px] text-ink-dim">이 범위에 원장이 없습니다.</p>
        <p className="mt-1 text-[11.5px] text-ink-muted">
          전표를 입력하거나(전표 화면) DY는 ECOUNT 엑셀을 올리면 여기에 섭니다. 출처 없는 숫자는 올리지 않습니다.
        </p>
      </section>
    )
  }

  const period = month && scope.periods.includes(month) ? month : latest
  const href = (params: { month?: string; tab?: StatementKind }) =>
    withParams(basePath, {
      month: params.month && params.month !== latest ? params.month : undefined,
      tab: params.tab && params.tab !== 'is' ? params.tab : undefined,
    })

  const origin = scope.originAt(period)
  const coverage = scope.coverageAt(period)
  const rows = statementRows(tab, scope, period)

  return (
    <div className="mt-4 space-y-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-ink-muted">
          <span>
            {period.replace('-', '년 ')}월 ·{' '}
            {origin === 'closing' ? '월 결산 기준' : origin === 'journal' ? '전표 기준 (마감 전)' : '결산·전표 혼합'}
          </span>
          {businessIds.length > 1 ? (
            <span className={coverage < businessIds.length ? 'text-warning' : ''}>
              · {coverage}/{businessIds.length}개사 단순 합산 (내부거래 제거 전)
            </span>
          ) : null}
          <span className="flex items-center gap-1">
            · 꼬리표
            {FIGURE_BASIS.map((b) => (
              <span key={b} className="flex items-center gap-0.5">
                <BasisTag basis={b} compact />
                <span>{FIGURE_BASIS_LABEL_KO[b]}</span>
              </span>
            ))}
          </span>
        </div>
        <MonthSelect
          value={period}
          periods={[...scope.periods].reverse().map((p) => ({
            period: p,
            label: `${p.replace('-', '년 ')}월${p === latest ? ' (최신)' : ''}`,
          }))}
          hrefFor={Object.fromEntries(scope.periods.map((p) => [p, href({ month: p, tab })]))}
        />
      </div>

      <KpiCards
        cards={kpiCards(scope, period)}
        runway={runway(scope, period)}
        hrefFor={(metric) => {
          const a = METRIC_ANCHOR[metric]
          return `${href({ month: period, tab: a.tab })}#${a.key}`
        }}
      />

      <div className="grid grid-cols-12 gap-3.5">
        <div className="col-span-12 xl:col-span-7">
          <CostStructurePanel data={costStructure(scope, ledger, period)} />
        </div>
        <div className="col-span-12 xl:col-span-5">
          <ClosingDiffPanel diff={closingDiff(ledger, scope)} />
        </div>
      </div>

      <section className="rounded-xl border border-line-soft bg-panel p-3.5">
        <nav className="flex items-center gap-1 border-b border-line-soft pb-2" aria-label="재무제표">
          {STATEMENT_TABS.map((t) => (
            <Link
              key={t}
              href={href({ month: period, tab: t })}
              aria-current={t === tab ? 'page' : undefined}
              className={[
                'rounded-md px-2.5 py-1 text-[12px] transition-colors',
                t === tab ? 'bg-accent/15 font-semibold text-ink' : 'text-ink-muted hover:text-ink-dim',
              ].join(' ')}
            >
              {STATEMENT_LABEL_KO[t]}
            </Link>
          ))}
          <span className="ml-auto text-[10.5px] text-ink-muted">단위: 백만원 · 계정코드는 회사 계정과목표 원본</span>
        </nav>
        <div className="mt-2">
          <StatementTable kind={tab} rows={rows} period={period} />
        </div>
      </section>
    </div>
  )
}

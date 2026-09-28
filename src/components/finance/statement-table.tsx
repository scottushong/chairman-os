import { addMonths } from '@/lib/ledger/basis'
import { combine2 } from '@/lib/ledger/basis'
import type { StatementKind, StatementRow } from '@/lib/ledger/statements'
import type { Figure } from '@/types'

import { FigureText } from './figure'

/**
 * 재무제표 한 장. 계정별 원본(회사 계정코드)이 먼저, 합계가 그 아래.
 *
 * 행의 id가 KPI 카드의 링크 목적지다(lib/ledger/statements.ts METRIC_ANCHOR).
 * :target으로 그 줄에 불이 들어온다(globals.css .fin-row).
 *
 * 칸마다 꼬리표를 단다. 표 안이라 한 글자(확/잠/수/추)로 줄인다 — 표 위 범례가 풀어 쓴다.
 */

function pct(now: Figure | null, before: Figure | null): Figure | null {
  if (!now || !before || before.value === 0 || Math.sign(before.value) !== Math.sign(now.value)) return null
  return combine2(now, before, (a, b) => ((a - b) / Math.abs(b)) * 100)
}

const ROW_TONE: Record<StatementRow['kind'], string> = {
  account: 'text-ink-dim',
  section: 'text-t10 font-semibold tracking-[0.08em] text-ink-muted',
  subtotal: 'font-semibold text-ink border-t border-line-soft',
  total: 'font-bold text-ink border-t border-line bg-raised/40',
  note: 'text-warning',
}

export function StatementTable({
  kind,
  rows,
  period,
}: {
  kind: StatementKind
  rows: StatementRow[]
  period: string
}) {
  const label = (p: string) => `${p.slice(2, 4)}.${p.slice(5)}`
  const columns =
    kind === 'is'
      ? [`${label(period)} 당월`, `${label(addMonths(period, -12))} 전년동월`, '전년비', `${period.slice(0, 4)} YTD`]
      : kind === 'bs'
        ? [`${label(period)} 말`, `${label(addMonths(period, -1))} 말`, `${label(addMonths(period, -12))} 말`]
        : [`${label(period)} 당월`, `${period.slice(0, 4)} YTD`]

  /**
   * 폰(640px 이하): 열이 곧 기간이라 카드로 풀 수 없다 — 표 그대로 자기 상자 안에서 옆으로 밀고,
   * 계정 이름 칸을 왼쪽에 붙여 둔다. 공용 .m-sticky-first는 첫 칸(코드)을 붙이는데, 폰에서 붙어 있어야
   * 읽히는 것은 코드가 아니라 이름이다. 그래서 코드 칸을 숨기고 코드를 이름 위에 작게 올린 뒤
   * 이름 칸에 같은 규칙(sticky · left-0 · bg-app)을 직접 건다.
   */
  const pin = 'max-sm:sticky max-sm:left-0 max-sm:z-[1] max-sm:min-w-[132px] max-sm:bg-app'
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-t12 sm:min-w-[640px]">
        <thead>
          <tr className="border-b border-line text-t10h text-ink-muted">
            <th className="w-16 py-1.5 pr-2 text-left font-normal max-sm:hidden">코드</th>
            <th className={`py-1.5 pr-2 text-left font-normal ${pin}`}>계정 · 항목</th>
            {columns.map((c) => (
              <th key={c} className="py-1.5 pl-3 text-right font-normal tnum">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {/* 원천이 한 칸도 없는 계정 줄은 뺀다. 그 회사가 쓰지 않는 계정이다(예: VANA의 원재료비). */}
          {rows.filter((r) => r.kind !== 'account' || r.current || r.prior || r.priorYear || r.ytd).map((r) => {
            const cells: (Figure | null)[] =
              kind === 'is'
                ? [r.current, r.prior, null, r.ytd]
                : kind === 'bs'
                  ? [r.current, r.prior, r.priorYear]
                  : [r.current, r.ytd]
            return (
              <tr key={r.key} id={r.key} className={`fin-row scroll-mt-24 ${ROW_TONE[r.kind]}`}>
                <td className="py-1.5 pr-2 text-t10h text-ink-muted tnum max-sm:hidden">{r.account_code ?? ''}</td>
                <td className={`py-1.5 pr-2 ${r.kind === 'account' && r.account_code ? 'pl-2' : ''} ${pin}`}>
                  {r.account_code ? (
                    <span className="block text-t10h text-ink-muted tnum sm:hidden">{r.account_code}</span>
                  ) : null}
                  {r.label}
                </td>
                {r.kind === 'section'
                  ? columns.map((c) => <td key={c} />)
                  : cells.map((f, i) =>
                      kind === 'is' && i === 2 ? (
                        <td key={i} className="py-1.5 pl-3 text-right">
                          <FigureText figure={pct(r.current, r.prior)} unit="pct" compact />
                        </td>
                      ) : (
                        <td key={i} className="py-1.5 pl-3 text-right">
                          <FigureText figure={f} unit="million" compact />
                        </td>
                      ),
                    )}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

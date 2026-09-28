import type { ClosingDiff, CostStructure } from '@/lib/ledger/analysis'
import { ACCOUNT_CATEGORY_LABEL_KO } from '@/types'

import { FigureText } from './figure'

/**
 * 원가 구조 — 매출 100 기준 비용 비중, 그 비용의 전년비, 관련 지수의 전년비를 한 줄에.
 *
 * 한 줄에 세 가지를 나란히 두는 이유: "원재료비가 18% 올랐다"만으로는 판단이 안 선다.
 * 원재료지수가 같이 18% 올랐으면 가격 문제고, 지수가 3%인데 비용이 18%면 우리 문제다.
 *
 * 막대는 비중 하나만 그린다(단일 계열, 한 색). 증감률 둘은 막대가 아니라 부호 붙은 숫자다 —
 * 비중(0~100)과 증감률(±)을 한 축에 올리면 이중 축이 되고, 그건 읽는 사람을 속인다.
 * 막대 끝에 값을 직접 적어 색만으로 읽히지 않게 한다.
 */
export function CostStructurePanel({ data }: { data: CostStructure }) {
  return (
    <section className="rounded-xl border border-line-soft bg-panel p-3.5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-t13 font-semibold">원가 구조</h2>
        <span className="text-t11 text-ink-muted">
          매출 100 기준 · {data.period.replace('-', '년 ')}월 · 매출{' '}
          <FigureText figure={data.revenue} unit="eok" compact />
        </span>
      </div>

      {/* m-cards: 폰(640px 이하)에서는 네 칸이 360px에 못 들어가 대분류가 한 글자씩 접혔다.
          줄 하나를 카드 하나로 세우고 칸 이름을 값 왼쪽에 붙인다(globals.css). */}
      <table className="m-cards mt-2.5 w-full text-t12">
        <thead>
          <tr className="text-t10h text-ink-muted">
            <th className="w-20 py-1 text-left font-normal">대분류</th>
            <th className="py-1 text-left font-normal">매출 대비 비중</th>
            <th className="w-28 py-1 text-right font-normal">비용 전년비</th>
            <th className="w-44 py-1 text-right font-normal">관련 지수 전년비</th>
          </tr>
        </thead>
        <tbody>
          {data.rows.map((r) => (
            <tr key={r.category} className="border-t border-line-soft">
              <td className="py-2 text-ink-dim max-sm:font-semibold max-sm:text-ink">{ACCOUNT_CATEGORY_LABEL_KO[r.category]}</td>
              <td className="py-2 pr-3" data-label="매출 대비 비중">
                {/* 카드에서는 칸 이름 옆 남은 폭을 막대가 채운다 — flex-1이 없으면 막대 폭이 0이 된다 */}
                <div className="flex items-center gap-2 max-sm:flex-1">
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-raised">
                    <div
                      className="h-full rounded-full bg-accent"
                      // 축은 매출 100이다. 가장 큰 막대를 꽉 채우도록 늘리면 '매출의 45%'가 '매출 전부'처럼 보인다.
                      style={{ width: `${Math.min(100, Math.max(0, r.share?.value ?? 0))}%` }}
                      title={r.share ? `${r.share.value.toFixed(1)}%` : '원천 없음'}
                    />
                  </div>
                  <span className="w-20 shrink-0 text-right">
                    {r.share ? (
<FigureText figure={r.share} unit="share" compact />
                    ) : (
                      <span className="text-ink-muted">—</span>
                    )}
                  </span>
                </div>
              </td>
              <td className="py-2 text-right" data-label="비용 전년비">
                {/* 비용은 오르는 게 나쁘다 — 색이 뒤집힌다 */}
                <FigureText figure={r.yoyPct} unit="pct" compact signTone={{ upIsGood: false }} />
              </td>
              <td className="py-2 text-right" data-label="관련 지수 전년비">
                {r.driver ? (
                  <span className="inline-flex items-center gap-1.5">
                    <span className="text-t10h text-ink-muted">{r.driver.label}</span>
                    <FigureText figure={r.driver.yoyPct} unit="pct" compact />
                  </span>
                ) : (
                  <span className="text-t10h text-ink-muted">드라이버 없음</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-t10h text-ink-muted">
        비중은 매출원가와 판관비를 대분류로 묶은 값이다. 감가상각·영업외·법인세는 빠진다.
        지수 색은 칠하지 않는다 — 지수가 오른 것은 좋고 나쁨이 아니라 설명이다.
      </p>
    </section>
  )
}

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

/** 잠정-확정 차이. 이번 달 잠정 숫자를 얼마나 믿을지의 눈금이다. */
export function ClosingDiffPanel({ diff }: { diff: ClosingDiff | null }) {
  return (
    <section className="rounded-xl border border-line-soft bg-panel p-3.5">
      <div className="flex items-baseline justify-between">
        <h2 className="text-t13 font-semibold">잠정 → 확정 차이</h2>
        <span className="text-t11 text-ink-muted">
          {diff ? `${diff.period.replace('-', '년 ')}월 마감` : '마감 이력 없음'}
        </span>
      </div>
      {!diff ? (
        <p className="py-6 text-center text-t12 text-ink-muted">
          마감 시점의 잠정치가 기록된 달이 아직 없습니다.
        </p>
      ) : (
        <>
          {/* m-cards: 폰에서는 지표 하나가 카드 하나 — 네 칸을 360px에 욱여넣으면 숫자와 꼬리표가 갈라진다 */}
          <table className="m-cards mt-2.5 w-full text-t12">
            <thead>
              <tr className="text-t10h text-ink-muted">
                <th className="py-1 text-left font-normal">지표</th>
                <th className="py-1 text-right font-normal">마감 전</th>
                <th className="py-1 text-right font-normal">확정</th>
                <th className="py-1 text-right font-normal">차이</th>
              </tr>
            </thead>
            <tbody>
              {diff.metrics
                .filter((m) => ['Revenue', 'Cost', 'EBITDA', 'NetIncome', 'Cash'].includes(m.metric))
                .map((m) => (
                  <tr key={m.metric} className="border-t border-line-soft">
                    <td className="py-1.5 text-ink-dim max-sm:font-semibold max-sm:text-ink">{METRIC_KO[m.metric]}</td>
                    <td className="py-1.5 text-right" data-label="마감 전"><FigureText figure={m.provisional} unit="eok" digits={2} compact /></td>
                    <td className="py-1.5 text-right" data-label="확정"><FigureText figure={m.confirmed} unit="eok" digits={2} compact /></td>
                    <td className="py-1.5 text-right font-semibold" data-label="차이">
                      {Math.round(m.diff.value) === 0 ? (
                        <span className="text-ink-muted">없음</span>
                      ) : (
                        <FigureText figure={m.diff} unit="million" compact />
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
          {diff.accounts.length > 0 ? (
            <div className="mt-2.5 border-t border-line-soft pt-2">
              <p className="text-t10h text-ink-muted">결산조정이 들어간 계정 (백만원, 차변 − 대변)</p>
              <ul className="mt-1 space-y-0.5 text-t11h">
                {diff.accounts.slice(0, 5).map((a) => (
                  <li key={a.account_code} className="flex items-center justify-between gap-2">
                    <span className="text-ink-dim">
                      <span className="mr-1.5 text-t10h text-ink-muted tnum">{a.account_code}</span>
                      {a.name}
                    </span>
                    <FigureText figure={a.diff} unit="million" compact />
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </>
      )}
    </section>
  )
}

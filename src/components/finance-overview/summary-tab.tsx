import Link from 'next/link'

import type { ChecklistItem } from '@/lib/finance-overview/checklist'
import { warnShort } from '@/lib/finance-overview/checklist'
import { addMonths, computeBs, computeCash, computeCosts, computeDebt, computePl, computeSales, DEBT_SOURCE_KO, growth, monthsOfYear, pct, VAL_SOURCE_KO, type Ctx } from '@/lib/finance-overview/engine'
import { eok, monthKo, pctText, ppText, ratio, won } from '@/lib/finance-overview/format'
import { grainLabel, grainMonths, plSum, prevGrainEnd, type Grain } from '@/lib/finance-overview/grain'
import type { Kpi } from '@/lib/finance-overview/kpis'

import { ChecklistWithdraw } from './checklist-withdraw'
import { KpiGrid } from './kpi-grid'
import { Card, Lack, Note, Stat, T, Td, Th } from './parts'

/**
 * «요약» 탭 — 시안 finance-overview-mock.html 그대로: 위 다섯 칸 → ①~⑥ 두 줄 → ⑦ 이번 달 자료 → ⑧ 12가지 지표.
 * 보는 화면이 없던 종류(급여 부서별 · 카드 · 해외법인 · 해외판촉 · 절감목표)는 맨 아래 «그 밖 자료 표»에.
 */
export function SummaryTab({ ctx, period, grain, kpis, checklist, links, withdraw = null }: { ctx: Ctx; period: string; grain: Grain; kpis: Kpi[]; checklist: ChecklistItem[]; links: { upload: string; pl: string; calendar: string; daily: string; statements: string | null; customers: string; kpi: string }; withdraw?: { businessId: string } | null }) {
  const cur = plSum(ctx, grainMonths(period, grain))
  const prevEnd = prevGrainEnd(period, grain)
  const prev = plSum(ctx, grainMonths(prevEnd, grain))
  const ly = plSum(ctx, grainMonths(addMonths(period, -12), grain))
  const plM = computePl(ctx, period)
  const bs = computeBs(ctx, period)
  const bsPrev = computeBs(ctx, addMonths(period, -1))
  const cash = computeCash(ctx, period, bs)
  const cashPrev = computeCash(ctx, addMonths(period, -1))
  const debt = computeDebt(ctx, period)
  const costs = computeCosts(ctx, period).slice(0, 5)
  const sales = computeSales(ctx, period)
  const label = grainLabel(period, grain)
  const prevLabel = grain === 'year' ? `${Number(period.slice(0, 4)) - 1}년` : grainLabel(prevEnd, grain)
  const lyLabel = `전년 ${grain === 'year' ? `${Number(period.slice(0, 4)) - 1}년` : grainLabel(period, grain)}`
  const margin = (a: number | null, b: number | null) => pct(a, b)
  const mDiff = (a: number | null, b: number | null, c: number | null, d: number | null) => {
    const x = margin(a, b)
    const y = margin(c, d)
    return x === null || y === null ? null : x - y
  }
  const revMom = growth(cur.revenue, prev.revenue)
  const revYoy = growth(cur.revenue, ly.revenue)
  const gpD = mDiff(cur.gross, cur.revenue, prev.gross, prev.revenue)
  const opD = mDiff(cur.op, cur.revenue, prev.op, prev.revenue)
  const cashDiff = cash.closing !== null && cashPrev.closing !== null ? cash.closing - cashPrev.closing : null
  // 현금이 준 까닭 한 마디(가장 큰 나간 돈 항목) — 자료가 있을 때만.
  const why = (() => {
    const m = ctx.months.get(period)
    if (!m?.cashflow.length || cashDiff === null || cashDiff >= 0) return null
    const top = [...m.cashflow].filter((r) => !r.planned).sort((a, b) => Number(b.outflow ?? 0) - Number(a.outflow ?? 0))[0]
    return top?.category ? String(top.category).slice(0, 14) : null
  })()

  // 누계(1월 ~ 이 달) 현금흐름
  const ytdCash = monthsOfYear(period).map((p) => computeCash(ctx, p))
  const ytd = (k: 'operating' | 'investing' | 'financing' | 'materialPaid') => (ytdCash.some((c) => c[k] !== null) ? ytdCash.reduce((s, c) => s + (c[k] ?? 0), 0) : null)
  const ytdOpening = ytdCash[0]?.opening ?? null

  const invNow = bs.inventory.total
  const invPrev = bsPrev.inventory.total
  const got = checklist.filter((c) => c.state !== 'missing').length
  const warnN = checklist.filter((c) => c.state === 'warn').length
  const m = ctx.months.get(period)

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-3.5 md:grid-cols-3 xl:grid-cols-5">
        <Stat label="매출액" value={eok(cur.revenue)} sub={[revMom !== null ? `전월 ${pctText(revMom)}` : null, revYoy !== null ? `전년 ${pctText(revYoy)}` : null].filter(Boolean).join(' · ') || (cur.revenue === null ? '자료 부족: 판매현황 · 계정별 원장' : null)} tone={(revMom ?? 0) >= 0 ? 'up' : 'down'} />
        <Stat label="매출총이익" value={eok(cur.gross)} aside={cur.gross !== null ? ratio(margin(cur.gross, cur.revenue)) : null} sub={gpD !== null ? `전월 ${ppText(gpD)}` : null} tone={(gpD ?? 0) >= 0 ? 'up' : 'down'} />
        <Stat label="영업이익" value={eok(cur.op)} aside={cur.op !== null ? ratio(margin(cur.op, cur.revenue)) : null} sub={opD !== null ? `전월 ${ppText(opD)}` : null} tone={(opD ?? 0) >= 0 ? 'up' : 'down'} />
        <Stat label="기말 현금" value={eok(cash.closing)} sub={cashDiff !== null ? `전월 ${eok(cashDiff, 1, true)}${why ? ` (${why})` : ''}` : cash.closing === null ? '자료 부족: 월별 자금흐름표' : null} tone={(cashDiff ?? 0) >= 0 ? 'up' : 'down'} />
        <Stat label="차입 잔액" value={eok(debt.total)} sub={debt.total === null ? '자료 부족: 대출현황 · 차입금' : `이번 달 원리금 ${eok(debt.monthlyPay, 2)}`} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title={`① 손익 (${plM.cogsBasis.method === 'inventory' ? '재고 반영' : '장부 원가'})`} more={{ href: links.pl }}>
          {cur.revenue === null && cur.op === null ? (
            <Lack need="계정별 원장 또는 월별 손익계산서" upload={links.upload} />
          ) : (
            <T>
              <thead>
                <tr>
                  <Th>항목</Th>
                  <Th n>{label}</Th>
                  <Th n>{prevLabel}</Th>
                  <Th n>{lyLabel}</Th>
                </tr>
              </thead>
              <tbody>
                {(
                  [
                    ['매출액', 'revenue', false],
                    ['매출원가', 'cogs', false],
                    ['매출총이익', 'gross', true],
                    ['판매관리비', 'sga', false],
                    ['영업이익', 'op', true],
                    ['영업외손익', 'nonop', false],
                    ['당기순이익', 'net', true],
                  ] as const
                ).map(([name, k, bold]) => (
                  <tr key={k}>
                    <Td bold={bold}>{name}</Td>
                    <Td n bold={bold}>{won(cur[k])}</Td>
                    <Td n>{won(prev[k])}</Td>
                    <Td n>{won(ly[k])}</Td>
                  </tr>
                ))}
              </tbody>
            </T>
          )}
          {plM.notes.length || cur.missing.length ? (
            <Note tone="warn">
              잠정 — {[...plM.notes, ...(cur.missing.length ? [`${cur.missing.map(monthKo).join(' · ')} 손익 자료 없음(합계에서 뺌)`] : [])].join(' ')}
            </Note>
          ) : null}
        </Card>

        <Card title="② 재무상태" more={links.statements ? { href: links.statements } : null}>
          {bs.totalAssets === null ? (
            <Lack need={bs.note ?? '장부 또는 전년 공식 결산'} upload={links.upload} />
          ) : (
            <T>
              <thead>
                <tr>
                  <Th>자산</Th>
                  <Th n>{monthKo(period)} 말</Th>
                  <Th>부채 · 자본</Th>
                  <Th n>{monthKo(period)} 말</Th>
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: Math.max(bs.assets.length, bs.liabilities.length) }).map((_, i) => {
                  const a = bs.assets[i]
                  const l = bs.liabilities[i]
                  return (
                    <tr key={i}>
                      <Td bold={a?.bold}>{a?.label ?? ''}</Td>
                      <Td n bold={a?.bold}>{a ? won(a.amount) : ''}</Td>
                      <Td bold={l?.bold}>{l?.label ?? ''}</Td>
                      <Td n bold={l?.bold}>{l ? won(l.amount) : ''}</Td>
                    </tr>
                  )
                })}
              </tbody>
            </T>
          )}
          <Note>
            재고 합계 {eok(invNow)}
            {invNow !== null && invPrev !== null ? ` · 전월 대비 ${eok(invNow - invPrev, 1, true)}` : ''}
            {bs.inventory.raw === null && invNow !== null ? ' · 원재료 합계는 원료 3가지 미만이면 감춥니다' : ''}
            {m?.valuationSource && (m.valuationSource.wip || m.valuationSource.finished)
              ? ` · 재공품 ${m.valuationSource.wip ? VAL_SOURCE_KO[m.valuationSource.wip] : '없음'} · 완제품 ${m.valuationSource.finished ? VAL_SOURCE_KO[m.valuationSource.finished] : '없음'}`
              : ''}
          </Note>
        </Card>

        <Card title="③ 현금흐름" more={{ href: links.calendar }}>
          {!cash.hasFlows && cash.closing === null ? (
            <Lack need="월별 자금흐름표" upload={links.upload} />
          ) : (
            <T>
              <thead>
                <tr>
                  <Th>구분</Th>
                  <Th n>{monthKo(period)}</Th>
                  <Th n>누계(1~{Number(period.slice(5, 7))}월)</Th>
                </tr>
              </thead>
              <tbody>
                <tr><Td>기초 현금</Td><Td n>{won(cash.opening)}</Td><Td n>{won(ytdOpening)}</Td></tr>
                <tr><Td>영업활동</Td><Td n>{won(cash.operating, true)}</Td><Td n>{won(ytd('operating'), true)}</Td></tr>
                <tr><Td className="pl-6 text-[#6b7772]">그중 원료대금 지급</Td><Td n className="text-[#6b7772]">{won(cash.materialPaid)}</Td><Td n className="text-[#6b7772]">{won(ytd('materialPaid'))}</Td></tr>
                <tr><Td>투자활동</Td><Td n>{won(cash.investing, true)}</Td><Td n>{won(ytd('investing'), true)}</Td></tr>
                <tr><Td>재무활동</Td><Td n>{won(cash.financing, true)}</Td><Td n>{won(ytd('financing'), true)}</Td></tr>
                <tr><Td bold>기말 현금</Td><Td n bold>{won(cash.closing)}</Td><Td n bold>{won(cash.closing)}</Td></tr>
              </tbody>
            </T>
          )}
          <Note>{cashSentence(plM.op, cash)}</Note>
        </Card>

        <Card title="④ 대출 · 차입" more={{ href: links.daily }}>
          {!debt.rows.length ? (
            <Lack need="대출현황 · 차입금" upload={links.upload} />
          ) : (
            <T>
              <thead>
                <tr>
                  <Th>기관</Th>
                  <Th>종류</Th>
                  <Th n>잔액</Th>
                  <Th n>금리</Th>
                  <Th>만기</Th>
                  <Th n>이달 원리금</Th>
                </tr>
              </thead>
              <tbody>
                {debt.rows.map((r, i) => (
                  <tr key={i}>
                    <Td>{r.lender}</Td>
                    <Td>{r.type}</Td>
                    <Td n>{won(r.balance)}</Td>
                    <Td n>{r.rate === null ? '—' : `${r.rate}%`}</Td>
                    <Td>{r.maturity ? r.maturity.slice(0, 7) : '—'}</Td>
                    <Td n>{won(r.monthlyPay)}</Td>
                  </tr>
                ))}
                <tr>
                  <Td bold>합계</Td>
                  <Td />
                  <Td n bold>{won(debt.total)}</Td>
                  <Td />
                  <Td />
                  <Td n bold>{won(debt.monthlyPay)}</Td>
                </tr>
              </tbody>
            </T>
          )}
          {debt.asOf && debt.asOf !== period ? <Note>대출현황은 {monthKo(debt.asOf)} 기준입니다(이 달 자료 없음).</Note> : null}
          {debt.interestSource || debt.principalSource ? (
            <Note>
              출처 — 원금 {debt.principalSource ? DEBT_SOURCE_KO[debt.principalSource] : '없음'} · 이자 {debt.interestSource ? DEBT_SOURCE_KO[debt.interestSource] : '없음'}
              {debt.interestSource === 'ledger' ? ` ${won(debt.monthlyInterest)}(대출마다 나누지 않음)` : ''}
            </Note>
          ) : null}
        </Card>

        <Card title="⑤ 비용 상위" more={{ href: links.pl }}>
          {!costs.length ? (
            <Lack need="계정별 원장 · 급여대장 · 법인카드 사용내역" upload={links.upload} />
          ) : (
            <T>
              <thead>
                <tr>
                  <Th>계정</Th>
                  <Th n>{monthKo(period)}</Th>
                  <Th n>전월 대비</Th>
                </tr>
              </thead>
              <tbody>
                {costs.map((c, i) => (
                  <tr key={i}>
                    <Td>{c.label}</Td>
                    <Td n>{won(c.amount)}</Td>
                    <Td n className={c.change !== null && c.change >= 20 ? 'text-[#b4432b]' : ''}>{pctText(c.change)}</Td>
                  </tr>
                ))}
              </tbody>
            </T>
          )}
        </Card>

        <Card title="⑥ 매출 상위" more={{ href: links.customers }}>
          {!sales.rows.length ? (
            <Lack need="판매현황(거래처) 또는 세금계산서" upload={links.upload} />
          ) : (
            <T>
              <thead>
                <tr>
                  <Th>거래처</Th>
                  <Th n>매출</Th>
                  <Th n>kg</Th>
                  <Th n>비중</Th>
                </tr>
              </thead>
              <tbody>
                {sales.rows.map((r, i) => (
                  <tr key={i}>
                    <Td>{r.customer}</Td>
                    <Td n>{won(r.amount)}</Td>
                    <Td n>{r.kg === null ? '—' : Math.round(r.kg).toLocaleString('ko-KR')}</Td>
                    <Td n>{ratio(r.share)}</Td>
                  </tr>
                ))}
              </tbody>
            </T>
          )}
          {sales.rows.length && !m?.shipment.length ? <Note>kg는 판매현황 수량입니다(출하집계표가 오면 출하 kg).</Note> : null}
        </Card>
      </div>

      <Card title={`⑦ 이번 달 자료 — 받은 것 ${got} · 빠진 것 ${checklist.length - got} · 경고 ${warnN}`} more={{ href: links.upload, label: '자료 올리기 ›' }}>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6" data-testid="checklist">
          {checklist.map((c) =>
            c.state === 'ok' ? (
              <div key={c.key} className="rounded-lg bg-[#e1efeb] px-2.5 py-2 text-[13px] text-[#0f6b5c]">
                ✓ {c.label}
                {withdraw && c.uploadId ? <ChecklistWithdraw uploadId={c.uploadId} businessId={withdraw.businessId} fileName={c.fileName ?? null} /> : null}
              </div>
            ) : c.state === 'warn' ? (
              <div key={c.key} className="rounded-lg bg-[#fdf4ec] px-2.5 py-2 text-[13px] text-[#9a4b12]" title={c.warnings.join('\n')}>
                ⚠ {c.label} ({warnShort(c.warnings)})
                {withdraw && c.uploadId ? <ChecklistWithdraw uploadId={c.uploadId} businessId={withdraw.businessId} fileName={c.fileName ?? null} /> : null}
              </div>
            ) : (
              <div key={c.key} className="rounded-lg border border-dashed border-[#c9d1cd] bg-white px-2.5 py-2 text-[13px] text-[#6b7772]">
                · {c.label}{' '}
                <Link href={links.upload} className="inline-flex items-center text-[#0f6b5c] hover:underline">
                  올리기
                </Link>
              </div>
            ),
          )}
        </div>
      </Card>

      <KpiGrid id="k" kpis={kpis} />

      <OtherTables ctx={ctx} period={period} />
    </div>
  )
}

function cashSentence(op: number | null, c: ReturnType<typeof computeCash>): string {
  if (!c.hasFlows) return '자금흐름표가 오면 영업 · 투자 · 재무로 나눠 보입니다.'
  const net = c.net ?? 0
  if (op !== null && op > 0 && net < 0) {
    const big = [(c.materialPaid ?? 0) < 0 ? '원료대금 지급' : null, (c.investing ?? 0) < 0 ? '설비 투자' : null, (c.financing ?? 0) < 0 ? '대출 상환' : null].filter(Boolean)
    return `이익은 났지만 ${big.length ? big.join('과 ') : '지출'}로 현금은 줄었습니다.`
  }
  if (net >= 0) return '이달 현금이 늘었습니다.'
  return '이달 현금이 줄었습니다.'
}

/** 보는 화면이 없던 종류 — 급여 부서별 · 법인카드 · 해외법인 · 해외판촉 · 절감목표(한 화면 안에 표로). */
function OtherTables({ ctx, period }: { ctx: Ctx; period: string }) {
  const m = ctx.months.get(period)
  if (!m) return null
  const pay = m.payroll
  const card = m.card
  const byDept = new Map<string, number>()
  for (const r of card) byDept.set(String(r.dept ?? '부서 없음'), (byDept.get(String(r.dept ?? '부서 없음')) ?? 0) + Number(r.amount ?? 0))
  const blocks: { title: string; empty: string; head: string[]; rows: (string | number | null)[][] }[] = [
    { title: '급여 — 부서별 합계', empty: '급여대장', head: ['부서', '급여', '상여', '퇴직급여'], rows: pay.map((r) => [String(r.dept ?? ''), won(Number(r.salary ?? 0)), won(Number(r.bonus ?? 0)), won(Number(r.severance ?? 0))]) },
    { title: `법인카드 — 부서별 (${card.length}건)`, empty: '법인카드 사용내역', head: ['부서', '금액'], rows: [...byDept.entries()].sort((a, b) => b[1] - a[1]).map(([d, v]) => [d, won(v)]) },
    { title: '베트남 법인 운영비', empty: '해외법인 운영비', head: ['항목', '통화', '금액', '원화'], rows: m.overseas.map((r) => [String(r.item ?? ''), String(r.currency ?? ''), Number(r.amount ?? 0).toLocaleString('ko-KR'), r.amount_krw === null || r.amount_krw === undefined ? '—' : won(Number(r.amount_krw))]) },
    { title: '해외 판촉비 — 담당자별', empty: '해외판촉비', head: ['담당자', '항목', '금액'], rows: m.promo.map((r) => [String(r.person ?? ''), String(r.item ?? ''), Number(r.amount ?? 0).toLocaleString('ko-KR')]) },
    { title: '절감목표 · 진행', empty: '절감목표 · 진행현황', head: ['항목', '목표', '실적', '달성'], rows: m.savings.map((r) => [String(r.item ?? ''), won(Number(r.target ?? 0)), won(Number(r.actual ?? 0)), ratio(pct(Number(r.actual ?? 0), Number(r.target ?? 0)), 0)]) },
  ]
  return (
    <details className="rounded-[10px] border border-[#e1e6e3] bg-white px-[18px] py-3" data-testid="other-tables">
      <summary className="cursor-pointer text-[15px] font-bold">그 밖 자료 표 — 급여 · 카드 · 해외법인 · 해외판촉 · 절감목표</summary>
      <div className="mt-3 grid grid-cols-1 gap-4 lg:grid-cols-2">
        {blocks.map((b) => (
          <div key={b.title} className="flex min-w-0 flex-col gap-1.5">
            <div className="text-[14px] font-semibold">{b.title}</div>
            {b.rows.length ? (
              <T>
                <thead>
                  <tr>{b.head.map((h, i) => <Th key={h} n={i > 0}>{h}</Th>)}</tr>
                </thead>
                <tbody>
                  {b.rows.slice(0, 12).map((r, i) => (
                    <tr key={i}>{r.map((v, j) => <Td key={j} n={j > 0}>{v}</Td>)}</tr>
                  ))}
                </tbody>
              </T>
            ) : (
              <Lack need={b.empty} />
            )}
          </div>
        ))}
      </div>
      {m.payroll.length ? <Note>급여는 부서 합계만 보입니다(개인 줄은 대표 · CFO).</Note> : null}
    </details>
  )
}

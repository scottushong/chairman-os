import Link from 'next/link'

import { addMonths, computePl, monthsOfYear, pct, plYtd, type Ctx, type PlLine } from '@/lib/finance-overview/engine'
import { eok, monthKo, ratio, won } from '@/lib/finance-overview/format'

import { CsvButton } from './csv-button'
import { Lack, Note } from './parts'
import { ValuationEdit } from './valuation-edit'

/**
 * «손익계산서» — 시안 finance-pl-mock.html: 과목 전부(재고 반영 원가 · 판관비 세부 · 영업외 · 법인세 · 당기순이익)를 이번 달 · 전월 · 증감 · 올해 누계 ·
 * 매출 대비로. 오른쪽: 월별 막대(매출 · 영업이익률) · 이익 변동 이유 · 공식 결산 3년 비교. 줄을 누르면 아래 «계정별 원장» 칸이 그 계정 줄로.
 */
export function PlTab({ ctx, period, hrefFor, selected, officials, upload, businessId, canFix = false }: { ctx: Ctx; period: string; hrefFor: (acct: string | null) => string; selected: string | null; officials: { year: string; revenue: number | null; op: number | null }[]; upload: string; businessId?: string; canFix?: boolean }) {
  const cur = computePl(ctx, period)
  const prev = computePl(ctx, addMonths(period, -1))
  const ytd = plYtd(ctx, period)
  if (cur.source === 'none' && cur.revenue === null) return <Lack need="계정별 원장 또는 월별 손익계산서" upload={upload} />
  const prevOf = (k: string) => prev.lines.find((l) => l.key === k)?.amount ?? null
  const rev = cur.revenue
  const bars = monthsOfYear(period).map((p) => {
    const r = computePl(ctx, p)
    return { p, rev: r.revenue, margin: pct(r.op, r.revenue) }
  })
  const maxRev = Math.max(1, ...bars.map((b) => b.rev ?? 0))
  const dOp = cur.op !== null && prev.op !== null ? cur.op - prev.op : null
  const reasons = dOp === null ? [] : profitReasons(cur, prev)
  const sel = selected ? cur.lines.find((l) => l.key === selected) ?? null : null
  // 2026 잠정(1~M월 + 전망)
  const done = bars.filter((b) => b.rev !== null)
  const yr = period.slice(0, 4)
  const left = 12 - Number(period.slice(5, 7))
  const ytdRev = ytd.byKey.get('rev') ?? null
  const ytdOp = ytd.byKey.get('op') ?? null
  const last3 = monthsOfYear(period).slice(-3).map((p) => computePl(ctx, p)).filter((r) => r.revenue !== null)
  const fRev = ytdRev === null || !last3.length ? null : ytdRev + (last3.reduce((s, r) => s + (r.revenue ?? 0), 0) / last3.length) * left
  const fOp = ytdOp === null || !last3.length ? null : ytdOp + (last3.reduce((s, r) => s + (r.op ?? 0), 0) / last3.length) * left
  const csv = [['과목', '이번 달', '전월', '증감', '올해 누계', '매출 대비'], ...cur.lines.map((l) => [l.label, l.amount ?? '', prevOf(l.key) ?? '', l.amount !== null && prevOf(l.key) !== null ? (l.amount as number) - (prevOf(l.key) as number) : '', ytd.byKey.get(l.key) ?? '', rev ? (((l.amount ?? 0) / rev) * 100).toFixed(1) : ''])]

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.7fr_1fr]">
      <section className="flex min-w-0 flex-col gap-2.5 rounded-[10px] border border-[#e1e6e3] bg-white px-[18px] py-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-[15px] font-bold">
            손익계산서 — {yr}년 {Number(period.slice(5, 7))}월 (단위: 원)
          </h2>
          <div className="flex items-center gap-2 text-[14px] lg:text-[12px] text-[#6b7772]">
            줄을 누르면 계정별 원장의 그 줄로
            <CsvButton rows={csv} fileName={`손익계산서_${period}.csv`} />
          </div>
        </div>
        <div className="-mx-1 overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse tnum" data-testid="pl-table">
            <thead>
              <tr>
                {['과목', '이번 달', '전월', '증감', '올해 누계', '매출 대비'].map((h, i) => (
                  <th key={h} className={`border-b border-[#e1e6e3] px-2 py-1.5 text-[14px] lg:text-[12px] font-medium text-[#6b7772] ${i ? 'text-right' : 'text-left'}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {cur.lines.map((l) => {
                const p = prevOf(l.key)
                const d = l.amount !== null && p !== null ? l.amount - p : null
                const sum = l.level === 'sum'
                const costLike = /^(cogs|sga|nonop-out|tax)/.test(l.key)
                const dTone = d === null || d === 0 || !sum ? '' : (d > 0) !== costLike ? 'text-[#0f6b5c]' : 'text-[#b4432b]'
                const y = ytd.byKey.get(l.key) ?? null
                const share = rev && l.amount !== null && !/open|close/.test(l.key) ? ratio(pct(l.amount, rev)) : ''
                const cls = sum ? 'border-t border-[#d7ddda] bg-[#f7f9f8] font-bold' : 'text-[13px] text-[#6b7772]'
                return (
                  <tr key={l.key} className={`${cls} ${selected === l.key ? 'outline outline-1 outline-[#0f6b5c]' : ''}`}>
                    <td className={`border-b border-[#eef1ef] px-2 py-[7px] whitespace-nowrap ${sum ? 'text-[14px]' : 'pl-7'}`}>
                      {l.codes.length ? (
                        <Link href={hrefFor(l.key)} scroll={false} className="hover:underline">
                          {l.label}
                        </Link>
                      ) : (
                        l.label
                      )}
                    </td>
                    <td className="border-b border-[#eef1ef] px-2 py-[7px] text-right whitespace-nowrap">{won(l.amount)}</td>
                    <td className="border-b border-[#eef1ef] px-2 py-[7px] text-right">{won(p)}</td>
                    <td className={`border-b border-[#eef1ef] px-2 py-[7px] text-right ${dTone}`}>{/open|close/.test(l.key) ? '' : won(d, true)}</td>
                    <td className="border-b border-[#eef1ef] px-2 py-[7px] text-right">{/open|close/.test(l.key) ? '' : won(y)}</td>
                    <td className="border-b border-[#eef1ef] px-2 py-[7px] text-right">{share}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <Note>
          잠정 = 계정별 원장 · 재고금액명세서 · 급여대장 · 대출현황으로 앱이 계산한 값. 세무사 결산(표준재무제표)이 올라오면 «공식»으로 바뀌고 차이가 옆에 표시됩니다.
          {ytd.missing.length ? ` 올해 누계는 ${ytd.missing.map(monthKo).join(' · ')} 자료가 없어 비웠습니다.` : ''}
        </Note>
        {cur.notes.length ? <Note tone="warn">{cur.notes.join(' ')}</Note> : null}
        {ctx.auto && businessId && ctx.months.get(period)?.valuationKnown ? (
          <ValuationEdit
            businessId={businessId}
            period={period}
            canFix={canFix}
            rows={(['wip', 'finished'] as const).map((cat) => {
              const m = ctx.months.get(period)!
              return { cat, label: cat === 'wip' ? '재공품' : '완제품', value: m.valuation[cat], source: m.valuationSource?.[cat] ?? null }
            })}
          />
        ) : null}
        <LedgerLines ctx={ctx} period={period} line={sel} clear={hrefFor(null)} />
      </section>

      <div className="flex min-w-0 flex-col gap-4">
        <section className="flex flex-col gap-2.5 rounded-[10px] border border-[#e1e6e3] bg-white px-[18px] py-4">
          <h2 className="text-[15px] font-bold">월별 흐름 — 올해 1~{Number(period.slice(5, 7))}월</h2>
          <div className="text-[14px] lg:text-[12px] text-[#6b7772]">막대 = 매출 · 위 숫자 = 영업이익률</div>
          <div className="flex h-[150px] items-end gap-1.5 border-b border-[#e1e6e3] px-0.5">
            {bars.map((b, i) => {
              const last = i === bars.length - 1
              return (
                <div key={b.p} className="flex flex-1 flex-col items-center gap-[3px]" title={`${monthKo(b.p)} 매출 ${eok(b.rev)}`}>
                  <div className={`text-[14px] lg:text-[10px] ${last ? 'font-semibold text-[#1a211e]' : 'text-[#6b7772]'}`}>{b.margin === null ? '' : `${b.margin.toFixed(1)}%`}</div>
                  <div className={`w-full rounded-t-[3px] ${last ? 'bg-[#0f6b5c]' : 'bg-[#b9d8d0]'}`} style={{ height: `${b.rev ? Math.max(4, Math.round((b.rev / maxRev) * 120)) : 2}px` }} />
                  <div className={`text-[14px] lg:text-[11px] ${last ? 'font-semibold text-[#1a211e]' : 'text-[#6b7772]'}`}>{Number(b.p.slice(5, 7))}</div>
                </div>
              )
            })}
          </div>
          {done.length < bars.length ? <Note>빈 막대 = 그 달 손익 자료 없음</Note> : null}
        </section>

        <section className="flex flex-col gap-2 rounded-[10px] border border-[#e1e6e3] bg-white px-[18px] py-4">
          <h2 className="text-[15px] font-bold">{dOp === null ? '이번 달 이익 변동 이유' : `이번 달 이익이 ${dOp < 0 ? '줄어든' : '늘어난'} 이유 (전월 대비 ${dOp < 0 ? '−' : '+'}${Math.round(Math.abs(dOp) / 10_000).toLocaleString('ko-KR')}만)`}</h2>
          {reasons.length ? (
            <table className="w-full border-collapse tnum">
              <tbody>
                {reasons.map((r) => (
                  <tr key={r.label}>
                    <td className="border-b border-[#eef1ef] px-2 py-[7px] text-[14px]">{r.label}</td>
                    <td className={`border-b border-[#eef1ef] px-2 py-[7px] text-right text-[14px] ${r.amount < 0 ? 'text-[#b4432b]' : 'text-[#0f6b5c]'}`}>{won(r.amount, true)}</td>
                  </tr>
                ))}
                <tr className="border-t border-[#d7ddda] bg-[#f7f9f8] font-bold">
                  <td className="px-2 py-[7px] text-[14px]">합계</td>
                  <td className={`px-2 py-[7px] text-right text-[14px] ${dOp! < 0 ? 'text-[#b4432b]' : 'text-[#0f6b5c]'}`}>{won(dOp, true)}</td>
                </tr>
              </tbody>
            </table>
          ) : (
            <Lack need="앞 달 손익(계정별 원장)" />
          )}
        </section>

        <section className="flex flex-col gap-2 rounded-[10px] border border-[#e1e6e3] bg-white px-[18px] py-4">
          <h2 className="text-[15px] font-bold">공식 결산과 비교</h2>
          <table className="w-full border-collapse tnum">
            <thead>
              <tr>
                {['연도', '매출 (공식)', '영업이익', '이익률'].map((h, i) => (
                  <th key={h} className={`border-b border-[#e1e6e3] px-2 py-1.5 text-[14px] lg:text-[12px] font-medium text-[#6b7772] ${i ? 'text-right' : 'text-left'}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {officials.slice(-3).map((o) => (
                <tr key={o.year}>
                  <td className="border-b border-[#eef1ef] px-2 py-[7px] text-[14px]">{o.year}</td>
                  <td className="border-b border-[#eef1ef] px-2 py-[7px] text-right text-[14px]">{eok(o.revenue)}</td>
                  <td className="border-b border-[#eef1ef] px-2 py-[7px] text-right text-[14px]">{eok(o.op)}</td>
                  <td className="border-b border-[#eef1ef] px-2 py-[7px] text-right text-[14px]">{ratio(pct(o.op, o.revenue))}</td>
                </tr>
              ))}
              <tr className="bg-[#f8eadf]">
                <td className="px-2 py-[7px] text-[14px]">{yr} 잠정 (1~{Number(period.slice(5, 7))}월 + 전망)</td>
                <td className="px-2 py-[7px] text-right text-[14px]">{eok(fRev, 0)}</td>
                <td className="px-2 py-[7px] text-right text-[14px]">{eok(fOp)}</td>
                <td className="px-2 py-[7px] text-right text-[14px]">{ratio(pct(fOp, fRev))}</td>
              </tr>
            </tbody>
          </table>
          {!officials.length ? <Note>세무사 결산(표준재무제표 PDF)을 올리면 해마다 비교합니다.</Note> : null}
        </section>
      </div>
    </div>
  )
}

/** 영업이익 변동 = 매출 증가 효과 + 원가율 변화 + 판관비 묶음별 변화(합이 정확히 맞는다). */
function profitReasons(cur: ReturnType<typeof computePl>, prev: ReturnType<typeof computePl>): { label: string; amount: number }[] {
  if (cur.revenue === null || prev.revenue === null || !prev.revenue || cur.gross === null || prev.gross === null) return []
  const gmPrev = prev.gross / prev.revenue
  const revEffect = (cur.revenue - prev.revenue) * gmPrev
  const crNow = cur.revenue ? (cur.cogs ?? 0) / cur.revenue : 0
  const crPrev = (prev.cogs ?? 0) / prev.revenue
  const costEffect = -(crNow - crPrev) * cur.revenue
  const out: { label: string; amount: number }[] = []
  out.push({ label: `원가율 변화 (${crNow > crPrev ? '+' : '−'}${Math.abs((crNow - crPrev) * 100).toFixed(1)}p)`, amount: Math.round(costEffect) })
  out.push({ label: `매출 ${cur.revenue >= prev.revenue ? '증가' : '감소'} 효과`, amount: Math.round(revEffect) })
  const groups = cur.lines.filter((l) => l.key.startsWith('sga-'))
  const deltas = groups.map((g) => ({ label: g.label, d: -((g.amount ?? 0) - (prev.lines.find((x) => x.key === g.key)?.amount ?? 0)) }))
  const top = [...deltas].sort((a, b) => Math.abs(b.d) - Math.abs(a.d)).slice(0, 2).filter((x) => Math.abs(x.d) >= 1)
  for (const t of top) out.push({ label: `${t.label} ${t.d < 0 ? '증가' : '감소'}`, amount: Math.round(t.d) })
  const total = (cur.op ?? 0) - (prev.op ?? 0)
  const rest = total - out.reduce((s, x) => s + x.amount, 0)
  if (Math.abs(rest) >= 1) out.push({ label: '기타 (급여 · 경비)', amount: Math.round(rest) })
  return out
}

/** 줄을 누르면 — 그 줄이 묶은 계정의 원장 줄(원장 거래 줄 · 계정별 원장 합계). */
function LedgerLines({ ctx, period, line, clear }: { ctx: Ctx; period: string; line: PlLine | null; clear: string }) {
  if (!line) return null
  const m = ctx.months.get(period)
  const codes = new Set(line.codes)
  const detail = (m?.ledgerLines ?? []).filter((r) => codes.has(String(r.account_code ?? '')))
  const sums = (m?.ledgerSums ?? []).filter((r) => codes.has(String(r.account_code ?? '')))
  return (
    <div id="ledger" className="mt-2 rounded-md border border-[#0f6b5c] px-3 py-2" data-testid="ledger-lines">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="text-[14px] font-semibold">계정별 원장 — {line.label}</div>
        <Link href={clear} scroll={false} className="inline-flex items-center text-[13px] text-[#0f6b5c] hover:underline">
          닫기
        </Link>
      </div>
      {detail.length ? (
        <table className="mt-1 w-full border-collapse text-[13px] tnum">
          <thead>
            <tr>
              {['일자', '계정', '거래처', '적요', '차변', '대변'].map((h, i) => (
                <th key={h} className={`border-b border-[#e1e6e3] px-2 py-1 text-[14px] lg:text-[12px] font-medium text-[#6b7772] ${i >= 4 ? 'text-right' : 'text-left'}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {detail.slice(0, 50).map((r, i) => (
              <tr key={i}>
                <td className="border-b border-[#eef1ef] px-2 py-1">{String(r.tx_date ?? '').slice(5, 10)}</td>
                <td className="border-b border-[#eef1ef] px-2 py-1">{String(r.account_name ?? r.account_code ?? '')}</td>
                <td className="border-b border-[#eef1ef] px-2 py-1">{String(r.counterparty ?? '')}</td>
                <td className="border-b border-[#eef1ef] px-2 py-1">{String(r.memo ?? '')}</td>
                <td className="border-b border-[#eef1ef] px-2 py-1 text-right">{r.debit ? won(Number(r.debit)) : ''}</td>
                <td className="border-b border-[#eef1ef] px-2 py-1 text-right">{r.credit ? won(Number(r.credit)) : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : sums.length ? (
        <table className="mt-1 w-full border-collapse text-[13px] tnum">
          <tbody>
            {sums.map((r, i) => (
              <tr key={i}>
                <td className="border-b border-[#eef1ef] px-2 py-1">{String(r.account_code ?? '')} {String(r.account_name ?? '')}</td>
                <td className="border-b border-[#eef1ef] px-2 py-1 text-right">차변 {won(Number(r.debit ?? 0))}</td>
                <td className="border-b border-[#eef1ef] px-2 py-1 text-right">대변 {won(Number(r.credit ?? 0))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="mt-1 text-[13px] text-[#6b7772]">이 달 원장 줄이 없습니다(장부 전표에서 온 값이면 «전표» 화면에서 봅니다).</div>
      )}
      {detail.length > 50 ? <div className="text-[14px] lg:text-[12px] text-[#6b7772]">앞 50줄만 — 전체는 원장 파일에서</div> : null}
    </div>
  )
}

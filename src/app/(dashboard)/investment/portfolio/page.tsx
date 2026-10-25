import { AccountForm, ApprovalForm, CorpTxForm, PlanForm } from '@/components/investment/forms'
import { LongTermSimulator } from '@/components/investment/long-term-simulator'
import { InvCard, Kpi, NoData, PageTitle, RowLink, StatusBadge, T, Td, Th } from '@/components/investment/ui'
import { eaStore } from '@/lib/approvals/store'
import { kstToday } from '@/lib/chairman-project'
import { day, krw, krwEok, pct, seoulDateTime, usd } from '@/lib/investment/format'
import { financeLink } from '@/lib/investment/finance-link'
import { latestPrice } from '@/lib/investment/metrics'
import { monthlyPlan, paperSummary, realSummary } from '@/lib/investment/portfolio'
import { investmentViewer } from '@/lib/investment/screen'
import type { InvPrice } from '@/lib/investment/types'

export const dynamic = 'force-dynamic'

const FLOW = ['대양산업 영업현금흐름', '세금 · 차입금 · 운전자금 · 설비투자 확보', '확정된 잉여현금', '일정 비율 장기 적립', 'DY 장기투자 계정'] as const

/** 7. DY Portfolio(원문 12) — 법인 장기투자. Real(손 입력)과 Paper(가상)를 섞지 않는다. 자동 주문 없음. */
export default async function PortfolioPage() {
  const { repo, admin, user } = await investmentViewer()
  const [settings, accounts, approvals, txs, paperPfs, paperTxs, securities, fin] = await Promise.all([
    repo.invSettings(),
    repo.invAccounts(),
    repo.invApprovals(),
    repo.invCorpTxs(),
    repo.invPaperPortfolios(),
    repo.invPaperTxs(),
    repo.invSecurities(),
    financeLink(repo),
  ])
  const people = admin ? await (await eaStore()).people().catch(() => []) : []
  const sec = (id: string | null) => securities.find((s) => s.security_id === id)
  const fxSec = securities.find((s) => s.kind === 'fx' && s.ticker === 'USDKRW')
  const ids = [...new Set([...txs.map((t) => t.security_id), ...paperTxs.map((t) => t.security_id)].filter(Boolean))] as string[]
  const priceMap = new Map<string, InvPrice[]>()
  await Promise.all([...ids, ...(fxSec ? [fxSec.security_id] : [])].map(async (id) => priceMap.set(id, await repo.invPrices(id))))
  const fxNow = fxSec ? (latestPrice(priceMap.get(fxSec.security_id) ?? [])?.value ?? null) : null
  const today = kstToday()
  const real = realSummary(
    txs,
    (id) => {
      const p = latestPrice(priceMap.get(id) ?? [])
      return p ? { price: p.value, currency: sec(id)?.currency ?? 'USD', as_of: p.as_of } : null
    },
    fxNow,
    today,
  )
  const paper = paperSummary(paperTxs, (id) => (priceMap.get(id) ?? []).slice().sort((a, b) => a.d.localeCompare(b.d)).at(-1) ?? null)
  const plan = monthlyPlan(settings.monthly_budget_krw, { equity: settings.alloc_equity_pct, bond: settings.alloc_bond_pct, cash: settings.alloc_cash_pct })
  const etfs = securities.filter((s) => s.kind === 'etf').map((s) => ({ id: s.security_id, label: `${s.ticker ?? ''} — ${s.name}` }))
  const allSec = securities.filter((s) => s.kind !== 'fx').sort((a, b) => (a.ticker ?? a.name).localeCompare(b.ticker ?? b.name)).map((s) => ({ id: s.security_id, label: `${s.ticker ?? '—'} — ${s.name}` }))
  const approved = approvals.filter((a) => a.status === 'approved').map((a) => ({ id: a.approval_id, label: `${a.doc_no ?? a.title} · ${krw(a.amount_krw)} · ${a.approver_name ?? ''}` }))

  return (
    <div className="flex flex-col gap-4">
      <PageTitle title="DY Portfolio" sub="대양산업(DAE YANG Industry) 법인 장기투자 — 개인 계좌와 섞지 않는다 · AI가 실제 주문을 내지 않는다" />

      <InvCard title="잉여현금 → 장기 적립" sub="영업현금흐름에서 세금 · 차입금 · 운전자금 · 설비투자를 먼저 확보하고, 남는 현금의 일정 비율만 장기투자 계정으로">
        <ol className="flex flex-col items-stretch gap-1 sm:flex-row sm:flex-wrap sm:items-center">
          {FLOW.map((f, i) => (
            <li key={f} className="flex items-center gap-1">
              <span className={`rounded-lg border px-3 py-2 text-[14px] ${i === 2 ? 'border-accent bg-accent/10 font-semibold' : 'border-line-soft bg-raised'}`}>
                {f}
                {i === 2 ? <span className="block text-[13px] font-normal text-ink-muted">재무 지표 12 «투자 여력»: {fin.k12?.value ?? '—'}</span> : null}
              </span>
              {i < FLOW.length - 1 ? <span className="text-ink-muted" aria-hidden>→</span> : null}
            </li>
          ))}
        </ol>
        <p className="text-[14px]">DY 장기투자 계정 → 글로벌 주식 · 글로벌 채권 · 규칙에 따른 제한적 인출 → 수익 재투자</p>
        <p className="text-[13px] text-ink-muted">
          <StatusBadge status={fin.status} /> 재무(/finance) 읽기 전용 — 지표 8 «자금 전망» {fin.k8?.value ?? '—'}{fin.k8?.aside ? ` (${fin.k8.aside})` : ''} · 지표 12 «투자 여력» {fin.k12?.value ?? '—'}{fin.note ? ` · ${fin.note}` : ''}
        </p>
      </InvCard>

      <InvCard title="자금 4영역" sub="A~C는 투자 금지 · D만 투자 가능 금액(재무에서 읽음)">
        <div className="grid gap-3 sm:grid-cols-2">
          {[
            { k: 'A. 운영자금', d: '원료 구매 · 급여 · 물류 · 세금 · 매입채무 · 차입금', v: fin.operating, note: '향후 3개월 평균 지출(재무 자금 전망)', ban: true },
            { k: 'B. 유동성 준비금', d: '매출 감소 · 원료 가격 급등 · 고객 결제 지연 대비', v: fin.reserve, note: '재무 안전 잔액', ban: true },
            { k: 'C. 전략사업 자금', d: '베트남 공장 · 설비증설 · M&A · 보증금 · 인수 후 운영자금', v: null, note: '재무에 이 칸이 없음 — UNAVAILABLE', ban: true },
            { k: 'D. 장기투자 자산', d: '앞의 세 영역을 보호한 뒤 남는 현금에서 적립 — DY Capital Fund', v: fin.investable, note: '지표 12 투자 여력(양수만)', ban: false },
          ].map((x) => (
            <div key={x.k} className={`rounded-lg border p-3 ${x.ban ? 'border-line-soft' : 'border-ok/50 bg-ok/5'}`}>
              <div className="text-[16px] font-bold">{x.k}</div>
              <div className="text-[13px] text-ink-muted">{x.d}</div>
              <div className="mt-1 text-[18px] font-semibold tnum">{x.v === null ? 'DATA NOT AVAILABLE' : krwEok(x.v)}</div>
              <div className="flex flex-wrap items-center gap-1 text-[13px] text-ink-muted">{x.ban ? <span className="rounded-full bg-raised px-2">투자 금지</span> : <span className="rounded-full bg-ok/15 px-2 text-ok">DY Capital Fund</span>}{x.note}</div>
            </div>
          ))}
        </div>
      </InvCard>

      <div className="grid min-w-0 gap-4 xl:grid-cols-2">
        <InvCard title="월 투자 계획" sub={`월 ${krw(settings.monthly_budget_krw)} · Global Equity ETF ${settings.alloc_equity_pct}% · Investment-Grade Bond ETF ${settings.alloc_bond_pct}% · 현금 ${settings.alloc_cash_pct}% — 초기 계획이며 자동매매 승인이 아니다`}>
          <T minWidth={380}>
            <thead><tr><Th>자산</Th><Th n>비중</Th><Th n>월 금액</Th><Th n>연 금액</Th><Th>ETF</Th></tr></thead>
            <tbody>
              <tr><Td>Global Equity ETF</Td><Td n>{settings.alloc_equity_pct}%</Td><Td n>{krw(plan.equity)}</Td><Td n>{krw(plan.equity * 12)}</Td><Td>{sec(settings.plan_equity_security ?? null)?.ticker ?? '미선택'}</Td></tr>
              <tr><Td>Investment-Grade Bond ETF</Td><Td n>{settings.alloc_bond_pct}%</Td><Td n>{krw(plan.bond)}</Td><Td n>{krw(plan.bond * 12)}</Td><Td>{sec(settings.plan_bond_security ?? null)?.ticker ?? '미선택'}</Td></tr>
              <tr><Td>Cash / Short-Term Reserve</Td><Td n>{settings.alloc_cash_pct}%</Td><Td n>{krw(plan.cash)}</Td><Td n>{krw(plan.cash * 12)}</Td><Td>—</Td></tr>
            </tbody>
          </T>
          {admin ? <PlanForm securities={etfs} equity={settings.plan_equity_security ?? null} bond={settings.plan_bond_security ?? null} /> : null}
        </InvCard>
        <InvCard title="DY 장기투자 시뮬레이터" sub="가정 계산 — 예측이 아니다">
          <LongTermSimulator />
        </InvCard>
      </div>

      <InvCard title="Real Portfolio" sub="대양산업 법인 명의 증권계좌의 실제 자산 — 사람이 증권사에서 매매하고 여기 손으로 적는다(덧붙이기만 · 정정은 «정정» 줄)">
        {accounts.length === 0 ? <NoData need="등록된 법인 계좌가 없습니다 — 계좌를 먼저 등록하고 월 100만 원 입금을 적습니다." /> : (
          <p className="text-[14px]">{accounts.map((a) => `${a.name} · ${a.broker}${a.account_last4 ? ` ****${a.account_last4}` : ''} · ${a.owner_entity}`).join(' / ')}</p>
        )}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Kpi label="누적 투자원금" value={krw(real.deposits - real.withdrawals)} sub={`입금 ${krw(real.deposits)} · 인출 ${krw(real.withdrawals)}`} />
          <Kpi label="현재 평가금액" value={real.marketValue === null ? 'NEED DATA' : krw(real.marketValue)} sub={real.missingPrices.length ? `가격 없는 종목 ${real.missingPrices.length}` : `현금 ${krw(real.cash)}`} />
          <Kpi label="총수익률" value={pct(real.totalReturnPct, 2, true)} sub={`연복리(XIRR) ${pct(real.cagrPct, 2, true)}`} tone={(real.totalReturnPct ?? 0) >= 0 ? 'ok' : 'bad'} />
          <Kpi label="실현 · 미실현 손익" value={`${krw(real.realized)}`} sub={`미실현 ${real.unrealized === null ? '—' : krw(real.unrealized)}`} />
          <Kpi label="배당수익" value={krw(real.dividends)} />
          <Kpi label="환차손익" value={real.fxPnl === null ? '—' : krw(real.fxPnl)} sub={fxNow ? `USD/KRW ${fxNow.toFixed(2)}` : '환율 없음'} />
          <Kpi label="거래비용 · 세금" value={krw(real.fees)} sub={`세금 ${krw(real.taxes)}`} />
          <Kpi label="Benchmark 대비" value="NEED DATA" sub="벤치마크(ACWI) 일별 가격 — TWELVEDATA_API_KEY" />
        </div>
        {real.allocation.length ? (
          <T minWidth={420}>
            <thead><tr><Th>자산</Th><Th n>평가금액</Th><Th n>비중</Th></tr></thead>
            <tbody>{real.allocation.map((a) => <tr key={a.security_id}><Td>{a.security_id === 'cash' ? '현금' : (sec(a.security_id)?.ticker ?? a.security_id)}</Td><Td n>{krw(a.valueKrw)}</Td><Td n>{pct(a.pct)}</Td></tr>)}</tbody>
          </T>
        ) : null}
        {txs.length ? (
          <T minWidth={860}>
            <thead><tr><Th>거래일</Th><Th>종류</Th><Th>종목</Th><Th n>수량</Th><Th n>가격</Th><Th n>원화 금액</Th><Th n>비용 · 세금</Th><Th>승인자 · 승인 시각</Th><Th>메모</Th></tr></thead>
            <tbody>
              {[...txs].reverse().map((t) => (
                <tr key={t.tx_id}>
                  <Td>{day(t.trade_date)}</Td><Td>{t.kind}</Td><Td>{sec(t.security_id)?.ticker ?? '—'}</Td><Td n>{t.shares ?? '—'}</Td><Td n>{t.price ?? '—'} {t.price ? t.currency : ''}</Td><Td n>{krw(t.amount_krw)}</Td><Td n>{krw(t.fees_krw + t.tax_krw)}</Td>
                  <Td>{t.approved_by_name ? `${t.approved_by_name} · ${seoulDateTime(t.approved_at)}` : '—'}</Td><Td className="max-w-[200px] truncate">{t.note ?? ''}</Td>
                </tr>
              ))}
            </tbody>
          </T>
        ) : null}
        {admin ? (
          <>
            <AccountForm />
            {accounts.length ? <CorpTxForm accounts={accounts.map((a) => ({ id: a.account_id, label: `${a.name} · ${a.broker}` }))} securities={allSec} approvals={approved} /> : null}
          </>
        ) : null}
      </InvCard>

      <InvCard title="투자 승인" sub="전자결재 양식 «투자 승인» 하나 — 매수 · 매도는 승인된 결재가 있어야 적힌다(승인자 · 승인 시각이 거래 줄에 남는다)">
        {approvals.length === 0 ? <NoData need="올린 투자 승인이 없습니다." /> : (
          <T minWidth={640}>
            <thead><tr><Th>문서</Th><Th>구분</Th><Th n>금액</Th><Th>상태</Th><Th>승인자 · 시각</Th></tr></thead>
            <tbody>
              {approvals.map((a) => (
                <tr key={a.approval_id}>
                  <Td><RowLink href={`/e-approval?doc=${a.ea_doc_id}`}>{a.doc_no ?? a.title}</RowLink></Td>
                  <Td>{a.kind === 'monthly_plan' ? '월 정기 적립' : a.kind === 'trade' ? `개별 ${a.side === 'sell' ? '매도' : '매수'}` : '계획 변경'}</Td>
                  <Td n>{krw(a.amount_krw)}</Td>
                  <Td>{a.status ?? '—'}</Td>
                  <Td>{a.approver_name ? `${a.approver_name} · ${seoulDateTime(a.decided_at ?? null)}` : '—'}</Td>
                </tr>
              ))}
            </tbody>
          </T>
        )}
        <ApprovalForm chairman={user.role === 'Chairman'} people={people.filter((p) => p.user_id !== user.user_id).map((p) => ({ id: p.user_id, name: `${p.name}${p.dept ? ` · ${p.dept}` : ''}` }))} securities={allSec} />
      </InvCard>

      <InvCard title="Research / Paper Portfolio" sub={paperPfs[0]?.rule ?? 'AI 추천 검증용 가상 포트폴리오 — 실제 돈 없음'}>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Kpi label="가상 투입(USD)" value={usd(paper.invested, 0)} />
          <Kpi label="실현 손익" value={usd(paper.realized, 0)} />
          <Kpi label="평가 손익" value={paper.unrealized === null ? '—' : usd(paper.unrealized, 0)} />
          <Kpi label="수익률" value={pct(paper.returnPct, 2, true)} />
        </div>
        {paper.rows.length === 0 ? <NoData need="가상 매매가 아직 없습니다 — 추천이 WATCH · BUY ZONE이 되고 그 다음 가격이 들어오면 시작됩니다." /> : (
          <T minWidth={560}>
            <thead><tr><Th>종목</Th><Th n>보유</Th><Th n>원가</Th><Th n>평가</Th><Th>가격 기준</Th></tr></thead>
            <tbody>{paper.rows.map((r) => <tr key={r.security_id}><Td>{sec(r.security_id)?.ticker ?? r.security_id}</Td><Td n>{r.shares.toFixed(2)}</Td><Td n>{usd(r.cost, 0)}</Td><Td n>{r.value === null ? '—' : usd(r.value, 0)}</Td><Td>{r.lastPrice ? `${r.lastPrice.d} ${r.lastPrice.source === 'sec13f_implied' ? '13F 분기말' : '일별'}` : '—'}</Td></tr>)}</tbody>
          </T>
        )}
        <p className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-[14px]">6개월 Paper 성과가 좋아도 개별 종목 투자를 자동으로 확대하지 않는다 — 규모 확대는 대표가 투자 승인 결재로 정한다.</p>
        <p className="text-[13px] text-ink-muted">Real과 Paper의 성과는 섞지 않는다 · 신호(추천 생성) 다음 날 이후 가격으로만 가상 매매한다.</p>
      </InvCard>
    </div>
  )
}

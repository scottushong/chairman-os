'use client'

import { useActionState, useState, useTransition } from 'react'

import {
  investmentAddAccount,
  investmentAddCorpTx,
  investmentRequestApproval,
  investmentSavePlan,
  investmentSetFailureCause,
  investmentAddMarketData,
  investmentAddMetric,
  investmentAddScore,
  investmentAddSplit,
  investmentAddThesis,
  investmentAiReasons,
  investmentCollectNow,
  investmentManualHoldings,
  investmentMarkAlertRead,
  investmentRunAnalysis,
  investmentSaveScenario,
  investmentSaveSettings,
  investmentSaveWeights,
  investmentSetMarket,
  investmentSetWatch,
  type ActionResult,
} from '@/app/actions/investment'

/** 대표 손 입력 폼들(0094) — 출처 주소 · 기준일 필수. 결과 한 줄을 폼 아래에 그대로 보여 준다. */

const INPUT = 'min-h-11 min-w-0 max-w-full rounded-lg border border-line-soft bg-panel px-3 text-[14px] text-ink lg:min-h-9'
const BTN = 'inline-flex min-h-11 items-center justify-center rounded-lg bg-accent px-4 text-[14px] font-semibold text-on-accent disabled:opacity-50 lg:min-h-9'

function Msg({ r }: { r: ActionResult | null }) {
  if (!r) return null
  return <p className={`text-[13px] ${r.ok ? 'text-ok' : 'text-critical'}`}>{r.message}</p>
}

export function CollectNowButton() {
  const [pending, start] = useTransition()
  const [r, setR] = useState<ActionResult | null>(null)
  return (
    <div className="flex flex-col gap-1">
      <button type="button" className={BTN} disabled={pending} onClick={() => start(async () => setR(await investmentCollectNow()))}>
        {pending ? '수집 중… (최대 4분)' : '지금 수집'}
      </button>
      <Msg r={r} />
    </div>
  )
}

export function WatchToggle({ securityId, watch }: { securityId: string; watch: boolean }) {
  const [pending, start] = useTransition()
  const [reason, setReason] = useState('')
  const [r, setR] = useState<ActionResult | null>(null)
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input className={`${INPUT} w-56`} placeholder={watch ? '해제 사유(선택)' : '관심 사유'} value={reason} onChange={(e) => setReason(e.target.value)} aria-label="사유" />
      <button type="button" className={BTN} disabled={pending} onClick={() => start(async () => setR(await investmentSetWatch(securityId, !watch, reason)))}>
        {watch ? '관심 해제' : '관심 지정'}
      </button>
      <Msg r={r} />
    </div>
  )
}

export function SplitForm({ securityId }: { securityId: string }) {
  const [r, action, pending] = useActionState(investmentAddSplit, null)
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="security_id" value={securityId} />
      <div className="grid gap-2 sm:grid-cols-3">
        <input className={INPUT} name="ex_date" placeholder="분할 기준일 YYYY-MM-DD" aria-label="분할 기준일" />
        <input className={INPUT} name="ratio" placeholder="비율(2:1 → 2)" aria-label="비율" />
        <input className={INPUT} name="source_url" placeholder="출처 https://…" aria-label="출처" />
      </div>
      <div><button className={BTN} disabled={pending}>분할 기록</button></div>
      <Msg r={r} />
    </form>
  )
}

export function MetricForm({ securityId }: { securityId: string }) {
  const [r, action, pending] = useActionState(investmentAddMetric, null)
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="security_id" value={securityId} />
      <div className="grid gap-2 sm:grid-cols-4">
        <select className={INPUT} name="metric" aria-label="지표" defaultValue="expense_ratio">
          <option value="expense_ratio">총보수(%)</option>
          <option value="aum_usd">순자산 AUM(USD)</option>
          <option value="tracking_error">추적오차(%)</option>
          <option value="distribution_yield">분배금 수익률(%)</option>
          <option value="etf_return_1y">ETF 1년 수익률(%)</option>
          <option value="index_return_1y">기초지수 1년 수익률(%)</option>
        </select>
        <input className={INPUT} name="value" placeholder="값" aria-label="값" />
        <input className={INPUT} name="as_of" placeholder="기준일 YYYY-MM-DD" aria-label="기준일" />
        <input className={INPUT} name="source_url" placeholder="운용사 출처 https://…" aria-label="출처" />
      </div>
      <div><button className={BTN} disabled={pending}>저장</button></div>
      <Msg r={r} />
    </form>
  )
}

export function ManualHoldingsForm() {
  const [r, action, pending] = useActionState(investmentManualHoldings, null)
  return (
    <form action={action} className="flex flex-col gap-2">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <select className={INPUT} name="source_id" aria-label="자료" defaultValue="fundsmith:factsheet">
          <option value="fundsmith:factsheet">Fundsmith 월간 Factsheet</option>
          <option value="pershing:site">Pershing Square 공식 사이트</option>
        </select>
        <input className={INPUT} name="data_as_of" placeholder="자료 기준일 YYYY-MM-DD" aria-label="자료 기준일" />
        <input className={INPUT} name="source_published_at" placeholder="공개일 YYYY-MM-DD(모르면 비움)" aria-label="공개일" />
        <input className={INPUT} name="source_url" placeholder="출처 https://…" aria-label="출처" />
      </div>
      <textarea className={`${INPUT} min-h-32 py-2 font-mono`} name="rows" placeholder={'줄마다: 이름 | 티커 | 비중% | 주식 수(없으면 비움)\nMicrosoft | MSFT | 8.2 |\nMeta Platforms | META | 7.1 |'} aria-label="보유 줄" />
      <div><button className={BTN} disabled={pending}>저장</button></div>
      <Msg r={r} />
    </form>
  )
}

export function SettingsForm({ limit, quality, budget }: { limit: number; quality: number; budget: number }) {
  const [r, action, pending] = useActionState(investmentSaveSettings, null)
  return (
    <form action={action} className="flex flex-col gap-2">
      <div className="grid gap-2 sm:grid-cols-3">
        <label className="flex flex-col gap-1 text-[13px] text-ink-muted">하루 외부 호출 한도<input className={INPUT} name="collect_daily_limit" defaultValue={limit} /></label>
        <label className="flex flex-col gap-1 text-[13px] text-ink-muted">BUY 최소 데이터 품질(0~100)<input className={INPUT} name="data_quality_min" defaultValue={quality} /></label>
        <label className="flex flex-col gap-1 text-[13px] text-ink-muted">월 투자 예정액(원)<input className={INPUT} name="monthly_budget_krw" defaultValue={budget} /></label>
      </div>
      <div><button className={BTN} disabled={pending}>설정 저장</button></div>
      <Msg r={r} />
    </form>
  )
}

// ── 0095 ──

const ASSUMPTION_LABEL: Record<string, string> = {
  fcf_per_share: 'FCF/주($)',
  fcf_cagr: 'FCF 성장률(%)',
  exit_multiple: '미래 P/FCF(배)',
  required_return: '요구수익률(%)',
  margin_of_safety: '안전마진(%)',
}

export interface ScenarioDefaults {
  fcf_per_share: { value: number | null; source_url: string | null; as_of: string | null; quality: number | null }
}

export function ScenarioForm({ securityId, defaults }: { securityId: string; defaults: ScenarioDefaults }) {
  const [r, action, pending] = useActionState(investmentSaveScenario, null)
  const pre: Record<string, { value: string; source: string; as_of: string; quality: string }> = {
    fcf_per_share: { value: defaults.fcf_per_share.value?.toFixed(2) ?? '', source: defaults.fcf_per_share.source_url ?? '', as_of: defaults.fcf_per_share.as_of ?? '', quality: String(defaults.fcf_per_share.quality ?? '') },
    fcf_cagr: { value: '', source: '', as_of: '', quality: '' },
    exit_multiple: { value: '', source: '', as_of: '', quality: '' },
    required_return: { value: '12', source: '', as_of: '', quality: '' },
    margin_of_safety: { value: '20', source: '', as_of: '', quality: '' },
  }
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="security_id" value={securityId} />
      <div className="grid gap-2 sm:grid-cols-3">
        <select className={INPUT} name="scenario" defaultValue="base" aria-label="시나리오">
          <option value="bear">Bear</option>
          <option value="base">Base</option>
          <option value="bull">Bull</option>
        </select>
        <input className={INPUT} name="years" defaultValue="5" aria-label="기간(년)" placeholder="기간(년)" />
        <input className={INPUT} name="probability" placeholder="확률 %(대표 판단 · 선택)" aria-label="확률" />
      </div>
      {Object.keys(ASSUMPTION_LABEL).map((k) => (
        <div key={k} className="grid gap-2 sm:grid-cols-[150px_100px_minmax(0,1fr)_140px_90px] sm:items-center">
          <span className="text-[13px] text-ink-dim">{ASSUMPTION_LABEL[k]}</span>
          <input className={INPUT} name={`${k}_value`} defaultValue={pre[k].value} aria-label={`${ASSUMPTION_LABEL[k]} 값`} />
          <input className={INPUT} name={`${k}_source`} defaultValue={pre[k].source} placeholder="출처 https://…" aria-label={`${ASSUMPTION_LABEL[k]} 출처`} />
          <input className={INPUT} name={`${k}_as_of`} defaultValue={pre[k].as_of} placeholder="기준일" aria-label={`${ASSUMPTION_LABEL[k]} 기준일`} />
          <input className={INPUT} name={`${k}_quality`} defaultValue={pre[k].quality} placeholder="품질" aria-label={`${ASSUMPTION_LABEL[k]} 품질`} />
        </div>
      ))}
      <div className="grid gap-2 sm:grid-cols-2">
        <input className={INPUT} name="premise" placeholder="주요 전제" aria-label="주요 전제" />
        <input className={INPUT} name="risk" placeholder="전제가 틀릴 경우의 위험" aria-label="위험" />
      </div>
      <p className="text-[13px] text-ink-muted">가정마다 출처 · 기준일 · 품질(0~100)이 있어야 BUY 조건을 통과합니다. 저장은 새 버전 줄 — 이전 값은 지워지지 않습니다.</p>
      <div><button className={BTN} disabled={pending}>시나리오 저장</button></div>
      <Msg r={r} />
    </form>
  )
}

export function ScoreForm({ subjectType, subjectId, factors }: { subjectType: 'market' | 'company'; subjectId: string; factors: { key: string; label: string }[] }) {
  const [r, action, pending] = useActionState(investmentAddScore, null)
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="subject_type" value={subjectType} />
      <input type="hidden" name="subject_id" value={subjectId} />
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_100px]">
        <select className={INPUT} name="factor" aria-label="요소">
          {factors.map((f) => (
            <option key={f.key} value={f.key}>{f.label}</option>
          ))}
        </select>
        <input className={INPUT} name="score" placeholder="0~100" aria-label="점수" />
      </div>
      <input className={INPUT} name="evidence" placeholder="근거(숫자 · 자료)" aria-label="근거" />
      <div className="grid gap-2 sm:grid-cols-2">
        <input className={INPUT} name="source_url" placeholder="출처 https://…(있으면 품질 80)" aria-label="출처" />
        <input className={INPUT} name="as_of" placeholder="기준일 YYYY-MM-DD" aria-label="기준일" />
      </div>
      <div><button className={BTN} disabled={pending}>대표 판단 저장</button></div>
      <Msg r={r} />
    </form>
  )
}

export function ThesisForm({ securityId, managers }: { securityId: string; managers: { id: string; name: string }[] }) {
  const [r, action, pending] = useActionState(investmentAddThesis, null)
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="security_id" value={securityId} />
      <div className="grid gap-2 sm:grid-cols-4">
        <select className={INPUT} name="kind" defaultValue="company" aria-label="종류">
          <option value="company">투자 가설</option>
          <option value="manager_reason">기관 보유 이유</option>
          <option value="invalidation">가설 훼손 조건</option>
        </select>
        <select className={INPUT} name="classification" defaultValue="HYPOTHESIS" aria-label="분류">
          <option value="CONFIRMED">CONFIRMED(공식 문서)</option>
          <option value="INFERRED">INFERRED</option>
          <option value="HYPOTHESIS">HYPOTHESIS</option>
          <option value="UNKNOWN">UNKNOWN</option>
        </select>
        <select className={INPUT} name="manager_id" defaultValue="" aria-label="기관">
          <option value="">기관 없음</option>
          {managers.map((m) => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </select>
        <select className={INPUT} name="state" defaultValue="active" aria-label="상태">
          <option value="active">유효</option>
          <option value="broken">훼손됨(THESIS BROKEN)</option>
        </select>
      </div>
      <input className={INPUT} name="statement" placeholder="가설 문장" aria-label="가설" />
      <div className="grid gap-2 sm:grid-cols-2">
        <input className={INPUT} name="source_url" placeholder="출처 https://…" aria-label="출처" />
        <input className={INPUT} name="document_date" placeholder="문서 기준일 YYYY-MM-DD" aria-label="문서 기준일" />
      </div>
      <textarea className={`${INPUT} min-h-20 py-2`} name="evidence" placeholder={'근거 줄마다: 항목 | 값 | 출처 https://… | 기준일\nFCF 마진 | 24% | https://www.sec.gov/... | 2025-12-31'} aria-label="근거" />
      <div><button className={BTN} disabled={pending}>가설 저장</button></div>
      <Msg r={r} />
    </form>
  )
}

export function MarketDataForm({ marketId }: { marketId: string }) {
  const [r, action, pending] = useActionState(investmentAddMarketData, null)
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="market_id" value={marketId} />
      <div className="grid gap-2 sm:grid-cols-4">
        <input className={INPUT} name="publisher" placeholder="발행처" aria-label="발행처" />
        <input className={INPUT} name="title" placeholder="자료 제목" aria-label="제목" />
        <input className={INPUT} name="url" placeholder="출처 https://…" aria-label="출처" />
        <input className={INPUT} name="published_date" placeholder="발표일 YYYY-MM-DD" aria-label="발표일" />
      </div>
      <div className="grid gap-2 sm:grid-cols-6">
        <select className={INPUT} name="metric" defaultValue="market_size" aria-label="지표">
          <option value="market_size">시장 규모</option>
          <option value="cagr">CAGR</option>
          <option value="historical_growth">과거 성장</option>
          <option value="adoption">채택률</option>
          <option value="penetration">침투율</option>
          <option value="unit_cost">단위원가</option>
          <option value="profit_pool">이익 규모</option>
          <option value="other">기타</option>
        </select>
        <input className={INPUT} name="label" placeholder="지표 이름" aria-label="지표 이름" />
        <input className={INPUT} name="year" placeholder="연도" aria-label="연도" />
        <input className={INPUT} name="value" placeholder="값" aria-label="값" />
        <input className={INPUT} name="unit" placeholder="단위" aria-label="단위" />
        <select className={INPUT} name="kind" defaultValue="forecast" aria-label="실측 · 전망">
          <option value="actual">실측</option>
          <option value="forecast">전망</option>
        </select>
      </div>
      <div><button className={BTN} disabled={pending}>출처와 함께 저장</button></div>
      <Msg r={r} />
    </form>
  )
}

export function MarketSelect({ securityId, current, markets }: { securityId: string; current: string | null; markets: { id: string; name: string }[] }) {
  const [pending, start] = useTransition()
  const [r, setR] = useState<ActionResult | null>(null)
  return (
    <div className="flex flex-wrap items-center gap-2">
      <select className={INPUT} defaultValue={current ?? ''} aria-label="산업" disabled={pending} onChange={(e) => start(async () => setR(await investmentSetMarket(securityId, e.target.value || null)))}>
        <option value="">산업 지정 없음</option>
        {markets.map((m) => (
          <option key={m.id} value={m.id}>{m.name}</option>
        ))}
      </select>
      <Msg r={r} />
    </div>
  )
}

export function RunAnalysisButton() {
  const [pending, start] = useTransition()
  const [r, setR] = useState<ActionResult | null>(null)
  return (
    <div className="flex flex-col gap-1">
      <button type="button" className={BTN} disabled={pending} onClick={() => start(async () => setR(await investmentRunAnalysis()))}>
        {pending ? '분석 중…' : '지금 분석'}
      </button>
      <Msg r={r} />
    </div>
  )
}

export function AiReasonsButton({ securityId, managerId, label }: { securityId: string; managerId: string; label: string }) {
  const [pending, start] = useTransition()
  const [r, setR] = useState<ActionResult | null>(null)
  return (
    <div className="flex flex-col gap-1">
      <button type="button" className="inline-flex min-h-11 items-center rounded-lg border border-line-soft px-3 text-[13px] lg:min-h-9" disabled={pending} onClick={() => start(async () => setR(await investmentAiReasons(securityId, managerId as never)))}>
        {pending ? 'AI 추론 중…' : label}
      </button>
      <Msg r={r} />
    </div>
  )
}

export function AlertReadButton({ alertId }: { alertId: number }) {
  const [pending, start] = useTransition()
  const [done, setDone] = useState(false)
  return (
    <button type="button" disabled={pending || done} onClick={() => start(async () => setDone((await investmentMarkAlertRead(alertId)).ok))} className="inline-flex min-h-11 items-center rounded px-2 text-[13px] text-ink-muted hover:text-ink lg:min-h-7">
      {done ? '읽음' : '읽음 표시'}
    </button>
  )
}

export function WeightsForm({ weights }: { weights: Record<string, number> }) {
  const [r, action, pending] = useActionState(investmentSaveWeights, null)
  const groups: [string, string[]][] = [
    ['Market Score', ['w_market_demand', 'w_market_profit', 'w_market_adoption', 'w_market_bottleneck', 'w_market_durability']],
    ['Leader Score', ['w_leader_share', 'w_leader_moat', 'w_leader_cash', 'w_leader_balance', 'w_leader_mgmt']],
    ['Opportunity', ['w_opp_market', 'w_opp_leader', 'w_opp_valuation', 'w_opp_inst']],
  ]
  return (
    <form action={action} className="flex flex-col gap-2">
      {groups.map(([title, keys]) => (
        <fieldset key={title} className="flex flex-wrap items-center gap-2">
          <legend className="mb-1 text-[13px] font-semibold text-ink-dim">{title}(합 100)</legend>
          {keys.map((k) => (
            <label key={k} className="flex items-center gap-1 text-[13px] text-ink-muted">
              {k.replace(/^w_(market|leader|opp)_/, '')}
              <input className={`${INPUT} w-20`} name={k} defaultValue={weights[k]} />
            </label>
          ))}
        </fieldset>
      ))}
      <div><button className={BTN} disabled={pending}>가중치 저장</button></div>
      <Msg r={r} />
    </form>
  )
}

// ── 0096 ──

export function ApprovalForm({ chairman, people, securities }: { chairman: boolean; people: { id: string; name: string }[]; securities: { id: string; label: string }[] }) {
  const [r, action, pending] = useActionState(investmentRequestApproval, null)
  return (
    <form action={action} className="flex flex-col gap-2">
      <div className="grid gap-2 sm:grid-cols-4">
        <select className={INPUT} name="kind" defaultValue="monthly_plan" aria-label="구분">
          <option value="monthly_plan">월 정기 적립</option>
          <option value="trade">개별 매매</option>
          <option value="plan_change">계획 변경</option>
        </select>
        <select className={INPUT} name="side" defaultValue="" aria-label="매수 · 매도">
          <option value="">매수/매도(개별 매매만)</option>
          <option value="buy">매수</option>
          <option value="sell">매도</option>
        </select>
        <select className={INPUT} name="security_id" defaultValue="" aria-label="종목">
          <option value="">종목(개별 매매만)</option>
          {securities.map((s) => (
            <option key={s.id} value={s.id}>{s.label}</option>
          ))}
        </select>
        <input className={INPUT} name="amount_krw" placeholder="금액(원)" aria-label="금액" />
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <input className={INPUT} name="title" placeholder="제목(예: 2026-11 정기 적립 100만 원)" aria-label="제목" />
        <input className={INPUT} name="target" placeholder="대상(종목 · ETF · 계좌)" aria-label="대상" />
      </div>
      <textarea className={`${INPUT} min-h-20 py-2`} name="rationale" placeholder="근거 — 추천 버전 · 매수 기준가 · 출처 · 자산배분 계획" aria-label="근거" />
      {chairman ? (
        <select className={INPUT} name="approver" defaultValue="" aria-label="승인자">
          <option value="">승인자(대표 본인 문서는 본인이 결재할 수 없음)</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      ) : (
        <p className="text-[13px] text-ink-muted">결재선: 대표 승인</p>
      )}
      <div><button className={BTN} disabled={pending}>투자 승인 결재 올리기</button></div>
      <Msg r={r} />
    </form>
  )
}

export function AccountForm() {
  const [r, action, pending] = useActionState(investmentAddAccount, null)
  return (
    <form action={action} className="grid gap-2 sm:grid-cols-5">
      <input className={INPUT} name="name" placeholder="계좌 이름" aria-label="계좌 이름" />
      <input className={INPUT} name="broker" placeholder="증권사" aria-label="증권사" />
      <input className={INPUT} name="account_last4" placeholder="번호 끝 4자리" aria-label="끝 4자리" />
      <input className={INPUT} name="opened_at" placeholder="개설일 YYYY-MM-DD" aria-label="개설일" />
      <button className={BTN} disabled={pending}>계좌 등록</button>
      <div className="sm:col-span-5"><Msg r={r} /></div>
    </form>
  )
}

export function CorpTxForm({ accounts, securities, approvals }: { accounts: { id: string; label: string }[]; securities: { id: string; label: string }[]; approvals: { id: string; label: string }[] }) {
  const [r, action, pending] = useActionState(investmentAddCorpTx, null)
  return (
    <form action={action} className="flex flex-col gap-2">
      <div className="grid gap-2 sm:grid-cols-4">
        <select className={INPUT} name="account_id" aria-label="계좌">
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>{a.label}</option>
          ))}
        </select>
        <select className={INPUT} name="kind" defaultValue="deposit" aria-label="종류">
          <option value="deposit">입금(월 적립)</option>
          <option value="buy">매수</option>
          <option value="sell">매도</option>
          <option value="dividend">배당 · 분배금</option>
          <option value="fee">수수료</option>
          <option value="tax">세금</option>
          <option value="withdraw">인출</option>
          <option value="adjust">정정</option>
        </select>
        <input className={INPUT} name="trade_date" placeholder="거래일 YYYY-MM-DD" aria-label="거래일" />
        <select className={INPUT} name="approval_id" defaultValue="" aria-label="승인 결재">
          <option value="">승인 결재(매수 · 매도만)</option>
          {approvals.map((a) => (
            <option key={a.id} value={a.id}>{a.label}</option>
          ))}
        </select>
      </div>
      <div className="grid gap-2 sm:grid-cols-4">
        <select className={INPUT} name="security_id" defaultValue="" aria-label="종목">
          <option value="">종목(매수 · 매도 · 배당)</option>
          {securities.map((s) => (
            <option key={s.id} value={s.id}>{s.label}</option>
          ))}
        </select>
        <input className={INPUT} name="shares" placeholder="수량" aria-label="수량" />
        <input className={INPUT} name="price" placeholder="가격(그 통화)" aria-label="가격" />
        <input className={INPUT} name="currency" placeholder="통화 KRW · USD" defaultValue="KRW" aria-label="통화" />
      </div>
      <div className="grid gap-2 sm:grid-cols-4">
        <input className={INPUT} name="fx_rate" placeholder="환율(1단위 = 원, 외화만)" aria-label="환율" />
        <input className={INPUT} name="amount" placeholder="금액(입금 · 배당 등)" aria-label="금액" />
        <input className={INPUT} name="fees_krw" placeholder="수수료(원)" aria-label="수수료" />
        <input className={INPUT} name="tax_krw" placeholder="세금(원)" aria-label="세금" />
      </div>
      <input className={INPUT} name="note" placeholder="메모(정정은 사유 필수)" aria-label="메모" />
      <div><button className={BTN} disabled={pending}>거래 적기</button></div>
      <Msg r={r} />
    </form>
  )
}

export function PlanForm({ securities, equity, bond }: { securities: { id: string; label: string }[]; equity: string | null; bond: string | null }) {
  const [r, action, pending] = useActionState(investmentSavePlan, null)
  return (
    <form action={action} className="grid gap-2 sm:grid-cols-3">
      <select className={INPUT} name="plan_equity_security" defaultValue={equity ?? ''} aria-label="Global Equity ETF">
        <option value="">Global Equity ETF 고르기</option>
        {securities.map((s) => (
          <option key={s.id} value={s.id}>{s.label}</option>
        ))}
      </select>
      <select className={INPUT} name="plan_bond_security" defaultValue={bond ?? ''} aria-label="Investment-Grade Bond ETF">
        <option value="">Investment-Grade Bond ETF 고르기</option>
        {securities.map((s) => (
          <option key={s.id} value={s.id}>{s.label}</option>
        ))}
      </select>
      <button className={BTN} disabled={pending}>계획 ETF 저장</button>
      <div className="sm:col-span-3"><Msg r={r} /></div>
    </form>
  )
}

export function FailureCauseForm({ outcomeId, suggested }: { outcomeId: number; suggested: string | null }) {
  const [r, action, pending] = useActionState(investmentSetFailureCause, null)
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="outcome_id" value={outcomeId} />
      <select className={INPUT} name="failure_cause" defaultValue={suggested ?? ''} aria-label="실패 원인">
        <option value="">원인 고르기</option>
        <option value="market_forecast">1. 산업 성장 전망 오류</option>
        <option value="competitiveness">2. 기업 경쟁력 전망 오류</option>
        <option value="earnings_cashflow">3. 실적 · 현금흐름 전망 오류</option>
        <option value="buy_price_overestimated">4. 매수가 과대평가</option>
        <option value="multiple_contraction">5. 밸류에이션 배수 축소</option>
        <option value="macro">6. 거시경제 변화</option>
        <option value="fx">7. 환율 변동</option>
        <option value="data_error">8. 데이터 오류</option>
        <option value="thesis_broken">9. 투자 가설 훼손</option>
      </select>
      <button className={BTN} disabled={pending}>원인 기록</button>
      <Msg r={r} />
    </form>
  )
}

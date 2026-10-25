'use client'

import { useActionState, useState, useTransition } from 'react'

import {
  investmentAddMetric,
  investmentAddSplit,
  investmentCollectNow,
  investmentManualHoldings,
  investmentSaveSettings,
  investmentSetWatch,
  type ActionResult,
} from '@/app/actions/investment'

/** 대표 손 입력 폼들(0094) — 출처 주소 · 기준일 필수. 결과 한 줄을 폼 아래에 그대로 보여 준다. */

const INPUT = 'min-h-11 rounded-lg border border-line-soft bg-panel px-3 text-[14px] text-ink lg:min-h-9'
const BTN = 'inline-flex min-h-11 items-center justify-center rounded-lg bg-accent px-4 text-[14px] font-semibold text-white disabled:opacity-50 lg:min-h-9'

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

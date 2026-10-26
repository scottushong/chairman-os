'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

import { saveAutoFix } from '@/app/actions/finance-auto'
import { AUTO_RULE_KO, type AutoDecision } from '@/lib/finance-overview/auto-types'

/**
 * 0091 «자동으로 정한 것 N건 ›» — /finance 위 한 줄. 누르면 목록(규칙 · 근거 · 고치기). 0건이면 그리지 않는다.
 * 판단 · 확인 단추는 없다 — 시스템이 이미 정했다. 틀렸을 때만 고친다(장부를 쓰는 사람). 다른 사람은 읽기만.
 */
export function AutoList({ decisions, businessId, canFix, upload }: { decisions: AutoDecision[]; businessId: string; canFix: boolean; upload: string }) {
  if (!decisions.length) return null
  const fixed = decisions.filter((d) => d.state !== 'auto').length
  return (
    <details className="rounded-[10px] border border-line bg-card px-[18px] py-2.5" data-testid="auto-list">
      <summary className="cursor-pointer list-none text-[14px] text-ink [&::-webkit-details-marker]:hidden">
        <span className="font-semibold">자동으로 정한 것 {decisions.length}건 ›</span>
        {fixed ? <span className="ml-2 text-[13px] text-ink-muted">(사람이 고친 것 {fixed})</span> : null}
      </summary>
      <ul className="mt-2 flex flex-col">
        {decisions.map((d) => (
          <Row key={d.id} d={d} businessId={businessId} canFix={canFix} upload={upload} />
        ))}
      </ul>
      <div className="mt-2 text-[14px] lg:text-[12px] text-ink-muted">틀리면 파일을 빼거나(⑦ 이번 달 자료의 «빼기») 여기서 숫자 · 달을 고칩니다. 원장 원본은 바뀌지 않습니다.</div>
    </details>
  )
}

const addMonths = (p: string, n: number) => {
  const d = new Date(Date.UTC(Number(p.slice(0, 4)), Number(p.slice(5, 7)) - 1 + n, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}
const when = (iso: string) => new Date(Date.parse(iso) + 9 * 3_600_000).toISOString().slice(5, 16).replace('T', ' ')
const prevText = (p: Record<string, unknown> | null) =>
  p
    ? Object.values(p)
        .filter((v) => v !== null && v !== '')
        .map((v) => (typeof v === 'number' ? `${Math.round(v).toLocaleString('ko-KR')}` : String(v)))
        .join(' · ')
    : ''

function Row({ d, businessId, canFix, upload }: { d: AutoDecision; businessId: string; canFix: boolean; upload: string }) {
  const router = useRouter()
  const [busy, start] = useTransition()
  const [msg, setMsg] = useState<string | null>(null)
  const [amount, setAmount] = useState(d.value === null || d.value === undefined ? '' : String(d.value))
  const [month, setMonth] = useState(d.months?.[0] ?? d.period)
  const send = (action: string, value?: unknown) =>
    start(async () => {
      const prev = d.rule === 'valuation' ? { 값: d.value ?? null, 출처: d.title.match(/\[(.+)\]$/)?.[1] ?? null } : d.rule === 'period' ? { 달: (d.months ?? []).join(',') || null } : { 상태: d.state === 'off' ? '되살림' : '제외' }
      const r = await saveAutoFix({ businessId, rule: d.rule, key: d.key, period: d.period, action, value, prev })
      setMsg(r.error ?? '고쳤습니다 — 다시 계산했습니다.')
      if (r.ok) router.refresh()
    })
  const btn = 'min-h-11 lg:min-h-8 rounded-md border border-line bg-card px-2.5 text-[13px] text-accent hover:border-accent disabled:opacity-50'
  const choices = d.from ? Array.from({ length: 25 }, (_, i) => addMonths(d.from!, i - 12)) : []
  return (
    <li className="flex flex-col gap-1 border-t border-line-soft py-2 first:border-t-0" data-testid={`auto-${d.rule}`}>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="rounded-full bg-accent-soft px-2 py-[1px] text-[12px] font-semibold text-accent">{AUTO_RULE_KO[d.rule]}</span>
        <span className="text-[14px] text-ink">{d.title}</span>
        {d.state !== 'auto' && d.fix ? (
          <span className="text-[12px] text-warning">
            {d.state === 'off' ? '원래대로' : '고침'} — {d.fix.by ?? '누군가'} · {when(d.fix.at)}
            {prevText(d.fix.prev) ? ` · 전값 ${prevText(d.fix.prev)}` : ''}
          </span>
        ) : null}
      </div>
      <div className="text-[14px] lg:text-[12px] text-ink-muted">근거: {d.basis}</div>
      {canFix ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {d.rule === 'valuation' ? (
            <>
              <input aria-label="금액" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} className="min-h-11 lg:min-h-8 w-36 rounded-md border border-line px-2 text-right text-[13px] tnum" />
              <button type="button" disabled={busy} className={btn} onClick={() => send('value', amount)}>
                값 고치기
              </button>
            </>
          ) : null}
          {d.rule === 'period' ? (
            <>
              <select aria-label="귀속 달" value={month} onChange={(e) => setMonth(e.target.value)} className="min-h-11 lg:min-h-8 rounded-md border border-line bg-card px-2 text-[13px]">
                {choices.map((p) => (
                  <option key={p} value={p}>
                    {p.slice(0, 4)}년 {Number(p.slice(5, 7))}월
                  </option>
                ))}
              </select>
              <button type="button" disabled={busy} className={btn} onClick={() => send('month', month)}>
                달 고치기
              </button>
              {d.state !== 'off' ? (
                <button type="button" disabled={busy} className={btn} onClick={() => send('keep_date')}>
                  전표 날짜로 되돌리기
                </button>
              ) : null}
            </>
          ) : null}
          {d.rule === 'duplicate' && d.state === 'auto' ? (
            <button type="button" disabled={busy} className={btn} onClick={() => send('restore')}>
              되살리기
            </button>
          ) : null}
          {d.rule === 'loan' ? (
            <Link href={upload} className={`${btn} inline-flex items-center`}>
              대출현황 올리기
            </Link>
          ) : null}
          {d.state !== 'auto' && d.rule !== 'loan' ? (
            <button type="button" disabled={busy} className={btn} onClick={() => send('auto')}>
              자동으로 돌리기
            </button>
          ) : null}
          {msg ? (
            <span role="status" className="text-[13px] text-ink-muted">
              {msg}
            </span>
          ) : null}
        </div>
      ) : null}
    </li>
  )
}

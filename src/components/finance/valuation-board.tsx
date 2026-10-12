'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

import { bulkDecideIssue, confirmValuation, saveOpening, saveValuation, voidValuation } from '@/app/actions/finance-v21'
import { CATEGORY_KO, ISSUE_CHOICE_KO, OPENING_SOURCE_KO, SCOPE_KO, STATE_KO, STATUS_KO, WITHHELD_KO, won } from '@/lib/finance-upload/v21-text'
import type { FinInventoryRollRow, FinIssueSummary, FinValuation, FinValuationWarning, ValueState } from '@/types'

/**
 * 0072 «재고 · 평가» 화면 몸통 — 재공품 · 완제품 평가금액(입력 · 잠정 · 확정) · 기초재고 연결 · 원료 출고 구분.
 * 값은 고치지 않는다: 차이는 보여 주기만 하고, 빈칸은 «미입력»으로 둔다. 확정은 입력한 사람이 아닌 사람만(DB도 거부).
 * 원료 출고는 합계(fin_issue_summary)만 — 원료별 kg · 제품별 투입 · 배합 비율은 어디에도 없다.
 * 직원 화면에도 선다 — «회장»이 아니라 «대표 · CFO».
 */

const inputCls = 'mt-0.5 block w-full min-w-0 rounded-md border border-line bg-panel px-2 py-1.5 text-t12h text-ink'
const labelCls = 'min-w-0 text-t10h text-ink-muted'

function Amount({ amount, state }: { amount: number | null; state: ValueState | null }) {
  if (state === 'missing' || state === null) return <span className="rounded bg-raised px-1.5 py-0.5 text-t10 text-ink-muted">{STATE_KO.missing}</span>
  return (
    <span className="tnum">
      {won(amount)} <span className="text-t10 text-ink-muted">{STATE_KO[state]}</span>
    </span>
  )
}

/* ───────────────────────── 평가금액 ───────────────────────── */

export function ValuationSection({
  businessId,
  businessName,
  month,
  rows,
  warnings,
  viewerId,
  viewerName,
}: {
  businessId: string
  businessName: string
  month: string
  rows: FinValuation[]
  warnings: FinValuationWarning[]
  viewerId: string
  viewerName: string
}) {
  const live = rows.filter((r) => !r.voided_at)
  const voided = rows.filter((r) => r.voided_at)
  return (
    <section className="rounded-xl border border-line-soft bg-panel p-3" aria-labelledby="val-h">
      <h2 id="val-h" className="text-t13 font-semibold">재공품 · 완제품 평가금액 · {month}</h2>
      <p className="mt-0.5 text-t10h text-ink-muted">입력 중 → 잠정 → 확정. 확정은 입력한 사람이 아닌 장부 담당이 합니다. 바꾸면 지우지 않고 옛 줄을 무효로 남깁니다.</p>
      {warnings.length ? (
        <ul className="mt-2 space-y-1" aria-label="평가금액 경고">
          {warnings.map((w, i) => (
            <li key={i} className="rounded-md border border-gold/40 bg-gold/10 px-2 py-1 text-t11h">
              <span className="font-semibold text-gold">{w.message}</span>
              {w.kind === 'scope_mismatch' && w.detail ? (
                <span className="text-ink-dim">
                  {' '}— {CATEGORY_KO[w.category] ?? w.category}: 기초(앞 달 {String(w.detail.prev_period ?? '')}) {SCOPE_KO[String(w.detail.opening_scope)] ?? '—'} · 기말 {SCOPE_KO[String(w.detail.closing_scope)] ?? '—'}. 고치지 않고 보여 주기만 합니다.
                </span>
              ) : (
                <span className="text-ink-dim"> — 같은 출처에서 같은 금액입니다. 한쪽이 잘못 들어갔는지 보세요.</span>
              )}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="mt-2 grid gap-2 lg:grid-cols-2">
        {(['wip', 'finished'] as const).map((c) => {
          const r = live.find((x) => x.category === c)
          return r ? <ValuationCard key={c} r={r} businessId={businessId} businessName={businessName} viewerId={viewerId} /> : (
            <div key={c} className="rounded-lg border border-dashed border-line px-3 py-2 text-t11h text-ink-muted">
              {CATEGORY_KO[c]} — 이 달 평가금액이 없습니다(미입력).
            </div>
          )
        })}
      </div>
      {voided.length ? (
        <details className="mt-2">
          <summary className="cursor-pointer text-t11h text-ink-dim">무효 · 바뀐 줄 {voided.length}</summary>
          <ul className="mt-1 divide-y divide-line-soft text-t11h">
            {voided.map((r) => (
              <li key={r.valuation_id} className="flex flex-wrap gap-2 py-1 text-ink-dim">
                <span>{CATEGORY_KO[r.category]}</span>
                <Amount amount={r.amount} state={r.value_state} />
                <span>{STATUS_KO[r.status]}</span>
                <span>무효 이유: {r.void_reason}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      <ValuationForm businessId={businessId} businessName={businessName} month={month} viewerName={viewerName} />
    </section>
  )
}

function ValuationCard({ r, businessId, businessName, viewerId }: { r: FinValuation; businessId: string; businessName: string; viewerId: string }) {
  const router = useRouter()
  const [reason, setReason] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, start] = useTransition()
  const mine = r.entered_by === viewerId
  const who = (id: string | null, name: string | null) => (id === null ? '—' : id === viewerId ? `나${name ? `(${name})` : ''}` : (name ?? '다른 장부 담당'))
  return (
    <article className={`rounded-lg border px-3 py-2 ${r.status === 'final' ? 'border-ok/40' : 'border-line'}`} data-testid={`valuation-${r.category}`}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-t12 font-semibold">{CATEGORY_KO[r.category]}</h3>
        <span className={`rounded px-1.5 py-0.5 text-t10 font-semibold ${r.status === 'final' ? 'bg-ok/15 text-ok' : r.status === 'provisional' ? 'bg-gold/15 text-gold' : 'bg-raised text-ink-dim'}`}>{STATUS_KO[r.status]}</span>
        <span className="ml-auto"><Amount amount={r.amount} state={r.value_state} /></span>
      </div>
      <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-t11h">
        <dt className="text-ink-muted">회사 · 월</dt><dd className="min-w-0">{businessName} · {r.period}</dd>
        <dt className="text-ink-muted">평가 기준일</dt><dd>{r.valuation_date ?? '—'}</dd>
        <dt className="text-ink-muted">평가방법</dt><dd className="min-w-0 break-words">{r.method ?? '—'}</dd>
        <dt className="text-ink-muted">포함 원가 범위</dt><dd>{SCOPE_KO[r.cost_scope]}</dd>
        <dt className="text-ink-muted">출처</dt><dd className="min-w-0 break-words">{r.source === 'manual' ? '직접 입력' : r.source === 'excel' ? '엑셀' : 'PDF'}{r.source_ref ? ` · ${r.source_ref}` : ''}</dd>
        <dt className="text-ink-muted">입력자</dt><dd>{who(r.entered_by, r.entered_by_name)}</dd>
        <dt className="text-ink-muted">확인자</dt><dd>{who(r.confirmed_by, r.confirmed_by_name)}</dd>
        {r.note ? (<><dt className="text-ink-muted">비고</dt><dd className="min-w-0 break-words">{r.note}</dd></>) : null}
      </dl>
      {r.status !== 'final' ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="이유(무효 · 마감 달은 필수)" aria-label="이유" className="min-w-0 flex-1 rounded-md border border-line bg-panel px-2 py-1.5 text-t12h" />
          {mine ? (
            <span className="text-t10h text-ink-muted" data-testid="self-confirm-note">입력한 사람은 확정할 수 없습니다 — 다른 장부 담당이 확정합니다.</span>
          ) : (
            <button
              type="button"
              disabled={busy || r.value_state === 'missing'}
              title={r.value_state === 'missing' ? '«미입력»은 확정할 수 없습니다' : undefined}
              onClick={() =>
                start(async () => {
                  const x = await confirmValuation(r.valuation_id, businessId, reason)
                  setMsg(x.error ?? '확정했습니다.')
                  if (x.ok) router.refresh()
                })
              }
              className="min-h-9 rounded-md bg-accent px-3 text-t11h font-semibold text-white disabled:opacity-40"
            >
              확정
            </button>
          )}
          <button
            type="button"
            disabled={busy || reason.trim().length < 2}
            onClick={() =>
              start(async () => {
                const x = await voidValuation(r.valuation_id, businessId, reason)
                setMsg(x.error ?? '무효로 했습니다(지우지 않음).')
                if (x.ok) router.refresh()
              })
            }
            className="min-h-9 rounded-md border border-line px-3 text-t11h text-ink-dim hover:border-critical hover:text-critical disabled:opacity-40"
          >
            무효
          </button>
        </div>
      ) : null}
      {msg ? <p role="status" className="mt-1 text-t10h">{msg}</p> : null}
    </article>
  )
}

function ValuationForm({ businessId, businessName, month, viewerName }: { businessId: string; businessName: string; month: string; viewerName: string }) {
  const router = useRouter()
  const [f, setF] = useState({ period: month, category: 'wip', amount: '', valuationDate: '', method: '월 가중평균', costScope: 'material_labor_overhead', sourceRef: '', note: '', status: 'provisional', reason: '' })
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, start] = useTransition()
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }))
  return (
    <details className="mt-3 rounded-lg border border-line-soft px-3 py-2">
      <summary className="cursor-pointer text-t12 font-semibold">평가금액 넣기 · 바꾸기(직접 입력)</summary>
      <p className="mt-1 text-t10h text-ink-muted">엑셀은 «회계 · 재무 자료 올리기»에 놓으면 «⑮ 재공품 · 완제품 평가»로 들어갑니다(잠정). 금액을 비우면 «미입력», 0을 적으면 «확인된 0»입니다.</p>
      <div className="mt-2 grid gap-2 sm:grid-cols-3 lg:grid-cols-4">
        <label className={labelCls}>회사<input value={businessName} readOnly className={`${inputCls} bg-raised`} /></label>
        <label className={labelCls}>월<input type="month" value={f.period} onChange={set('period')} className={inputCls} /></label>
        <label className={labelCls}>
          구분
          <select value={f.category} onChange={set('category')} className={inputCls}>
            <option value="wip">재공품</option>
            <option value="finished">완제품</option>
          </select>
        </label>
        <label className={labelCls}>금액(원)<input inputMode="decimal" value={f.amount} onChange={set('amount')} placeholder="비우면 미입력" className={inputCls} /></label>
        <label className={labelCls}>평가 기준일<input type="date" value={f.valuationDate} onChange={set('valuationDate')} className={inputCls} /></label>
        <label className={labelCls}>평가방법<input value={f.method} onChange={set('method')} maxLength={60} className={inputCls} /></label>
        <label className={labelCls}>
          포함 원가 범위
          <select value={f.costScope} onChange={set('costScope')} className={inputCls}>
            <option value="material_only">재료비만</option>
            <option value="material_labor_overhead">재료비 + 노무비 + 경비</option>
          </select>
        </label>
        <label className={labelCls}>출처<input value="직접 입력" readOnly className={`${inputCls} bg-raised`} /></label>
        <label className={labelCls}>출처 줄(예: 평가표 3쪽)<input value={f.sourceRef} onChange={set('sourceRef')} maxLength={120} className={inputCls} /></label>
        <label className={labelCls}>입력자<input value={viewerName} readOnly className={`${inputCls} bg-raised`} /></label>
        <label className={labelCls}>확인자<input value="확정할 때 다른 사람" readOnly className={`${inputCls} bg-raised`} /></label>
        <label className={labelCls}>
          상태
          <select value={f.status} onChange={set('status')} className={inputCls}>
            <option value="entering">입력 중</option>
            <option value="provisional">잠정</option>
          </select>
        </label>
        <label className={`${labelCls} sm:col-span-2`}>비고<input value={f.note} onChange={set('note')} maxLength={500} className={inputCls} /></label>
        <label className={`${labelCls} sm:col-span-2`}>이유(확정된 값을 바꾸거나 마감 달이면 필수)<input value={f.reason} onChange={set('reason')} maxLength={500} className={inputCls} /></label>
      </div>
      <button
        type="button"
        disabled={busy}
        onClick={() =>
          start(async () => {
            const r = await saveValuation({ businessId, ...f })
            setMsg(r.error ?? '저장했습니다.')
            if (r.ok) router.refresh()
          })
        }
        className="mt-2 min-h-10 rounded-md bg-accent px-4 text-t12 font-semibold text-white disabled:opacity-40"
      >
        {busy ? '저장 중…' : '저장'}
      </button>
      {msg ? <p role="status" className="mt-1 text-t11h">{msg}</p> : null}
    </details>
  )
}

/* ───────────────────────── 기초재고 연결 ───────────────────────── */

export function RollSection({ businessId, month, rows }: { businessId: string; month: string; rows: FinInventoryRollRow[] }) {
  const needsOpening = rows.some((r) => r.opening_source !== 'prev_close')
  return (
    <section className="rounded-xl border border-line-soft bg-panel p-3" aria-labelledby="roll-h">
      <h2 id="roll-h" className="text-t13 font-semibold">기초재고 연결 · {month}</h2>
      <p className="mt-0.5 text-t10h text-ink-muted">기초 = 앞 달 확정 기말. 없으면 첫 달 직접 입력, 그것도 없으면 «미연결». 명세서 기초와 앞 달 기말이 다르면 차이만 보여 주고 고치지 않습니다.</p>
      {rows.length === 0 ? <p className="mt-2 text-t11h text-ink-muted">아직 준비 중입니다(0072 반영 전).</p> : (
        <div className="mt-2 overflow-x-auto rounded-md border border-line-soft">
          <table className="w-full min-w-[560px] text-t11">
            <thead className="bg-raised">
              <tr>
                <th className="px-2 py-1 text-left font-medium text-ink-muted">구분</th>
                <th className="px-2 py-1 text-left font-medium text-ink-muted">기초</th>
                <th className="px-2 py-1 text-left font-medium text-ink-muted">기초 출처</th>
                <th className="px-2 py-1 text-left font-medium text-ink-muted">기말</th>
                <th className="px-2 py-1 text-left font-medium text-ink-muted">명세서 기초 · 차이</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.category} className="border-t border-line-soft" data-testid={`roll-${r.category}`}>
                  <td className="px-2 py-1 font-semibold">{CATEGORY_KO[r.category]}</td>
                  <td className="px-2 py-1"><Amount amount={r.opening_amount} state={r.opening_state} /></td>
                  <td className="px-2 py-1">
                    <span className={`rounded px-1.5 py-0.5 text-t10 font-semibold ${r.opening_source === 'unlinked' ? 'bg-critical/10 text-critical' : r.opening_source === 'prev_close' ? 'bg-ok/15 text-ok' : 'bg-gold/15 text-gold'}`}>{OPENING_SOURCE_KO[r.opening_source]}</span>
                  </td>
                  <td className="px-2 py-1">
                    <Amount amount={r.closing_amount} state={r.closing_state} />
                    {r.closing_status ? <span className="ml-1 text-t10 text-ink-muted">{STATUS_KO[r.closing_status]}</span> : null}
                    {r.missing_lines > 0 ? <span className="block text-t10 text-gold">빈칸 {r.missing_lines}줄은 더하지 않았습니다(미입력).</span> : null}
                  </td>
                  <td className="px-2 py-1">
                    {r.category !== 'raw' ? <span className="text-ink-muted">—</span> : r.statement_opening === null ? <span className="text-t10 text-ink-muted">명세서 기초 {STATE_KO.missing}</span> : (
                      <>
                        <span className="tnum">{won(r.statement_opening)}</span>
                        {r.diff_vs_prev_close !== null && Math.abs(r.diff_vs_prev_close) >= 1 ? (
                          <span className="ml-1 rounded bg-critical/10 px-1.5 py-0.5 text-t10 font-semibold text-critical tnum">차이 {r.diff_vs_prev_close > 0 ? '+' : ''}{won(r.diff_vs_prev_close)}</span>
                        ) : r.diff_vs_prev_close !== null ? <span className="ml-1 text-t10 text-ok">앞 달 기말과 같음</span> : null}
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {needsOpening ? <OpeningForm businessId={businessId} month={month} categories={rows.filter((r) => r.opening_source !== 'prev_close').map((r) => r.category)} /> : null}
    </section>
  )
}

function OpeningForm({ businessId, month, categories }: { businessId: string; month: string; categories: FinInventoryRollRow['category'][] }) {
  const router = useRouter()
  const [f, setF] = useState({ category: categories[0] ?? 'raw', amount: '', source: '', note: '' })
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, start] = useTransition()
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }))
  return (
    <details className="mt-3 rounded-lg border border-line-soft px-3 py-2">
      <summary className="cursor-pointer text-t12 font-semibold">첫 달 기초 넣기(앞 달 확정 기말이 없을 때만 쓰입니다)</summary>
      <div className="mt-2 grid gap-2 sm:grid-cols-4">
        <label className={labelCls}>
          구분
          <select value={f.category} onChange={set('category')} className={inputCls}>
            {categories.map((c) => <option key={c} value={c}>{CATEGORY_KO[c]}</option>)}
          </select>
        </label>
        <label className={labelCls}>기초 금액(원)<input inputMode="decimal" value={f.amount} onChange={set('amount')} placeholder="비우면 미입력" className={inputCls} /></label>
        <label className={labelCls}>
          출처(필수)
          <select value={f.source} onChange={set('source')} className={inputCls}>
            <option value="">고르세요</option>
            <option value="manual">직접 입력</option>
            <option value="statement">재고금액명세서</option>
          </select>
        </label>
        <label className={labelCls}>이유 · 출처 설명(필수)<input value={f.note} onChange={set('note')} maxLength={500} className={inputCls} /></label>
      </div>
      <button
        type="button"
        disabled={busy || !f.source || f.note.trim().length < 2}
        onClick={() =>
          start(async () => {
            const r = await saveOpening({ businessId, period: month, ...f })
            setMsg(r.error ?? '저장했습니다.')
            if (r.ok) router.refresh()
          })
        }
        className="mt-2 min-h-10 rounded-md bg-accent px-4 text-t12 font-semibold text-white disabled:opacity-40"
      >
        저장
      </button>
      {msg ? <p role="status" className="mt-1 text-t11h">{msg}</p> : null}
    </details>
  )
}

/* ───────────────────────── 원료 출고 구분 ───────────────────────── */

export function IssueSection({ businessId, month, summary }: { businessId: string; month: string; summary: FinIssueSummary | null }) {
  return (
    <section className="rounded-xl border border-line-soft bg-panel p-3" aria-labelledby="iss-h">
      <h2 id="iss-h" className="text-t13 font-semibold">원료 출고 구분 · {month}</h2>
      <p className="mt-0.5 text-t10h text-ink-muted">출고 유형 · 적요 · 창고로 «생산 투입 · 비생산(샘플 · 폐기 · 반품 · 이동 · 조정)»을 나눕니다. 규칙에 맞지 않으면 «확인 필요» — 생산 투입이 기본값이 아닙니다. 원료별 양은 보이지 않습니다(합계만).</p>
      {!summary ? <p className="mt-2 text-t11h text-ink-muted">이 달 원료 출고명세가 없거나 아직 준비 중입니다.</p> : (
        <div className="mt-2 grid gap-3 lg:grid-cols-[1fr_minmax(0,22rem)]">
          <div className="min-w-0">
            <p className="text-t11h text-ink-dim tnum">줄 수 — 생산 투입 {summary.lines.production} · 비생산 {summary.lines.non_production} · 확인 필요 {summary.lines.needs_review}</p>
            {summary.needs_review.length ? (
              <ul className="mt-2 space-y-2">
                {summary.needs_review.map((m) => <IssueRow key={m.material} businessId={businessId} month={month} material={m.material} lines={m.lines} />)}
              </ul>
            ) : <p className="mt-2 text-t11h text-ok">«확인 필요» 줄이 없습니다.</p>}
          </div>
          <aside className="rounded-lg border border-line px-3 py-2" aria-label="생산 투입 합계와 생산수량" data-testid="issue-summary">
            <h3 className="text-t12 font-semibold">생산 투입 합계 · 생산수량</h3>
            <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-t11h">
              <dt className="text-ink-muted">생산 투입 kg 합계</dt>
              <dd className="tnum">{summary.production_input_kg === null ? <span className="text-gold">보류</span> : `${summary.production_input_kg.toLocaleString('ko-KR')} kg(100kg 단위)`}</dd>
              <dt className="text-ink-muted">생산수량 kg</dt>
              <dd className="tnum">{summary.production_qty_kg === null ? STATE_KO.missing : `${summary.production_qty_kg.toLocaleString('ko-KR')} kg`}</dd>
            </dl>
            {summary.input_withheld ? <p className="mt-1 text-t10h text-ink-dim">{WITHHELD_KO[summary.input_withheld]}</p> : null}
            {summary.input_missing_lines > 0 ? <p className="mt-1 text-t10h text-gold">kg 칸이 빈 생산 투입 {summary.input_missing_lines}줄은 더하지 않았습니다(미입력).</p> : null}
          </aside>
        </div>
      )}
    </section>
  )
}

function IssueRow({ businessId, month, material, lines }: { businessId: string; month: string; material: string; lines: number }) {
  const router = useRouter()
  const [choice, setChoice] = useState('')
  const [reason, setReason] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, start] = useTransition()
  return (
    <li className="rounded-lg border border-gold/40 px-2.5 py-2">
      <div className="flex flex-wrap items-center gap-2 text-t11h">
        <span className="font-semibold">{material}</span>
        <span className="rounded bg-gold/15 px-1.5 py-0.5 text-t10 font-semibold text-gold tnum">확인 필요 {lines}줄</span>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        <select value={choice} onChange={(e) => setChoice(e.target.value)} aria-label={`${material} 구분`} className="min-h-9 rounded-md border border-line bg-panel px-2 text-t12h">
          <option value="">구분 고르기</option>
          {Object.entries(ISSUE_CHOICE_KO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} placeholder="이유(필수)" aria-label="이유" className="min-w-0 flex-1 rounded-md border border-line bg-panel px-2 py-1.5 text-t12h" />
        <button
          type="button"
          disabled={busy || !choice || reason.trim().length < 2}
          onClick={() =>
            start(async () => {
              const r = await bulkDecideIssue({ businessId, period: month, material, choice, reason })
              setMsg(r.error ?? `${r.n ?? 0}줄을 정했습니다.`)
              if (r.ok) router.refresh()
            })
          }
          className="min-h-9 rounded-md bg-accent px-3 text-t11h font-semibold text-white disabled:opacity-40"
        >
          한꺼번에 정하기
        </button>
      </div>
      {msg ? <p role="status" className="mt-1 text-t10h">{msg}</p> : null}
    </li>
  )
}

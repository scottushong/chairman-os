'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

import { decidePlAdjustment, proposePlAdjustment, recordMonthlyPl, reopenMonthlyPl, savePlSettings } from '@/app/actions/monthly-pl'
import { ADJ_KIND_KO, ADJ_STATUS_KO, REVENUE_SOURCE_KO, VIEW_STATUS_KO, wonOrMissing } from '@/lib/monthly-pl/text'
import type { MonthlyPlView, PlAdjustmentKind, PlSettings } from '@/types'

/**
 * PlClosePanel — 재무 현황 «손익계산서» 탭 아래(/finance?tab=pl) · 0075 «월별 손익 — 재고 반영»의 내부 마감 확정 · 재고 조정 제안 · 설정(평가방법 · 허용오차 · 매출 원천 · 원료 대금 항목).
 * (2026-10-20 A5 — 예전 /finance/<회사>/monthly 화면 아래 패널에서 옮김. 손익 · 원가 근거 · 자금 참고 표시는 손익계산서 탭이 대신한다 — 그 부분은 지웠다.)
 * 숫자는 DB가 계산한 것을 그대로 그린다. 권한은 예전 그대로(잠정 저장 · 조정 제안 = 장부 쓰기 · 확정 · 조정 승인 = 마감 권한 · 다시 열기 · 설정 = 대표 · 그룹 CFO).
 * 직원 화면에도 선다 — «대표»라고 쓴다.
 */
export function PlClosePanel({
  businessId,
  period,
  view,
  error,
  settings,
  canKeep,
  canClose,
  isTop,
}: {
  businessId: string
  period: string
  view: MonthlyPlView | null
  error: string | null
  settings: PlSettings | null
  canKeep: boolean
  canClose: boolean
  isTop: boolean
}) {
  return (
    <section className="rounded-[10px] border border-[#e1e6e3] bg-white px-[18px] py-3" aria-labelledby="pl-close-h" data-testid="pl-close">
      <h2 id="pl-close-h" className="text-[15px] font-bold">
        내부 마감 · 재고 조정 · 설정 — {period.slice(0, 4)}년 {Number(period.slice(5, 7))}월
      </h2>
      <p className="mt-0.5 text-[13px] text-[#6b7772]">재고 반영 손익의 잠정 저장 · 내부 마감 확정 · 재고 조정 제안 · 평가방법 · 허용오차. 장부 전표는 바꾸지 않습니다.</p>
      <div className="mt-2">
        {error || !view ? (
          <p className="rounded-md bg-[#f4f5f3] px-3 py-2 text-[13px] text-[#6b7772]">{error ?? '이 달의 재고 반영 손익을 읽지 못했습니다.'}</p>
        ) : (
          <Status businessId={businessId} period={period} view={view} settings={settings} canKeep={canKeep} canClose={canClose} isTop={isTop} />
        )}
      </div>
    </section>
  )
}

const box = 'rounded-xl border border-line-soft bg-panel p-3'
const btn = 'min-h-11 lg:min-h-9 rounded-md border border-line px-3 text-t11h text-ink-dim hover:border-accent disabled:opacity-40'
const input = 'min-w-0 rounded-md border border-line bg-panel px-2 py-1.5 text-t12h text-ink'

function Status({ businessId, period, view, settings, canKeep, canClose, isTop }: { businessId: string; period: string; view: MonthlyPlView; settings: PlSettings | null; canKeep: boolean; canClose: boolean; isTop: boolean }) {
  const router = useRouter()
  const [busy, start] = useTransition()
  const [msg, setMsg] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [adj, setAdj] = useState({ kind: 'shrinkage' as PlAdjustmentKind, amount: '', reason: '' })
  const r = view.result
  const final = view.view_status === 'final'
  const run = (fn: () => Promise<{ ok?: true; error?: string; n?: number }>, done: string) =>
    start(async () => {
      const x = await fn()
      setMsg(x.error ?? done)
      if (x.ok) router.refresh()
    })
  return (
    <section className={box} aria-labelledby="mpl-status">
      <h3 id="mpl-status" className="text-t13 font-semibold">마감 상태</h3>
      <p className="mt-1 text-t12h">
        <span className={`rounded px-1.5 py-0.5 font-semibold ${final ? 'bg-ok/15 text-ok' : 'bg-raised text-ink'}`} data-testid="pl-status">{VIEW_STATUS_KO[view.view_status]}</span>
        <span className="ml-2 text-t10h text-ink-muted">{r.scope_label}</span>
      </p>
      <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-2 text-t10h">
        <dt className="text-ink-muted">평가방법</dt><dd>{r.method_label}</dd>
        <dt className="text-ink-muted">계산 버전</dt><dd>{r.calc_version}</dd>
        <dt className="text-ink-muted">마감</dt>
        <dd>{view.record?.closed_at ? `${view.record.closed_at.slice(0, 10)} · ${view.record.closed_by_name ?? '—'}` : view.record ? `잠정 저장 ${view.record.recorded_at.slice(0, 10)}` : '저장 없음'}</dd>
        <dt className="text-ink-muted">허용오차</dt><dd>{wonOrMissing(settings?.tolerance_krw ?? 1000)}</dd>
      </dl>
      {view.stale.inputs_changed ? <p className="mt-1 text-t11h text-warning">마감 뒤 원천 자료가 바뀌었습니다 — 숫자는 마감 때 그대로입니다. 바꾸려면 다시 열고 다시 마감하세요.</p> : null}
      {view.stale.opening_diff || view.stale.reclose_flags ? (
        <p className="mt-1 text-t11h text-warning">
          재마감 대상 — 앞 달을 다시 마감해 이 달 기초가 달라졌습니다
          {view.stale.opening_diff ? ` (원료 ${wonOrMissing(view.stale.opening_diff.raw)} · 재공품 ${wonOrMissing(view.stale.opening_diff.wip)} · 완제품 ${wonOrMissing(view.stale.opening_diff.finished)})` : ''}. 자동으로 덮어쓰지 않았습니다.
        </p>
      ) : null}
      {view.changed_vs_prev_final ? (
        <p className="mt-1 text-t10h text-ink-dim">다시 마감 — 앞 확정 대비 영업이익 {wonOrMissing(view.changed_vs_prev_final.operating_income)} · 기말 재공품 {wonOrMissing(view.changed_vs_prev_final.wip_closing)} · 기말 완제품 {wonOrMissing(view.changed_vs_prev_final.finished_closing)}</p>
      ) : null}
      {view.provisional_diff ? (
        <p className="mt-1 text-t10h text-ink-dim">잠정 → 마감 조정: 매출원가 {wonOrMissing(view.provisional_diff.cogs ?? null)} · 영업이익 {wonOrMissing(view.provisional_diff.operating_income ?? null)}</p>
      ) : null}
      {r.blockers.length ? (
        <div className="mt-2">
          <p className="text-t11h font-semibold text-critical">막는 까닭(내부 마감 확정 전에)</p>
          <ul className="mt-0.5 list-disc pl-4 text-t10h" aria-label="막는 까닭">
            {r.blockers.map((x, i) => <li key={i}>{x.target ? `${x.target}: ` : ''}{x.message}</li>)}
          </ul>
        </div>
      ) : null}
      <div className="mt-2">
        <p className="text-t11h font-semibold">확인 필요</p>
        <ul className="mt-0.5 list-disc pl-4 text-t10h text-ink-dim" aria-label="확인 필요">
          {r.warnings.map((x, i) => <li key={i}>{x.message}</li>)}
        </ul>
      </div>

      {view.adjustments.length ? (
        <ul className="mt-2 space-y-1 text-t10h" aria-label="재고 조정">
          {view.adjustments.map((a) => (
            <li key={a.adj_id} className="flex flex-wrap items-center gap-2 rounded-md bg-raised px-2 py-1">
              <span>{ADJ_KIND_KO[a.kind]} {wonOrMissing(a.amount)} — {a.reason}</span>
              <span className="text-ink-muted">{ADJ_STATUS_KO[a.status]} · 제안 {a.proposed_by_name ?? '—'}{a.approved_by_name ? ` · 승인 ${a.approved_by_name}` : ''}</span>
              {!final && a.status === 'proposed' && canClose ? (
                <button type="button" className={btn} disabled={busy} onClick={() => run(() => decidePlAdjustment({ adjId: a.adj_id, businessId, action: 'approve' }), '승인했습니다.')}>승인</button>
              ) : null}
              {!final && a.status !== 'voided' && canKeep ? (
                <button type="button" className={btn} disabled={busy || reason.trim().length < 2} title="아래 이유 칸이 필요합니다" onClick={() => run(() => decidePlAdjustment({ adjId: a.adj_id, businessId, action: 'void', reason }), '무효로 했습니다(지우지 않음).')}>무효</button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {canKeep || canClose || isTop ? (
        <div className="mt-3 space-y-2 border-t border-line-soft pt-2">
          <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="이유(다시 열기 · 조정 무효는 필수)" aria-label="이유" className={`${input} w-full`} />
          <div className="flex flex-wrap gap-2">
            {!final && canKeep ? (
              <button type="button" className={btn} disabled={busy || r.status === 'entering'} onClick={() => run(() => recordMonthlyPl({ businessId, period, final: false, reason }), '잠정으로 저장했습니다(같은 자료면 새 줄을 만들지 않습니다).')}>잠정 저장</button>
            ) : null}
            {!final && canClose ? (
              <button
                type="button"
                className="min-h-11 lg:min-h-9 rounded-md bg-accent px-3 text-t11h font-semibold text-white disabled:opacity-40"
                disabled={busy || !r.closable}
                title={r.closable ? undefined : '막는 까닭을 먼저 해결하세요'}
                onClick={() => run(() => recordMonthlyPl({ businessId, period, final: true, reason }), '내부 마감 확정했습니다.')}
              >
                내부 마감 확정
              </button>
            ) : null}
            {final && isTop ? (
              <button type="button" className={btn} disabled={busy || reason.trim().length < 2} onClick={() => run(() => reopenMonthlyPl({ businessId, period, reason }), '다시 열었습니다 — 이후 확정 달은 재마감 대상으로 표시됩니다.')}>다시 열기</button>
            ) : null}
          </div>
          {!final && canKeep ? (
            <form
              className="flex flex-wrap items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                run(() => proposePlAdjustment({ businessId, period, kind: adj.kind, amount: adj.amount, reason: adj.reason }), '조정을 제안했습니다 — 다른 마감 권한자가 승인합니다.')
              }}
            >
              <label className="text-t10h text-ink-muted">조정 종류
                <select value={adj.kind} onChange={(e) => setAdj({ ...adj, kind: e.target.value as PlAdjustmentKind })} className={`${input} block`}>
                  {(Object.keys(ADJ_KIND_KO) as PlAdjustmentKind[]).map((k) => <option key={k} value={k}>{ADJ_KIND_KO[k]}</option>)}
                </select>
              </label>
              <label className="text-t10h text-ink-muted">금액(원, 손실은 양수)
                <input value={adj.amount} onChange={(e) => setAdj({ ...adj, amount: e.target.value })} inputMode="numeric" className={`${input} block w-32`} />
              </label>
              <label className="min-w-48 flex-1 text-t10h text-ink-muted">사유
                <input value={adj.reason} onChange={(e) => setAdj({ ...adj, reason: e.target.value })} maxLength={500} className={`${input} block w-full`} />
              </label>
              <button className={btn} disabled={busy}>조정 제안</button>
            </form>
          ) : null}
          {isTop && settings ? <Settings businessId={businessId} settings={settings} onDone={setMsg} /> : null}
        </div>
      ) : null}
      {msg ? <p role="status" className="mt-1 text-t10h">{msg}</p> : null}
    </section>
  )
}

function Settings({ businessId, settings, onDone }: { businessId: string; settings: PlSettings; onDone: (m: string) => void }) {
  const router = useRouter()
  const [busy, start] = useTransition()
  const [f, setF] = useState({
    method: settings.method,
    confirmed: settings.method_confirmed,
    tolerance: String(settings.tolerance_krw),
    revenue: settings.revenue_source,
    categories: settings.payment_categories.join(', '),
    reason: '',
  })
  return (
    <details className="rounded-md border border-line-soft px-2 py-1">
      <summary className="cursor-pointer text-t11h">설정(대표 · 그룹 CFO) — 평가방법 · 허용오차 · 매출 원천 · 원료 대금 항목</summary>
      <form
        className="mt-1 grid gap-2 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault()
          start(async () => {
            const x = await savePlSettings({ businessId, method: f.method, methodConfirmed: f.confirmed, tolerance: f.tolerance, revenueSource: f.revenue, categories: f.categories, reason: f.reason })
            onDone(x.error ?? '설정을 바꿨습니다(이미 확정한 달은 그대로 — 다시 열어야 새 설정으로 계산됩니다).')
            if (x.ok) router.refresh()
          })
        }}
      >
        <label className="text-t10h text-ink-muted">평가방법
          <select value={f.method} onChange={(e) => setF({ ...f, method: e.target.value as PlSettings['method'] })} className={`${input} block w-full`}>
            <option value="monthly_wa">원료별 월 가중평균</option>
            <option value="statement">재고금액명세서 금액 그대로</option>
          </select>
        </label>
        <label className="flex min-h-11 items-center gap-1 text-t10h text-ink-muted">
          <input type="checkbox" checked={f.confirmed} onChange={(e) => setF({ ...f, confirmed: e.target.checked })} /> 세무사가 확인함(끄면 «관리용 잠정 기준»)
        </label>
        <label className="text-t10h text-ink-muted">대사 허용오차(원)
          <input value={f.tolerance} onChange={(e) => setF({ ...f, tolerance: e.target.value })} inputMode="numeric" className={`${input} block w-full`} />
        </label>
        <label className="text-t10h text-ink-muted">매출 원천(하나만)
          <select value={f.revenue} onChange={(e) => setF({ ...f, revenue: e.target.value as PlSettings['revenue_source'] })} className={`${input} block w-full`}>
            <option value="books">{REVENUE_SOURCE_KO.books}</option>
            <option value="sales_upload">{REVENUE_SOURCE_KO.sales_upload}</option>
          </select>
        </label>
        <label className="text-t10h text-ink-muted sm:col-span-2">원료 대금 항목(자금흐름표 «항목»에 이 말이 있으면 — 쉼표로)
          <input value={f.categories} onChange={(e) => setF({ ...f, categories: e.target.value })} className={`${input} block w-full`} />
        </label>
        <label className="text-t10h text-ink-muted sm:col-span-2">이유
          <input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} maxLength={500} className={`${input} block w-full`} />
        </label>
        <button className={btn} disabled={busy || f.reason.trim().length < 2}>설정 저장</button>
      </form>
    </details>
  )
}

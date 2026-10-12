'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

import { decidePlAdjustment, proposePlAdjustment, recordMonthlyPl, reopenMonthlyPl, savePlSettings } from '@/app/actions/monthly-pl'
import { ADJ_KIND_KO, ADJ_STATUS_KO, REVENUE_SOURCE_KO, VIEW_STATUS_KO, wonOrMissing } from '@/lib/monthly-pl/text'
import type { MonthlyPlView, PlAdjustmentKind, PlSettings, PlYearRow } from '@/types'

/**
 * 0075 «월별 손익 — 재고 반영» 패널. 기존 «월별 간이 손익» 화면(/finance/<회사>/monthly) 아래에 붙는다(새 대시보드 아님).
 * [손익] [재고 · 원가 근거] [자금 참고] [자료 상태] — 숫자는 DB가 계산한 것을 그대로 그린다(여기서 다시 계산하지 않는다).
 * 원료별 줄은 대표 · 원가 관리에게만 온다(DB가 가린다) — 이 화면은 받은 것만 그린다. 직원 화면에도 선다 — «대표»라고 쓴다.
 */

const box = 'rounded-xl border border-line-soft bg-panel p-3'
const btn = 'min-h-9 rounded-md border border-line px-3 text-t11h text-ink-dim hover:border-accent disabled:opacity-40'
const input = 'min-w-0 rounded-md border border-line bg-panel px-2 py-1.5 text-t12h text-ink'

function Row({ label, value, strong, note }: { label: string; value: number | null | undefined; strong?: boolean; note?: string }) {
  return (
    <div className={`flex items-baseline justify-between gap-3 border-b border-line-soft py-1 last:border-0 ${strong ? 'font-semibold' : ''}`}>
      <dt className="min-w-0 text-t11h text-ink-dim">
        {label}
        {note ? <span className="ml-1 text-t10 text-ink-muted">{note}</span> : null}
      </dt>
      <dd className={`tnum text-t12h ${value === null || value === undefined ? 'text-ink-muted' : ''}`}>{wonOrMissing(value)}</dd>
    </div>
  )
}

const sub = (a: number | null, b: number | null) => (a === null || b === null ? null : a - b)

export function MonthlyPlPanel({
  businessId,
  period,
  year,
  view,
  error,
  years,
  settings,
  canKeep,
  canClose,
  isTop,
}: {
  businessId: string
  period: string
  year: string
  view: MonthlyPlView | null
  error: string | null
  years: PlYearRow[]
  settings: PlSettings | null
  canKeep: boolean
  canClose: boolean
  isTop: boolean
}) {
  const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`)
  return (
    <section className="mt-6 space-y-3" aria-labelledby="mpl-h">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="mpl-h" className="text-t14 font-semibold">월별 손익 — 재고 반영 · {period}</h2>
        <p className="text-t10h text-ink-muted">많이 산 달이 나빠 보이지 않게 — 매입 · 생산 투입 · 판매 · 지급을 나누고 월말 재고를 반영합니다. 장부 전표는 바꾸지 않습니다.</p>
      </div>
      <nav aria-label="달 고르기" className="flex flex-wrap gap-1">
        {months.map((m) => {
          const y = years.find((r) => r.period === m)
          const on = m === period
          return (
            <Link
              key={m}
              href={`/finance/${businessId}/monthly?year=${year}&pl=${m}`}
              aria-current={on ? 'true' : undefined}
              className={`rounded-md border px-2 py-1 text-t10h ${on ? 'border-accent text-accent' : 'border-line text-ink-dim'}`}
            >
              {Number(m.slice(5))}월{y ? ` · ${y.status === 'final' ? '확정' : '잠정'}` : ''}
            </Link>
          )
        })}
      </nav>
      {error || !view ? (
        <p className="rounded-md bg-raised px-3 py-2 text-t12 text-ink-dim">{error ?? '이 달의 월별 손익을 읽지 못했습니다.'}</p>
      ) : (
        <Body businessId={businessId} period={period} view={view} settings={settings} canKeep={canKeep} canClose={canClose} isTop={isTop} />
      )}
    </section>
  )
}

function Body({ businessId, period, view, settings, canKeep, canClose, isTop }: { businessId: string; period: string; view: MonthlyPlView; settings: PlSettings | null; canKeep: boolean; canClose: boolean; isTop: boolean }) {
  const r = view.result
  const b = r.basis
  const p = r.pl
  // 매입액 → 매출원가 다리(계산식 그대로 — 원인을 추정하지 않는다).
  const rawUp = sub(b.raw_closing, b.raw_opening)
  const wipUp = sub(b.wip_closing, b.wip_opening)
  const finUp = sub(b.finished_closing, b.finished_opening)
  const bridge = [rawUp, wipUp, finUp, p.inventory_other, b.mfg_labor, b.mfg_overhead, p.cogs].every((x) => x !== null)
  const profitButCashDown = (p.operating_income ?? 0) > 0 && (r.cash.net ?? 0) < 0
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <section className={box} aria-labelledby="mpl-pl">
        <h3 id="mpl-pl" className="text-t13 font-semibold">손익</h3>
        <dl className="mt-1">
          <Row label="매출액" value={p.revenue} note={REVENUE_SOURCE_KO[settings?.revenue_source ?? 'books']} />
          <Row label="매출원가" value={p.cogs} note="판매분만(재고 반영)" />
          <Row label="매출총이익" value={p.gross_profit} strong />
          <Row label="판매관리비" value={p.sga} note="감가상각 포함 · 재고에 배분하지 않음" />
          {p.inventory_other ? <Row label="재고 변동(비생산 출고 · 승인된 조정)" value={p.inventory_other} note="처리 기준 확인 전 별도 줄" /> : null}
          <Row label="영업이익" value={p.operating_income} strong />
        </dl>
        <div className="mt-2 rounded-md bg-raised px-2 py-1.5 text-t10h text-ink-dim">
          <p className="font-semibold text-ink">검산(일괄 보정 아님)</p>
          <dl>
            <Row label="지금 장부 영업이익(매입을 바로 비용)" value={r.check.books_operating_income} />
            <Row label="검산 = 지금 장부 + 기말 재고 − 기초 재고" value={r.check.check_value} />
            <Row label="검산 − 새 영업이익" value={r.check.diff_vs_new} note="장부 매입 ≠ 입고 매입 · 비생산 · 조정 · 시점 차이" />
          </dl>
        </div>
      </section>

      <section className={box} aria-labelledby="mpl-basis">
        <h3 id="mpl-basis" className="text-t13 font-semibold">재고 · 원가 근거</h3>
        <dl className="mt-1">
          <Row label="원료 매입액(입고명세서 순매입)" value={b.raw_purchases} />
          <Row label="기초 원료 재고" value={b.raw_opening} />
          <Row label="기말 원료 재고" value={b.raw_closing} />
          <Row label="원료 사용액(재고 증감 기준)" value={b.raw_usage} />
          <Row label="생산 투입원가(투입 기준)" value={b.production_input} note={r.withheld?.includes('production_input') ? '원가 권한자에게만(원료가 적어 합계로 원료 kg이 드러날 수 있음)' : undefined} />
          <Row label="비생산 출고" value={b.non_production} />
          <Row label="승인된 재고 조정" value={b.adjustments_approved} />
          <Row label="대사 차이(제조로 간 원료비 − 투입 기준)" value={b.recon_diff} note={b.recon_ok === null ? '대사 못 함' : b.recon_ok ? '허용오차 안' : '허용오차 밖 — 자동으로 맞추지 않음'} />
          <Row label="제조 인건비" value={b.mfg_labor} />
          <Row label="제조경비" value={b.mfg_overhead} />
          <Row label="기초 · 기말 재공품" value={b.wip_opening} note={`→ ${wonOrMissing(b.wip_closing)}`} />
          <Row label="완성품 제조원가" value={b.cogm} />
          <Row label="기초 · 기말 완제품" value={b.finished_opening} note={`→ ${wonOrMissing(b.finished_closing)}`} />
        </dl>
        {bridge ? (
          <p className="mt-2 rounded-md bg-raised px-2 py-1.5 text-t10h text-ink-dim">
            <span className="font-semibold text-ink">매입액과 매출원가가 다른 까닭(계산식)</span> — 매입 {wonOrMissing(b.raw_purchases)} − 원료 재고 증가 {wonOrMissing(rawUp)} − 재고 변동 {wonOrMissing(p.inventory_other)} + 제조 인건비 · 경비{' '}
            {wonOrMissing((b.mfg_labor ?? 0) + (b.mfg_overhead ?? 0))} − 재공품 증가 {wonOrMissing(wipUp)} − 완제품 증가 {wonOrMissing(finUp)} = 매출원가 {wonOrMissing(p.cogs)}. 상세 자료가 없는 원인은 단정하지 않습니다.
          </p>
        ) : null}
        {r.materials.length ? (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[560px] text-t10h">
              <caption className="text-left text-t10h text-ink-muted">원료별(대표 · 원가 관리만) — 원료별 월 가중평균</caption>
              <thead className="text-ink-muted">
                <tr><th className="text-left">원료</th><th className="text-right">기초</th><th className="text-right">매입</th><th className="text-right">평균단가</th><th className="text-right">투입원가</th><th className="text-right">기말</th><th className="text-right">감모</th></tr>
              </thead>
              <tbody>
                {r.materials.map((m) => (
                  <tr key={m.name} className="border-t border-line-soft">
                    <td className="py-0.5">{m.name}{m.errors.length ? <span className="ml-1 text-critical">!</span> : null}</td>
                    <td className="tnum text-right">{wonOrMissing(m.opening_amount)}</td>
                    <td className="tnum text-right">{wonOrMissing(m.purchase_amount)}</td>
                    <td className="tnum text-right">{m.wa_unit_cost === null ? '—' : `${m.wa_unit_cost.toLocaleString('ko-KR')}원/kg`}</td>
                    <td className="tnum text-right">{wonOrMissing(m.production_cost)}</td>
                    <td className="tnum text-right">{wonOrMissing(m.closing_amount)}</td>
                    <td className="tnum text-right">{wonOrMissing(m.shrinkage_cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      <section className={box} aria-labelledby="mpl-cash">
        <h3 id="mpl-cash" className="text-t13 font-semibold">자금 참고</h3>
        <dl className="mt-1">
          <Row label="원료대금 실제 지급액(자금흐름표)" value={r.cash.material_payments} note={r.cash.state === 'not_uploaded' ? '미입력 · 연결 필요' : `항목 규칙: ${(settings?.payment_categories ?? []).join(' · ')}`} />
          <Row label="현금 순증감(입금 − 출금)" value={r.cash.net} />
        </dl>
        {profitButCashDown ? (
          <p className="mt-2 rounded-md border border-gold/40 bg-gold/10 px-2 py-1 text-t11h">이번 달 영업이익은 발생했지만 현금은 줄었습니다(원료 선매입 대금 지급 등). 이익과 현금을 같게 맞추지 않습니다.</p>
        ) : null}
        <p className="mt-2 text-t10h text-ink-muted">
          손익은 매입 · 매출 인식월, 현금은 실제 지급일 기준입니다. 외상 · 선급금 · 부가세 · 시점 차이로 다를 수 있습니다.{' '}
          <Link className="text-accent underline-offset-2 hover:underline" href={`/finance/${businessId}`}>재무 화면(현금)</Link>{' · '}
          <Link className="text-accent underline-offset-2 hover:underline" href={`/finance/${businessId}/upload?month=${period}`}>자금흐름표 올리기</Link>
        </p>
      </section>

      <Status businessId={businessId} period={period} view={view} settings={settings} canKeep={canKeep} canClose={canClose} isTop={isTop} />
    </div>
  )
}

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
      <h3 id="mpl-status" className="text-t13 font-semibold">자료 상태</h3>
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
                className="min-h-9 rounded-md bg-accent px-3 text-t11h font-semibold text-white disabled:opacity-40"
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
              <label className="min-w-0 flex-1 text-t10h text-ink-muted">사유
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
        <label className="flex items-center gap-1 text-t10h text-ink-muted">
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

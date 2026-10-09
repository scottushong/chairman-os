'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { addOverheadAction, setAllocAction, voidOverheadAction } from '@/app/actions/costs'
import { Alert, BTN_PRIMARY, FIELD, LABEL, Notice, VoidButton, VoidTag } from '@/components/purchasing/shared'
import { NumberInput } from '@/components/ui/number-input'
import { groupDigits } from '@/lib/number-input'
import { kg3, won0 } from '@/lib/costs/format'
import { krw } from '@/lib/sales/cost'
import {
  OVERHEAD_BASIS_LABEL_KO,
  OVERHEAD_CATEGORIES,
  OVERHEAD_CATEGORY_LABEL_KO,
  OVERHEAD_GROUP_LABEL_KO,
  overheadGroupOf,
  type AllocBasis,
  type AllocSettings,
  type CostProduct,
  type Overhead,
  type OverheadBasis,
  type OverheadCategory,
  type OverheadSummaryRow,
} from '@/types'

/**
 * 비용 마스터(0065 cost_overheads) · 배부 기준(cost_alloc_settings) — 원가 관리(쓰기) · 대표.
 *
 * 한 줄 = 항목 · 방식(월 금액 / 원/kg) · 금액 · 적용 시작일[· 제품]. 같은 항목(같은 범위)의 새 줄이 그 날부터 앞 줄을 대신한다 —
 * 방식이 달라도(월 금액 → 원/kg) 대신한다(0065 리뷰 I2). 고치지 않고 무효 + 새 줄. 금액 0 = 그 날부터 없음.
 * 월 금액은 «하루치 × 기간 ÷ 같은 기간 생산 kg»로 kg당이 된다(기간 생산이 없으면 계획 생산량).
 */

const BASIS_USED_KO: Record<AllocBasis, string> = { trailing: '직전 생산 kg', plan: '계획 생산량' }

export function OverheadManager({
  businessId,
  today,
  canWrite,
  products,
  summary,
  overheads,
  alloc,
}: {
  businessId: string
  today: string
  canWrite: boolean
  products: CostProduct[]
  summary: OverheadSummaryRow[]
  overheads: Overhead[]
  alloc: AllocSettings | null
}) {
  const router = useRouter()
  const pName = new Map(products.map((p) => [p.product_id, p.name]))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [showVoided, setShowVoided] = useState(false)
  const [d, setD] = useState<{ category: OverheadCategory; basis: OverheadBasis; amount: string; productId: string; effectiveFrom: string; note: string }>({
    category: 'labor',
    basis: 'monthly',
    amount: '',
    productId: '',
    effectiveFrom: today,
    note: '',
  })
  const [a, setA] = useState({
    basis: (alloc?.basis ?? 'trailing') as AllocBasis,
    windowDays: String(alloc?.window_days ?? 28),
    plannedKgMonth: alloc?.planned_kg_month ? groupDigits(String(alloc.planned_kg_month), 'number') : '',
  })

  async function run(fn: () => Promise<{ error?: string }>, ok: string) {
    if (busy) return false
    setBusy(true)
    setError(null)
    setNotice(null)
    const r = await fn()
    setBusy(false)
    if (r.error) {
      setError(r.error)
      return false
    }
    setNotice(ok)
    router.refresh()
    return true
  }

  const head = summary[0]
  const history = overheads.filter((o) => showVoided || !o.voided_at)

  return (
    <div className="space-y-3">
      <Alert text={error} />
      <Notice text={notice} />

      <section className="rounded-xl border border-line-soft bg-panel p-3 max-sm:border-0 max-sm:bg-transparent max-sm:p-0" aria-label="비용 마스터">
        <h2 className="text-t12h font-semibold">비용 마스터 — 오늘 적용 중</h2>
        <p className="mt-0.5 text-t10h text-ink-muted">
          {head?.basis_used
            ? `배부: ${BASIS_USED_KO[head.basis_used]} 기준 · ${head.window_days ?? 28}일 · 나눈 kg ${kg3(head.divisor_kg)}kg`
            : head
              ? '배부할 kg가 없습니다 — 직전 생산 · 계획 생산량이 없어 월 금액을 kg당으로 나눌 수 없습니다.'
              : '비용 항목이 없습니다.'}
        </p>
        {summary.length > 0 ? (
          <div className="mt-2 overflow-x-auto">
            <table className="m-cards w-full text-t12 sm:min-w-[760px]">
              <thead>
                <tr className="border-b border-line-soft text-left text-t10h text-ink-muted">
                  <th className="px-2 py-2 font-normal">항목</th>
                  <th className="px-2 py-2 font-normal">묶음</th>
                  <th className="px-2 py-2 font-normal">범위</th>
                  <th className="px-2 py-2 text-right font-normal">금액</th>
                  <th className="px-2 py-2 font-normal">시작일</th>
                  <th className="px-2 py-2 text-right font-normal">kg당 (원/kg)</th>
                </tr>
              </thead>
              <tbody>
                {summary.map((s) => (
                  <tr key={`${s.category}|${s.product_id ?? ''}`} className="border-t border-line-soft">
                    <td className="px-2 py-1.5 font-semibold">{OVERHEAD_CATEGORY_LABEL_KO[s.category] ?? s.category}</td>
                    <td className="px-2 py-1.5 text-ink-dim" data-label="묶음">
                      {OVERHEAD_GROUP_LABEL_KO[s.grp] ?? s.grp}
                    </td>
                    <td className="px-2 py-1.5 text-ink-dim" data-label="범위">
                      {s.product_id ? (pName.get(s.product_id) ?? s.product_id) : '모든 제품'}
                    </td>
                    <td className="px-2 py-1.5 text-right tnum" data-label="금액">
                      {s.basis === 'monthly' ? `월 ${won0(s.amount)}원` : `${s.amount.toLocaleString('ko-KR', { maximumFractionDigits: 2 })}원/kg`}
                    </td>
                    <td className="px-2 py-1.5 tnum" data-label="시작일">
                      {s.effective_from}
                    </td>
                    <td className="px-2 py-1.5 text-right tnum font-semibold" data-label="kg당">
                      {s.per_kg === null ? <span className="font-normal text-ink-muted">배부 전</span> : krw(s.per_kg)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      {canWrite ? (
        <div className="grid gap-3 lg:grid-cols-[2fr_1fr]">
          <section className="rounded-xl border border-line-soft bg-panel p-3" aria-label="비용 넣기">
            <h2 className="text-t12h font-semibold">비용 넣기</h2>
            <p className="mt-0.5 text-t10h text-ink-muted">같은 항목의 새 줄이 시작일부터 앞 줄을 대신합니다(방식이 달라도). 없애려면 금액 0으로 넣으세요.</p>
            <div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              <label className={LABEL}>
                항목
                <select className={`${FIELD} mt-0.5`} value={d.category} disabled={busy} onChange={(e) => setD({ ...d, category: e.target.value as OverheadCategory })}>
                  {OVERHEAD_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {OVERHEAD_GROUP_LABEL_KO[overheadGroupOf(c)]} · {OVERHEAD_CATEGORY_LABEL_KO[c]}
                    </option>
                  ))}
                </select>
              </label>
              <label className={LABEL}>
                방식
                <select
                  className={`${FIELD} mt-0.5`}
                  value={d.basis}
                  disabled={busy}
                  onChange={(e) => setD({ ...d, basis: e.target.value as OverheadBasis, amount: '', productId: '' })}
                >
                  <option value="monthly">{OVERHEAD_BASIS_LABEL_KO.monthly} (원/월)</option>
                  <option value="per_kg">{OVERHEAD_BASIS_LABEL_KO.per_kg} (직접 단가)</option>
                </select>
              </label>
              <label className={LABEL}>
                {d.basis === 'monthly' ? '월 금액' : 'kg당 금액'}
                {d.basis === 'monthly' ? (
                  <NumberInput kind="money" className={`${FIELD} mt-0.5`} value={d.amount} onChange={(v) => setD({ ...d, amount: v })} disabled={busy} />
                ) : (
                  <NumberInput kind="number" unit="원/kg" reading={false} className={`${FIELD} mt-0.5 pr-12`} value={d.amount} onChange={(v) => setD({ ...d, amount: v })} disabled={busy} />
                )}
              </label>
              {d.basis === 'per_kg' ? (
                <label className={LABEL}>
                  제품 (비우면 모든 제품)
                  <select className={`${FIELD} mt-0.5`} value={d.productId} disabled={busy} onChange={(e) => setD({ ...d, productId: e.target.value })}>
                    <option value="">모든 제품</option>
                    {products
                      .filter((p) => p.active)
                      .map((p) => (
                        <option key={p.product_id} value={p.product_id}>
                          {p.name}
                        </option>
                      ))}
                  </select>
                </label>
              ) : null}
              <label className={LABEL}>
                적용 시작일
                <input type="date" className={`${FIELD} mt-0.5`} value={d.effectiveFrom} disabled={busy} onChange={(e) => setD({ ...d, effectiveFrom: e.target.value })} />
              </label>
              <label className={LABEL}>
                메모 (선택)
                <input className={`${FIELD} mt-0.5`} value={d.note} maxLength={300} disabled={busy} onChange={(e) => setD({ ...d, note: e.target.value })} />
              </label>
            </div>
            <button
              type="button"
              className={`${BTN_PRIMARY} mt-2`}
              disabled={busy || d.amount === '' || !d.effectiveFrom}
              onClick={async () => {
                const ok = await run(
                  () => addOverheadAction({ businessId, ...d }),
                  `${OVERHEAD_CATEGORY_LABEL_KO[d.category]} ${d.basis === 'monthly' ? `월 ${d.amount}원` : `${d.amount}원/kg`}을 ${d.effectiveFrom}부터 넣었습니다.`,
                )
                if (ok) setD({ ...d, amount: '', note: '' })
              }}
            >
              {busy ? '저장 중…' : '비용 넣기'}
            </button>
          </section>

          <section className="rounded-xl border border-line-soft bg-panel p-3" aria-label="배부 기준">
            <h2 className="text-t12h font-semibold">배부 기준</h2>
            <p className="mt-0.5 text-t10h text-ink-muted">
              지금: {alloc ? `${alloc.basis === 'plan' ? '계획 생산량' : '직전 생산 kg'} · ${alloc.window_days}일` : '기본(직전 생산 kg · 28일)'}
              {alloc?.planned_kg_month ? ` · 월 계획 ${kg3(alloc.planned_kg_month)}kg` : ''}
              {head?.divisor_kg ? ` · 나눈 kg ${kg3(head.divisor_kg)}kg` : ''}
            </p>
            <div className="mt-2 grid gap-2">
              <label className={LABEL}>
                기준
                <select className={`${FIELD} mt-0.5`} value={a.basis} disabled={busy} onChange={(e) => setA({ ...a, basis: e.target.value as AllocBasis })}>
                  <option value="trailing">직전 생산 kg (권장 — 그 기간 생산이 없으면 계획 생산량)</option>
                  <option value="plan">늘 계획 생산량</option>
                </select>
              </label>
              <label className={LABEL}>
                기간 (일, 7~365)
                <NumberInput kind="number" unit="일" reading={false} className={`${FIELD} mt-0.5`} value={a.windowDays} onChange={(v) => setA({ ...a, windowDays: v })} disabled={busy} />
              </label>
              <label className={LABEL}>
                월 계획 생산량 {a.basis === 'plan' ? '(필수)' : '(선택)'}
                <NumberInput kind="number" unit="kg" reading={false} className={`${FIELD} mt-0.5`} value={a.plannedKgMonth} onChange={(v) => setA({ ...a, plannedKgMonth: v })} disabled={busy} />
              </label>
              <button type="button" className={BTN_PRIMARY} disabled={busy || !a.windowDays} onClick={() => void run(() => setAllocAction({ businessId, ...a }), '배부 기준을 바꿨습니다.')}>
                {busy ? '저장 중…' : '배부 기준 저장'}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      <section className="rounded-xl border border-line-soft bg-panel p-3 max-sm:border-0 max-sm:bg-transparent max-sm:p-0" aria-label="비용 기록">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-t12h font-semibold">비용 기록 (이력)</h2>
          <label className="flex min-h-11 items-center gap-1.5 text-t11h text-ink-dim lg:min-h-0">
            <input type="checkbox" className="size-4 accent-[var(--color-accent)]" checked={showVoided} onChange={(e) => setShowVoided(e.target.checked)} />
            무효 줄도
          </label>
        </div>
        {history.length === 0 ? (
          <p className="mt-2 text-t12 text-ink-muted">비용 기록이 없습니다.</p>
        ) : (
          <div className="mt-2 overflow-x-auto">
            <table className="m-cards w-full text-t12 sm:min-w-[760px]">
              <thead>
                <tr className="border-b border-line-soft text-left text-t10h text-ink-muted">
                  <th className="px-2 py-2 font-normal">시작일</th>
                  <th className="px-2 py-2 font-normal">항목</th>
                  <th className="px-2 py-2 font-normal">범위</th>
                  <th className="px-2 py-2 text-right font-normal">금액</th>
                  <th className="px-2 py-2 font-normal">메모</th>
                  <th className="px-2 py-2 text-right font-normal">{canWrite ? '정정' : ''}</th>
                </tr>
              </thead>
              <tbody>
                {history.map((o) => (
                  <tr key={o.overhead_id} className={`border-t border-line-soft ${o.voided_at ? 'text-ink-muted line-through decoration-ink-muted/50' : ''}`}>
                    <td className="px-2 py-1.5 tnum max-sm:font-semibold">
                      <span>
                        {o.effective_from}
                        {o.voided_at ? <VoidTag reason={o.void_reason} /> : null}
                      </span>
                    </td>
                    <td className="px-2 py-1.5" data-label="항목">
                      {OVERHEAD_CATEGORY_LABEL_KO[o.category] ?? o.category}
                    </td>
                    <td className="px-2 py-1.5 text-ink-dim" data-label="범위">
                      {o.product_id ? (pName.get(o.product_id) ?? o.product_id) : '모든 제품'}
                    </td>
                    <td className="px-2 py-1.5 text-right tnum" data-label="금액">
                      {o.basis === 'monthly' ? `월 ${won0(o.amount)}원` : `${o.amount.toLocaleString('ko-KR', { maximumFractionDigits: 2 })}원/kg`}
                    </td>
                    <td className="px-2 py-1.5 text-ink-dim" data-label="메모">
                      {o.note || '—'}
                    </td>
                    <td className="px-2 py-1.5 text-right" data-label={canWrite && !o.voided_at ? '정정' : undefined}>
                      {canWrite && !o.voided_at ? (
                        <VoidButton
                          onVoid={async (reason) => {
                            const r = await voidOverheadAction(businessId, o.overhead_id, reason)
                            if (!r.error) router.refresh()
                            return r.error
                          }}
                        />
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}

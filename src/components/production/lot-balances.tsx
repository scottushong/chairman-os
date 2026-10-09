'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { addAdjustmentAction, voidProductionRowAction } from '@/app/actions/production'
import { Alert, BTN_PRIMARY, FIELD, LABEL, Notice, VoidButton, VoidTag } from '@/components/purchasing/shared'
import { NumberInput } from '@/components/ui/number-input'
import { kg3 } from '@/lib/costs/format'
import type { LotAdjustment, LotBalance } from '@/types'

/**
 * 구매 LOT 잔량(0064 cost_lot_balances) — 입고 kg − 투입 − 조정. 저장하지 않는 값이라 DB가 그때그때 계산한다.
 * 조정(폐기 · 실사 차이)은 이유 필수 · 잔량을 넘지 못한다(cost_lot_short) · 고치지 않고 무효만. 금액은 보이지 않는다.
 */
export function LotBalances({
  businessId,
  today,
  tomorrow,
  canWrite,
  balances,
  adjustments,
}: {
  businessId: string
  today: string
  tomorrow: string
  canWrite: boolean
  balances: LotBalance[]
  adjustments: LotAdjustment[]
}) {
  const router = useRouter()
  const [showEmpty, setShowEmpty] = useState(false)
  const [showVoided, setShowVoided] = useState(false)
  const left = balances.filter((b) => b.remaining_kg > 0)
  const [d, setD] = useState({ lotId: left[0]?.lot_id ?? '', adjustedOn: today, qtyKg: '', reason: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const lot = balances.find((b) => b.lot_id === d.lotId)
  const rows = balances.filter((b) => showEmpty || b.remaining_kg > 0)

  async function submit() {
    if (busy) return
    setBusy(true)
    setError(null)
    setNotice(null)
    const r = await addAdjustmentAction({ businessId, ...d })
    setBusy(false)
    if (r.error) {
      setError(r.error)
      return
    }
    setNotice(`${lot?.material_name ?? ''} ${d.lotId} 잔량에서 ${d.qtyKg}kg를 뺐습니다.`)
    setD({ ...d, qtyKg: '', reason: '' })
    router.refresh()
  }

  return (
    <section className="rounded-xl border border-line-soft bg-panel p-3 max-sm:border-0 max-sm:bg-transparent max-sm:p-0" aria-label="구매 LOT 잔량">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-t12h font-semibold">구매 LOT 잔량 — 남은 LOT {left.length}개</h2>
        <label className="flex min-h-11 items-center gap-1.5 text-t11h text-ink-dim lg:min-h-0">
          <input type="checkbox" className="size-4 accent-[var(--color-accent)]" checked={showEmpty} onChange={(e) => setShowEmpty(e.target.checked)} />
          다 쓴 LOT도
        </label>
      </div>
      {rows.length === 0 ? (
        <p className="mt-3 text-t12 text-ink-muted">남은 구매 LOT가 없습니다.</p>
      ) : (
        <div className="mt-2 overflow-x-auto">
          <table className="m-cards w-full text-t12 sm:min-w-[860px]">
            <thead>
              <tr className="border-b border-line-soft text-left text-t10h text-ink-muted">
                <th className="px-2 py-2 font-normal">원료 · LOT</th>
                <th className="px-2 py-2 font-normal">공급처</th>
                <th className="px-2 py-2 font-normal">입고일</th>
                <th className="px-2 py-2 text-right font-normal">입고 kg</th>
                <th className="px-2 py-2 text-right font-normal">투입</th>
                <th className="px-2 py-2 text-right font-normal">조정</th>
                <th className="px-2 py-2 text-right font-normal">잔량</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((b) => (
                <tr key={b.lot_id} className="border-t border-line-soft">
                  <td className="px-2 py-1.5 max-sm:font-semibold">
                    <span>
                      {b.material_name}
                      <span className="block text-t10h font-normal text-ink-muted tnum">{b.lot_id}</span>
                    </span>
                  </td>
                  <td className="px-2 py-1.5 text-ink-dim" data-label="공급처">
                    <span>
                      {b.supplier_name}
                      {b.supplier_lot_no ? <span className="block text-t10h text-ink-muted">{b.supplier_lot_no}</span> : null}
                    </span>
                  </td>
                  <td className="px-2 py-1.5 tnum" data-label="입고일">
                    {b.received_on}
                  </td>
                  <td className="px-2 py-1.5 text-right tnum" data-label="입고 kg">
                    {kg3(b.qty_kg)}
                  </td>
                  <td className="px-2 py-1.5 text-right tnum text-ink-dim" data-label="투입">
                    {kg3(b.used_kg)}
                  </td>
                  <td className="px-2 py-1.5 text-right tnum text-ink-dim" data-label="조정">
                    {kg3(b.adjusted_kg)}
                  </td>
                  <td className="px-2 py-1.5 text-right tnum font-semibold" data-label="잔량">
                    {kg3(b.remaining_kg)}kg
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {canWrite ? (
        <div className="mt-3 rounded-lg border border-line-soft bg-raised/40 p-3">
          <h3 className="text-t11h font-semibold">잔량 조정 (폐기 · 실사 차이)</h3>
          <Alert text={error} />
          <Notice text={notice} />
          <div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
            <label className={`${LABEL} xl:col-span-2`}>
              구매 LOT
              <select className={`${FIELD} mt-0.5`} value={d.lotId} disabled={busy} onChange={(e) => setD({ ...d, lotId: e.target.value })}>
                <option value="">고르세요</option>
                {left.map((b) => (
                  <option key={b.lot_id} value={b.lot_id}>
                    {b.material_name} · {b.received_on} · 잔량 {kg3(b.remaining_kg)}kg · {b.lot_id}
                  </option>
                ))}
              </select>
            </label>
            <label className={LABEL}>
              조정일
              <input type="date" className={`${FIELD} mt-0.5`} value={d.adjustedOn} min={lot?.received_on} max={tomorrow} disabled={busy} onChange={(e) => setD({ ...d, adjustedOn: e.target.value })} />
            </label>
            <label className={LABEL}>
              뺄 kg
              <NumberInput kind="number" unit="kg" reading={false} className={`${FIELD} mt-0.5`} value={d.qtyKg} onChange={(v) => setD({ ...d, qtyKg: v })} disabled={busy} />
            </label>
            <label className={LABEL}>
              이유 (필수)
              <input className={`${FIELD} mt-0.5`} value={d.reason} maxLength={300} placeholder="예: 포대 파손 폐기" disabled={busy} onChange={(e) => setD({ ...d, reason: e.target.value })} />
            </label>
          </div>
          <button type="button" className={`${BTN_PRIMARY} mt-2`} disabled={busy || !d.lotId || !d.qtyKg || !d.reason.trim()} onClick={submit}>
            {busy ? '저장 중…' : '조정 넣기'}
          </button>
        </div>
      ) : null}

      <div className="mt-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-t11h font-semibold">조정 기록</h3>
          <label className="flex min-h-11 items-center gap-1.5 text-t11h text-ink-dim lg:min-h-0">
            <input type="checkbox" className="size-4 accent-[var(--color-accent)]" checked={showVoided} onChange={(e) => setShowVoided(e.target.checked)} />
            무효 줄도
          </label>
        </div>
        {adjustments.filter((a) => showVoided || !a.voided_at).length === 0 ? (
          <p className="mt-1 text-t11 text-ink-muted">조정 기록이 없습니다.</p>
        ) : (
          <ul className="mt-1 space-y-0.5">
            {adjustments
              .filter((a) => showVoided || !a.voided_at)
              .map((a) => (
                <li key={a.adj_id} className={`flex flex-wrap items-center justify-between gap-2 text-t11 ${a.voided_at ? 'text-ink-muted line-through decoration-ink-muted/50' : ''}`}>
                  <span>
                    <span className="tnum">{a.adjusted_on}</span> · {balances.find((b) => b.lot_id === a.lot_id)?.material_name ?? ''} <span className="tnum">{a.lot_id}</span> ·{' '}
                    <b className="tnum">−{kg3(a.qty_kg)}kg</b> · {a.reason}
                    {a.voided_at ? <VoidTag reason={a.void_reason} /> : null}
                  </span>
                  {canWrite && !a.voided_at ? (
                    <VoidButton
                      onVoid={async (reason) => {
                        const r = await voidProductionRowAction(businessId, 'adjustment', a.adj_id, reason)
                        if (!r.error) router.refresh()
                        return r.error
                      }}
                    />
                  ) : null}
                </li>
              ))}
          </ul>
        )}
      </div>
    </section>
  )
}

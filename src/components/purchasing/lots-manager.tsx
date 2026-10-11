'use client'

import { useRouter } from 'next/navigation'
import { useRef, useState } from 'react'

import { addLotAction, dismissCandidateAction, voidLotAction } from '@/app/actions/purchasing'
import { NumberInput } from '@/components/ui/number-input'
import { groupDigits } from '@/lib/number-input'
import { landedPreview, parseNum, won } from '@/lib/purchasing/calc'
import type { CostMaterial, CostSupplier, PurchaseCandidate, PurchaseDoc, PurchaseLot } from '@/types'

import { FxField, useFxLookup } from './fx-field'
import { PurchaseDocs } from './purchase-docs'
import { Alert, BTN, BTN_PRIMARY, CURRENCIES, FIELD, LABEL, LINK_BTN, Notice, VoidButton, VoidTag } from './shared'

/**
 * 구매 · 입고 LOT(0061 cost_purchase_lots) — 입력(Landed Cost 미리보기 · 환율 자동) · 결재 후보 · 첨부 · 목록(무효만).
 *
 * Landed Cost(원/kg) = (단가 × 수량 × 환율 + 운송비 + 관세 + 기타) ÷ 수량. 미리보기는 같은 식이고, **저장되는 값은 DB 트리거가 계산한다**
 * (입력값을 믿지 않는다). 환율을 비우면 DB가 입고일 이하 최신 환율을 찾는다 — 미리보기도 같은 표에서 찾아 보여 준다.
 */

interface Draft {
  materialId: string
  supplierId: string
  receivedOn: string
  orderedOn: string
  supplierLotNo: string
  qty: string
  unitPrice: string
  currency: string
  fx: string
  freight: string
  duty: string
  other: string
  note: string
  /** 결재 후보에서 왔으면 그 결재. */
  candidate: PurchaseCandidate | null
}

function blank(today: string, materials: CostMaterial[], suppliers: CostSupplier[]): Draft {
  const s = suppliers.find((x) => x.active)
  return {
    materialId: materials.find((m) => m.active)?.material_id ?? '',
    supplierId: s?.supplier_id ?? '',
    receivedOn: today,
    orderedOn: '',
    supplierLotNo: '',
    qty: '',
    unitPrice: '',
    currency: s?.currency_default ?? 'KRW',
    fx: '',
    freight: '',
    duty: '',
    other: '',
    note: '',
    candidate: null,
  }
}

const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, '').toLowerCase()

export function LotsManager({
  businessId,
  materials,
  suppliers,
  lots,
  candidates,
  docs,
  canEdit,
  today,
  initialFx,
}: {
  businessId: string
  materials: CostMaterial[]
  suppliers: CostSupplier[]
  lots: PurchaseLot[]
  /** null = 결재 후보를 볼 수 없다(구매 입력 권한 없음). */
  candidates: PurchaseCandidate[] | null
  docs: PurchaseDoc[]
  canEdit: boolean
  today: string
  /** 첫 공급처 통화의 오늘 환율(서버가 미리 찾아 둔 값 — 첫 화면에서 «찾는 중»이 깜빡이지 않게). */
  initialFx: number | null
}) {
  const router = useRouter()
  const activeMaterials = materials.filter((m) => m.active)
  const activeSuppliers = suppliers.filter((s) => s.active)
  const mName = new Map(materials.map((m) => [m.material_id, m.name]))
  const sName = new Map(suppliers.map((s) => [s.supplier_id, s.name]))

  const [list, setList] = useState(lots)
  const [cands, setCands] = useState(candidates)
  const [d, setD] = useState<Draft>(() => blank(today, activeMaterials, activeSuppliers))
  const fxAuto = useFxLookup(initialFx)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [showVoided, setShowVoided] = useState(false)
  const formRef = useRef<HTMLElement>(null)

  const set = (patch: Partial<Draft>) => setD((cur) => ({ ...cur, ...patch }))
  const rate = d.currency === 'KRW' ? 1 : (parseNum(d.fx) ?? fxAuto.auto)
  const preview = landedPreview({
    qty_kg: parseNum(d.qty),
    unit_price: parseNum(d.unitPrice),
    fx_rate: rate,
    freight_krw: parseNum(d.freight),
    duty_krw: parseNum(d.duty),
    other_krw: parseNum(d.other),
  })

  function pickSupplier(id: string) {
    const s = suppliers.find((x) => x.supplier_id === id)
    const currency = s?.currency_default ?? d.currency
    set({ supplierId: id, currency, fx: currency === d.currency ? d.fx : '' })
    if (currency !== d.currency) void fxAuto.lookup(currency, d.receivedOn)
  }

  /** «LOT로 넣기» — 결재의 구입처 · 품목 · 수량 · 금액 ÷ 수량(후보 단가)을 채운다. 원료 · 공급처는 사람이 고른다(이름이 같으면 미리 골라 둔다). */
  function fromCandidate(c: PurchaseCandidate) {
    const sup = activeSuppliers.find((s) => norm(s.name) === norm(c.vendor)) ?? null
    const mat = activeMaterials.find((m) => norm(c.item).includes(norm(m.name))) ?? null
    const unit = c.amount_krw && c.quantity ? Math.round((c.amount_krw / c.quantity) * 100) / 100 : null
    setD({
      ...blank(today, activeMaterials, activeSuppliers),
      materialId: mat?.material_id ?? '',
      supplierId: sup?.supplier_id ?? '',
      qty: c.quantity ? groupDigits(String(c.quantity), 'number') : '',
      unitPrice: unit ? groupDigits(String(unit), 'number') : '',
      currency: 'KRW',
      note: [c.title, c.vendor, c.item].filter(Boolean).join(' · ').slice(0, 500),
      candidate: c,
    })
    void fxAuto.lookup('KRW', today)
    setError(null)
    setNotice(null)
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  async function dismiss(c: PurchaseCandidate) {
    setError(null)
    const r = await dismissCandidateAction(businessId, c.decision_id)
    if (r.error) setError(r.error)
    else {
      setCands((l) => (l ? l.filter((x) => x.decision_id !== c.decision_id) : l))
      if (d.candidate?.decision_id === c.decision_id) set({ candidate: null })
    }
  }

  async function submit() {
    if (busy) return
    setBusy(true)
    setError(null)
    setNotice(null)
    const r = await addLotAction({
      businessId,
      material_id: d.materialId,
      supplier_id: d.supplierId,
      received_on: d.receivedOn,
      ordered_on: d.orderedOn,
      supplier_lot_no: d.supplierLotNo,
      qty_kg: d.qty,
      unit_price: d.unitPrice,
      currency: d.currency,
      fx_rate: d.fx,
      freight_krw: d.freight,
      duty_krw: d.duty,
      other_krw: d.other,
      source: d.candidate ? 'approval' : 'manual',
      source_ref: d.candidate?.decision_id ?? null,
      note: d.note,
    })
    setBusy(false)
    if (r.error || !r.lot) {
      setError(r.error ?? '저장하지 못했습니다.')
      return
    }
    const lot = r.lot
    setList((l) => [lot, ...l])
    if (d.candidate) setCands((l) => (l ? l.filter((x) => x.decision_id !== d.candidate?.decision_id) : l))
    setNotice(`${lot.lot_id} — ${mName.get(lot.material_id) ?? ''} ${lot.qty_kg.toLocaleString('ko-KR')}kg, Landed kg당 ${won(lot.landed_krw_per_kg)}원으로 넣었습니다.`)
    setD((cur) => ({ ...blank(today, activeMaterials, activeSuppliers), materialId: cur.materialId, supplierId: cur.supplierId, currency: cur.currency }))
  }

  const rows = list.filter((l) => showVoided || !l.voided_at)
  const ready = activeMaterials.length > 0 && activeSuppliers.length > 0

  return (
    <div className="mt-4 space-y-3">
      {cands && cands.length > 0 ? (
        <section className="rounded-xl border border-accent/40 bg-accent/5 p-3" aria-label="결재 후보">
          <h2 className="text-t12h font-semibold">결재 후보 — 승인된 구매 결재 {cands.length}건</h2>
          <p className="mt-0.5 text-t10h text-ink-muted">
            금액 ÷ 수량은 후보 단가일 뿐입니다(부가세 · 배송비가 섞일 수 있습니다). LOT로 넣기 전에 원료 · 공급처 · 단가를 확인하세요.
          </p>
          <ul className="mt-2 space-y-1.5">
            {cands.map((c) => (
              <li key={c.decision_id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line-soft bg-panel px-2.5 py-2">
                <div className="min-w-0 text-t12">
                  <p className="font-semibold">{c.title}</p>
                  <p className="text-t11 text-ink-dim">
                    {[c.vendor, c.item].filter(Boolean).join(' · ') || '구입처 · 품목 없음'}
                    {c.quantity ? ` · 수량 ${c.quantity.toLocaleString('ko-KR')}` : ''}
                    {c.amount_krw ? ` · ${won(c.amount_krw)}원` : ''}
                    {c.amount_krw && c.quantity ? ` · 후보 단가 ${won(c.amount_krw / c.quantity)}원` : ''}
                    {c.decided_at ? ` · 승인 ${c.decided_at.slice(0, 10)}` : ''}
                  </p>
                  {c.link ? (
                    <a href={c.link} target="_blank" rel="noreferrer noopener" className="text-t10h text-ink-muted underline-offset-2 hover:underline">
                      링크 열기
                    </a>
                  ) : null}
                </div>
                <div className="flex items-center gap-1">
                  <button type="button" className={BTN} disabled={busy || !ready} onClick={() => fromCandidate(c)}>
                    LOT로 넣기
                  </button>
                  <button type="button" className={LINK_BTN} disabled={busy} onClick={() => dismiss(c)}>
                    무시
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <Alert text={error} />
      <Notice text={notice} />

      {canEdit ? (
        <section ref={formRef} className="scroll-mt-4 rounded-xl border border-line-soft bg-panel p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-t12h font-semibold">구매 · 입고 LOT 넣기</h2>
            {d.candidate ? (
              <span className="flex items-center gap-1 rounded-md border border-accent/40 bg-accent/10 px-2 py-0.5 text-t10h text-ink-dim">
                결재 «{d.candidate.title}»에서
                <button type="button" className={LINK_BTN} onClick={() => setD(blank(today, activeMaterials, activeSuppliers))}>
                  풀기
                </button>
              </span>
            ) : null}
          </div>
          {!ready ? (
            <p className="mt-2 text-t11h text-ink-muted">원료와 공급처가 하나씩은 있어야 합니다 — «원료» · «공급처»에서 먼저 넣으세요.</p>
          ) : (
            <div className="mt-2 grid gap-3 lg:grid-cols-[1fr_300px]">
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                <label className={LABEL}>
                  원료
                  <select className={`${FIELD} mt-0.5`} value={d.materialId} disabled={busy} onChange={(e) => set({ materialId: e.target.value })}>
                    <option value="">고르세요</option>
                    {activeMaterials.map((m) => (
                      <option key={m.material_id} value={m.material_id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={LABEL}>
                  공급처
                  <select className={`${FIELD} mt-0.5`} value={d.supplierId} disabled={busy} onChange={(e) => pickSupplier(e.target.value)}>
                    <option value="">고르세요</option>
                    {activeSuppliers.map((s) => (
                      <option key={s.supplier_id} value={s.supplier_id}>
                        {s.name} ({s.currency_default})
                      </option>
                    ))}
                  </select>
                </label>
                <label className={LABEL}>
                  입고일 (원가 기준일)
                  <input
                    type="date"
                    className={`${FIELD} mt-0.5`}
                    value={d.receivedOn}
                    max={today}
                    disabled={busy}
                    onChange={(e) => {
                      set({ receivedOn: e.target.value })
                      void fxAuto.lookup(d.currency, e.target.value)
                    }}
                  />
                </label>
                <label className={LABEL}>
                  발주일 (선택)
                  <input type="date" className={`${FIELD} mt-0.5`} value={d.orderedOn} disabled={busy} onChange={(e) => set({ orderedOn: e.target.value })} />
                </label>
                <label className={LABEL}>
                  수량
                  <NumberInput kind="number" unit="kg" reading={false} className={`${FIELD} mt-0.5`} value={d.qty} onChange={(v) => set({ qty: v })} disabled={busy} />
                </label>
                <label className={LABEL}>
                  단가 (kg당)
                  <NumberInput
                    kind="number"
                    unit={d.currency}
                    reading={false}
                    className={`${FIELD} mt-0.5`}
                    value={d.unitPrice}
                    onChange={(v) => set({ unitPrice: v })}
                    disabled={busy}
                  />
                </label>
                <label className={LABEL}>
                  통화
                  <select
                    className={`${FIELD} mt-0.5`}
                    value={d.currency}
                    disabled={busy}
                    onChange={(e) => {
                      set({ currency: e.target.value, fx: '' })
                      void fxAuto.lookup(e.target.value, d.receivedOn)
                    }}
                  >
                    {CURRENCIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </label>
                <FxField currency={d.currency} auto={fxAuto.auto} autoLoading={fxAuto.loading} value={d.fx} onChange={(v) => set({ fx: v })} disabled={busy} />
                <label className={LABEL}>
                  운송비
                  <NumberInput kind="money" className={`${FIELD} mt-0.5`} value={d.freight} onChange={(v) => set({ freight: v })} disabled={busy} />
                </label>
                <label className={LABEL}>
                  관세
                  <NumberInput kind="money" className={`${FIELD} mt-0.5`} value={d.duty} onChange={(v) => set({ duty: v })} disabled={busy} />
                </label>
                <label className={LABEL}>
                  기타 부대비 (통관 · 보험 · 검사 · 하역)
                  <NumberInput kind="money" className={`${FIELD} mt-0.5`} value={d.other} onChange={(v) => set({ other: v })} disabled={busy} />
                </label>
                <label className={LABEL}>
                  공급처 LOT 번호 (선택)
                  <input className={`${FIELD} mt-0.5`} value={d.supplierLotNo} maxLength={80} disabled={busy} onChange={(e) => set({ supplierLotNo: e.target.value })} />
                </label>
                <label className={`${LABEL} sm:col-span-2 xl:col-span-4`}>
                  메모 (선택)
                  <input className={`${FIELD} mt-0.5`} value={d.note} maxLength={500} disabled={busy} onChange={(e) => set({ note: e.target.value })} />
                </label>
              </div>

              <aside className="rounded-lg border border-line-soft bg-raised/40 p-3" aria-label="Landed Cost 미리보기" aria-live="polite">
                <h3 className="text-t11h font-semibold text-ink-dim">Landed Cost 미리보기</h3>
                <dl className="mt-2 space-y-1 text-t12">
                  <div className="flex justify-between gap-2">
                    <dt className="text-ink-dim">물품가 (단가 × 수량 × 환율)</dt>
                    <dd className="tnum">{preview ? `${won(preview.goods_krw)}원` : '—'}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-ink-dim">부대비 합계</dt>
                    <dd className="tnum">{preview ? `${won(preview.extra_krw)}원` : '—'}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-ink-dim">총액</dt>
                    <dd className="tnum">{preview ? `${won(preview.total_krw)}원` : '—'}</dd>
                  </div>
                  <div className="mt-1 flex items-baseline justify-between gap-2 border-t border-line-soft pt-2">
                    <dt className="font-semibold">Landed (kg당)</dt>
                    <dd className="tnum text-t18 font-bold">{preview ? `${won(preview.landed_krw_per_kg)}원` : '—'}</dd>
                  </div>
                </dl>
                <p className="mt-2 text-t10h text-ink-muted">
                  {d.currency === 'KRW'
                    ? '원화 — 환율 1.'
                    : rate === null
                      ? '그 날짜의 환율이 없습니다 — 환율을 직접 넣으세요.'
                      : `환율 ${rate.toLocaleString('ko-KR', { maximumFractionDigits: 4 })} (${parseNum(d.fx) !== null ? '직접' : '자동'}).`}{' '}
                  저장되는 값은 DB가 같은 식으로 다시 계산합니다.
                </p>
                <button type="button" className={`${BTN_PRIMARY} mt-3 w-full`} disabled={busy || !preview || !d.materialId || !d.supplierId} onClick={submit}>
                  {busy ? '저장 중…' : d.candidate ? '결재에서 LOT 넣기' : 'LOT 넣기'}
                </button>
              </aside>
            </div>
          )}
        </section>
      ) : null}

      <PurchaseDocs businessId={businessId} docs={docs} suppliers={activeSuppliers} canEdit={canEdit} onChanged={() => router.refresh()} />

      <section className="rounded-xl border border-line-soft bg-panel p-3 max-sm:border-0 max-sm:bg-transparent max-sm:p-0">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-t12h font-semibold">LOT 목록</h2>
          <label className="flex min-h-11 items-center gap-1.5 text-t11h text-ink-dim lg:min-h-0">
            <input type="checkbox" className="size-4 accent-[var(--color-accent)]" checked={showVoided} onChange={(e) => setShowVoided(e.target.checked)} />
            무효 줄도
          </label>
        </div>
        {rows.length === 0 ? (
          <p className="mt-3 text-t12 text-ink-muted">LOT가 없습니다.</p>
        ) : (
          <div className="mt-2 overflow-x-auto">
            <table className="m-cards w-full text-t12 sm:min-w-[1000px]">
              <thead>
                <tr className="border-b border-line-soft text-left text-t10h text-ink-muted">
                  <th className="px-2 py-2 font-normal">LOT</th>
                  <th className="px-2 py-2 font-normal">입고일</th>
                  <th className="px-2 py-2 font-normal">원료</th>
                  <th className="px-2 py-2 font-normal">공급처</th>
                  <th className="px-2 py-2 text-right font-normal">수량</th>
                  <th className="px-2 py-2 text-right font-normal">단가</th>
                  <th className="px-2 py-2 text-right font-normal">부대비</th>
                  <th className="px-2 py-2 text-right font-normal">Landed 원/kg</th>
                  <th className="px-2 py-2 text-right font-normal">{canEdit ? '정정' : ''}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((l) => (
                  <tr key={l.lot_id} className={`border-t border-line-soft ${l.voided_at ? 'text-ink-muted line-through decoration-ink-muted/50' : ''}`}>
                    <td className="px-2 py-1.5 tnum text-t11 max-sm:font-semibold">
                      <span>
                        {l.lot_id}
                        {l.source === 'approval' ? <span className="ml-1.5 rounded border border-accent/40 px-1 text-t9h text-ink-dim">결재</span> : null}
                        {l.voided_at ? <VoidTag reason={l.void_reason} /> : null}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 tnum" data-label="입고일">
                      {l.received_on}
                    </td>
                    <td className="px-2 py-1.5" data-label="원료">
                      {mName.get(l.material_id) ?? l.material_id}
                    </td>
                    <td className="px-2 py-1.5 text-ink-dim" data-label="공급처">
                      <span>
                        {sName.get(l.supplier_id) ?? l.supplier_id}
                        {l.supplier_lot_no ? <span className="block text-t10h text-ink-muted">{l.supplier_lot_no}</span> : null}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 text-right tnum" data-label="수량">
                      {l.qty_kg.toLocaleString('ko-KR')}kg
                    </td>
                    <td className="px-2 py-1.5 text-right tnum text-ink-dim" data-label="단가">
                      {l.unit_price.toLocaleString('ko-KR', { maximumFractionDigits: 4 })} {l.currency}
                      {l.currency !== 'KRW' ? <span className="block text-t10h">× {l.fx_rate.toLocaleString('ko-KR', { maximumFractionDigits: 2 })}</span> : null}
                    </td>
                    <td className="px-2 py-1.5 text-right tnum text-ink-dim" data-label="부대비">
                      {won(l.freight_krw + l.duty_krw + l.other_krw)}
                    </td>
                    <td className="px-2 py-1.5 text-right tnum font-semibold" data-label="Landed 원/kg">
                      {won(l.landed_krw_per_kg)}
                    </td>
                    <td className="px-2 py-1.5 text-right" data-label={canEdit && !l.voided_at ? '정정' : undefined}>
                      {canEdit && !l.voided_at ? (
                        <VoidButton
                          onVoid={async (reason) => {
                            const res = await voidLotAction(businessId, l.lot_id, reason)
                            if (!res.error) {
                              setList((cur) => cur.map((x) => (x.lot_id === l.lot_id ? { ...x, voided_at: new Date().toISOString(), void_reason: reason } : x)))
                              // 결재에서 온 LOT를 무효로 하면 그 결재가 다시 후보로 돌아온다(0061 — 무효 아닌 LOT만 막는다). 다시 그려 받는다.
                              if (l.source === 'approval') window.location.reload()
                            }
                            return res.error
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

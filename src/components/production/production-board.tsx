'use client'

import { useRouter } from 'next/navigation'
import { Fragment, useMemo, useState } from 'react'

import { addInputAction, addProdLotAction, closeOrderAction, issueOrderAction, voidProductionRowAction } from '@/app/actions/production'
import { Alert, BTN, BTN_PRIMARY, FIELD, LABEL, LINK_BTN, Notice, VoidButton, VoidTag } from '@/components/purchasing/shared'
import { NumberInput } from '@/components/ui/number-input'
import { kg3 } from '@/lib/costs/format'
import { ORDER_STATUS_LABEL_KO, type CostProduct, type LotBalance, type ProdInput, type ProdLot, type ProductionOrder, type ProductionOrderLine } from '@/types'

/**
 * 생산 화면 본문(0064) — 작업지시(대표 발행 · 생산이 완료) · 생산 LOT 기록 · 투입 기록 · 생산 LOT별 투입 목록.
 *
 * **작업지시는 «원료 · kg»만** — 비율 · 수율 · kg당 구성은 이 화면 어디에도 없다(회장 결정 «X(작업지시 수량만)»). kg는 0.001까지.
 * 투입은 구매 LOT를 사람이 고른다 — 입고 오래된 LOT를 먼저 제안할 뿐 자동으로 빼지 않는다(FIFO 자동 차감 없음). 원가 숫자는 없다.
 * 저장 · 무효 뒤에는 서버에서 다시 받는다(router.refresh) — 잔량 · 상태는 DB가 계산한 값이 원천이다.
 */

const STATUS_CLASS: Record<ProductionOrder['status'], string> = {
  open: 'border-accent/40 bg-accent/10 text-ink',
  done: 'border-ok/40 bg-ok/10 text-ok',
  cancelled: 'border-line bg-raised text-ink-muted',
}

function StatusBadge({ status }: { status: ProductionOrder['status'] }) {
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-t10h font-semibold ${STATUS_CLASS[status]}`}>{ORDER_STATUS_LABEL_KO[status]}</span>
}

export function ProductionBoard({
  businessId,
  today,
  tomorrow,
  canWrite,
  chairman,
  products,
  materialNames,
  orders,
  lines,
  prodLots,
  inputs,
  balances,
}: {
  businessId: string
  today: string
  tomorrow: string
  canWrite: boolean
  chairman: boolean
  products: CostProduct[]
  materialNames: Record<string, string>
  orders: ProductionOrder[]
  lines: ProductionOrderLine[]
  prodLots: ProdLot[]
  inputs: ProdInput[]
  /** 구매 LOT 잔량(전부 — 남은 것만 제안에 쓴다). 입고 오래된 순. */
  balances: LotBalance[]
}) {
  const router = useRouter()
  const pName = useMemo(() => new Map(products.map((p) => [p.product_id, p.name])), [products])
  const mName = (id: string) => materialNames[id] ?? balances.find((b) => b.material_id === id)?.material_name ?? id
  const lotOf = (id: string) => balances.find((b) => b.lot_id === id)
  const openOrders = orders.filter((o) => o.status === 'open')
  const sorted = [...openOrders.sort((a, b) => a.planned_on.localeCompare(b.planned_on)), ...orders.filter((o) => o.status !== 'open')]
  const liveProdLots = prodLots.filter((p) => !p.voided_at)

  const [open, setOpen] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [showVoided, setShowVoided] = useState(false)

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

  // (f) 대표 — 작업지시 발행
  const activeProducts = products.filter((p) => p.active)
  const [issue, setIssue] = useState({ productId: activeProducts[0]?.product_id ?? '', plannedOn: tomorrow, plannedKg: '', note: '' })

  // (b) 생산 LOT
  const [lotDraft, setLotDraft] = useState({ orderId: openOrders[0]?.order_id ?? '', producedOn: today, outputKg: '', note: '' })

  // (c) 투입
  const [inDraft, setInDraft] = useState({ prodLotId: liveProdLots[0]?.prod_lot_id ?? '', materialId: '', lotId: '', qtyKg: '' })
  const chosenProdLot = liveProdLots.find((p) => p.prod_lot_id === inDraft.prodLotId) ?? null
  const orderLines = chosenProdLot ? lines.filter((l) => l.order_id === chosenProdLot.order_id) : []
  // 생산일 이전에 들어온, 남은 LOT만 — 입고 오래된 순(제안).
  const usable = balances.filter((b) => b.remaining_kg > 0 && (!chosenProdLot || b.received_on <= chosenProdLot.produced_on))
  const materialChoices = [...new Set([...orderLines.map((l) => l.material_id), ...usable.map((b) => b.material_id)])]
  const lotChoices = usable.filter((b) => !inDraft.materialId || b.material_id === inDraft.materialId)
  const suggested = lotChoices[0]?.lot_id ?? ''
  const chosenLot = lotOf(inDraft.lotId || suggested)

  return (
    <div className="mt-4 space-y-3">
      <Alert text={error} />
      <Notice text={notice} />

      {chairman ? (
        <section className="rounded-xl border border-line-soft bg-panel p-3" aria-label="작업지시 발행">
          <h2 className="text-t12h font-semibold">작업지시 발행</h2>
          <p className="mt-0.5 text-t10h text-ink-muted">계획일에 쓰는 BOM 판 × 계획 kg로 원료별 작업지시 kg를 한 번 만듭니다. 생산은 원료 · kg만 봅니다.</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
            <label className={LABEL}>
              제품
              <select className={`${FIELD} mt-0.5`} value={issue.productId} disabled={busy} onChange={(e) => setIssue({ ...issue, productId: e.target.value })}>
                <option value="">고르세요</option>
                {activeProducts.map((p) => (
                  <option key={p.product_id} value={p.product_id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label className={LABEL}>
              계획일
              <input type="date" className={`${FIELD} mt-0.5`} value={issue.plannedOn} disabled={busy} onChange={(e) => setIssue({ ...issue, plannedOn: e.target.value })} />
            </label>
            <label className={LABEL}>
              계획 kg
              <NumberInput kind="number" unit="kg" reading={false} className={`${FIELD} mt-0.5`} value={issue.plannedKg} onChange={(v) => setIssue({ ...issue, plannedKg: v })} disabled={busy} />
            </label>
            <label className={LABEL}>
              메모 (선택)
              <input className={`${FIELD} mt-0.5`} value={issue.note} maxLength={500} disabled={busy} onChange={(e) => setIssue({ ...issue, note: e.target.value })} />
            </label>
            <div className="flex items-end">
              <button
                type="button"
                className={`${BTN_PRIMARY} w-full`}
                disabled={busy || !issue.productId || !issue.plannedOn || !issue.plannedKg}
                onClick={async () => {
                  const okDone = await run(() => issueOrderAction({ businessId, ...issue }), `${pName.get(issue.productId) ?? ''} ${issue.plannedKg}kg 작업지시를 발행했습니다.`)
                  if (okDone) setIssue({ ...issue, plannedKg: '', note: '' })
                }}
              >
                {busy ? '처리 중…' : '발행'}
              </button>
            </div>
          </div>
        </section>
      ) : null}

      <section className="rounded-xl border border-line-soft bg-panel p-3 max-sm:border-0 max-sm:bg-transparent max-sm:p-0" aria-label="작업지시">
        <h2 className="text-t12h font-semibold">작업지시 — 진행 중 {openOrders.length}건</h2>
        {sorted.length === 0 ? (
          <p className="mt-3 text-t12 text-ink-muted">작업지시가 없습니다.</p>
        ) : (
          <div className="mt-2 overflow-x-auto">
            <table className="m-cards w-full text-t12 sm:min-w-[860px]">
              <thead>
                <tr className="border-b border-line-soft text-left text-t10h text-ink-muted">
                  <th className="px-2 py-2 font-normal">제품</th>
                  <th className="px-2 py-2 font-normal">계획일</th>
                  <th className="px-2 py-2 text-right font-normal">계획 kg</th>
                  <th className="px-2 py-2 text-right font-normal">생산 kg (LOT)</th>
                  <th className="px-2 py-2 font-normal">상태</th>
                  <th className="px-2 py-2 text-right font-normal">
                    <span className="sr-only">작업</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((o) => {
                  const made = liveProdLots.filter((p) => p.order_id === o.order_id)
                  const oLines = lines.filter((l) => l.order_id === o.order_id)
                  return (
                    <Fragment key={o.order_id}>
                      <tr className="border-t border-line-soft align-top">
                        <td className="px-2 py-1.5 max-sm:font-semibold">
                          <span>
                            {pName.get(o.product_id) ?? o.product_id}
                            <span className="block text-t10h font-normal text-ink-muted tnum">{o.order_id}</span>
                            {o.note ? <span className="block text-t10h font-normal text-ink-dim">{o.note}</span> : null}
                          </span>
                        </td>
                        <td className="px-2 py-1.5 tnum" data-label="계획일">
                          {o.planned_on}
                        </td>
                        <td className="px-2 py-1.5 text-right tnum" data-label="계획 kg">
                          {kg3(o.planned_kg)}kg
                        </td>
                        <td className="px-2 py-1.5 text-right tnum" data-label="생산 kg">
                          {made.length ? `${kg3(made.reduce((t, p) => t + p.output_kg, 0))}kg (${made.length})` : '—'}
                        </td>
                        <td className="px-2 py-1.5" data-label="상태">
                          <StatusBadge status={o.status} />
                        </td>
                        <td className="px-2 py-1.5 text-right">
                          <span className="flex flex-wrap items-center justify-end gap-1">
                            <button type="button" className={BTN} aria-expanded={open === o.order_id} onClick={() => setOpen(open === o.order_id ? null : o.order_id)}>
                              {open === o.order_id ? '접기' : '원료 · kg'}
                            </button>
                            {o.status === 'open' && canWrite ? (
                              <button
                                type="button"
                                className={LINK_BTN}
                                disabled={busy}
                                onClick={() => {
                                  if (window.confirm('이 작업지시를 완료로 닫을까요? 닫으면 생산 LOT를 더 넣을 수 없습니다.')) {
                                    void run(() => closeOrderAction(businessId, o.order_id, 'done'), '작업지시를 완료로 닫았습니다.')
                                  }
                                }}
                              >
                                완료
                              </button>
                            ) : null}
                            {o.status === 'open' && chairman ? (
                              <button
                                type="button"
                                className={LINK_BTN}
                                disabled={busy}
                                onClick={() => {
                                  if (window.confirm('이 작업지시를 취소할까요?')) void run(() => closeOrderAction(businessId, o.order_id, 'cancelled'), '작업지시를 취소했습니다.')
                                }}
                              >
                                취소
                              </button>
                            ) : null}
                          </span>
                        </td>
                      </tr>
                      {open === o.order_id ? (
                        <tr className="border-t border-line-soft bg-raised/40">
                          <td colSpan={6} className="px-3 py-2">
                            {oLines.length === 0 ? (
                              <p className="text-t11 text-ink-muted">작업지시 수량이 없습니다.</p>
                            ) : (
                              <ul className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
                                {oLines.map((l) => (
                                  <li key={l.material_id} className="flex justify-between gap-3 rounded border border-line-soft bg-panel px-2 py-1 text-t12">
                                    <span>{mName(l.material_id)}</span>
                                    <span className="tnum font-semibold">{kg3(l.planned_kg)}kg</span>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {canWrite ? (
        <div className="grid gap-3 lg:grid-cols-2">
          <section className="rounded-xl border border-line-soft bg-panel p-3" aria-label="생산 LOT 기록">
            <h2 className="text-t12h font-semibold">생산 LOT 기록</h2>
            {openOrders.length === 0 ? (
              <p className="mt-2 text-t11h text-ink-muted">열려 있는 작업지시가 없습니다.</p>
            ) : (
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <label className={`${LABEL} sm:col-span-2`}>
                  작업지시
                  <select className={`${FIELD} mt-0.5`} value={lotDraft.orderId} disabled={busy} onChange={(e) => setLotDraft({ ...lotDraft, orderId: e.target.value })}>
                    <option value="">고르세요</option>
                    {openOrders.map((o) => (
                      <option key={o.order_id} value={o.order_id}>
                        {pName.get(o.product_id) ?? o.product_id} · {o.planned_on} · {kg3(o.planned_kg)}kg
                      </option>
                    ))}
                  </select>
                </label>
                <label className={LABEL}>
                  생산일
                  <input type="date" className={`${FIELD} mt-0.5`} value={lotDraft.producedOn} max={tomorrow} disabled={busy} onChange={(e) => setLotDraft({ ...lotDraft, producedOn: e.target.value })} />
                </label>
                <label className={LABEL}>
                  산출 kg
                  <NumberInput kind="number" unit="kg" reading={false} className={`${FIELD} mt-0.5`} value={lotDraft.outputKg} onChange={(v) => setLotDraft({ ...lotDraft, outputKg: v })} disabled={busy} />
                </label>
                <label className={`${LABEL} sm:col-span-2`}>
                  메모 (선택)
                  <input className={`${FIELD} mt-0.5`} value={lotDraft.note} maxLength={500} disabled={busy} onChange={(e) => setLotDraft({ ...lotDraft, note: e.target.value })} />
                </label>
                <button
                  type="button"
                  className={`${BTN_PRIMARY} sm:col-span-2`}
                  disabled={busy || !lotDraft.orderId || !lotDraft.producedOn || !lotDraft.outputKg}
                  onClick={async () => {
                    const ok = await run(() => addProdLotAction({ businessId, ...lotDraft }), `생산 LOT ${lotDraft.outputKg}kg를 넣었습니다 — 이어서 투입을 기록하세요.`)
                    if (ok) setLotDraft({ ...lotDraft, outputKg: '', note: '' })
                  }}
                >
                  {busy ? '저장 중…' : '생산 LOT 넣기'}
                </button>
              </div>
            )}
          </section>

          <section className="rounded-xl border border-line-soft bg-panel p-3" aria-label="투입 기록">
            <h2 className="text-t12h font-semibold">투입 기록</h2>
            <p className="mt-0.5 text-t10h text-ink-muted">실제로 쓴 구매 LOT와 kg. 입고가 오래된 LOT를 먼저 제안합니다 — 다른 LOT를 썼다면 바꿔 고르세요.</p>
            {liveProdLots.length === 0 ? (
              <p className="mt-2 text-t11h text-ink-muted">생산 LOT를 먼저 넣으세요.</p>
            ) : (
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <label className={`${LABEL} sm:col-span-2`}>
                  생산 LOT
                  <select
                    className={`${FIELD} mt-0.5`}
                    value={inDraft.prodLotId}
                    disabled={busy}
                    onChange={(e) => setInDraft({ prodLotId: e.target.value, materialId: '', lotId: '', qtyKg: '' })}
                  >
                    <option value="">고르세요</option>
                    {liveProdLots.map((p) => (
                      <option key={p.prod_lot_id} value={p.prod_lot_id}>
                        {p.prod_lot_id} · {pName.get(p.product_id) ?? ''} · {p.produced_on} · {kg3(p.output_kg)}kg
                      </option>
                    ))}
                  </select>
                </label>
                <label className={LABEL}>
                  원료
                  <select className={`${FIELD} mt-0.5`} value={inDraft.materialId} disabled={busy} onChange={(e) => setInDraft({ ...inDraft, materialId: e.target.value, lotId: '' })}>
                    <option value="">전부</option>
                    {materialChoices.map((id) => {
                      const planned = orderLines.find((l) => l.material_id === id)
                      return (
                        <option key={id} value={id}>
                          {mName(id)}
                          {planned ? ` · 작업지시 ${kg3(planned.planned_kg)}kg` : ''}
                        </option>
                      )
                    })}
                  </select>
                </label>
                <label className={LABEL}>
                  구매 LOT (남은 것 · 입고 오래된 순)
                  <select className={`${FIELD} mt-0.5`} value={inDraft.lotId || suggested} disabled={busy} onChange={(e) => setInDraft({ ...inDraft, lotId: e.target.value })}>
                    {lotChoices.length === 0 ? <option value="">남은 LOT 없음</option> : null}
                    {lotChoices.map((b, i) => (
                      <option key={b.lot_id} value={b.lot_id}>
                        {i === 0 ? '추천 · ' : ''}
                        {b.material_name} · {b.received_on} · 잔량 {kg3(b.remaining_kg)}kg · {b.lot_id}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={LABEL}>
                  투입 kg
                  <NumberInput kind="number" unit="kg" reading={false} className={`${FIELD} mt-0.5`} value={inDraft.qtyKg} onChange={(v) => setInDraft({ ...inDraft, qtyKg: v })} disabled={busy} />
                </label>
                <div className="flex items-end text-t11 text-ink-dim">{chosenLot ? `이 LOT 잔량 ${kg3(chosenLot.remaining_kg)}kg · ${chosenLot.supplier_name}${chosenLot.supplier_lot_no ? ` ${chosenLot.supplier_lot_no}` : ''}` : null}</div>
                <button
                  type="button"
                  className={`${BTN_PRIMARY} sm:col-span-2`}
                  disabled={busy || !inDraft.prodLotId || !(inDraft.lotId || suggested) || !inDraft.qtyKg}
                  onClick={async () => {
                    const ok = await run(
                      () => addInputAction({ businessId, prodLotId: inDraft.prodLotId, lotId: inDraft.lotId || suggested, qtyKg: inDraft.qtyKg }),
                      `투입 ${inDraft.qtyKg}kg를 기록했습니다.`,
                    )
                    if (ok) setInDraft({ ...inDraft, lotId: '', qtyKg: '' })
                  }}
                >
                  {busy ? '저장 중…' : '투입 넣기'}
                </button>
              </div>
            )}
          </section>
        </div>
      ) : null}

      <section className="rounded-xl border border-line-soft bg-panel p-3 max-sm:border-0 max-sm:bg-transparent max-sm:p-0" aria-label="생산 LOT와 투입">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-t12h font-semibold">생산 LOT와 투입</h2>
          <label className="flex min-h-11 items-center gap-1.5 text-t11h text-ink-dim lg:min-h-0">
            <input type="checkbox" className="size-4 accent-[var(--color-accent)]" checked={showVoided} onChange={(e) => setShowVoided(e.target.checked)} />
            무효 줄도
          </label>
        </div>
        {prodLots.length === 0 ? (
          <p className="mt-3 text-t12 text-ink-muted">생산 LOT가 없습니다.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {prodLots
              .filter((p) => showVoided || !p.voided_at)
              .map((p) => {
                const ins = inputs.filter((i) => i.prod_lot_id === p.prod_lot_id && (showVoided || !i.voided_at))
                return (
                  <li key={p.prod_lot_id} className={`rounded-lg border border-line-soft bg-panel px-3 py-2 ${p.voided_at ? 'text-ink-muted' : ''}`}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-t12">
                        <b className="tnum">{p.prod_lot_id}</b> · {pName.get(p.product_id) ?? p.product_id} · <span className="tnum">{p.produced_on}</span> · 산출{' '}
                        <b className="tnum">{kg3(p.output_kg)}kg</b>
                        {p.voided_at ? <VoidTag reason={p.void_reason} /> : null}
                      </p>
                      {canWrite && !p.voided_at ? (
                        <VoidButton
                          onVoid={async (reason) => {
                            const r = await voidProductionRowAction(businessId, 'prod_lot', p.prod_lot_id, reason)
                            if (!r.error) router.refresh()
                            return r.error
                          }}
                        />
                      ) : null}
                    </div>
                    {ins.length === 0 ? (
                      <p className="mt-1 text-t11 text-ink-muted">투입 기록이 없습니다.</p>
                    ) : (
                      <ul className="mt-1 space-y-0.5">
                        {ins.map((i) => {
                          const b = lotOf(i.lot_id)
                          return (
                            <li key={i.input_id} className={`flex flex-wrap items-center justify-between gap-2 text-t11 ${i.voided_at ? 'text-ink-muted line-through decoration-ink-muted/50' : ''}`}>
                              <span>
                                {mName(i.material_id)} · <span className="tnum">{i.lot_id}</span>
                                {b ? <span className="text-ink-muted"> ({b.received_on})</span> : null} · <b className="tnum">{kg3(i.qty_kg)}kg</b>
                                {i.voided_at ? <VoidTag reason={i.void_reason} /> : null}
                              </span>
                              {canWrite && !i.voided_at && !p.voided_at ? (
                                <VoidButton
                                  onVoid={async (reason) => {
                                    const r = await voidProductionRowAction(businessId, 'input', i.input_id, reason)
                                    if (!r.error) router.refresh()
                                    return r.error
                                  }}
                                />
                              ) : null}
                            </li>
                          )
                        })}
                      </ul>
                    )}
                  </li>
                )
              })}
          </ul>
        )}
      </section>
    </div>
  )
}

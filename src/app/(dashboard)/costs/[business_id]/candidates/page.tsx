import Link from 'next/link'
import { notFound } from 'next/navigation'

import { decideCostCandidate } from '@/app/actions/cost-candidates'
import { PageHeader } from '@/components/layout/page-header'
import { recordScreenRead } from '@/lib/activity-record'
import { CANDIDATE_KIND_KO, candidateError } from '@/lib/costs/candidates'
import { openCosts } from '@/lib/costs/page'
import { featureOn } from '@/lib/features-server'
import { krw } from '@/lib/sales/cost'
import type { CostCandidate, CostMaterial, CostProduct, CostSupplier, PurchaseLot } from '@/types'

/**
 * PHASE 6 원가 후보 승인(0078). 자료 올리기에서 온 후보(② 입고 · ⑦ OFFER SHEET · ① 판매현황)를 «LOT로 넣기 · 무시 · 나중에»로 정한다.
 * 문: 대표 · 원가 관리 쓰기 줄(openCosts + canWrite) · 스위치 'cost_candidates'(기본 대표만) — 원가 관리 쓰기 줄이 0명이면 대표만 보인다.
 * 화면에 BOM · 원료 비율 · 제품별 투입은 없다(후보 한 줄의 수량 · 금액뿐). 넣기는 DB가 원래 길(0061 LOT · 0067 판매)을 부른다.
 * 내려받기는 없다(원가 엔진 빼기 금지).
 */
export default async function CandidatesPage(props: PageProps<'/costs/[business_id]/candidates'>) {
  const { business_id } = await props.params
  const sp = await props.searchParams
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)
  const { repo, user, business, canWrite } = await openCosts(business_id)
  if (!canWrite || !(await featureOn(user, 'cost_candidates', business_id))) notFound()
  await recordScreenRead({ path: `/costs/${business_id}/candidates`, kind: 'page', business_id })
  const chairman = user.role === 'Chairman'
  const showDone = one(sp.done) === '1'

  let rows: CostCandidate[] = []
  let error: string | null = null
  try {
    rows = await repo.listCostCandidates(business_id, showDone)
  } catch (e) {
    console.error('[candidates] cost_fin_candidates', e instanceof Error ? e.message : String(e))
    error = candidateError(e, chairman)
  }
  // 넣기 칸의 고르기 목록 — 권한이 없으면 빈 목록(DB가 다시 거부한다). 이름만 — 원료 kg · 비율은 없다.
  const safe = async <T,>(p: Promise<T[]>): Promise<T[]> => p.catch(() => [])
  const [materials, suppliers, lots, products] = await Promise.all([
    safe<CostMaterial>(repo.listCostMaterials(business_id)),
    safe<CostSupplier>(repo.listCostSuppliers(business_id)),
    safe<PurchaseLot>(repo.listPurchaseLots(business_id)),
    safe<CostProduct>(repo.listCostProducts(business_id)),
  ])
  const liveLots = lots.filter((l) => !l.voided_at).slice(0, 100)
  const matName = new Map(materials.map((m) => [m.material_id, m.name]))
  const action = decideCostCandidate.bind(null, business_id)
  const msg = one(sp.msg)
  const err = one(sp.err)
  const won = (n: number | null) => (n === null ? '—' : krw(n))
  const field = 'rounded-md border border-line bg-panel px-2 py-1'

  return (
    <div className="mx-auto max-w-[1400px] space-y-4 px-4 py-5 sm:px-6">
      <PageHeader
        icon="layers"
        title={`${business.name} 원가 후보 승인`}
        code="COST-C1"
        description="자료 올리기에서 온 후보 — LOT로 넣기 · 무시 · 나중에. 이유는 꼭 적고, 결정마다 기록이 남습니다."
      />
      <p className="flex flex-wrap gap-3 text-t12">
        <Link href={`/costs/${business_id}`} className="text-accent hover:underline">
          ← 원가 관리
        </Link>
        <Link href={`/costs/${business_id}/candidates${showDone ? '' : '?done=1'}`} className="text-accent hover:underline">
          {showDone ? '남은 후보만' : '끝난 것도 보기'}
        </Link>
      </p>
      {msg ? <p className="rounded-md border border-line-soft bg-panel px-3 py-2 text-t12">{msg}</p> : null}
      {err ? <p className="rounded-md border border-danger/40 bg-danger/5 px-3 py-2 text-t12 text-danger">{err}</p> : null}
      {error ? <p className="text-t12 text-danger">{error}</p> : null}
      {!error && rows.length === 0 ? <p className="text-t12 text-ink-muted">남은 후보가 없습니다.</p> : null}
      <ul className="space-y-3">
        {rows.map((r) => (
          <li key={`${r.source_table}:${r.line_id}`} className="rounded-lg border border-line bg-panel p-3 text-t12">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="font-semibold">{CANDIDATE_KIND_KO[r.kind]}</span>
              <span className="text-ink-muted">
                {r.period}
                {r.tx_date ? ` · ${r.tx_date}` : ''} · 줄 {r.line_id}
              </span>
              <span>{r.name ?? '—'}</span>
              <span className="text-ink-dim">{r.counterparty ?? '—'}</span>
              {r.qty !== null ? <span>{r.qty.toLocaleString('ko-KR')} kg</span> : null}
              <span>금액 {won(r.amount_krw)}</span>
              {r.unit_krw_per_kg !== null ? <span>단가 {won(r.unit_krw_per_kg)}/kg</span> : null}
              {r.extra_krw !== null ? <span>부대비 {won(r.extra_krw)}</span> : null}
              {r.ref_no ? <span className="text-ink-muted">{r.ref_no}</span> : null}
              {r.last_action ? (
                <span className="rounded-full border border-line-soft px-2 text-ink-dim">
                  {r.last_action === 'lot' ? `넣음 ${r.target_ref ?? ''}` : r.last_action === 'ignore' ? '무시' : '나중에'} — {r.last_reason}
                </span>
              ) : null}
            </div>
            {r.last_action === 'lot' || r.last_action === 'ignore' ? null : (
              <form action={action} className="mt-2 flex flex-wrap items-end gap-2">
                <input type="hidden" name="source" value={r.source_table} />
                <input type="hidden" name="line" value={r.line_id} />
                <label className="flex flex-col gap-1">
                  <span className="text-ink-muted">결정</span>
                  <select name="action" defaultValue="lot" className={field}>
                    <option value="lot">{r.kind === 'sale' ? '판매 실적으로 넣기' : 'LOT로 넣기'}</option>
                    <option value="ignore">무시</option>
                    <option value="later">나중에</option>
                  </select>
                </label>
                {r.kind === 'purchase_lot' ? (
                  <>
                    <label className="flex flex-col gap-1">
                      <span className="text-ink-muted">원료</span>
                      <select name="material" className={field} defaultValue="">
                        <option value="">고르기</option>
                        {materials.map((m) => (
                          <option key={m.material_id} value={m.material_id}>
                            {m.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-ink-muted">공급처</span>
                      <select name="supplier" className={field} defaultValue="">
                        <option value="">고르기</option>
                        {suppliers.map((s) => (
                          <option key={s.supplier_id} value={s.supplier_id}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-ink-muted">입고일(비우면 거래일)</span>
                      <input type="date" name="on" className={field} />
                    </label>
                  </>
                ) : r.kind === 'landed' ? (
                  <label className="flex flex-col gap-1">
                    <span className="text-ink-muted">부대비를 더할 LOT(앞 LOT는 무효 · 새 LOT)</span>
                    <select name="lot" className={field} defaultValue="">
                      <option value="">고르기</option>
                      {liveLots.map((l) => (
                        <option key={l.lot_id} value={l.lot_id}>
                          {l.lot_id} · {matName.get(l.material_id) ?? '원료'} · {l.received_on}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <>
                    <label className="flex flex-col gap-1">
                      <span className="text-ink-muted">제품</span>
                      <select name="product" className={field} defaultValue="">
                        <option value="">고르기</option>
                        {products.map((p) => (
                          <option key={p.product_id} value={p.product_id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-ink-muted">출고일(비우면 거래일)</span>
                      <input type="date" name="on" className={field} />
                    </label>
                  </>
                )}
                <label className="flex min-w-[220px] flex-1 flex-col gap-1">
                  <span className="text-ink-muted">이유(꼭)</span>
                  <input name="reason" required minLength={2} maxLength={300} className={field} />
                </label>
                <button type="submit" className="min-h-11 rounded-md border border-line bg-panel px-3 hover:border-accent lg:min-h-0 lg:py-1">
                  정하기
                </button>
              </form>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

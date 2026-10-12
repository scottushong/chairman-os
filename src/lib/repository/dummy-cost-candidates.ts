import { kstToday } from '@/lib/chairman-project'
import type { CandidateAction, CandidateSource, CostCandidate } from '@/types'

import { dummyHasBusiness, dummyModuleGrants, dummyViewer } from './dummy-org'
import { dummyCostCan } from './dummy-purchasing'
import type { ChairmanRepository } from './types'

/**
 * 0078 «원가 후보 승인»의 dummy 자리(live에서는 돌지 않는다). 0078 cost_candidate_gate · cost_fin_candidates · cost_fin_candidate_decide를 옮겨 적었다.
 * 후보 줄은 **가짜**(가짜 원료 · 가짜 공급처 · 가짜 고객) — ②는 dummy 자료 올리기 입고 줄(살아 있는 것)을, ⑦ · ①은 이 파일의 가짜 줄을 쓴다.
 * 넣기: ② · ⑦은 dummy 구매 LOT 길(addPurchaseLot · voidPurchaseLot — 구매 쓰기 문 그대로), ①은 영업 쓰기 문만 보고 가짜 판매 id(0067 sale_record 흉내).
 */

export interface DummyCostCandidatesDeps {
  featureOn(businessId: string): Promise<boolean>
  purchaseInLines(businessId: string): { line_id: number; period: string; tx_date: string | null; material: string | null; supplier: string | null; qty: number | null; amount: number | null }[]
  addLot(businessId: string, input: Record<string, unknown>): Promise<{ lot_id: string }>
  voidLot(businessId: string, lotId: string, reason: string): Promise<void>
  lot(businessId: string, lotId: string): Record<string, unknown> | null
}

interface Decision {
  business_id: string
  source_table: CandidateSource
  line_id: number
  action: CandidateAction
  reason: string
  target_ref: string | null
  decided_at: string
  superseded: boolean
}

const decisions: Decision[] = []
let saleSeq = 0

function fakeLines(businessId: string): Omit<CostCandidate, 'last_action' | 'last_reason' | 'last_at' | 'target_ref'>[] {
  if (businessId !== 'biz_dy') return []
  const ym = kstToday().slice(0, 7)
  return [
    { source_table: 'fin_import_lines', kind: 'landed', line_id: 9001, period: ym, tx_date: null, name: '가짜 원재료 A', counterparty: '가짜 공급처 갑', qty: null, amount_krw: 1_400_000, unit_krw_per_kg: null, extra_krw: 35_000, ref_no: 'OFFER-가짜-1' },
    { source_table: 'fin_sales_lines', kind: 'sale', line_id: 9101, period: ym, tx_date: kstToday(), name: '가짜 제품 X', counterparty: '(주)가짜상사', qty: 50, amount_krw: 450_000, unit_krw_per_kg: 9000, extra_krw: null, ref_no: null },
  ]
}

function gate(businessId: string): boolean {
  const v = dummyViewer()
  if (v.revoked_at || !dummyHasBusiness(v, businessId)) return false
  if (v.role === 'Chairman') return true
  if (v.role === 'AIAgent' || v.role === 'Integration') return false
  return dummyModuleGrants(v.user_id).some((m) => m.module === `/costing/${businessId}` && m.can_write)
}

export function dummyCostCandidates(d: DummyCostCandidatesDeps): Pick<ChairmanRepository, 'listCostCandidates' | 'decideCostCandidate'> {
  const all = (businessId: string) => [
    ...d.purchaseInLines(businessId).map((p) => ({
      source_table: 'fin_purchase_in_lines' as const, kind: 'purchase_lot' as const, line_id: p.line_id, period: p.period, tx_date: p.tx_date,
      name: p.material, counterparty: p.supplier, qty: p.qty, amount_krw: p.amount,
      unit_krw_per_kg: p.qty && p.amount && p.qty > 0 && p.amount > 0 ? Math.round(p.amount / p.qty) : null, extra_krw: null, ref_no: null,
    })),
    ...fakeLines(businessId),
  ]
  const live = (src: CandidateSource, line: number) => decisions.filter((x) => x.source_table === src && x.line_id === line && !x.superseded)
  const open = async (businessId: string) => {
    if (!(await d.featureOn(businessId))) throw new Error('feature_off')
    if (!gate(businessId)) throw new Error('cost_not_found')
  }
  return {
    async listCostCandidates(businessId, includeDone) {
      await open(businessId)
      return all(businessId)
        .map((c): CostCandidate => {
          const last = live(c.source_table, c.line_id).at(-1)
          return { ...c, last_action: last?.action ?? null, last_reason: last?.reason ?? null, last_at: last?.decided_at ?? null, target_ref: last?.target_ref ?? null }
        })
        .filter((c) => includeDone || c.last_action === null || c.last_action === 'later')
    },
    async decideCostCandidate(businessId, x) {
      await open(businessId)
      const reason = x.reason.trim()
      if (!reason || reason.length > 300) throw new Error('cost_candidate_reason')
      const line = all(businessId).find((c) => c.source_table === x.source && c.line_id === x.line_id)
      if (!line) throw new Error('cost_not_found')
      if (live(x.source, x.line_id).some((v) => v.action !== 'later')) throw new Error('cost_candidate_done')
      let target: string | null = null
      if (x.action === 'lot') {
        if (x.source === 'fin_purchase_in_lines') {
          if (!dummyCostCan('purchasing', businessId, true)) throw new Error('cost_not_found')
          if (!x.material_id || !x.supplier_id || !line.qty || !line.amount_krw) throw new Error('cost_candidate_invalid')
          const lot = await d.addLot(businessId, {
            material_id: x.material_id, supplier_id: x.supplier_id, received_on: x.on || line.tx_date || kstToday(), ordered_on: null, supplier_lot_no: '',
            qty_kg: line.qty, unit_price: line.amount_krw / line.qty, currency: 'KRW', fx_rate: null, freight_krw: 0, duty_krw: 0, other_krw: 0,
            source: 'import', source_ref: `fin_purchase_in_lines:${line.line_id}`, note: '자료 올리기 ② 입고 후보(0078)',
          })
          target = lot.lot_id
        } else if (x.source === 'fin_import_lines') {
          if (!dummyCostCan('purchasing', businessId, true)) throw new Error('cost_not_found')
          const old = x.lot_id ? d.lot(businessId, x.lot_id) : null
          if (!old || old.voided_at || !line.extra_krw) throw new Error('cost_candidate_invalid')
          await d.voidLot(businessId, String(old.lot_id), `Landed 부대비 후보 반영(fin_import_lines:${line.line_id}) — ${reason}`.slice(0, 300))
          const keep = ['material_id', 'supplier_id', 'received_on', 'ordered_on', 'supplier_lot_no', 'qty_kg', 'unit_price', 'currency', 'fx_rate', 'freight_krw', 'duty_krw']
          const rest = Object.fromEntries(keep.map((k) => [k, old[k] ?? null]))
          const lot = await d.addLot(businessId, { ...rest, other_krw: Number(old.other_krw) + line.extra_krw, source: 'import', source_ref: `fin_import_lines:${line.line_id}`, note: `자료 올리기 ⑦ OFFER 부대비 후보(0078) · 앞 LOT ${String(old.lot_id)}` })
          target = lot.lot_id
        } else {
          if (!dummyCostCan('sales', businessId, true)) throw new Error('sale_not_found')
          if (!x.product_id || !line.qty) throw new Error('cost_candidate_invalid')
          target = `sl_fake_cand_${++saleSeq}`
        }
      }
      for (const v of live(x.source, x.line_id)) v.superseded = true
      decisions.push({ business_id: businessId, source_table: x.source, line_id: x.line_id, action: x.action, reason, target_ref: target, decided_at: new Date().toISOString(), superseded: false })
      return target ?? `dec_fake_${decisions.length}`
    },
  }
}

import { kstToday } from '@/lib/chairman-project'
import { aggregateMargins, type MarginSaleInput } from '@/lib/sales/margins'
import type { SaleDeal, SaleGrade } from '@/types'

import { DUMMY_UID, dummyHasBusiness, dummyModuleGrants, dummyViewer } from './dummy-org'
import { dummyCostCan } from './dummy-purchasing'
import { dummyMarginsGate } from './dummy-sales-cost'
import type { ChairmanRepository } from './types'

/**
 * 0077 «판매 실적 · 마진»의 dummy 자리(live에서는 돌지 않는다). 0077 sales_deals · sales_margins와 0067 sale_visible · cost_margins를 옮겨 적었다.
 * 판매 줄은 **가짜**(가짜 제품 X · Y · Z · 가짜 고객)이고, 실제 원가 원래 값(act_raw)도 이 파일에만 있는 가짜 숫자다 — BOM · 원료 kg가 없다.
 * 문(대표 · 원가 관리 · 하루 20번 · 호출마다 감사 · 겸직 거부)은 dummy 원가 엔진의 문(dummyMarginsGate)을 그대로 지난다.
 */

export interface DummySalesMarginsDeps {
  featureOn(businessId: string): Promise<boolean>
  inSubtree(viewerId: string, targetId: string): boolean
  /** 0075 내부 마감 확정 달(YYYY-MM) — dummy 월별 손익 저장소. */
  closedMonths(businessId: string): Set<string>
}

interface Sale extends MarginSaleInput {
  business_id: string
  customer_name: string
  grade: SaleGrade
  grade_as_of: string
  created_by: string
}

const DY = 'biz_dy'
const day = (n: number) => kstToday(new Date(Date.now() + n * 86_400_000))

function seed(): Sale[] {
  const s = (
    n: number, at: number, who: string, product: 'x' | 'y' | 'z', customer: string, kg: number, price: number, source: 'actual' | 'current',
    actRaw: number | null, grade: SaleGrade, quote: { price: number; raw: number } | null,
  ): Sale => ({
    sale_id: `sl_fake_${String(n).padStart(3, '0')}`, business_id: DY, shipped_on: day(at), product_id: `prd_fake_${product}`,
    product_name: `제품 ${product.toUpperCase()}(가짜)`, customer_company: customer, customer_name: '김가짜', kg, price_krw_per_kg: price, currency: 'KRW',
    source, act_raw: actRaw, quote_id: quote ? `qt_fake_${n}` : null, q_price: quote?.price ?? null, q_raw: quote?.raw ?? null,
    grade, grade_as_of: day(at), created_by: who,
  })
  return [
    s(1, -2, DUMMY_UID.salesStaff, 'x', '(주)가짜상사', 333.333, 9100, 'current', 6789.4321, 'green', { price: 9100, raw: 6700.25 }),
    s(2, -9, DUMMY_UID.salesStaff, 'y', '(주)가짜상사', 1000, 8400, 'actual', 7100.5, 'yellow', null),
    s(3, -35, DUMMY_UID.salesStaff2, 'x', '가짜푸드', 500, 9000, 'current', null, 'unknown', null),
    s(4, -40, DUMMY_UID.salesLead, 'z', '가짜푸드', 250.5, 12000, 'actual', 9300.125, 'green', { price: 12500, raw: 9200 }),
    s(5, -70, DUMMY_UID.salesStaff, 'z', '(주)가짜상사', 120, 11000, 'actual', null, 'red', null),
  ]
}

const g = globalThis as unknown as { __chairmanDummySalesMargins?: Sale[] }
const store: Sale[] = (g.__chairmanDummySalesMargins ??= seed())

const PERIOD = /^\d{4}-\d{2}-\d{2}$/
function range(from: string, to: string) {
  if (!PERIOD.test(from) || !PERIOD.test(to) || from > to || Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`) > 1100 * 86_400_000) throw new Error('cost_invalid')
}

/** 0067 sale_visible 거울. */
function visible(d: DummySalesMarginsDeps, s: Sale): boolean {
  const v = dummyViewer()
  if (v.revoked_at || !dummyHasBusiness(v, s.business_id)) return false
  if (v.role === 'Chairman') return true
  const b = s.business_id
  const rows = dummyModuleGrants(v.user_id)
  if (!dummyCostCan('sales', b)) return false
  if (rows.some((m) => m.module === `/purchasing/${b}` && m.can_write)) return false
  if (!dummyCostCan('costing', b) && rows.some((m) => m.module === `/purchasing/${b}` || m.module === `/production/${b}`)) return false
  return s.created_by === v.user_id || (v.role === 'TeamLead' && d.inSubtree(v.user_id, s.created_by))
}

export function dummySalesMargins(d: DummySalesMarginsDeps): Pick<ChairmanRepository, 'listSaleDeals' | 'salesMargins'> {
  return {
    async listSaleDeals(businessId, from, to) {
      if (!(await d.featureOn(businessId))) throw new Error('feature_off')
      range(from, to)
      const me = dummyViewer().user_id
      return store
        .filter((s) => s.business_id === businessId && s.shipped_on >= from && s.shipped_on <= to && visible(d, s))
        .sort((a, b) => (a.shipped_on < b.shipped_on ? 1 : a.shipped_on > b.shipped_on ? -1 : 0))
        .map(
          (s): SaleDeal => ({
            sale_id: s.sale_id, shipped_on: s.shipped_on, customer_company: s.customer_company, customer_name: s.customer_name, product_name: s.product_name,
            kg: s.kg, price_krw_per_kg: s.price_krw_per_kg, currency: s.currency, revenue_krw: Math.round(s.kg * s.price_krw_per_kg),
            grade: s.grade, grade_as_of: s.grade_as_of, grade_basis: s.created_by === DUMMY_UID.salesStaff ? 'midnight' : 'now', quote_id: s.quote_id, mine: s.created_by === me,
          }),
        )
    },
    async salesMargins(businessId, from, to, grain, by) {
      if (!(await d.featureOn(businessId))) throw new Error('feature_off')
      const v = dummyViewer()
      if (!(v.role === 'Chairman' || dummyCostCan('costing', businessId))) throw new Error('cost_not_found')
      range(from, to)
      if (!['day', 'week', 'month', 'quarter', 'year'].includes(grain) || !['deal', 'product', 'customer', 'total'].includes(by)) throw new Error('cost_invalid')
      const gt = dummyMarginsGate(businessId)
      const xs = store.filter((s) => s.business_id === businessId && s.shipped_on >= from && s.shipped_on <= to)
      return aggregateMargins(xs, grain, by, gt.chairman, d.closedMonths(businessId))
    },
  }
}

/** 시험이 가짜 판매 줄을 본다(dummy만). */
export function dummySaleRows(): readonly Readonly<Sale>[] {
  return store
}

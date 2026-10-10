// scripts/check-sales-cost.ts가 이 파일을 바로 import한다 — 런타임 import는 상대 경로로 둔다.
import ExcelJS from 'exceljs'

import type { Quote } from '@/types'

/**
 * 0066 고객용 견적서(.xlsx) — 한 장. **원가 · 마진 · 등급 · 원가 기준 · 결재 · 만든 사람은 넣지 않는다**(고객에게 가는 파일).
 * 들어가는 것: 견적 번호(판) · 날짜 · 고객 · 제품 · 수량 · 단가 · 금액 · 통화 · 유효기간 · 공급자 회사 이름.
 * 통화가 원화가 아니면 단가 = 제시가(원/kg) ÷ 저장 순간 환율(소수 둘째 자리).
 */
export const CUSTOMER_QUOTE_FIELDS = ['견적 번호', '견적일', '고객 회사', '고객 담당', '제품', '수량(kg)', '단가', '금액', '통화', '유효기간', '공급자'] as const

export function customerUnitPrice(q: Pick<Quote, 'price_krw_per_kg' | 'currency' | 'fx_rate'>): number {
  return q.currency === 'KRW' ? q.price_krw_per_kg : Math.round((q.price_krw_per_kg / q.fx_rate) * 100) / 100
}

export function buildCustomerQuote(q: Quote, supplierName: string): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook()
  wb.creator = supplierName
  const ws = wb.addWorksheet('견적서')
  ws.columns = [{ width: 16 }, { width: 44 }]
  ws.addRow(['견적서']).font = { bold: true, size: 16 }
  ws.addRow([])
  const unit = customerUnitPrice(q)
  const money = q.currency === 'KRW' ? '#,##0' : '#,##0.00'
  const rows: [string, string | number | Date][] = [
    ['견적 번호', `${q.root_id} (${q.version}판)`],
    ['견적일', new Date(`${q.created_at.slice(0, 10)}T00:00:00Z`)],
    ['고객 회사', q.customer_company],
    ['고객 담당', q.customer_name],
    ['제품', q.product_name],
    ['수량(kg)', q.kg],
    ['단가', unit],
    ['금액', Math.round(unit * q.kg * 100) / 100],
    ['통화', q.currency],
    ['유효기간', new Date(`${q.valid_until}T00:00:00Z`)],
    ['공급자', supplierName],
  ]
  for (const [k, v] of rows) {
    const r = ws.addRow([k, v])
    r.getCell(1).font = { bold: true }
    if (v instanceof Date) r.getCell(2).numFmt = 'yyyy-mm-dd'
    if (k === '단가' || k === '금액') r.getCell(2).numFmt = money
    if (k === '수량(kg)') r.getCell(2).numFmt = '#,##0.###'
  }
  ws.addRow([])
  ws.addRow([`단가는 kg당 ${q.currency}. 유효기간이 지나면 다시 견적합니다.`])
  return wb
}

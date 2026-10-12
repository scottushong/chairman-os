/**
 * PHASE 3 «월별 손익 — 재고 반영 매출원가 · 손익과 현금 분리 · 마감» (0075 · src/lib/finance/monthly-pl.ts).
 *
 * 금액은 전부 원(KRW). null = «미입력»(0이 아니다). 0 = 확인된 0.
 * 칸 이름은 0075 fin_pl_compute(jsonb)의 열쇠와 같다(snake_case) — 같은 입력을 SQL과 TS가 같은 결과로 계산해야 한다
 * (scripts/check-monthly-pl.ts가 PGlite에서 대조한다).
 */

/** 원료 평가방법. monthly_wa = 원료별 월 가중평균(기본 · 관리용 잠정) · statement = 재고금액명세서 금액 그대로(공식 방법 확인 뒤). */
export type PlMethod = 'monthly_wa' | 'statement'

/** 매출을 어디서 읽나 — 하나만(둘을 더하지 않는다). books = 장부(전표 · 결산) · sales_upload = 올린 판매현황. */
export type PlRevenueSource = 'books' | 'sales_upload'

export type PlNonProductionKind = 'sample' | 'scrap' | 'return' | 'adjust'

export type PlAdjustmentKind = 'shrinkage' | 'scrap' | 'valuation_loss' | 'other'

/** 원료 한 가지의 한 달(원료끼리 섞지 않는다). 수량 kg · 금액 원. */
export interface PlMaterialInput {
  name: string
  opening_qty: number | null
  opening_amount: number | null
  /** prev_close = 앞 달 내부 마감 확정 기말 · statement = 앞 달 재고금액명세서 · statement_absent = 앞 달 명세서에 없음(0으로 봄) · missing. */
  opening_source: 'prev_close' | 'statement' | 'statement_absent' | 'missing'
  purchase_qty: number
  purchase_amount: number
  /** 확인된 생산 투입 kg(출고 구분 «생산 투입»). 출고명세가 없으면 null. */
  production_qty: number | null
  /** 비생산 출고 kg(성격별). 창고 이동(transfer)은 회사 재고가 바뀌지 않아 넣지 않는다. */
  non_production: Partial<Record<PlNonProductionKind, number>>
  /** 이 원료의 «확인 필요» 출고 줄 수 · kg 빈칸 줄 수. */
  issue_needs_review: number
  issue_missing_qty: number
  /** 이 달 재고금액명세서 기말 수량 · 금액. 명세서가 없으면 null. */
  closing_qty: number | null
  closing_statement_amount: number | null
  /** 이 달 명세서에 없는 원료(명세서는 있다) — 기말 0으로 본다(경고). */
  closing_absent?: boolean
}

export interface PlStockInput {
  opening_amount: number | null
  /** prev_pl_close = 앞 달 내부 마감 확정 · prev_final_valuation = 앞 달 확정 평가금액(0072) · manual · statement = 첫 달 직접 입력(0072) · unlinked. */
  opening_source: 'prev_pl_close' | 'prev_final_valuation' | 'manual' | 'statement' | 'unlinked'
  opening_scope: 'material_only' | 'material_labor_overhead' | null
  closing_amount: number | null
  closing_status: 'entering' | 'provisional' | 'final' | null
  closing_scope: 'material_only' | 'material_labor_overhead' | null
  /** 0072 «재공품 · 완제품 중복 의심»(같은 금액 · 같은 출처). */
  duplicate_suspect: boolean
}

export interface PlAdjustmentInput {
  kind: PlAdjustmentKind
  /** 원. 양수 = 손실(원료 재고가 장부보다 적다). */
  amount: number
  status: 'proposed' | 'approved'
}

export interface MonthlyPlInput {
  period: string
  method: PlMethod
  /** 세무사가 평가방법을 확인했나 — false면 «관리용 잠정 기준». */
  method_confirmed: boolean
  tolerance_krw: number
  materials: PlMaterialInput[]
  /** 이 달 원료 출고명세가 하나라도 있나(없으면 생산 투입을 모른다). */
  issues_uploaded: boolean
  /** 이 달 재고금액명세서가 있나. */
  statement_uploaded: boolean
  /** 첫 달 기초 직접 입력(0072 fin_inventory_openings 원재료 합) — 원료별 수량이 없어 평균단가에는 못 쓴다(표시만). */
  raw_opening_manual: number | null
  /** 이 달 명세서의 기초 금액 합(0072 opening_amount) — 대조만. */
  raw_statement_opening: number | null
  wip: PlStockInput
  finished: PlStockInput
  revenue: number | null
  revenue_source: PlRevenueSource
  /** 장부(전표 · 결산) 이 달 손익 줄이 있나. 없으면 장부 칸은 전부 null. */
  books_has_lines: boolean
  /** 장부 매출원가 구역 · 대분류 원재료(4510 원재료비 · 4610 상품매출원가) — 새 매출원가로 **교체**되는 줄(더하지 않는다). */
  books_raw_material: number | null
  /** 장부 매출원가 구역 · 인건비 대분류(4520 제조인건비 …). */
  mfg_labor: number | null
  /** 장부 매출원가 구역 · 그 밖(전력 · 운반 · 라이선스 · 기타제조경비 · 외주가공). */
  mfg_overhead: number | null
  /** 장부 판관비 + 감가상각(영업이익 아래 줄 — 재고에 배분하지 않는다). */
  sga: number | null
  /** 지금 장부 영업이익(A 방식 — 매입이 원재료비로 바로 비용). 검산 칸만. */
  books_operating_income: number | null
  adjustments: PlAdjustmentInput[]
  cash: {
    uploaded: boolean
    /** 자금흐름표 출금 중 항목 이름이 원료 대금 규칙에 맞는 줄의 합. */
    material_payments: number | null
    inflow: number | null
    outflow: number | null
  }
  /** 같은 거래 묶음(0072 same)으로 빠진 입고 줄 수 · 입고 줄 둘 이상이 든 «중복 의심» 묶음 수. */
  purchase_dupes_excluded: number
  purchase_suspects: number
  link: {
    /** 앞 달이 내부 마감 확정인가(그러면 기초는 그 기말에서 왔다). */
    prev_final: boolean
    /** 앞 달보다 더 앞에 확정 달이 있나(그러면 앞 달도 마감해야 한다). */
    earlier_final: boolean
  }
}

export interface PlIssue {
  code: string
  message: string
  target?: string
}

export interface PlMaterialResult {
  name: string
  opening_qty: number | null
  opening_amount: number | null
  opening_source: PlMaterialInput['opening_source']
  purchase_qty: number
  purchase_amount: number
  /** 원료별 월 가중평균단가(원/kg, 소수 4자리 표시용). 근거가 없으면 null(최신 구매가로 대체하지 않는다). */
  wa_unit_cost: number | null
  production_qty: number | null
  production_cost: number | null
  non_production_qty: number
  non_production_cost: number | null
  expected_closing_qty: number | null
  closing_qty: number | null
  closing_amount: number | null
  closing_statement_amount: number | null
  /** 장부상 남아야 할 수량 − 명세서 수량(감모 · 오류). 대사 차이의 원료별 근거. */
  shrinkage_qty: number | null
  shrinkage_cost: number | null
  errors: string[]
}

export interface MonthlyPlResult {
  calc_version: string
  period: string
  method: PlMethod
  method_label: string
  /** entering = 입력 중(영업이익을 못 냄) · provisional = 잠정. 내부 마감 확정은 저장된 줄(fin_pl_closes)만 말한다. */
  status: 'entering' | 'provisional'
  closable: boolean
  /** full = 영업이익까지 · raw_usage_only = 원료 사용액까지 · none. */
  scope: 'full' | 'raw_usage_only' | 'none'
  scope_label: string
  pl: {
    revenue: number | null
    cogs: number | null
    gross_profit: number | null
    sga: number | null
    /** 재고 변동(비생산 출고 · 승인된 조정) — 처리 기준 확인 전 별도 줄. 원료 사용액에서 빼서 옮긴 것이라 두 번 세지 않는다. */
    inventory_other: number | null
    operating_income: number | null
  }
  basis: {
    raw_opening: number | null
    raw_purchases: number
    raw_closing: number | null
    /** ① 원료 사용액(재고 증감 기준) = 기초 + 순매입 − 기말. */
    raw_usage: number | null
    /** 생산 투입원가(투입 기준) = Σ 원료별 확인된 투입 kg × 월 가중평균. 대표 · 원가 권한 밖은 원료 3가지 미만이면 감춘다. */
    production_input: number | null
    non_production: number | null
    adjustments_approved: number
    adjustments_by_kind: Partial<Record<PlAdjustmentKind, number>>
    /** 제조로 간 원료비 = ① − 비생산 − 승인된 조정. */
    raw_to_production: number | null
    /** 대사 차이 = 제조로 간 원료비 − 생산 투입원가. 자동으로 맞추지 않는다. */
    recon_diff: number | null
    recon_ok: boolean | null
    mfg_labor: number | null
    mfg_overhead: number | null
    /** ② 제조비용. */
    mfg_cost: number | null
    wip_opening: number | null
    wip_closing: number | null
    /** ③ 완성품 제조원가. */
    cogm: number | null
    finished_opening: number | null
    finished_closing: number | null
  }
  cash: {
    state: 'value' | 'not_uploaded'
    material_payments: number | null
    inflow: number | null
    outflow: number | null
    net: number | null
  }
  check: {
    /** 지금 장부 영업이익(A 방식). */
    books_operating_income: number | null
    inventory_opening_total: number | null
    inventory_closing_total: number | null
    /** 검산 = 기존 손익 + 기말 전체 재고 − 기초 전체 재고(일괄 보정에 쓰지 않는다). */
    check_value: number | null
    /** 검산 − 새 영업이익(장부 매입 ≠ 입고 매입 · 비생산 · 조정 · 시점 차이). */
    diff_vs_new: number | null
    books_raw_material: number | null
    /** 장부 원재료비(교체됨) − 입고명세서 순매입. */
    purchase_vs_books_diff: number | null
  }
  blockers: PlIssue[]
  warnings: PlIssue[]
  materials: PlMaterialResult[]
  material_count: number
  /** 대표 · 원가 권한 밖에서 감춘 칸(있으면). */
  withheld?: string[]
}

/** 저장된 마감 한 줄(0075 fin_pl_closes). status: provisional 잠정 · final 내부 마감 확정. */
export interface PlCloseRecord {
  close_id: string
  status: 'provisional' | 'final'
  calc_version: string
  input_hash: string
  recorded_at: string
  recorded_by_name: string | null
  closed_at: string | null
  closed_by_name: string | null
}

/** 화면이 읽는 한 달(fin_pl_month). */
export interface MonthlyPlView {
  business_id: string
  period: string
  /** entering 입력 중 · provisional 잠정 · final 내부 마감 확정. */
  view_status: 'entering' | 'provisional' | 'final'
  record: PlCloseRecord | null
  result: MonthlyPlResult
  stale: {
    /** 마감 뒤 원천 자료가 바뀌었다(숫자는 마감 때 그대로). */
    inputs_changed: boolean
    /** 앞 달 확정 기말과 이 달 기초가 다르다(앞 달을 다시 마감했다) — 재마감 대상. 원재료 · 재공품 · 완제품 차이(원). */
    opening_diff: { raw: number | null; wip: number | null; finished: number | null } | null
    reclose_flags: number
  }
  /** 내부 마감 때 저장한 «잠정 → 마감» 차이(조정 내역). */
  provisional_diff: Partial<Record<keyof MonthlyPlResult['pl'], number | null>> | null
  /** 앞 확정 대비 바뀐 값(다시 마감한 달). */
  changed_vs_prev_final: Record<string, number | null> | null
  adjustments: PlAdjustmentRow[]
}

export interface PlAdjustmentRow {
  adj_id: string
  kind: PlAdjustmentKind
  amount: number
  reason: string
  status: 'proposed' | 'approved' | 'voided'
  proposed_by_name: string | null
  proposed_at: string
  approved_by_name: string | null
}

export interface PlSettings {
  method: PlMethod
  method_confirmed: boolean
  tolerance_krw: number
  revenue_source: PlRevenueSource
  payment_categories: string[]
  updated_at: string | null
}

export interface PlYearRow {
  period: string
  status: 'provisional' | 'final'
  closed_at: string | null
}

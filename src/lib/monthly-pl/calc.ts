import type {
  MonthlyPlInput,
  MonthlyPlResult,
  PlAdjustmentKind,
  PlIssue,
  PlMaterialResult,
  PlMethod,
  PlNonProductionKind,
} from '@/types'

/**
 * PHASE 3 «월별 손익 — 재고 반영 매출원가» 순수 계산(서버 · DB를 모른다).
 *
 * 0075 fin_pl_compute(jsonb)가 **같은 식을 SQL로** 쓴다 — live는 SQL이 계산하고(원료별 kg는 정의자 함수 안에서만 읽힌다),
 * 이 파일은 dummy 모드 · 시험 · 화면 도우미가 쓴다. scripts/check-monthly-pl.ts가 같은 입력으로 둘을 대조한다.
 *
 * 흐름: 원료 매입 → 원료 재고 → 생산 투입 → 재공품 → 완제품 → 판매분 매출원가.
 *   ① 원료 사용액(재고 증감) = 기초 원료 + 순매입 − 기말 원료
 *      제조로 간 원료비 = ① − 비생산 출고(성격별) − 승인된 재고 조정        ← 재고 차이를 전부 생산 원료비로 넣지 않는다
 *   ② 제조비용 = 제조로 간 원료비 + 제조 인건비 + 제조경비
 *   ③ 완성품 제조원가 = 기초 재공품 + ② − 기말 재공품
 *   ④ 매출원가 = 기초 완제품 + ③ − 기말 완제품 + 장부 4610 상품매출원가(입고명세서에 없는 상품 — 교체하지 않고 더한다)
 *   ⑤ 매출총이익 = 매출 − ④
 *   ⑥ 영업이익 = ⑤ − 판관비 − 재고 변동(비생산 출고 + 승인된 조정 — 처리 기준 확인 전 별도 줄)
 *   ①의 모든 원은 ②(→ ④) 또는 «재고 변동» 중 **한 곳에만** 간다 — 조정을 더해도 영업이익은 그대로, 줄만 옮긴다(이중 반영 금지).
 *
 * 원료별 월 가중평균단가 = (기초 금액 + 순매입 금액) ÷ (기초 수량 + 순매입 수량) — 원료끼리 섞지 않는다.
 *   생산 투입원가(투입 기준) = 확인된 투입 kg × 그 단가. 투입 기준과 ①(재고 증감)의 차이가 «대사 차이» — 보여 주기만 하고 맞추지 않는다.
 *   수량 ≤ 0이면 단가를 만들지 않는다(최신 구매가로 대신하지 않는다). 기초가 없으면 0이 아니라 «미입력».
 *   이동평균(입고 때마다 갱신)과 원가 엔진 Current와 다르다 — 이 단가는 그 달 하나의 평균이다.
 *
 * 반올림: 원료별 금액을 «수량 × 금액합 ÷ 수량합»으로 한 번 계산하고 그 자리에서 1원(0.5는 0에서 먼 쪽 — Postgres round와 같다).
 *   합계는 반올림한 원료별 금액의 합. 차이(감모)는 남은 값으로 계산해 합계가 원 단위로 정확히 맞물린다.
 */

export const PL_CALC_VERSION = 'pl-2026-10-12.2'

/** 1원 — 0.5는 0에서 먼 쪽(Postgres round(numeric)과 같다). */
export function roundWon(x: number): number {
  const r = Math.sign(x) * Math.round(Math.abs(x))
  return r === 0 ? 0 : r
}

/** kg — 소수 4자리(numeric(20,4)와 같다). */
export function roundQty(x: number): number {
  const r = Math.sign(x) * Math.round(Math.abs(x) * 10_000) / 10_000
  return r === 0 ? 0 : r
}

export function methodLabel(method: PlMethod, confirmed: boolean): string {
  if (method === 'statement') return confirmed ? '재고금액명세서 금액 그대로(공식 장부 방법)' : '재고금액명세서 금액 그대로(세무사 확인 전 — 관리용 잠정)'
  return confirmed ? '원료별 월 가중평균(세무사 확인)' : '관리용 잠정 기준(원료별 월 가중평균)'
}

/** 원료 이름 맞추기 — 앞뒤 공백 · 겹친 공백만(0075 fin_pl_norm과 같다). 다른 이름은 다른 원료다. */
export function normalizeMaterial(name: string | null | undefined): string {
  return (name ?? '').replace(/\s+/g, ' ').trim()
}

const NP_KINDS: readonly PlNonProductionKind[] = ['sample', 'scrap', 'return', 'adjust']
const ADJ_KINDS: readonly PlAdjustmentKind[] = ['shrinkage', 'scrap', 'other']

const MAT_MSG: Record<string, string> = {
  opening_missing: '원료 기초(수량 · 금액)가 없음 — 앞 달 재고금액명세서를 올리거나 앞 달을 마감하세요(0으로 채우지 않음)',
  closing_missing: '이 달 재고금액명세서의 기말 수량이 없음',
  qty_nonpositive: '기초 + 매입 수량이 0 이하 — 평균단가를 만들 수 없음(최신 구매가로 대신하지 않음)',
  amount_negative: '기초 + 매입 금액이 음수 — 자료 확인 필요',
  negative_stock: '기말 수량이 음수 — 자료 확인 필요(고치지 않음)',
  over_issue: '출고(생산 투입 + 비생산)가 기초 + 매입보다 많음 — 음수 재고(고치지 않음)',
  return_kind: '반품 출고 — 매입 환출 처리 기준 확인 필요',
  needs_review: '원료 출고 구분 «확인 필요» 줄이 남음',
  missing_qty: '원료 출고 kg 빈칸 줄이 있음',
  purchase_missing: '입고 줄에 수량 또는 금액 빈칸이 있음 — 0으로 채우지 않음',
  transfer_kind: '이동 출고 — 처리 기준 필요(회사 안 창고 이동인지 정하기 전에는 마감하지 않음)',
}

const add = (a: number | null, b: number | null): number | null => (a === null || b === null ? null : a + b)
const sub = (a: number | null, b: number | null): number | null => (a === null || b === null ? null : a - b)
function sumOrNull(xs: (number | null)[]): number | null {
  let t = 0
  for (const x of xs) {
    if (x === null) return null
    t += x
  }
  return t
}
const won = (n: number) => `${n.toLocaleString('ko-KR')}원`

function material(m: MonthlyPlInput['materials'][number], method: PlMethod): PlMaterialResult {
  const errors: string[] = []
  const np = NP_KINDS.reduce((t, k) => t + (m.non_production[k] ?? 0), 0)
  if ((m.non_production.return ?? 0) > 0) errors.push('return_kind')
  if (m.issue_needs_review > 0) errors.push('needs_review')
  if (m.issue_missing_qty > 0) errors.push('missing_qty')
  if ((m.purchase_missing ?? 0) > 0) errors.push('purchase_missing')
  if ((m.issue_transfer ?? 0) > 0) errors.push('transfer_kind')
  const openKnown = m.opening_qty !== null && m.opening_amount !== null
  if (!openKnown) errors.push('opening_missing')
  if (m.closing_qty === null) errors.push('closing_missing')
  else if (m.closing_qty < 0) errors.push('negative_stock')
  else if (method === 'statement' && m.closing_statement_amount === null) errors.push('closing_missing')

  const denQ = openKnown ? m.opening_qty! + m.purchase_qty : null
  const denA = openKnown ? m.opening_amount! + m.purchase_amount : null
  const prodQ = m.production_qty
  // 아무 일도 없는 원료(기초 0 · 매입 0 · 출고 0 · 기말 0) — 단가 없이 0.
  const idle = denQ === 0 && denA === 0 && (prodQ ?? 0) === 0 && np === 0 && (m.closing_qty ?? 0) === 0
  let ok = false
  if (denQ !== null && denA !== null && !idle) {
    if (denQ <= 0) errors.push('qty_nonpositive')
    else if (denA < 0) errors.push('amount_negative')
    else ok = true
  }
  const at = (q: number) => roundWon((q * denA!) / denQ!)
  const production_cost = idle ? 0 : ok && prodQ !== null ? at(prodQ) : null
  const non_production_cost = idle ? 0 : ok && prodQ !== null ? at(np) : null
  const expected = denQ !== null && prodQ !== null ? roundQty(denQ - prodQ - np) : null
  if (expected !== null && expected < 0) errors.push('over_issue')

  let closing_amount: number | null
  if (idle) closing_amount = 0
  else if (method === 'statement') closing_amount = m.closing_statement_amount
  else closing_amount = ok && m.closing_qty !== null && m.closing_qty >= 0 ? at(m.closing_qty) : null

  const shrinkage_qty = expected !== null && m.closing_qty !== null ? roundQty(expected - m.closing_qty) : null
  const usage = sub(denA, closing_amount)
  const shrinkage_cost = shrinkage_qty === null ? null : sub(sub(usage, production_cost), non_production_cost)

  return {
    name: m.name,
    opening_qty: m.opening_qty,
    opening_amount: m.opening_amount,
    opening_source: m.opening_source,
    purchase_qty: m.purchase_qty,
    purchase_amount: m.purchase_amount,
    wa_unit_cost: ok ? Math.round((denA! / denQ!) * 10_000) / 10_000 : null,
    production_qty: prodQ,
    production_cost,
    non_production_qty: np,
    non_production_cost,
    expected_closing_qty: expected,
    closing_qty: m.closing_qty,
    closing_amount,
    closing_statement_amount: m.closing_statement_amount,
    shrinkage_qty,
    shrinkage_cost,
    errors,
  }
}

/** 한 달 계산. 입력을 고치지 않는다 — 모자란 것은 null · 막는 까닭(blockers)으로만 말한다. */
export function computeMonthlyPl(x: MonthlyPlInput): MonthlyPlResult {
  const blockers: PlIssue[] = []
  const warnings: PlIssue[] = []
  const block = (code: string, message: string, target?: string) => blockers.push(target ? { code, message, target } : { code, message })
  const warn = (code: string, message: string, target?: string) => warnings.push(target ? { code, message, target } : { code, message })

  const mats = [...x.materials].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)).map((m) => material(m, x.method))
  for (const m of mats) for (const e of m.errors) block(`material_${e}`, MAT_MSG[e] ?? e, m.name)

  const raw_opening = sumOrNull(mats.map((m) => m.opening_amount))
  const raw_purchases = mats.reduce((t, m) => t + m.purchase_amount, 0)
  const raw_closing = sumOrNull(mats.map((m) => m.closing_amount))
  const raw_usage = sub(add(raw_opening, raw_purchases), raw_closing)
  const production_input = x.issues_uploaded ? sumOrNull(mats.map((m) => m.production_cost)) : null
  const non_production = x.issues_uploaded ? sumOrNull(mats.map((m) => m.non_production_cost)) : null

  const approved = x.adjustments.filter((a) => a.status === 'approved')
  const adjustments_approved = approved.reduce((t, a) => t + a.amount, 0)
  const adjustments_by_kind: Partial<Record<PlAdjustmentKind, number>> = {}
  for (const k of ADJ_KINDS) {
    const s = approved.filter((a) => a.kind === k).reduce((t, a) => t + a.amount, 0)
    if (approved.some((a) => a.kind === k)) adjustments_by_kind[k] = s
  }
  if (x.adjustments.some((a) => a.status === 'proposed')) block('adjustments_unapproved', '승인 전 재고 조정이 있음 — 다른 마감 권한자가 승인하거나 무효로 하세요')

  const splitKnown = non_production !== null
  const raw_to_production = raw_usage === null ? null : raw_usage - (non_production ?? 0) - adjustments_approved
  const inventory_other = (non_production ?? 0) + adjustments_approved
  const recon_diff = production_input === null || raw_to_production === null || !splitKnown ? null : raw_to_production - production_input
  const recon_ok = recon_diff === null ? null : Math.abs(recon_diff) <= x.tolerance_krw

  if (!x.issues_uploaded) block('issues_not_uploaded', '이 달 원료 출고명세가 없음 — 생산 투입 · 비생산 출고를 모름')
  if (!x.statement_uploaded) block('statement_not_uploaded', '이 달 재고금액명세서가 없음 — 기말 원료 재고를 모름')
  if (raw_usage !== null && !splitKnown) warn('production_split_pending', '출고 구분 전 — 원료 사용액 전체를 제조로 넣은 잠정값')
  if (recon_ok === false) block('recon_over_tolerance', `투입 기준과 재고 증감 기준의 대사 차이가 허용오차(${won(x.tolerance_krw)})를 넘음 — 원인 확인 · 승인된 조정이 필요(자동으로 맞추지 않음)`)
  if (recon_diff === null && x.issues_uploaded && raw_usage !== null) block('recon_unavailable', '투입 기준 원가를 계산할 수 없어 대사를 못 함')
  if (x.purchase_suspects > 0) block('purchase_suspects', `입고 «중복 의심» 묶음 ${x.purchase_suspects}개 — 같은 거래인지 정하세요(자동으로 같은 거래로 보지 않음)`)
  if (x.purchase_dupes_excluded > 0) warn('purchase_dupes_excluded', `같은 거래 묶음으로 입고 줄 ${x.purchase_dupes_excluded}개를 한 번만 셈`)

  // 재공품 · 완제품
  const stock = (s: MonthlyPlInput['wip'], key: 'wip' | 'finished', ko: string) => {
    if (s.opening_amount === null) block(`${key}_opening_missing`, `${ko} 기초가 미연결 — 앞 달 확정 기말 또는 첫 달 직접 입력이 필요(0으로 채우지 않음)`)
    if (s.closing_amount === null) block(`${key}_closing_missing`, `${ko} 월말 평가금액이 미입력(0으로 채우지 않음)`)
    else if (s.closing_status !== 'final') block(`${key}_closing_not_final`, `${ko} 월말 평가금액이 확정 전 — 입력한 사람이 아닌 장부 담당이 확정`)
    if (s.opening_scope && s.closing_scope && s.opening_scope !== s.closing_scope) block(`${key}_scope_mismatch`, `${ko} 기초 · 기말 포함 원가 범위가 다름`)
    else if (s.opening_amount !== null && s.closing_amount !== null && (!s.opening_scope || !s.closing_scope)) warn(`${key}_scope_unknown`, `${ko} 기초 또는 기말의 포함 원가 범위를 모름 — 같은 범위인지 확인`)
  }
  stock(x.wip, 'wip', '재공품')
  stock(x.finished, 'finished', '완제품')
  if (x.wip.duplicate_suspect || x.finished.duplicate_suspect) block('valuation_duplicate', '재공품 · 완제품 중복 의심(같은 금액 · 같은 출처)')

  if (x.revenue === null) block('revenue_missing', x.revenue_source === 'books' ? '매출 미입력 — 장부에 이 달 매출 전표가 없음' : '매출 미입력 — 이 달 판매현황이 없음')
  if (!x.books_has_lines) block('books_missing', '장부에 이 달 손익 전표가 없음 — 제조 인건비 · 제조경비 · 판관비 미입력')
  if (!x.link.prev_final && x.link.earlier_final) block('prev_not_closed', '앞 달이 내부 마감 전 — 앞 달부터 마감하세요(기초 = 전월 확정 기말)')

  const mfg_cost = add(add(raw_to_production, x.mfg_labor), x.mfg_overhead)
  const cogm = sub(add(x.wip.opening_amount, mfg_cost), x.wip.closing_amount)
  const cogs = add(sub(add(x.finished.opening_amount, cogm), x.finished.closing_amount), x.books_merchandise_cogs)
  const gross_profit = sub(x.revenue, cogs)
  const operating_income = sub(sub(gross_profit, x.sga), inventory_other)

  // 경고(막지 않음)
  if (!x.method_confirmed) warn('method_provisional', `평가방법: ${methodLabel(x.method, false)} — 세무사 확인 뒤 설정에서 바꿀 수 있음`)
  if (inventory_other !== 0) warn('inventory_other_policy', '재고 변동(비생산 출고 · 승인된 조정)을 별도 줄로 둠 — 매출원가 · 판관비 · 영업외 중 처리 기준 확인 전')
  if (x.books_raw_material !== null && Math.abs(x.books_raw_material - raw_purchases) > x.tolerance_krw) {
    warn('purchase_vs_books_diff', '장부 원재료비(교체됨 — 4610 상품매출원가 제외)와 입고명세서 순매입이 다름 — 부가세 · 선급금 · 외상 · 시점 차이 확인')
  }
  if (x.raw_statement_opening !== null && raw_opening !== null && Math.abs(x.raw_statement_opening - raw_opening) > x.tolerance_krw) {
    warn('statement_opening_diff', '이 달 재고금액명세서의 기초와 연결한 기초(전월 기말)가 다름 — 고치지 않고 보여 주기만')
  }
  if (x.raw_opening_manual !== null && raw_opening === null) warn('raw_opening_manual_only', '첫 달 원재료 기초 합만 있고 원료별 수량이 없음 — 평균단가를 내려면 앞 달 재고금액명세서가 필요')
  if (mats.some((m) => m.opening_source === 'statement_absent')) warn('opening_absent', '앞 달 명세서에 없는 원료는 기초 0으로 봄 — 확인')
  if ((x.openings_unconfirmed ?? 0) > 0) warn('opening_unconfirmed', '이 달 기초(직접 입력) 중 아직 확인 전인 줄이 있음 — 확정 전에 재고 · 평가 화면에서 확인')
  if (x.materials.some((m) => m.closing_absent)) warn('closing_absent', '이 달 명세서에 없는 원료는 기말 0으로 봄 — 확인')
  if (!x.cash.uploaded) warn('cash_not_uploaded', '자금흐름표 미입력 · 연결 필요 — 원료대금 실제 지급액을 모름(손익으로 추정하지 않음)')
  warn('product_margin_unavailable', '제품별 실제 마진: 계산 불가 — 원료 LOT ↔ 제품 LOT 연결 근거가 없음(kg 비율 배분을 실제 원가로 쓰지 않음)')
  warn('sales_cost_provisional', '판매 실적의 실제 원가(LOT가 없으면 출고일 Current)는 조회할 때 계산하는 잠정 대체원가 — 이 월 마감 매출원가와 섞지 않음')

  const invOpen = add(add(raw_opening, x.wip.opening_amount), x.finished.opening_amount)
  const invClose = add(add(raw_closing, x.wip.closing_amount), x.finished.closing_amount)
  const check_value = sub(add(x.books_operating_income, invClose), invOpen)

  const scope: MonthlyPlResult['scope'] = operating_income !== null ? 'full' : raw_usage !== null ? 'raw_usage_only' : 'none'
  return {
    calc_version: PL_CALC_VERSION,
    period: x.period,
    method: x.method,
    method_label: methodLabel(x.method, x.method_confirmed),
    status: operating_income !== null ? 'provisional' : 'entering',
    closable: operating_income !== null && blockers.length === 0,
    scope,
    scope_label: scope === 'full' ? '영업이익까지 계산' : scope === 'raw_usage_only' ? '원료 사용액(재고 증감 기준)까지만 계산 — 나머지는 자료가 필요' : '계산할 수 있는 범위 없음',
    pl: { revenue: x.revenue, cogs, gross_profit, sga: x.sga, inventory_other, operating_income },
    basis: {
      raw_opening,
      raw_purchases,
      raw_closing,
      raw_usage,
      production_input,
      non_production,
      adjustments_approved,
      adjustments_by_kind,
      raw_to_production,
      recon_diff,
      recon_ok,
      mfg_labor: x.mfg_labor,
      mfg_overhead: x.mfg_overhead,
      mfg_cost,
      wip_opening: x.wip.opening_amount,
      wip_closing: x.wip.closing_amount,
      cogm,
      finished_opening: x.finished.opening_amount,
      finished_closing: x.finished.closing_amount,
      merchandise_cogs: x.books_merchandise_cogs,
    },
    cash: {
      state: x.cash.uploaded ? 'value' : 'not_uploaded',
      material_payments: x.cash.uploaded ? x.cash.material_payments : null,
      inflow: x.cash.uploaded ? x.cash.inflow : null,
      outflow: x.cash.uploaded ? x.cash.outflow : null,
      net: x.cash.uploaded ? sub(x.cash.inflow, x.cash.outflow) : null,
    },
    check: {
      books_operating_income: x.books_operating_income,
      inventory_opening_total: invOpen,
      inventory_closing_total: invClose,
      check_value,
      diff_vs_new: sub(check_value, operating_income),
      books_raw_material: x.books_raw_material,
      purchase_vs_books_diff: x.books_raw_material === null ? null : x.books_raw_material - raw_purchases,
    },
    blockers,
    warnings,
    materials: mats,
    material_count: mats.filter((m) => m.purchase_amount !== 0 || (m.opening_amount ?? 0) !== 0 || (m.production_qty ?? 0) !== 0 || (m.closing_qty ?? 0) !== 0).length,
  }
}

/**
 * 대표 · 원가 권한 밖에 보이는 모양(0075 fin_pl_mask와 같다): 원료별 줄 없음 · 원료 이름이 붙은 까닭은 «원료 n가지»로 합침 ·
 * 원료가 3가지 미만이거나 출고 구분이 남았으면 생산 투입원가 · 대사 차이 금액을 감춘다(합계로 원료 kg이 드러나지 않게 — 0072 fin_issue_summary와 같은 문).
 */
export function maskPlResult(r: MonthlyPlResult, costAccess: boolean): MonthlyPlResult {
  if (costAccess) return r
  const fold = (xs: PlIssue[]): PlIssue[] => {
    const out: PlIssue[] = []
    const n = new Map<string, number>()
    for (const i of xs) {
      if (!i.target) out.push(i)
      else n.set(i.code, (n.get(i.code) ?? 0) + 1)
    }
    for (const [code, count] of n) out.push({ code, message: `${MAT_MSG[code.replace(/^material_/, '')] ?? code} (원료 ${count}가지)` })
    return out
  }
  const hide = r.material_count < 3 || r.blockers.some((b) => b.code === 'material_needs_review')
  // 0080 리뷰 I-A(fin_pl_mask와 같다): 원료 1~2가지면 원재료 기초 · 매입 · 기말 합계가 곧 원료 하나의 금액 — 보여 주는 칸만 비운다.
  const few = r.material_count >= 1 && r.material_count <= 2
  const basis = hide ? { ...r.basis, production_input: null, recon_diff: null } : r.basis
  return {
    ...r,
    materials: [],
    blockers: fold(r.blockers),
    warnings: fold(r.warnings),
    basis: few ? { ...basis, raw_opening: null, raw_purchases: null, raw_closing: null } : basis,
    check: few ? { ...r.check, inventory_opening_total: null, inventory_closing_total: null, check_value: null, diff_vs_new: null, purchase_vs_books_diff: null } : r.check,
    withheld: [...(hide ? ['production_input', 'recon_diff'] : []), ...(few ? ['raw_opening', 'raw_purchases', 'raw_closing', 'check'] : [])],
  }
}

/**
 * 같은 거래 한 번만(0072 fin_tx_groups를 읽어 0075 fin_pl_gather가 하는 것과 같다). 한 표(입고 · 판매)만 본다.
 *   same 묶음에 그 표 줄이 둘 이상이면 하나만 센다 — 금액 기준 줄(amount_base_ref)이 그 표 줄이면 그 줄, 아니면 가장 작은 줄 번호.
 *   suspect 묶음에 그 표 줄이 둘 이상이면 «중복 의심» 수 — 자동으로 같은 거래로 보지 않는다(마감을 막는다).
 *   다른 표(원장 · 세금계산서)와만 묶인 줄은 그대로 센다 — 이 계산은 원장 · 세금계산서를 매입 원천으로 쓰지 않는다.
 */
export function dedupeLines(
  table: string,
  liveLineIds: readonly number[],
  groups: readonly { status: 'same' | 'suspect' | 'rejected'; amount_base_ref: string | null; members: readonly { source_table: string; line_id: number; released: boolean }[] }[],
): { excluded: Set<number>; suspects: number } {
  const live = new Set(liveLineIds)
  const excluded = new Set<number>()
  let suspects = 0
  for (const g of groups) {
    const mine = g.members.filter((m) => !m.released && m.source_table === table && live.has(m.line_id)).map((m) => m.line_id)
    if (mine.length < 2) continue
    if (g.status === 'suspect') suspects += 1
    if (g.status !== 'same') continue
    const ref = g.amount_base_ref ?? ''
    const base = ref.startsWith(`${table}:`) && /^[0-9]{1,18}$/.test(ref.slice(table.length + 1)) ? Number(ref.slice(table.length + 1)) : NaN
    const keep = mine.includes(base) ? base : Math.min(...mine)
    for (const id of mine) if (id !== keep) excluded.add(id)
  }
  return { excluded, suspects }
}

/**
 * 단일 제품 완제품 추정(T2 · T4 — 제품이 하나일 때만). 월 가중평균: kg당 = (기초 금액 + 완성품 제조원가) ÷ (기초 kg + 생산 kg).
 * 이것은 «추정»이다 — 제품이 여럿이면 배합이 달라 kg 비율로 나누지 않는다(평가금액은 사람이 넣는다).
 */
export function estimateSingleProductFinished(x: { products: number; opening_kg: number; opening_amount: number; produced_kg: number; cogm: number; sold_kg: number }):
  | { basis: string; unit_cost: number; cogs: number; closing_kg: number; closing_amount: number }
  | { error: string } {
  if (x.products !== 1) return { error: '제품이 하나가 아니면 kg 비율 배분을 하지 않음 — 평가금액을 직접 넣으세요' }
  const den = x.opening_kg + x.produced_kg
  if (den <= 0) return { error: '기초 + 생산 kg이 0 이하' }
  if (x.sold_kg > den) return { error: '판매 kg이 기초 + 생산보다 많음 — 음수 재고' }
  const total = x.opening_amount + x.cogm
  const cogs = roundWon((x.sold_kg * total) / den)
  return { basis: '추정 — 단일 제품 월 가중평균', unit_cost: Math.round((total / den) * 10_000) / 10_000, cogs, closing_kg: roundQty(den - x.sold_kg), closing_amount: total - cogs }
}

/** 두 결과의 손익 줄 차이(나중 − 먼저) — «잠정 → 마감» 조정 내역. */
export function plDiff(after: MonthlyPlResult['pl'], before: MonthlyPlResult['pl']): Record<keyof MonthlyPlResult['pl'], number | null> {
  const keys = Object.keys(after) as (keyof MonthlyPlResult['pl'])[]
  return Object.fromEntries(keys.map((k) => [k, sub(after[k], before[k])])) as Record<keyof MonthlyPlResult['pl'], number | null>
}

/** 다시 마감한 달 뒤의 확정 달 — 덮어쓰지 않고 «재마감 대상»으로만 표시한다. */
export function laterFinalPeriods(records: readonly { period: string; status: 'provisional' | 'final'; live: boolean }[], period: string): string[] {
  return [...new Set(records.filter((r) => r.live && r.status === 'final' && r.period > period).map((r) => r.period))].sort()
}

/** 키 순서를 정렬한 JSON — 같은 입력 = 같은 해시(dummy · 시험용; live는 jsonb md5). */
export function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`
  if (v && typeof v === 'object') {
    return `{${Object.keys(v as Record<string, unknown>)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableJson((v as Record<string, unknown>)[k])}`)
      .join(',')}}`
  }
  return JSON.stringify(v ?? null)
}

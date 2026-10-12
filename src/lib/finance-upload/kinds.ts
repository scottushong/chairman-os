/**
 * «회계 · 재무 자료 올리기» v2의 14가지 자료(대표 결정 2026-10-12). 0070의 표 · 칸과 **같은 이름**이다 —
 * check:finance-upload가 0070 파일의 칸 목록과 이 표를 대조한다(한쪽만 고치면 넣기가 깨진다).
 *
 * keywords는 머리글 낱말(띄어쓰기 · 괄호를 뺀 뒤 «포함»으로 찾는다). hints는 시트명 · 제목 줄에서 찾는 종류 낱말.
 * 시트명은 예시일 뿐이다 — 이름이 달라도 머리글 · 제목으로 알아본다(분류는 classify.ts).
 */

export const UPLOAD_KINDS = [
  'sales',
  'purchase_in',
  'inventory',
  'production',
  'ledger',
  'payroll',
  'import',
  'cashflow',
  'card',
  'overseas',
  'promo',
  'loans',
  'borrowings',
  'savings',
] as const
export type UploadKind = (typeof UPLOAD_KINDS)[number]

export type FieldType = 'text' | 'number' | 'date'

export interface FieldSpec {
  key: string
  label: string
  type: FieldType
  keywords: string[]
  /** 이 칸이 비면 줄을 버린다(제목 · 빈 줄). */
  required?: boolean
}

export interface KindSpec {
  kind: UploadKind
  no: string
  label: string
  /** 흔한 시트명 · 제목 낱말 */
  hints: string[]
  table: string
  fields: FieldSpec[]
  /** 합계 줄과 대조할 칸 */
  sumField?: string
  /** 날짜 칸(기간을 읽는다) */
  dateField?: string
  /** 원가 엔진 «후보»로만 가는 종류 — 화면이 그렇게 말한다. */
  costCandidate?: boolean
  /** 넣는 곳(화면 한 줄) */
  target: string
}

const f = (key: string, label: string, type: FieldType, keywords: string[], required = false): FieldSpec => ({ key, label, type, keywords, required })

export const KIND_SPECS: KindSpec[] = [
  {
    kind: 'sales', no: '①', label: '매출 · 판매현황', hints: ['판매현황', '판매', '매출'], table: 'fin_sales_lines', sumField: 'amount', costCandidate: true,
    target: '거래처별 매출 · 제품별 판매수량 · 단가(0067 판매 실적과 대조 — «후보»로만)',
    fields: [f('customer', '거래처', 'text', ['거래처명', '거래처', '고객']), f('product', '제품', 'text', ['품목명', '품명', '제품', '품목'], true), f('qty', '수량', 'number', ['판매수량', '수량']), f('unit_price', '단가', 'number', ['단가']), f('amount', '금액', 'number', ['판매금액', '공급가액', '합계금액', '금액'], true)],
  },
  {
    kind: 'purchase_in', no: '②', label: '원재료 · 입고명세서', hints: ['입고명세', '입고', '매입현황', '구매입고'], table: 'fin_purchase_in_lines', sumField: 'amount', costCandidate: true,
    target: '원재료 · 부재료 매입수량 · 금액(원가 엔진 구매 LOT «후보» — 원가 관리가 승인해야 LOT)',
    fields: [f('material', '원재료', 'text', ['자재명', '품목명', '품명', '원재료', '품목'], true), f('supplier', '공급처', 'text', ['공급처', '매입처', '거래처']), f('material_kind', '구분', 'text', ['자재구분', '품목구분', '구분']), f('qty', '수량', 'number', ['입고수량', '수량']), f('amount', '금액', 'number', ['입고금액', '공급가액', '금액'], true)],
  },
  {
    kind: 'inventory', no: '③', label: '재고 · 재고금액명세서', hints: ['재고금액', '재고명세', '재고'], table: 'fin_inventory_lines', sumField: 'amount',
    target: '원재료 사용수량 · 재고수량 · 금액(원가 엔진 재고 잔량과 대조 보고)',
    fields: [f('item', '품목', 'text', ['품목명', '품명', '품목'], true), f('used_qty', '사용수량', 'number', ['사용수량', '출고수량', '사용']), f('stock_qty', '재고수량', 'number', ['기말재고수량', '재고수량', '기말수량']), f('amount', '재고금액', 'number', ['재고금액', '기말금액', '금액'])],
  },
  {
    kind: 'production', no: '④', label: '생산 · 제조지시명세서', hints: ['제조지시', '작업지시', '생산실적', '생산'], table: 'fin_production_lines', sumField: 'qty',
    target: '제품별 실제 생산수량만(원료 투입 줄은 열 때 버림)',
    fields: [f('product', '제품', 'text', ['생산품목', '제품명', '제품', '품목명', '품명'], true), f('qty', '생산수량', 'number', ['생산수량', '실적수량', '완료수량', '수량'], true)],
  },
  {
    kind: 'ledger', no: '⑤', label: '회계 · 계정별 원장', hints: ['계정별원장', '원장'], table: 'fin_ledger_sums',
    target: '제조경비 · 판관비 · 이자비용 — 계정별 그 달 차변 · 대변 합계',
    fields: [f('account_code', '계정코드', 'text', ['계정코드', '코드'], true), f('account_name', '계정명', 'text', ['계정명', '계정과목']), f('debit', '차변', 'number', ['차변']), f('credit', '대변', 'number', ['대변'])],
  },
  {
    kind: 'payroll', no: '⑥', label: '인건비 · 급여대장', hints: ['급여대장', '급여', '임금대장'], table: 'fin_payroll_depts', sumField: 'salary',
    target: '부서별 급여 · 상여 · 퇴직급여 합계(개인 줄은 대표 · CFO만 — 이름 · 주민번호 · 계좌는 저장하지 않음)',
    fields: [f('dept', '부서', 'text', ['부서명', '부서', '소속'], true), f('salary', '급여', 'number', ['지급합계', '급여합계', '기본급', '급여']), f('bonus', '상여', 'number', ['상여금', '상여']), f('severance', '퇴직급여', 'number', ['퇴직급여', '퇴직금'])],
  },
  {
    kind: 'import', no: '⑦', label: '수입 · OFFER SHEET', hints: ['offersheet', 'offer', '오퍼', '수입거래', '수입'], table: 'fin_import_lines', sumField: 'amount', costCandidate: true,
    target: '수입 원재료 대금 · 부대비용(원가 엔진 Landed Cost «후보»)',
    fields: [f('ref_no', '번호', 'text', ['offer', '오퍼번호', 'b/l', '계약번호', '번호']), f('material', '원재료', 'text', ['품목', '품명', 'item', 'description'], true), f('supplier', '공급처', 'text', ['shipper', '수출자', '공급처', '거래처']), f('currency', '통화', 'text', ['통화', 'currency']), f('amount', '대금', 'number', ['amount', '대금', '외화금액', '금액'], true), f('fx_rate', '환율', 'number', ['환율', 'rate']), f('amount_krw', '원화', 'number', ['원화금액', '원화']), f('extra_cost', '부대비용', 'number', ['부대비용', '운임', '관세', '통관'])],
  },
  {
    kind: 'cashflow', no: '⑧', label: '자금 · 월별 자금흐름표', hints: ['자금흐름', '자금일보', '자금수지', '자금'], table: 'fin_cash_flows', dateField: 'flow_date',
    target: '실제 입출금 — 손익과 현금흐름 비교',
    fields: [f('flow_date', '일자', 'date', ['일자', '날짜', '거래일']), f('category', '항목', 'text', ['항목', '적요', '내용', '구분'], true), f('inflow', '입금', 'number', ['입금', '수입']), f('outflow', '출금', 'number', ['출금', '지출'])],
  },
  {
    kind: 'card', no: '⑨', label: '카드 · 법인카드 사용내역', hints: ['법인카드', '카드사용', '카드'], table: 'fin_card_lines', sumField: 'amount', dateField: 'used_on',
    target: '비용 세부 · 사용 부서(카드번호는 뒤 4자리만)',
    fields: [f('used_on', '사용일', 'date', ['이용일', '사용일', '승인일', '일자']), f('merchant', '가맹점', 'text', ['가맹점', '사용처', '이용처'], true), f('dept', '부서', 'text', ['사용부서', '부서']), f('card_last4', '카드', 'text', ['카드번호', '카드']), f('amount', '금액', 'number', ['이용금액', '승인금액', '금액'], true)],
  },
  {
    kind: 'overseas', no: '⑩', label: '해외법인 · 베트남 법인 운영비', hints: ['베트남', '해외법인', '법인운영비', 'vietnam', 'vn'], table: 'fin_overseas_costs', sumField: 'amount',
    target: '해외법인 운영비 · 관련 지출(통화 · 환율 같이)',
    fields: [f('entity', '법인', 'text', ['법인명', '법인']), f('item', '항목', 'text', ['항목', '계정', '내용', '적요'], true), f('currency', '통화', 'text', ['통화', 'currency']), f('amount', '금액', 'number', ['외화금액', '금액', 'amount'], true), f('fx_rate', '환율', 'number', ['환율']), f('amount_krw', '원화', 'number', ['원화금액', '원화'])],
  },
  {
    kind: 'promo', no: '⑪', label: '해외판촉비', hints: ['판촉', '프로모션', 'promotion'], table: 'fin_promo_costs', sumField: 'amount',
    target: '담당자별 판촉비',
    fields: [f('person', '담당자', 'text', ['담당자', '담당', 'name'], true), f('item', '항목', 'text', ['항목', '내용', '적요']), f('currency', '통화', 'text', ['통화', 'currency']), f('amount', '금액', 'number', ['금액', 'amount'], true)],
  },
  {
    kind: 'loans', no: '⑫', label: '대출현황', hints: ['대출현황', '대출', '차입금현황'], table: 'fin_loans', sumField: 'principal',
    target: '금융기관 · 대출금액 · 금리 · 만기 · 상환조건 · 원금 · 이자(기준일마다 한 벌)',
    fields: [f('lender', '금융기관', 'text', ['금융기관', '은행', '대출기관'], true), f('principal', '대출금액', 'number', ['대출금액', '대출잔액', '대출금', '잔액'], true), f('rate', '금리', 'number', ['금리', '이율']), f('maturity', '만기', 'date', ['만기일', '만기']), f('terms', '상환조건', 'text', ['상환조건', '상환방법']), f('principal_paid', '원금', 'number', ['원금상환', '원금']), f('interest_paid', '이자', 'number', ['이자'])],
  },
  {
    kind: 'borrowings', no: '⑬', label: '연도별 차입금', hints: ['차입금', '차입'], table: 'fin_borrowings', sumField: 'amount', dateField: 'tx_date',
    target: '차입 · 상환 내역, 직접 입금 · 대납 구분',
    fields: [f('tx_date', '일자', 'date', ['일자', '날짜']), f('lender', '차입처', 'text', ['차입처', '대여자', '거래처'], true), f('direction', '구분', 'text', ['차입상환', '구분']), f('amount', '금액', 'number', ['금액'], true), f('method', '방법', 'text', ['입금방법', '지급방법', '방법', '대납'])],
  },
  {
    kind: 'savings', no: '⑭', label: '절감목표 · 진행현황', hints: ['절감목표', '절감', '진행현황'], table: 'fin_savings_lines',
    target: '기존 인건비 집계 · 손익 비교 · 절감 목표 대비 실적',
    fields: [f('item', '항목', 'text', ['항목', '구분', '내용'], true), f('labor_cost', '기존 인건비', 'number', ['기존인건비', '인건비']), f('target', '목표', 'number', ['절감목표', '목표']), f('actual', '실적', 'number', ['절감실적', '실적', '진행'])],
  },
]

export const KIND_BY_ID = new Map(KIND_SPECS.map((k) => [k.kind, k]))

export function kindSpec(kind: UploadKind): KindSpec {
  return KIND_BY_ID.get(kind)!
}

export function isUploadKind(v: unknown): v is UploadKind {
  return typeof v === 'string' && (UPLOAD_KINDS as readonly string[]).includes(v)
}

/** 급여 개인 줄(대표 · CFO만) — 0070 fin_payroll_people. */
export const PAYROLL_PEOPLE_FIELDS = ['dept', 'person_ref', 'salary', 'bonus', 'severance'] as const

/** 그 밖에 받는 것 — 기존 흐름(계정과목 · 연간 · 월별 손익 · 공식 결산)으로 보낸다. */
export const LEGACY_KIND_LABEL: Record<'accounts' | 'annual' | 'monthly' | 'statements', string> = {
  accounts: '계정과목표',
  annual: '재무제표(연간)',
  monthly: '월별 손익계산서',
  statements: '세무사 확정 결산',
}

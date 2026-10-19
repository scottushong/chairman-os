import type { UploadKind } from './kinds'

/**
 * 0089 열 맞추기 1단계 — ECOUNT에서 받은 그대로의 머리글(회사마다 · 메뉴마다 이름이 조금씩 다르다)을 우리 칸에 맞추는 «비슷한 이름» 표.
 * kinds.ts의 keywords가 먼저다(기존 판정을 바꾸지 않는다). 여기 낱말은 keywords로 못 찾은 칸에만 쓴다(pipeline.ts mapColumns 3 · 4번째 바퀴).
 * 이 표로도 안 되면 AI 한 번(기능 스위치 finance_upload_ai) → 맞춘 결과는 (회사, 종류)마다 fin_column_maps(0089)에 저장 → 다음부터 AI 없이.
 *
 * 낱말은 띄어쓰기를 뺀 뒤 «같음» → «포함»으로 찾는다. 넓은 낱말(«액» 같은 것)은 넣지 않는다 — 다른 칸을 가져간다.
 */
export const SYNONYMS: Partial<Record<UploadKind, Record<string, string[]>>> = {
  sales: {
    customer: ['매출처', '판매처', '납품처', '거래처코드명', '고객사', '고객명'],
    product: ['상품명', '제품명', '품목코드명', '품번'],
    qty: ['판매량', '출고수량', '출고량', 'qty'],
    unit_price: ['판매단가', '단가(원)', 'price'],
    amount: ['매출액', '매출금액', '공급가', '판매액', '금액합계'],
    tx_date: ['전표일자', '매출일자', '매출일', '출고일자'],
    amount_vat: ['vat', '부가가치세', '부가세금액'],
  },
  purchase_in: {
    material: ['원재료명', '원자재명', '품목코드명', '입고품목', '상품명'],
    supplier: ['구매처', '매입처명', '공급업체', '공급사'],
    material_kind: ['품목그룹', '자재그룹', '재료구분'],
    qty: ['입고량', '구매수량', '매입수량'],
    amount: ['구매금액', '매입금액', '매입액', '입고액', '공급가'],
    tx_date: ['구매일자', '매입일자', '전표일자'],
    amount_vat: ['vat', '부가가치세'],
  },
  inventory: {
    item: ['재고품목', '품목코드명', '자재명', '원재료명'],
    used_qty: ['출고량', '소모량', '소요량'],
    stock_qty: ['현재고', '재고량', '기말수량', '잔량'],
    opening_amount: ['기초금액', '이월금액'],
    amount: ['재고액', '기말잔액', '평가액'],
  },
  production: {
    product: ['생산제품', '완제품명', '생산품명'],
    qty: ['생산량', '완성수량', '양품수량', '실적량'],
  },
  payroll: {
    dept: ['부서코드명', '근무부서', '팀명', '조직'],
    salary: ['총지급액', '지급총액', '기본급여', '월급여'],
    bonus: ['상여', '성과급', '인센티브'],
    severance: ['퇴직충당', '퇴직연금'],
  },
  import: {
    ref_no: ['오퍼no', 'offerno', 'bl번호', 'inv번호', '인보이스번호'],
    material: ['품목명', '원재료명', 'goods'],
    supplier: ['수출업체', 'seller', 'vendor'],
    currency: ['화폐', 'cur'],
    amount: ['외화', 'invoiceamount', '결제금액'],
    fx_rate: ['적용환율', 'exrate'],
    amount_krw: ['원화환산', 'krw'],
    extra_cost: ['부대경비', '물류비', '수입부대비'],
  },
  cashflow: {
    flow_date: ['거래일자', '입출금일', '전표일자'],
    category: ['내역', '거래내용', '비고'],
    inflow: ['입금액', '들어온돈', '수입금액'],
    outflow: ['출금액', '나간돈', '지출금액'],
    account: ['통장', '계좌번호'],
    balance: ['현재잔액', '통장잔액'],
  },
  card: {
    used_on: ['거래일자', '결제일자', '승인일자'],
    merchant: ['가맹점명', '거래처', '상호'],
    dept: ['사용팀', '소속'],
    card_last4: ['카드no', '카드명'],
    amount: ['결제금액', '사용금액', '청구금액'],
  },
  loans: {
    lender: ['차입기관', '대출은행', '은행명'],
    principal: ['차입잔액', '대출잔고', '미상환잔액'],
    rate: ['이자율', '적용금리'],
    maturity: ['만기일자', '상환기일'],
    terms: ['상환방식'],
    principal_paid: ['원금상환액'],
    interest_paid: ['이자액', '이자납부액'],
    loan_type: ['대출구분', '대출과목'],
    loan_total: ['약정액', '대출한도'],
  },
  borrowings: {
    tx_date: ['거래일자', '차입일자'],
    lender: ['대여처', '빌린곳', '대주'],
    direction: ['차입/상환', '거래구분'],
    amount: ['거래금액', '차입액'],
    method: ['지급형태', '입금형태'],
  },
  valuation: {
    category: ['재고유형', '자산구분'],
    amount: ['평가액', '평가가액', '기말평가금액'],
    valuation_date: ['평가일자', '결산일'],
    method: ['원가법', '평가기준'],
    cost_scope: ['원가포함범위', '원가구성'],
    note: ['참고'],
  },
  tax_invoice: {
    issued_on: ['발행일자', '작성년월일'],
    counterparty: ['거래처상호', '공급자상호', '상대방'],
    item: ['품명'],
    supply_amount: ['공급가', '과세표준'],
    vat: ['부가세액', 'vat'],
    total: ['총금액', '합계액'],
    direction: ['매입/매출', '계산서구분'],
  },
  ledger_lines: {
    tx_date: ['일자-no', '회계일자', '거래일자'],
    account_code: ['과목코드', '계정code'],
    account_name: ['과목명', '계정과목명'],
    counterparty: ['거래처코드명', '상대처'],
    memo: ['내용', '비고'],
    debit: ['차변금액', '借方'],
    credit: ['대변금액', '貸方'],
  },
  shipment: {
    ship_date: ['출고일자', '납품일자', '배송일'],
    customer: ['납품처명', '출하처', '매출처'],
    product: ['제품명', '상품명'],
    qty: ['출고량', '납품수량', '출하kg'],
    amount: ['출하액', '납품금액', '매출액'],
  },
}

/** 그 종류 · 칸의 비슷한 이름(없으면 빈 목록). */
export function synonymsOf(kind: UploadKind, key: string): string[] {
  return SYNONYMS[kind]?.[key] ?? []
}

/** 머리글 칸 글 → 저장 열쇠(띄어쓰기 없는 NFKC 소문자 · 40자). fin_column_maps의 키 모양과 같다. */
export function labelKey(text: string): string {
  return text.normalize('NFKC').replace(/\s+/g, '').toLowerCase().slice(0, 40)
}

/** fin_column_maps 값: 칸 이름 또는 '-'(«쓰지 않음» — 다시 묻지 않는다). */
export const SKIP_COLUMN = '-'

/** 저장된 맞춤 한 벌(머리글 열쇠 → 칸 이름 · '-'). */
export type ColumnLabelMap = Record<string, string>

/**
 * 0089 A1 시험용 가짜 엑셀 — «ECOUNT에서 받은 그대로»(열 이름이 우리 낱말과 다름)인 14가지 × 변형 셋. 전부 지어낸 값이다
 * (진짜 회사 파일 아님 · 거래처 · 품목은 «가짜 …»).
 *
 *   ① syn     비슷한 이름(ECOUNT 메뉴 · 회사마다 다른 이름 — «매출처명» · «매출액» · «과세표준» …). 머리글 2행.
 *   ② title3  머리글 3행(위에 제목 줄 · 단위 줄) + 열 하나는 우리 표에 없는 회사 고유 이름(odd — 필수 칸). 코드로는 못 맞춰 AI(가짜) 한 번.
 *   ③ sheet2  여러 시트 중 2번째(1번째는 안내 시트) · 열 순서 거꾸로 · 비슷한 이름.
 *
 * 14가지는 지금 자료 올리기가 알아보는 종류 중 ECOUNT · 사내 엑셀로 오는 것(⑤ 계정별 원장은 구조 학습이 따로 있어 뺐다 — 결정 문서).
 */
import ExcelJS from 'exceljs'

import type { UploadKind } from '../../src/lib/finance-upload/kinds'

type Cell = string | number | null

export interface RenameCol {
  key: string
  /** kinds.ts 낱말로 읽히는 이름 */
  base: string
  /** 비슷한 이름(① · ③) */
  syn: string
  /** 회사 고유 이름(② — AI가 맞춘다) */
  odd?: string
}

export interface RenameKind {
  kind: UploadKind
  sheet: string
  title: string
  cols: RenameCol[]
  /** 줄 — 열 순서는 cols와 같다. 'D3' 꼴은 그 달 3일 */
  rows: Cell[][]
}

export type Variant = 'syn' | 'title3' | 'sheet2'
export const VARIANTS: Variant[] = ['syn', 'title3', 'sheet2']
export const VARIANT_KO: Record<Variant, string> = { syn: '① 비슷한 이름', title3: '② 머리글 3행 + 제목 줄 + 회사 고유 열 이름', sheet2: '③ 2번째 시트 · 열 순서 섞기' }

const c = (key: string, base: string, syn: string, odd?: string): RenameCol => ({ key, base, syn, ...(odd ? { odd } : {}) })

export const RENAME_KINDS: RenameKind[] = [
  {
    kind: 'sales', sheet: '판매현황', title: '판매현황',
    cols: [c('tx_date', '판매일자', '전표일자'), c('customer', '거래처명', '매출처명'), c('product', '품목명', '상품명'), c('qty', '수량', '판매량'), c('unit_price', '단가', '판매단가'), c('amount', '공급가액', '매출액', '청구총액'), c('amount_vat', '부가세', 'VAT')],
    rows: [['D3', '가짜 거래처 A', '가짜 제품 1', 10, 1000, 10000, 1000], ['D9', '가짜 거래처 B', '가짜 제품 2', 5, 2000, 10000, 1000]],
  },
  {
    kind: 'purchase_in', sheet: '구매입고현황', title: '구매입고현황',
    cols: [c('tx_date', '입고일자', '구매일자'), c('material', '자재명', '원재료명', '구입물품'), c('supplier', '공급처', '구매처'), c('qty', '입고수량', '입고량'), c('amount', '입고금액', '구매금액')],
    rows: [['D4', '가짜 원재료 1', '가짜 공급처 갑', 100, 50000], ['D11', '가짜 원재료 2', '가짜 공급처 을', 10, 3000]],
  },
  {
    kind: 'inventory', sheet: '재고금액명세서', title: '재고금액명세서',
    cols: [c('item', '품목명', '재고품목', '보관물'), c('used_qty', '사용수량', '소모량'), c('stock_qty', '기말재고수량', '현재고'), c('amount', '재고금액', '재고액')],
    rows: [['가짜 원재료 1', 40, 60, 30000], ['가짜 원재료 2', 10, 5, 2500]],
  },
  {
    kind: 'production', sheet: '생산실적현황', title: '생산실적현황',
    cols: [c('product', '생산품목', '완제품명', '완성품'), c('qty', '생산수량', '양품수량')],
    rows: [['가짜 제품 1', 500], ['가짜 제품 2', 300]],
  },
  {
    kind: 'payroll', sheet: '급여대장', title: '급여대장',
    cols: [c('dept', '부서', '근무부서', '근무처'), c('salary', '기본급', '총지급액'), c('bonus', '상여금', '성과급'), c('severance', '퇴직급여', '퇴직충당')],
    rows: [['가짜 경영지원', 3000000, 0, 0], ['가짜 영업', 3200000, 100000, 0]],
  },
  {
    kind: 'cashflow', sheet: '자금일보', title: '월별 자금흐름표',
    cols: [c('flow_date', '일자', '거래일자'), c('account', '계좌', '통장'), c('category', '항목', '거래내용', '용도'), c('inflow', '입금', '입금액'), c('outflow', '출금', '출금액'), c('balance', '잔액', '통장잔액')],
    rows: [['D5', '가짜은행 주거래', '가짜 매출 입금', 5000000, 0, 15000000], ['D10', '가짜은행 주거래', '가짜 급여 지급', 0, 9000000, 6000000]],
  },
  {
    kind: 'card', sheet: '법인카드 사용내역', title: '법인카드 사용내역',
    cols: [c('used_on', '이용일', '결제일자'), c('merchant', '가맹점', '가맹점명', '거래상대'), c('dept', '사용부서', '사용팀'), c('card_last4', '카드번호', '카드no'), c('amount', '이용금액', '청구금액')],
    rows: [['D4', '가짜 식당', '가짜 경영지원', '1234-5678-9012-3456', 30000], ['D6', '가짜 문구', '가짜 영업', '1234-5678-9012-3456', 12000]],
  },
  {
    kind: 'loans', sheet: '대출현황', title: '대출현황',
    cols: [c('lender', '금융기관', '대출은행', '여신기관'), c('principal', '대출잔액', '미상환잔액'), c('rate', '금리', '적용금리'), c('maturity', '만기일', '상환기일'), c('interest_paid', '월이자', '이자납부액'), c('loan_total', '대출금액', '약정액')],
    rows: [['가짜 은행', 400000000, 4.5, '2090-12-31', 1500000, 500000000]],
  },
  {
    kind: 'tax_invoice', sheet: '매입 세금계산서', title: '전자세금계산서 매입',
    cols: [c('issued_on', '작성일자', '작성년월일'), c('counterparty', '상호', '거래처상호', '상대회사'), c('item', '품목명', '품명'), c('supply_amount', '공급가액', '과세표준'), c('vat', '세액', '부가세액'), c('total', '합계금액', '총금액')],
    rows: [['D7', '가짜 공급처 정', '가짜 원재료 7', 70000, 7000, 77000]],
  },
  {
    kind: 'ledger_lines', sheet: '전표내역', title: '일반전표 전표내역',
    cols: [c('tx_date', '전표일자', '회계일자'), c('account_code', '계정코드', '과목코드'), c('account_name', '계정과목', '과목명', '계정'), c('counterparty', '거래처명', '상대처'), c('memo', '적요', '내용'), c('debit', '차변', '차변금액'), c('credit', '대변', '대변금액')],
    rows: [['D3', '8110', '복리후생비', '가짜 식당', '가짜 식대', 30000, null], ['D3', '1030', '보통예금', null, '가짜 식대', null, 30000]],
  },
  {
    kind: 'shipment', sheet: '출하집계표', title: '출하집계표',
    cols: [c('ship_date', '출하일자', '납품일자'), c('customer', '거래처명', '출하처', '받는곳'), c('product', '품목명', '제품명'), c('qty', '출하량', '출고량'), c('amount', '출하금액', '출하액')],
    rows: [['D4', '가짜 거래처 A', '가짜 제품 1', 1000, 2000000], ['D12', '가짜 거래처 B', '가짜 제품 2', 500, 900000]],
  },
  {
    kind: 'import', sheet: 'OFFER SHEET', title: '수입 거래목록 OFFER SHEET',
    cols: [c('ref_no', 'OFFER NO', '인보이스번호'), c('material', 'ITEM', 'GOODS', '물품'), c('supplier', 'SHIPPER', 'SELLER'), c('currency', '통화', '화폐'), c('amount', 'AMOUNT', '결제금액'), c('fx_rate', '환율', '적용환율'), c('amount_krw', '원화금액', '원화환산'), c('extra_cost', '부대비용', '물류비')],
    rows: [['OF-01', '가짜 원재료 9', '가짜 수출자', 'USD', 1000, 1350, 1350000, 50000]],
  },
  {
    kind: 'valuation', sheet: '재공품 완제품 평가', title: '재공품 · 완제품 평가',
    cols: [c('category', '재고구분', '재고유형', '재고종류'), c('amount', '평가금액', '평가액'), c('valuation_date', '평가기준일', '평가일자'), c('method', '평가방법', '평가기준'), c('cost_scope', '포함원가범위', '원가구성'), c('note', '비고', '참고')],
    rows: [['재공품', 3400000, 'D28', '월 가중평균', '재료비+노무비+경비', '가짜'], ['완제품', 1200000, 'D28', '월 가중평균', '재료비+노무비+경비', '가짜']],
  },
  {
    kind: 'borrowings', sheet: '연도별 차입금', title: '연도별 차입금',
    cols: [c('tx_date', '일자', '거래일자'), c('lender', '차입처', '대여처', '빌려준곳'), c('direction', '구분', '거래구분'), c('amount', '금액', '거래금액'), c('method', '입금방법', '지급형태')],
    rows: [['D2', '가짜 대여자', '차입', 100000000, '직접 입금'], ['D20', '가짜 대여자', '상환', 20000000, '대납']],
  },
]

/** 회사 고유 이름(②) → 칸 — 가짜 AI가 «맞춘다». */
export function oddLabels(kind: UploadKind): Record<string, string> {
  const k = RENAME_KINDS.find((x) => x.kind === kind)
  return Object.fromEntries((k?.cols ?? []).filter((x) => x.odd).map((x) => [x.odd!.replace(/\s/g, '').toLowerCase(), x.key]))
}

const title = (t: string, ym: string) => [`회사명 : (주)가짜산업 / ${ym.replace('-', '/')}/01 ~ ${ym.replace('-', '/')}/28 / ${t}`]
const dayOf = (v: Cell, ym: string, scale: number): Cell => (typeof v === 'string' && /^D\d{1,2}$/.test(v) ? `${ym}-${v.slice(1).padStart(2, '0')}` : typeof v === 'number' && scale !== 1 && v > 100 ? v * scale : v)

async function book(sheets: { name: string; rows: Cell[][] }[]): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook()
  for (const s of sheets) {
    const ws = wb.addWorksheet(s.name)
    for (const r of s.rows) ws.addRow(r)
  }
  return new Uint8Array(await wb.xlsx.writeBuffer())
}

/** 변형 하나의 xlsx. scale = 숫자 배수(두 번째 올리기 — 같은 양식 · 다른 값), sheetSuffix = 시트명 뒤에 붙임. */
export async function renameFile(k: RenameKind, v: Variant, ym: string, o: { scale?: number; sheetSuffix?: string } = {}): Promise<{ name: string; bytes: Uint8Array }> {
  const scale = o.scale ?? 1
  const body = k.rows.map((r) => r.map((x) => dayOf(x, ym, scale)))
  const sheetName = `${k.sheet}${o.sheetSuffix ?? ''}`.slice(0, 31)
  let sheets: { name: string; rows: Cell[][] }[]
  if (v === 'syn') {
    sheets = [{ name: sheetName, rows: [title(k.title, ym), k.cols.map((x) => x.syn), ...body] }]
  } else if (v === 'title3') {
    sheets = [{ name: sheetName, rows: [title(k.title, ym), [null, null, '(단위 : 원)'], k.cols.map((x) => x.odd ?? x.base), ...body] }]
  } else {
    // 열 순서 거꾸로 · 1번째 시트는 안내(표 없음).
    const rev = <T,>(r: T[]) => [...r].reverse()
    sheets = [
      { name: '안내', rows: [['이 파일은 ECOUNT에서 내려받은 그대로입니다'], ['출력일 2099/10/11 오전 10:12'], ['문의: 가짜 담당']] },
      { name: sheetName, rows: [title(k.title, ym), rev(k.cols.map((x) => x.syn)), ...body.map(rev)] },
    ]
  }
  return { name: `가짜 ${k.kind} ${v} ${ym}${o.sheetSuffix ?? ''}.xlsx`, bytes: await book(sheets) }
}

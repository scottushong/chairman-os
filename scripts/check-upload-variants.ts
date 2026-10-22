/**
 * 0092 «자료 올리기» 모양 바꾸기 검사 — 19가지 자료 + 계정과목표 · 월별 손익(ECOUNT 양식)마다 같은 숫자를 다섯 모양의 xlsx로 만들어
 * 앱과 같은 길(processUpload: 열기 → 버리기 → 분류 → 읽기 → 검증 → 저장 — dummy 저장소)에 넣는다. 진짜 AI 0회(classify 없음) · 진짜 회사 파일 없음.
 *
 *   npx tsx --conditions=react-server scripts/check-upload-variants.ts
 *
 *   ① ECOUNT 원래 머리글   ② 조금 다른 머리글(띄어쓰기 · 괄호 · «금 액» · «공급가액(원)» · 영어 섞임 · 끝에 «합계»)
 *   ③ 머리글이 3번째 줄(위에 제목 줄)   ④ 시트 둘(앞은 표지 · 자료는 둘째)   ⑤ 빈 줄 · 소계 · 합계 줄이 섞임
 *
 * 본다: 저장됨(applied) · 줄 수(합계 · 소계 · 빈 줄은 줄이 아님) · 금액 합(합계 줄을 두 번 세지 않음) · 머리글의 칸을 다 알아봄(빈 칸 없음).
 * 실패하면 화면 카드 문구(message · why)를 그대로 찍는다.
 */
import assert from 'node:assert/strict'

process.env.DUMMY_FIN_DEMO = 'off'
process.env.DUMMY_USER = 'chairman'
delete process.env.ANTHROPIC_API_KEY

import ExcelJS from 'exceljs'

import type { UploadKind } from '../src/lib/finance-upload/kinds'
import { builtinRole } from '../src/lib/finance-upload/ledger'
import { processUpload, type FileCard } from '../src/lib/finance-upload/process'
import { costByBusiness, documentsByBusiness, financeByBusiness } from '../src/lib/module-grants'
import { dummyRepository as repo } from '../src/lib/repository/dummy'
import { dummyFinLines, dummyFinStore } from '../src/lib/repository/dummy-finance-upload'
import { dummyModuleGrants, dummyViewer } from '../src/lib/repository/dummy-org'
import type { SessionUser } from '../src/types'

const BIZ = 'biz_dy'
type Cell = string | number | null
type V = string | number | null

function session(): SessionUser {
  const p = dummyViewer()
  const g = dummyModuleGrants(p.user_id)
  return { user_id: p.user_id, name: p.display_name, role: p.role, title_ko: p.title_ko, display_name_en: p.display_name_en, language: 'ko', finance: financeByBusiness(g), documents: documentsByBusiness(g), cost: costByBusiness(g) }
}

async function xlsx(sheets: { name: string; rows: Cell[][] }[]): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook()
  for (const s of sheets) {
    const ws = wb.addWorksheet(s.name)
    s.rows.forEach((r, i) => {
      // 빈 줄도 자리를 지킨다(addRow([])는 줄을 남기지 않을 수 있다).
      const row = ws.getRow(i + 1)
      r.forEach((v, j) => {
        if (v !== null) row.getCell(j + 1).value = v
      })
      row.commit()
    })
  }
  return new Uint8Array(await wb.xlsx.writeBuffer())
}

/** 한 종류의 가짜 표 — 칸(열쇠 · 원래 머리글 · 바꾼 머리글) · 줄 · 합계 칸. */
interface Case {
  kind: UploadKind
  sheet: string
  title: string
  cols: [key: string, orig: string, alt: string][]
  rows: Record<string, V>[]
  /** 금액 합을 볼 칸(합계 줄도 이 칸에 적는다) */
  sum: string
  /** 저장되는 줄 수(급여는 부서 수) — 없으면 rows.length */
  saved?: number
  /** 저장 뒤 값이 비면 안 되는 칸(없으면 cols 전부) */
  must?: string[]
  /** 합계 줄을 넣지 않는다(합계 줄이 없는 양식) */
  noTotal?: boolean
}

const d = (ym: string, day: number) => `${ym}-${String(day).padStart(2, '0')}`

function cases(ym: string): Case[] {
  return [
    {
      kind: 'sales', sheet: '판매현황', title: '판매현황', sum: 'amount',
      cols: [['tx_date', '판매일자', '일 자'], ['customer', '거래처명', 'Customer'], ['product', '품목명', '품목 (명)'], ['qty', '판매수량', 'Q\'ty'], ['unit_price', '단가', '단가(원)'], ['amount', '공급가액', '공급가액(원)']],
      rows: [
        { tx_date: d(ym, 3), customer: '가짜 거래처 A', product: '가짜 제품 1', qty: 10, unit_price: 1000, amount: 10000 },
        { tx_date: d(ym, 5), customer: '가짜 거래처 B', product: '가짜 제품 2', qty: 5, unit_price: 2000, amount: 10000 },
        { tx_date: d(ym, 9), customer: '가짜 거래처 C', product: '가짜 제품 1', qty: 7, unit_price: 1500, amount: 10500 },
        { tx_date: d(ym, 20), customer: '가짜 거래처 A', product: '가짜 제품 3', qty: 2, unit_price: 3000, amount: 6000 },
      ],
    },
    {
      kind: 'purchase_in', sheet: '입고명세서', title: '입고명세서', sum: 'amount',
      cols: [['tx_date', '입고일자', '입고 일자'], ['material', '자재명', '품목명(자재)'], ['supplier', '공급처', '공급처 명'], ['material_kind', '자재구분', '구 분'], ['qty', '입고수량', '수량(kg)'], ['amount', '입고금액', '금 액']],
      rows: [
        { tx_date: d(ym, 3), material: '가짜 원재료 1', supplier: '가짜 공급처 갑', material_kind: '원재료', qty: 100, amount: 50000 },
        { tx_date: d(ym, 8), material: '가짜 부재료 1', supplier: '가짜 공급처 을', material_kind: '부재료', qty: 10, amount: 3000 },
        { tx_date: d(ym, 19), material: '가짜 원재료 2', supplier: '가짜 공급처 병', material_kind: '원재료', qty: 60, amount: 21000 },
      ],
    },
    {
      kind: 'inventory', sheet: '재고금액명세서', title: '재고금액명세서', sum: 'amount',
      cols: [['item', '품목명', '품목 명'], ['used_qty', '사용수량', '사용량'], ['stock_qty', '기말재고수량', '기말 수량'], ['opening_amount', '기초재고금액', '기초 금액'], ['amount', '기말재고금액', '기말재고 금액(원)']],
      rows: [
        { item: '가짜 원재료 1', used_qty: 40, stock_qty: 60, opening_amount: 28000, amount: 30000 },
        { item: '가짜 원재료 2', used_qty: 10, stock_qty: 5, opening_amount: 2000, amount: 2500 },
        { item: '가짜 원재료 3', used_qty: 3, stock_qty: 9, opening_amount: 900, amount: 1100 },
      ],
    },
    {
      kind: 'production', sheet: '제조지시명세서', title: '제조지시명세서', sum: 'qty',
      cols: [['product', '생산품목', '제품명'], ['qty', '생산수량', '생산량(kg)']],
      rows: [{ product: '가짜 제품 1', qty: 500 }, { product: '가짜 제품 2', qty: 300 }, { product: '가짜 제품 3', qty: 120 }],
    },
    {
      kind: 'payroll', sheet: '급여대장', title: '급여대장', sum: 'salary', saved: 2, must: ['dept', 'salary', 'bonus', 'severance'],
      cols: [['person_ref', '사번', '사원번호'], ['name', '성명', '성 명'], ['rrn', '주민번호', '주민등록번호'], ['dept', '부서', '부서명'], ['salary', '기본급', '기본급(원)'], ['bonus', '상여', '상여금'], ['severance', '퇴직급여', '퇴직금'], ['acct', '계좌번호', '계좌']],
      rows: [
        { person_ref: 'E001', name: '가짜이름일', rrn: '900101-1234567', dept: '경영지원', salary: 3000000, bonus: 0, severance: 0, acct: '110-123-456789' },
        { person_ref: 'E002', name: '가짜이름이', rrn: '910202-2345678', dept: '경영지원', salary: 2800000, bonus: 100000, severance: 0, acct: '110-987-654321' },
        { person_ref: 'E003', name: '가짜이름삼', rrn: '920303-1456789', dept: '영업', salary: 3200000, bonus: 0, severance: 0, acct: '110-555-111111' },
      ],
    },
    {
      kind: 'import', sheet: 'OFFER SHEET', title: '수입 거래목록 OFFER SHEET', sum: 'amount',
      cols: [['ref_no', 'OFFER NO', 'Offer No.'], ['material', 'ITEM', 'Item Description'], ['supplier', 'SHIPPER', 'Shipper'], ['currency', '통화', 'Currency'], ['amount', 'AMOUNT', 'Amount (USD)'], ['fx_rate', '환율', 'Ex. Rate'], ['amount_krw', '원화금액', '원화 금액(원)'], ['extra_cost', '부대비용', '부대 비용']],
      rows: [
        { ref_no: 'OF-01', material: '가짜 원재료 9', supplier: '가짜 수출자 A', currency: 'USD', amount: 1000, fx_rate: 1350, amount_krw: 1350000, extra_cost: 50000 },
        { ref_no: 'OF-02', material: '가짜 원재료 8', supplier: '가짜 수출자 B', currency: 'USD', amount: 2000, fx_rate: 1360, amount_krw: 2720000, extra_cost: 70000 },
      ],
    },
    {
      kind: 'cashflow', sheet: '자금흐름표', title: '월별 자금흐름표', sum: 'inflow', must: ['flow_date', 'account', 'category', 'balance'],
      cols: [['flow_date', '일자', '거래 일자'], ['account', '계좌', '계좌명'], ['currency', '통화', '통 화'], ['category', '항목', '적 요'], ['inflow', '입금', '입금액(원)'], ['outflow', '출금', '출금액(원)'], ['balance', '잔액', '잔 액'], ['planned', '실적/예정', '구분(실적/예정)']],
      rows: [
        { flow_date: d(ym, 2), account: '가짜은행 주거래', currency: 'KRW', category: '가짜 매출 입금', inflow: 5000000, outflow: null, balance: 15000000, planned: '실적' },
        { flow_date: d(ym, 10), account: '가짜은행 주거래', currency: 'KRW', category: '가짜 급여 지급', inflow: null, outflow: 9000000, balance: 6000000, planned: '실적' },
        { flow_date: d(ym, 15), account: '가짜은행 운영', currency: 'KRW', category: '가짜 수금', inflow: 3000000, outflow: null, balance: 4000000, planned: '실적' },
      ],
    },
    {
      kind: 'card', sheet: '법인카드', title: '법인카드 사용내역', sum: 'amount',
      cols: [['used_on', '이용일', '이용 일자'], ['merchant', '가맹점', '가맹점명'], ['dept', '사용부서', '부 서'], ['card_last4', '카드번호', '카드 번호'], ['amount', '이용금액', '이용금액(원)']],
      rows: [
        { used_on: d(ym, 4), merchant: '가짜 식당', dept: '경영지원', card_last4: '1234-5678-9012-3456', amount: 30000 },
        { used_on: d(ym, 6), merchant: '가짜 문구', dept: '영업', card_last4: '1234-5678-9012-3456', amount: 12000 },
        { used_on: d(ym, 9), merchant: '가짜 주유소', dept: '생산1', card_last4: '1234-5678-9012-9999', amount: 80000 },
      ],
    },
    {
      kind: 'overseas', sheet: '베트남 법인 운영비', title: '베트남 법인 운영비', sum: 'amount',
      cols: [['entity', '법인명', '법인'], ['item', '항목', '비용 항목'], ['currency', '통화', 'Currency'], ['amount', '외화금액', '외화 금액'], ['fx_rate', '환율', '적용 환율'], ['amount_krw', '원화금액', '원화환산액']],
      rows: [
        { entity: '가짜 VN 법인', item: '가짜 임차료', currency: 'VND', amount: 10000000, fx_rate: 0.055, amount_krw: 550000 },
        { entity: '가짜 VN 법인', item: '가짜 현지 급여', currency: 'VND', amount: 20000000, fx_rate: 0.055, amount_krw: 1100000 },
      ],
    },
    {
      kind: 'promo', sheet: '해외 판촉비', title: '해외 판촉비', sum: 'amount',
      cols: [['person', '담당자', '담당'], ['item', '항목', '내 용'], ['currency', '통화', 'Currency'], ['amount', '금액', '금 액']],
      rows: [{ person: '가짜 담당 김', item: '가짜 전시회', currency: 'USD', amount: 2000 }, { person: '가짜 담당 이', item: '가짜 샘플 발송', currency: 'USD', amount: 700 }],
    },
    {
      kind: 'loans', sheet: '대출현황', title: '대출현황', sum: 'principal',
      cols: [['lender', '금융기관', '은행'], ['loan_type', '대출종류', '대출 구분'], ['loan_total', '대출금액', '약정금액(원)'], ['principal', '대출잔액', '잔액(원)'], ['rate', '금리', '금리(%)'], ['maturity', '만기일', '만기 일자'], ['principal_paid', '원금상환', '원금 상환액'], ['interest_paid', '이자', '월 이자'], ['pay_day', '이자납입일', '납입일']],
      rows: [
        { lender: '가짜 은행 갑', loan_type: '시설자금', loan_total: 2000000000, principal: 1266600000, rate: 4.1, maturity: '2109-06-30', principal_paid: 12330000, interest_paid: 4330000, pay_day: 25 },
        { lender: '가짜 은행 을', loan_type: '운전자금', loan_total: 1200000000, principal: 1200000000, rate: 5.2, maturity: '2107-03-31', principal_paid: 0, interest_paid: 5200000, pay_day: 17 },
      ],
    },
    {
      kind: 'borrowings', sheet: '차입금', title: '연도별 차입금', sum: 'amount',
      cols: [['tx_date', '일자', '일 자'], ['lender', '차입처', '차입처명'], ['direction', '구분', '차입/상환'], ['amount', '금액', '금 액(원)'], ['method', '입금방법', '입금 방법']],
      rows: [
        { tx_date: d(ym, 2), lender: '가짜 대여자', direction: '차입', amount: 100000000, method: '직접 입금' },
        { tx_date: d(ym, 20), lender: '가짜 대여자', direction: '상환', amount: 20000000, method: '대납' },
      ],
    },
    {
      kind: 'savings', sheet: '절감목표 및 진행현황', title: '절감목표 및 진행현황', sum: 'labor_cost',
      cols: [['item', '항목', '절감 항목'], ['labor_cost', '기존인건비', '기존 인건비(원)'], ['target', '절감목표', '절감 목표'], ['actual', '절감실적', '절감 실적']],
      rows: [{ item: '가짜 공정 자동화', labor_cost: 120000000, target: 30000000, actual: 12000000 }, { item: '가짜 외주 정리', labor_cost: 40000000, target: 10000000, actual: 2000000 }],
    },
    {
      kind: 'valuation', sheet: '재공품 완제품 평가', title: '재공품 · 완제품 평가', sum: 'amount', noTotal: true,
      cols: [['category', '재고구분', '구 분'], ['amount', '평가금액', '평가금액(원)'], ['valuation_date', '평가기준일', '기준일자'], ['method', '평가방법', '평가 방법'], ['cost_scope', '포함원가범위', '원가 범위'], ['note', '비고', '비 고']],
      must: ['category', 'amount', 'valuation_date', 'method', 'cost_scope'],
      rows: [
        { category: '재공품', amount: 3400000, valuation_date: d(ym, 28), method: '월 가중평균', cost_scope: '재료비+노무비+경비', note: '가짜' },
        { category: '완제품', amount: 5100000, valuation_date: d(ym, 28), method: '월 가중평균', cost_scope: '재료비+노무비+경비', note: '가짜' },
      ],
    },
    {
      kind: 'material_issue', sheet: '원료 출고명세', title: '원료 출고명세서', sum: 'qty_kg', noTotal: true,
      cols: [['issued_on', '출고일자', '출고 일자'], ['material', '원료명', '원료 명'], ['qty_kg', '출고량(kg)', '출고중량(kg)'], ['issue_type', '출고유형', '출고 구분'], ['memo', '적요', '비 고'], ['warehouse', '출고창고', '창고']],
      rows: [
        { issued_on: d(ym, 3), material: '가짜 원료 가', qty_kg: 410, issue_type: '생산출고', memo: '가짜 메모', warehouse: '1공장' },
        { issued_on: d(ym, 4), material: '가짜 원료 나', qty_kg: 120, issue_type: '샘플', memo: '샘플 출고', warehouse: '1공장' },
      ],
    },
    {
      kind: 'tax_invoice', sheet: '매출 세금계산서', title: '전자세금계산서 매출', sum: 'supply_amount',
      cols: [['issued_on', '작성일자', '작성 일자'], ['counterparty', '상호', '거래처 상호'], ['item', '품목명', '품 목'], ['supply_amount', '공급가액', '공급가액(원)'], ['vat', '세액', '세 액'], ['total', '합계금액', '합계 금액']],
      rows: [
        { issued_on: d(ym, 5), counterparty: '가짜 매출처 갑', item: '가짜 제품 1', supply_amount: 70000, vat: 7000, total: 77000 },
        { issued_on: d(ym, 9), counterparty: '가짜 매출처 을', item: '가짜 제품 2', supply_amount: 30000, vat: 3000, total: 33000 },
      ],
    },
    {
      kind: 'ledger_lines', sheet: '전표내역', title: '일반전표 전표내역', sum: 'debit', noTotal: true, must: ['tx_date', 'account_code', 'account_name', 'memo'],
      cols: [['tx_date', '전표일자', '일자-No.'], ['account_code', '계정코드', '계정 코드'], ['account_name', '계정과목', '계정과목명'], ['counterparty', '거래처명', '거래처'], ['memo', '적요', '적 요'], ['debit', '차변', '차변금액'], ['credit', '대변', '대변금액']],
      rows: [
        { tx_date: d(ym, 3), account_code: '8110', account_name: '복리후생비', counterparty: '가짜 식당', memo: '가짜 식대', debit: 30000, credit: null },
        { tx_date: d(ym, 3), account_code: '1030', account_name: '보통예금', counterparty: null, memo: '가짜 식대', debit: null, credit: 30000 },
        { tx_date: d(ym, 7), account_code: '8120', account_name: '여비교통비', counterparty: '가짜 택시', memo: '가짜 교통', debit: 15000, credit: null },
      ],
    },
    {
      kind: 'shipment', sheet: '출하집계표', title: '출하집계표', sum: 'qty',
      cols: [['ship_date', '출하일자', '출하 일자'], ['customer', '거래처명', '납품처'], ['product', '품목명', '품명'], ['qty', '출하량', '출하량(kg)'], ['amount', '출하금액', '출하 금액(원)']],
      rows: [
        { ship_date: d(ym, 4), customer: '가짜 거래처 A', product: '가짜 제품 1', qty: 1000, amount: 2000000 },
        { ship_date: d(ym, 11), customer: '가짜 거래처 B', product: '가짜 제품 2', qty: 400, amount: 900000 },
        { ship_date: d(ym, 18), customer: '가짜 거래처 A', product: '가짜 제품 1', qty: 600, amount: 1200000 },
      ],
    },
  ]
}

const VARIANTS = ['① 원래', '② 머리글 다름', '③ 머리글 3줄', '④ 시트 둘', '⑤ 빈 줄 · 소계'] as const
type Variant = 0 | 1 | 2 | 3 | 4

const titleLine = (t: string, ym: string) => `회사명 : (주)가짜산업 / ${ym.replace('-', '/')}/01 ~ ${ym.replace('-', '/')}/28 / ${t}`

/** 합계 · 소계 줄 — 첫 칸에 낱말, 숫자 칸에 합(글 칸은 비움). */
function sumRow(c: Case, rows: Record<string, V>[], word: string): Cell[] {
  return c.cols.map(([key], i) => {
    if (i === 0) return word
    const nums = rows.map((r) => r[key]).filter((v): v is number => typeof v === 'number')
    return nums.length === rows.length && key !== 'pay_day' && key !== 'rate' && key !== 'fx_rate' && key !== 'unit_price' ? nums.reduce((a, b) => a + b, 0) : null
  })
}

function tableRows(c: Case, v: Variant, ym: string): Cell[][] {
  const head = c.cols.map(([, o, a]) => (v === 1 ? a : o))
  const body = c.rows.map((r) => c.cols.map(([k]) => r[k] ?? null))
  const top: Cell[][] = v === 2 ? [[c.title], [titleLine(c.title, ym), null, null, '(단위 : 원)']] : [[titleLine(c.title, ym)]]
  if (v !== 4) return [...top, head, ...body, ...(c.noTotal ? [] : [sumRow(c, c.rows, '합계')])]
  // ⑤ 빈 줄 · 소계(앞 절반) · 빈 줄 · 나머지 · 소계 · 합 계(띄어 쓴)
  const half = Math.max(1, Math.floor(c.rows.length / 2))
  const blank: Cell[] = c.cols.map(() => null)
  return [
    ...top, head, blank,
    ...body.slice(0, half), sumRow(c, c.rows.slice(0, half), '소계'), blank,
    ...body.slice(half), sumRow(c, c.rows.slice(half), '[소계]'), blank,
    // 묶음 이름이 붙은 부분 합(ECOUNT 거래처별 · 품목별) — 줄이 아니다(0092). 숫자 칸은 0이라 합계 줄 검산을 바꾸지 않는다.
    sumRow(c, [], '가짜 거래처 A 소계'), blank,
    sumRow(c, c.rows, '합 계'),
  ]
}

async function build(c: Case, v: Variant, ym: string): Promise<Uint8Array> {
  const data = { name: c.sheet, rows: tableRows(c, v, ym) }
  if (v === 3) return xlsx([{ name: '표지', rows: [['가짜산업 월간 자료'], [], ['작성 : 재무팀'], ['기간', ym]] }, data])
  return xlsx([data])
}

interface Result { label: string; ok: boolean; why: string }

function savedRows(card: FileCard): Record<string, unknown>[] {
  if (card.kind === 'valuation') return dummyFinStore().valuations.filter((x) => x.source_upload_id === card.upload_id && !x.voided_at).map((x) => x as unknown as Record<string, unknown>)
  return dummyFinLines().filter((l) => l.upload_id === card.upload_id && !l.voided_at && !l.people).map((l) => l.row as Record<string, unknown>)
}

async function runCase(c: Case, v: Variant, ym: string, user: SessionUser): Promise<Result> {
  const label = `${c.kind} ${VARIANTS[v]}`
  const bytes = await build(c, v, ym)
  const cards = await processUpload({ repo, businessId: BIZ, fileName: `가짜 ${c.kind} v${v + 1} ${ym}.xlsx`, bytes, classify: null, aiBudget: 0, today: new Date('2099-06-15'), boss: true, user })
  const card = cards.find((x) => x.kind === c.kind) ?? cards[0]
  const shown = `«${card.message}»${card.why.length ? ` why=${JSON.stringify(card.why)}` : ''}${card.warnings?.length ? ` warnings=${JSON.stringify(card.warnings.slice(0, 3))}` : ''}`
  if (cards.length !== 1) return { label, ok: false, why: `카드 ${cards.length}장: ${cards.map((x) => `${x.sheet}:${x.kind}:${x.status}`).join(' / ')} ${shown}` }
  if (card.status !== 'applied') return { label, ok: false, why: `${card.status}${card.hold ? `(${card.hold})` : ''} · kind=${card.kind} ${shown}` }
  if (card.kind !== c.kind) return { label, ok: false, why: `종류 ${card.kind} ${shown}` }
  if (card.period !== ym) return { label, ok: false, why: `기간 ${card.period}(기대 ${ym}) ${shown}` }
  const want = c.saved ?? c.rows.length
  if (card.rows !== want) return { label, ok: false, why: `줄 ${card.rows}(기대 ${want}) ${shown}` }
  const rows = savedRows(card)
  if (rows.length !== want) return { label, ok: false, why: `저장된 줄 ${rows.length}(기대 ${want})` }
  const sumWant = c.rows.reduce((a, r) => a + (typeof r[c.sum] === 'number' ? (r[c.sum] as number) : 0), 0)
  const sumGot = rows.reduce((a, r) => a + Number(r[c.sum] ?? 0), 0)
  if (Math.abs(sumGot - sumWant) > 0.5) return { label, ok: false, why: `${c.sum} 합 ${sumGot}(기대 ${sumWant}) ${shown}` }
  const must = c.must ?? c.cols.map(([k]) => k)
  const empty = must.filter((k) => k !== 'credit' && k !== 'debit' && rows.every((r) => r[k] === null || r[k] === undefined || r[k] === ''))
  if (empty.length) return { label, ok: false, why: `못 알아본 칸 ${empty.join(', ')} ${shown} 첫 줄=${JSON.stringify(rows[0])}` }
  if (card.warnings?.some((w) => w.startsWith('합계가 맞지 않습니다'))) return { label, ok: false, why: `합계 경고 ${shown}` }
  return { label, ok: true, why: '' }
}

/* ───── ⑤ 계정별 원장 · 계정과목표 · 월별 손익(모양이 달라 따로) ───── */

const LEDGER: [string, string, [number, number][]][] = [
  ['8110', '복리후생비', [[30000, 0], [20000, 0]]],
  ['9310', '이자비용', [[12000, 0]]],
  ['4010', '제품매출', [[0, 500000], [0, 250000]]],
]

function ledgerRows(v: Variant, ym: string): Cell[][] {
  const head = v === 1 ? ['일자-No.', '적 요', '차변(원)', '대변(원)', '잔 액(원)'] : ['일자-No.', '적요', '차변', '대변', '잔액']
  const out: Cell[][] = v === 2 ? [['계정별원장'], [null, null, null, '(단위 : 원)']] : []
  for (const [code, name, lines] of LEDGER) {
    out.push([`회사명 : (주)가짜산업 / ${ym.replace('-', '/')}/01 ~ ${ym.replace('-', '/')}/28 / 계정별원장 / ${code}(${name})`], head, ['이월잔액', null, null, null, 0])
    let bal = 0
    lines.forEach(([dr, cr], i) => {
      bal += dr - cr
      out.push([d(ym, 3 + i * 5), `가짜 ${name} ${i + 1}`, dr || null, cr || null, bal])
      if (v === 4) out.push([null, null, null, null, null])
    })
    const dr = lines.reduce((a, l) => a + l[0], 0)
    const cr = lines.reduce((a, l) => a + l[1], 0)
    if (v === 4) out.push(['[ 월 계 ]', null, dr, cr, null], ['[ 누 계 ]', null, dr, cr, null])
    else out.push(['합계', null, dr, cr, null])
  }
  return out
}

async function runLedger(v: Variant, ym: string, user: SessionUser): Promise<Result> {
  const label = `ledger ${VARIANTS[v]}`
  const data = { name: '계정별원장', rows: ledgerRows(v, ym) }
  const bytes = await xlsx(v === 3 ? [{ name: '표지', rows: [['가짜산업 월간 자료'], [], ['작성 : 재무팀']] }, data] : [data])
  const cards = await processUpload({ repo, businessId: BIZ, fileName: `가짜 ledger v${v + 1} ${ym}.xlsx`, bytes, classify: null, aiBudget: 0, today: new Date('2099-06-15'), boss: true, user })
  const card = cards[0]
  const shown = `«${card.message}»${card.why.length ? ` why=${JSON.stringify(card.why)}` : ''}${card.warnings?.length ? ` warnings=${JSON.stringify(card.warnings.slice(0, 3))}` : ''}`
  if (cards.length !== 1 || card.status !== 'applied' || card.kind !== 'ledger') return { label, ok: false, why: `${cards.map((x) => `${x.sheet}:${x.kind}:${x.status}`).join(' / ')} ${shown}` }
  if (card.period !== ym) return { label, ok: false, why: `기간 ${card.period} ${shown}` }
  const rows = savedRows(card)
  if (rows.length !== LEDGER.length) return { label, ok: false, why: `계정 ${rows.length}(기대 ${LEDGER.length}) ${shown}` }
  const dr = rows.reduce((a, r) => a + Number(r.debit ?? 0), 0)
  const want = LEDGER.reduce((a, [, , l]) => a + l.reduce((s, x) => s + x[0], 0), 0)
  if (dr !== want) return { label, ok: false, why: `차변 합 ${dr}(기대 ${want}) ${shown}` }
  return { label, ok: true, why: '' }
}

const CHART: [string, string, string][] = [['1010', '현금및현금성자산', '자산'], ['1080', '외상매출금', '자산'], ['2010', '외상매입금', '부채'], ['3310', '자본금', '자본'], ['4010', '제품매출', '수익'], ['8110', '복리후생비', '비용'], ['9310', '이자비용', '영업외비용']]

async function runAccounts(v: Variant, user: SessionUser): Promise<Result> {
  const label = `accounts ${VARIANTS[v]}`
  const head = v === 1 ? ['계정 코드', '계정과목명', '구 분', '사용 여부'] : ['코드', '계정명', '구분', '사용여부']
  const body = CHART.map(([c, n, g]) => [c, n, g, '사용'])
  const top: Cell[][] = v === 2 ? [['계정과목 목록'], ['회사 : 가짜산업', null, null, '(단위 : 원)']] : [['계정과목 목록']]
  const rows: Cell[][] = v === 4 ? [...top, head, [null], ...body.slice(0, 3), [null], ...body.slice(3), [null]] : [...top, head, ...body]
  const data = { name: '계정과목', rows }
  const bytes = await xlsx(v === 3 ? [{ name: '표지', rows: [['가짜산업 계정과목'], [], ['작성 : 재무팀']] }, data] : [data])
  const cards = await processUpload({ repo, businessId: BIZ, fileName: `계정과목표 가짜 v${v + 1}.xlsx`, bytes, classify: null, aiBudget: 0, today: new Date('2099-06-15'), boss: true, user })
  const card = cards[0]
  const shown = `«${card.message}» warnings=${JSON.stringify(card.warnings ?? [])}`
  if (card.status !== 'applied' || card.legacy !== 'accounts') return { label, ok: false, why: `${card.status} legacy=${card.legacy} ${shown}` }
  if (!new RegExp(`계정 ${CHART.length}개`).test(card.message)) return { label, ok: false, why: `계정 수 ${shown}` }
  return { label, ok: true, why: '' }
}

async function runMonthly(v: Variant, year: number, user: SessionUser): Promise<Result> {
  const label = `monthly ${VARIANTS[v]}`
  const head = v === 1 ? ['계정 코드', '과 목', '9 월', '합 계'] : ['계정코드', '과목명', '9월', '합계']
  const L: [string | null, string, number][] = [[null, 'Ⅰ. 매출액', 900000], ['4010', '제품매출', 900000], [null, 'Ⅳ. 판매비와관리비', 50000], ['8110', '복리후생비', 50000], [null, 'Ⅶ. 영업외비용', 12000], ['9310', '이자비용', 12000], [null, 'Ⅷ. 당기순이익', 838000]]
  const body = L.map(([c, n, a]) => [c, n, a, a])
  const top: Cell[][] = [['월별 손익계산서'], [`${year}/01/01 ~ ${year}/12/31`], [null, null, null, '(단위 : 원)']]
  const rows: Cell[][] = v === 4 ? [...top, head, [null], ...body.slice(0, 3), [null], ...body.slice(3)] : v === 2 ? [['월별 손익계산서'], [`${year}/01/01 ~ ${year}/12/31`, null, null, '(단위 : 원)'], head, ...body] : [...top, head, ...body]
  const data = { name: '월별손익', rows }
  const bytes = await xlsx(v === 3 ? [{ name: '표지', rows: [['가짜산업 손익'], [], ['작성 : 재무팀']] }, data] : [data])
  const cards = await processUpload({ repo, businessId: BIZ, fileName: `월별손익계산서_${year}_v${v + 1}.xlsx`, bytes, classify: null, aiBudget: 0, today: new Date('2099-06-15'), boss: true, user })
  const card = cards[0]
  const shown = `«${card.message}» warnings=${JSON.stringify(card.warnings ?? [])}`
  if (card.status !== 'applied' || card.legacy !== 'monthly') return { label, ok: false, why: `${card.status} legacy=${card.legacy} ${shown}` }
  if (card.period !== `${year}-09`) return { label, ok: false, why: `기간 ${card.period} ${shown}` }
  return { label, ok: true, why: '' }
}

async function main() {
  const user = session()
  assert.equal(user.role, 'Chairman')
  const results: Result[] = []
  const kinds = cases('2099-01').map((c) => c.kind)
  for (let v = 0 as Variant; v < 5; v = (v + 1) as Variant) {
    for (const [ki, kind] of [...kinds, 'ledger' as const].entries()) {
      // 종류 · 모양마다 다른 달(겹침 · 바꾸기가 끼지 않게).
      const ym = `${2080 + v * 2 + Math.floor(ki / 12)}-${String((ki % 12) + 1).padStart(2, '0')}`
      if (kind === 'ledger') results.push(await runLedger(v, ym, user))
      else results.push(await runCase(cases(ym).find((c) => c.kind === kind)!, v, ym, user))
    }
    results.push(await runAccounts(v, user))
    results.push(await runMonthly(v, 2070 + v, user))
  }
  // 못 알아본 꼭 있어야 하는 칸 — 카드가 «파일을 고치세요»가 아니라 그 칸 이름을 말한다.
  {
    const ym = '2079-03'
    const noProduct = await processUpload({ repo, businessId: BIZ, fileName: '가짜 판매 모델.xlsx', bytes: await xlsx([{ name: '판매현황', rows: [[titleLine('판매현황', ym)], ['판매일자', '거래처명', '모델', '판매수량', '공급가액'], [d(ym, 3), '가짜 거래처 A', '가짜 제품 1', 10, 10000], [d(ym, 4), '가짜 거래처 B', '가짜 제품 2', 5, 7000], ['합계', null, null, 15, 17000]] }]), classify: null, aiBudget: 0, boss: true, user })
    const c = noProduct[0]
    results.push({ label: 'msg 필수 글 칸', ok: c.status === 'failed' && c.message.startsWith('«제품» 열을 못 알아봤습니다') && !!c.ask?.some((a) => a.label === '모델'), why: `${c.status} «${c.message}» ask=${JSON.stringify(c.ask)}` })
    const noAmount = await processUpload({ repo, businessId: BIZ, fileName: '가짜 판매 매상.xlsx', bytes: await xlsx([{ name: '판매현황', rows: [[titleLine('판매현황', ym)], ['판매일자', '거래처명', '품목명', '판매수량', '매상'], [d(ym, 3), '가짜 거래처 A', '가짜 제품 1', 10, 10000], [d(ym, 4), '가짜 거래처 B', '가짜 제품 2', 5, 7000]] }]), classify: null, aiBudget: 0, boss: true, user })
    const a = noAmount[0]
    results.push({ label: 'msg 필수 숫자 칸', ok: a.status === 'applied' && !!a.warnings?.some((w) => w.startsWith('«금액» 열을 못 알아봤습니다')), why: `${a.status} «${a.message}» warnings=${JSON.stringify(a.warnings)}` })
    for (const r of [noProduct, noAmount].flat()) assert.ok(!/회장/.test(`${r.message} ${(r.warnings ?? []).join(' ')}`), '직원 화면 문구에 «회장»')
  }
  const failed = results.filter((r) => !r.ok)
  // 표: 종류 × 모양
  const names = [...new Set(results.filter((r) => !r.label.startsWith('msg')).map((r) => r.label.split(' ')[0]))]
  for (const n of names) console.log(`${n.padEnd(15)} ${VARIANTS.map((vn) => (results.find((r) => r.label === `${n} ${vn}`)?.ok ? 'PASS' : 'FAIL')).join('  ')}`)
  for (const m of results.filter((r) => r.label.startsWith('msg'))) console.log(`${m.label.padEnd(15)} ${m.ok ? 'PASS' : 'FAIL'}`)
  // 묶음 이름이 붙은 부분 합은 소계 · 그냥 합계 · 계정 이름은 그대로(0092)
  assert.equal(builtinRole('가짜 거래처 A 소계'), 'subtotal')
  assert.equal(builtinRole('급여(판관) 9월 합계'), null) // 원장 적요 — 거래 줄
  assert.equal(builtinRole('합 계'), 'total')
  assert.equal(builtinRole('총합계'), 'total')
  assert.equal(builtinRole('월합계'), 'month')
  assert.equal(builtinRole('외상매출금'), null)
  for (const f of failed) console.log(`FAIL ${f.label}: ${f.why}`)
  assert.equal(failed.length, 0, `${failed.length}/${results.length} 실패`)
  console.log(
    `PASS: 모양 바꾸기 ${names.length * VARIANTS.length}/${names.length * VARIANTS.length}(${names.length}가지 × 다섯 모양: 원래 · 머리글 다름 · 머리글 3줄 · 시트 둘 · 빈 줄 · 소계) — 저장 · 줄 수 · 합(합계 · 소계 줄 빼고) · 칸 다 알아봄 · ` +
      `못 알아본 칸 이름 문구 2/2. 진짜 AI 0회.`,
  )
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

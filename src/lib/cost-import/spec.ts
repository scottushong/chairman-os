import type { ImportField, ImportTarget } from './types'

/**
 * 대상별 엑셀 칸 — 빈 양식의 머리글 · 예시 한 줄 · 설명 시트, 칸 맞추기의 짐작(머리글 동의어)이 모두 여기서 나온다.
 * 예시 값은 **가짜**다(실제 원료 · 공급처 · 가격이 아니다 — check:cost-import가 양식에 실제 자료가 0인지 본다).
 *
 * 영역(area)은 화면 입력 권한과 같다(회장 결정 2026-10-11): 원료 · 공급처 · 시장가 · 구매 LOT = 구매 입력, 비용 줄 = 원가 관리,
 * 생산 LOT · 투입 = 생산 입력, BOM = 대표만.
 */

export const IMPORT_AREA: Record<ImportTarget, 'purchasing' | 'costing' | 'production' | 'chairman'> = {
  materials: 'purchasing',
  suppliers: 'purchasing',
  market_prices: 'purchasing',
  purchase_lots: 'purchasing',
  overheads: 'costing',
  production: 'production',
  bom: 'chairman',
}

/** 한 파일의 자료 줄 상한(머리글 제외). BOM은 줄 = 원료 한 줄이라 더 크다. 대량 넣기로 감사 · 검사를 흐리지 않게. */
export const IMPORT_MAX_ROWS: Record<ImportTarget, number> = {
  materials: 500,
  suppliers: 500,
  market_prices: 500,
  purchase_lots: 500,
  overheads: 200,
  production: 500,
  bom: 1000,
}

/** 파일 크기 상한 — 서버 액션 본문으로 받는다(파일은 어디에도 저장하지 않는다). */
export const IMPORT_MAX_BYTES = 2 * 1024 * 1024

interface FieldSpec extends ImportField {
  /** 머리글 짐작 — 공백 · 괄호를 걷은 소문자로 비교한다. */
  aliases: string[]
}

const f = (key: string, label: string, required: boolean, hint: string, example: string, aliases: string[] = []): FieldSpec => ({
  key,
  label,
  required,
  hint,
  example,
  aliases: [label, key, ...aliases],
})

export const IMPORT_FIELDS: Record<ImportTarget, FieldSpec[]> = {
  materials: [
    f('name', '원료 이름', true, '회사 안에서 겹치지 않는 이름. 띄어쓰기 · 대소문자는 같은 이름으로 본다.', '예시원료A', ['원료', '원료명', '품목', '품목명', 'material', 'name']),
    f('unit', '단위', false, 'kg만 받습니다(비우면 kg).', 'kg', ['기본단위', 'unit']),
    f('category', '분류', false, '주원료 · 부원료 · 첨가제 · 포장재 · 기타(비우면 주원료).', '주원료', ['구분', '종류', 'category']),
    f('spec', '규격', false, '200자까지.', '25kg 포대', ['spec', '사양']),
    f('note', '메모', false, '500자까지.', '', ['비고', 'note']),
  ],
  suppliers: [
    f('name', '공급처 이름', true, '회사 안에서 겹치지 않는 이름.', '예시공급사', ['공급처', '공급사', '거래처', '거래처명', 'supplier', 'vendor']),
    f('country', '국가', false, '60자까지.', '한국', ['country', '나라']),
    f('currency', '통화', false, 'KRW · USD 같은 세 글자(비우면 KRW).', 'KRW', ['기본통화', 'currency']),
    f('contact', '연락처', false, '500자까지.', '', ['담당자', 'contact']),
    f('terms', '조건', false, '결제 · 인도 조건. 500자까지.', '', ['결제조건', 'terms']),
    f('note', '메모', false, '500자까지.', '', ['비고', 'note']),
  ],
  market_prices: [
    f('material', '원료', true, '원료 이름(먼저 원료 엑셀로 넣어 둔 이름). 못 찾으면 그 줄은 오류입니다.', '예시원료A', ['원료이름', '원료명', '품목', 'material']),
    f('date', '날짜', true, '시세 날짜(2026-10-11). 내일보다 먼 날짜는 받지 않습니다.', '2026-10-01', ['일자', '조사일', 'date']),
    f('price', '가격', true, 'kg당 가격(통화 단위). 0보다 커야 합니다.', '1000', ['단가', 'kg당가격', 'price']),
    f('currency', '통화', false, '세 글자(비우면 KRW).', 'KRW', ['currency']),
    f('fx_rate', '환율', false, '원화가 아니면 넣거나 비우면 그 날 환율 표에서 찾습니다.', '', ['fx', 'rate']),
    f('source', '출처', true, '같은 원료 · 같은 날이라도 출처가 다르면 따로 들어가 평균을 냅니다.', '예시 시세지', ['출처명', 'source']),
    f('source_url', '출처 주소', false, 'http:// 또는 https://.', '', ['url', '링크']),
    f('note', '메모', false, '500자까지.', '', ['비고', 'note']),
  ],
  purchase_lots: [
    f('material', '원료', true, '원료 이름. 못 찾으면 오류.', '예시원료A', ['원료이름', '원료명', '품목', 'material']),
    f('supplier', '공급처', true, '공급처 이름. 못 찾으면 오류(먼저 공급처 엑셀을 넣으세요).', '예시공급사', ['공급처이름', '공급사', '거래처', 'supplier']),
    f('received_on', '입고일', true, '원가 기준일. 내일보다 먼 날짜는 받지 않습니다.', '2026-10-01', ['입고일자', '입고', 'received']),
    f('qty_kg', 'kg', true, '입고 kg. 0보다 커야 합니다.', '1000', ['수량', '수량kg', '입고kg', 'qty']),
    f('unit_price', '단가', true, 'kg당 단가(통화 단위).', '1000', ['kg당단가', 'unitprice', 'price']),
    f('currency', '통화', false, '세 글자(비우면 KRW).', 'KRW', ['currency']),
    f('fx_rate', '환율', false, '비우면 입고일 환율 표에서 찾습니다.', '', ['fx', 'rate']),
    f('freight_krw', '운송', false, '원화 합계(비우면 0).', '0', ['운송비', '운임', 'freight']),
    f('duty_krw', '관세', false, '원화 합계(비우면 0).', '0', ['관세액', 'duty']),
    f('other_krw', '부대', false, '원화 합계(비우면 0).', '0', ['부대비', '기타비용', 'other']),
    f('supplier_lot_no', '공급처 LOT 번호', false, '같은 날 같은 kg 두 LOT를 구분하는 칸.', '', ['lot번호', 'lotno', 'lot']),
    f('ordered_on', '주문일', false, '비워도 됩니다.', '', ['발주일', 'ordered']),
    f('note', '메모', false, '500자까지.', '', ['비고', 'note']),
  ],
  overheads: [
    f('category', '항목', true, '인건비 · 전기 · 가스 · 감가상각 · QC · 폐기 Loss · 포장 · 팔레트 · 물류 · 창고 · 임대 · 보험 · 금융비용 · 커미션 · 기타.', '전기', ['비용항목', 'category']),
    f('basis', '방식', true, '월 금액 또는 원/kg.', '월 금액', ['배부방식', 'basis']),
    f('amount', '금액', true, '월 금액이면 원/월, 원/kg이면 원/kg. 0 = 그 날부터 없음.', '1000000', ['amount', '금액원']),
    f('scope', '범위', false, '원/kg만 — 제품 이름. 비우면 모든 제품.', '', ['제품', '대상제품', 'scope']),
    f('effective_from', '시작일', true, '그 날부터 적용(미래 날짜 가능).', '2026-10-01', ['적용일', '적용시작일', 'from']),
    f('note', '메모', false, '300자까지.', '', ['비고', 'note']),
  ],
  production: [
    f('order', '오더', true, '생산 오더 번호(PO-…). 열린 오더만.', 'PO-20261001-ABC123', ['오더번호', '생산오더', 'order']),
    f('produced_on', '생산일', true, '같은 오더 · 생산일 · 산출 kg 줄은 생산 LOT 하나로 묶습니다.', '2026-10-01', ['생산일자', 'date']),
    f('output_kg', '산출 kg', true, '생산 LOT의 산출 kg.', '500', ['산출', '산출량', 'output']),
    f('lot', '투입 LOT', true, '구매 LOT 번호(PL-…). 잔량을 넘으면 거부.', 'PL-20260920-DEF456', ['투입lot번호', '구매lot', 'lot']),
    f('qty_kg', '투입 kg', true, '그 LOT에서 쓴 kg.', '100', ['투입량', 'kg', 'qty']),
    f('note', '메모', false, '생산 LOT 메모(묶음의 첫 줄). 500자까지.', '', ['비고', 'note']),
  ],
  bom: [
    f('product', '제품', true, '제품 이름. 같은 제품 · 같은 시작일 줄은 판 하나로 묶습니다.', '예시제품A', ['제품명', '품목', 'product']),
    f('valid_from', '시작일', true, '판 적용 시작일.', '2026-10-01', ['적용일', '적용시작일', 'from']),
    f('yield_pct', '수율', true, '% (0 초과 100 이하). 한 판 안에서 같은 값.', '95', ['수율%', 'yield']),
    f('material', '원료', true, '원료 이름. 못 찾으면 오류.', '예시원료A', ['원료명', '자재', '자재명', 'material']),
    f('kg_per_kg', '원료 kg/제품 kg', true, '제품 1kg에 드는 원료 kg(소수 8자리까지).', '0.5', ['소요량', '배합량', 'kgperkg', 'qty']),
    f('note', '메모', false, '판 메모(묶음의 첫 줄). 300자까지.', '', ['비고', 'note']),
  ],
}

/** 머리글 비교용 — 공백 · 괄호 · 밑줄 · 마침표를 걷은 소문자. */
export function headerKey(s: string): string {
  return s.toLowerCase().replace(/[\s()[\]{}_.·/:-]+/g, '')
}

/** 머리글 짐작: 칸마다 동의어가 맞는 첫 열. 한 열은 한 칸에만. */
export function guessMapping(target: ImportTarget, headers: string[]): Record<string, number | null> {
  const keys = headers.map(headerKey)
  const used = new Set<number>()
  const out: Record<string, number | null> = {}
  for (const field of IMPORT_FIELDS[target]) {
    const aliases = field.aliases.map(headerKey)
    let hit: number | null = null
    for (let i = 0; i < keys.length && hit === null; i += 1) {
      if (!used.has(i) && keys[i] && aliases.includes(keys[i])) hit = i
    }
    if (hit !== null) used.add(hit)
    out[field.key] = hit
  }
  return out
}

/** 이름 비교 — DB의 name_norm(공백 걷기 · 소문자)과 같다. */
export function nameNorm(s: string): string {
  return s.replace(/\s+/g, '').toLowerCase()
}

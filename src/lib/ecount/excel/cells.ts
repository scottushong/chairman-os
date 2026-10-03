import { parseAccountingNumber } from '@/lib/statements/paste'

/**
 * ECOUNT 엑셀 셀 한 칸의 정규화 — 순수 함수(exceljs를 import하지 않는다 · 값 모양만 본다).
 *
 * **못 읽은 칸은 0이 아니라 오류다**(설계서 A · paste.ts와 같은 원칙). 파서가 조용히 0을 넣으면 그 0이
 * 장부로 들어가 «그 달 매출 0원»이라는 없는 사실이 확정된다. 오류 칸은 이유를 들고 다니고, 대상별 판정이
 * 그 칸을 «차단»으로 보여 준다.
 *
 * 수식 칸은 저장된 결과(result)를 쓴다. 결과가 없으면(프로그램이 만든 파일에 흔하다) 오류다 —
 * 수식을 여기서 다시 계산하지 않는다.
 */

export type EcountCell =
  | { t: 'empty' }
  | { t: 'number'; v: number }
  | { t: 'text'; v: string }
  /** YYYY-MM-DD (exceljs는 날짜 칸을 UTC 자정으로 준다). */
  | { t: 'date'; v: string }
  /** 읽지 못한 칸 — v는 사람에게 보일 이유. */
  | { t: 'error'; v: string }

export const EMPTY_CELL: EcountCell = Object.freeze({ t: 'empty' }) as EcountCell

/** 금액 단위. ECOUNT 재무제표는 머리에 «(단위 : 원)» · «(단위 : 천원)»을 적는다. */
export type EcountUnit = 'won' | 'thousand' | 'million'

export const UNIT_MULTIPLIER: Record<EcountUnit, number> = { won: 1, thousand: 1_000, million: 1_000_000 }
export const UNIT_LABEL_KO: Record<EcountUnit, string> = { won: '원', thousand: '천원', million: '백만원' }

function textCell(s: string): EcountCell {
  const v = s.trim()
  return v === '' ? EMPTY_CELL : { t: 'text', v }
}

/** exceljs의 cell.value 하나를 정규화한다. 모양은 exceljs CellValue — null · 수 · 글 · 불리언 · 날짜 · 객체 다섯. */
export function normalizeCell(value: unknown): EcountCell {
  if (value === null || value === undefined) return EMPTY_CELL
  if (typeof value === 'number') return Number.isFinite(value) ? { t: 'number', v: value } : { t: 'error', v: '숫자가 아닌 값(무한대)' }
  if (typeof value === 'string') return textCell(value)
  if (typeof value === 'boolean') return { t: 'text', v: value ? 'TRUE' : 'FALSE' }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? { t: 'error', v: '날짜를 읽지 못함' } : { t: 'date', v: value.toISOString().slice(0, 10) }
  }
  if (typeof value === 'object') {
    const o = value as Record<string, unknown>
    // 셀 오류(#DIV/0! · #REF! …)
    if (typeof o.error === 'string') return { t: 'error', v: `셀 오류 ${o.error}` }
    // 수식 · 공유 수식 — 저장된 결과만 믿는다.
    if ('formula' in o || 'sharedFormula' in o) {
      if (o.result === undefined || o.result === null) {
        return { t: 'error', v: '수식 결과가 저장되지 않은 칸 — 엑셀에서 열어 저장한 뒤 다시 올리세요' }
      }
      const r = normalizeCell(o.result)
      return r.t === 'empty' ? { t: 'error', v: '수식 결과가 비어 있음' } : r
    }
    // 서식 있는 글(richText)
    if (Array.isArray(o.richText)) {
      return textCell(o.richText.map((p) => (p && typeof (p as { text?: unknown }).text === 'string' ? (p as { text: string }).text : '')).join(''))
    }
    // 하이퍼링크 — 보이는 글만. text가 다시 richText일 수 있다.
    if ('hyperlink' in o || 'text' in o) return typeof o.text === 'string' ? textCell(o.text) : normalizeCell(o.text)
  }
  return { t: 'error', v: '읽을 수 없는 칸' }
}

/** 칸을 글로(머리글 · 과목명 · 기간 찾기). 오류 칸은 빈 글이다. */
export function cellText(cell: EcountCell | undefined): string {
  if (!cell) return ''
  switch (cell.t) {
    case 'text':
    case 'date':
      return cell.v
    case 'number':
      return String(cell.v)
    default:
      return ''
  }
}

export type AmountResult = { ok: true; value: number | null } | { ok: false; reason: string }

/**
 * 금액 칸을 원 단위로. 빈 칸은 null(0이 아니다 — 0인지 빈 칸인지는 대상별 판정이 정한다).
 * 글 칸은 paste.ts 규칙(쉼표 · 괄호 음수 · ₩ · 공백)으로 읽는다. 단위를 곱한 **뒤에** 반올림한다.
 */
export function cellAmount(cell: EcountCell | undefined, unit: EcountUnit = 'won'): AmountResult {
  if (!cell || cell.t === 'empty') return { ok: true, value: null }
  if (cell.t === 'date') return { ok: false, reason: `금액 자리에 날짜(${cell.v})` }
  if (cell.t === 'error') return { ok: false, reason: cell.v }
  const raw = cell.t === 'number' ? cell.v : parseAccountingNumber(cell.v)
  if (raw === null) return { ok: true, value: null }
  if (raw === undefined) return { ok: false, reason: `숫자로 읽지 못함: «${String(cell.v).slice(0, 40)}»` }
  const value = Math.round(raw * UNIT_MULTIPLIER[unit])
  if (!Number.isSafeInteger(value)) return { ok: false, reason: '금액이 너무 큽니다' }
  // -0을 0으로(화면 · 비교에서 «-0»이 보이지 않게).
  return { ok: true, value: value === 0 ? 0 : value }
}

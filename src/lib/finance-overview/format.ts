/** 재무 현황 숫자 글 — 시안의 모양(«19.9억» · «1,992,975,160» · «−18,420,000» · «+4.2%» · «−0.4%p»). 빈 값은 «—». */

const MINUS = '−'

/** 억 단위(소수 한 자리). sign = 양수에 «+». */
export function eok(v: number | null | undefined, digits = 1, sign = false): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—'
  const x = v / 1e8
  const body = Math.abs(x) >= 1000 ? Math.round(Math.abs(x)).toLocaleString('ko-KR') : Math.abs(x).toFixed(digits)
  return `${x < 0 ? MINUS : sign && x > 0 ? '+' : ''}${body}억`
}

/** 원 단위 전부(쉼표). sign = 양수에 «+». */
export function won(v: number | null | undefined, sign = false): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—'
  const r = Math.round(v)
  return `${r < 0 ? MINUS : sign && r > 0 ? '+' : ''}${Math.abs(r).toLocaleString('ko-KR')}`
}

export function usd(v: number | null | undefined, sign = false): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—'
  return `${v < 0 ? MINUS : sign && v > 0 ? '+' : ''}$ ${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function pctText(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—'
  return `${v < 0 ? MINUS : v > 0 ? '+' : ''}${Math.abs(v).toFixed(digits)}%`
}

export function ppText(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—'
  return `${v < 0 ? MINUS : v > 0 ? '+' : ''}${Math.abs(v).toFixed(digits)}%p`
}

/** 비율(%) 그대로(부호 없이). */
export function ratio(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—'
  return `${v.toFixed(digits)}%`
}

export const monthKo = (p: string) => `${Number(p.slice(5, 7))}월`
export const yearMonthKo = (p: string) => `${p.slice(0, 4)}년 ${Number(p.slice(5, 7))}월`

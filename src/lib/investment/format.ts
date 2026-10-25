/**
 * 투자 화면의 숫자 표기 — 금액은 통화를 늘 붙이고(USD «$» · KRW «원»), 비율은 «%», 기준일은 YYYY-MM-DD.
 * 값이 없으면 «—»(0이 아니다 — 0과 없음은 다르다).
 */

export const DASH = '—'

export function usd(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return DASH
  return `$${v.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`
}

/** 큰 달러 금액 — $1.23B · $456.7M · $12.3K */
export function usdBig(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return DASH
  const a = Math.abs(v)
  const sign = v < 0 ? '−' : ''
  if (a >= 1e12) return `${sign}$${(a / 1e12).toFixed(2)}T`
  if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(2)}B`
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(1)}M`
  if (a >= 1e3) return `${sign}$${(a / 1e3).toFixed(1)}K`
  return `${sign}$${a.toFixed(0)}`
}

export function krw(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return DASH
  return `${Math.round(v).toLocaleString('ko-KR')}원`
}

/** 억 · 만 단위 원 — 73.6억 원 · 4,000만 원 */
export function krwEok(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return DASH
  const a = Math.abs(v)
  const sign = v < 0 ? '−' : ''
  if (a >= 1e8) return `${sign}${(a / 1e8).toLocaleString('ko-KR', { maximumFractionDigits: 1 })}억 원`
  if (a >= 1e4) return `${sign}${Math.round(a / 1e4).toLocaleString('ko-KR')}만 원`
  return `${sign}${Math.round(a).toLocaleString('ko-KR')}원`
}

export function shares(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return DASH
  return Math.round(v).toLocaleString('en-US')
}

export function pct(v: number | null | undefined, digits = 1, signed = false): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return DASH
  const s = v.toFixed(digits)
  return `${signed && v > 0 ? '+' : v < 0 ? '−' : ''}${s.replace('-', '')}%`
}

export function times(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return DASH
  return `${v.toFixed(digits)}x`
}

export function day(iso: string | null | undefined): string {
  return iso ? iso.slice(0, 10) : DASH
}

export function seoulDateTime(iso: string | null | undefined): string {
  if (!iso) return DASH
  return new Date(iso).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
}

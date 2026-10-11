/**
 * 엑셀 칸 글자 → 값. 브라우저 없이 돈다(check:cost-import).
 * 숫자는 **10진 문자열**로 돌려준다 — DB numeric에 원값 그대로 넣는다(부동소수 꼬리 없이).
 */

/** «1,234.50» · «₩1,234» · «1234» → «1234.5». 음수 · 숫자 아님 → null. 빈 칸 → ''. */
export function decimal(raw: string): string | null {
  let s = raw.replace(/[,\s₩$€¥원]/g, '')
  if (s === '') return ''
  // 엑셀 숫자 칸이 String()으로 1e-7처럼 올 수 있다.
  if (/^\d+(\.\d+)?e[-+]?\d+$/i.test(s)) {
    const n = Number(s)
    if (!Number.isFinite(n) || n < 0) return null
    s = n.toFixed(12)
  }
  if (!/^\d+(\.\d+)?$/.test(s)) return null
  const [i, d = ''] = s.split('.')
  const int = i.replace(/^0+(?=\d)/, '')
  const frac = d.replace(/0+$/, '')
  return frac ? `${int}.${frac}` : int
}

/** 소수 자리 수. */
export function scale(dec: string): number {
  const p = dec.split('.')[1]
  return p ? p.length : 0
}

/** 같은 수인가(문자열 10진 비교). 기존 줄은 number로 오므로 같은 정규화를 거친다. */
export function sameNumber(a: string | number | null | undefined, b: string | number | null | undefined): boolean {
  const norm = (v: string | number | null | undefined) => (v === null || v === undefined || v === '' ? '0' : decimal(typeof v === 'number' ? numText(v) : v))
  return norm(a) === norm(b)
}

/** number → 10진 글자(지수 표기 없이). */
export function numText(n: number): string {
  if (!Number.isFinite(n)) return ''
  const s = String(n)
  return /e/i.test(s) ? (decimal(s) ?? '') : s
}

const pad = (n: number) => String(n).padStart(2, '0')

/** 2026-10-11 · 2026.10.11 · 2026/10/11 · 엑셀 날짜 일련번호 → YYYY-MM-DD. 아니면 null. 빈 칸 → ''. */
export function isoDate(raw: string): string | null {
  const s = raw.trim()
  if (s === '') return ''
  let y: number, m: number, d: number
  const hit = /^(\d{4})[-./년\s]+(\d{1,2})[-./월\s]+(\d{1,2})일?$/.exec(s)
  if (hit) {
    y = Number(hit[1])
    m = Number(hit[2])
    d = Number(hit[3])
  } else if (/^\d{5}(\.0+)?$/.test(s)) {
    // 엑셀 일련번호(1900 체계) — 25569 = 1970-01-01.
    const t = new Date((Number(s) - 25569) * 86_400_000)
    y = t.getUTCFullYear()
    m = t.getUTCMonth() + 1
    d = t.getUTCDate()
  } else {
    return null
  }
  const t = new Date(Date.UTC(y, m - 1, d))
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d || y < 2000 || y > 2100) return null
  return `${y}-${pad(m)}-${pad(d)}`
}

/** 날짜 + n일. */
export function addDays(iso: string, n: number): string {
  const t = new Date(`${iso}T00:00:00Z`)
  t.setUTCDate(t.getUTCDate() + n)
  return t.toISOString().slice(0, 10)
}

/** 통화 세 글자. 원 · ₩ → KRW, $ · 달러 → USD. 빈 칸 → ''. 아니면 null. */
export function currency(raw: string): string | null {
  const s = raw.trim()
  if (s === '') return ''
  if (/^(원|₩|krw)$/i.test(s)) return 'KRW'
  if (/^(\$|달러|usd)$/i.test(s)) return 'USD'
  if (/^(€|유로|eur)$/i.test(s)) return 'EUR'
  if (/^(엔|¥|jpy)$/i.test(s)) return 'JPY'
  if (/^(위안|cny|rmb)$/i.test(s)) return 'CNY'
  return /^[A-Za-z]{3}$/.test(s) ? s.toUpperCase() : null
}

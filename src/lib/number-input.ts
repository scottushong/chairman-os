/**
 * 금액 · 숫자 입력칸의 순수 판정 (2026-10-07 회장 지시 — 결재 «금액» 칸에 «500만» · «오백만»을 넣지 못하게).
 *
 * 화면(components/ui/number-input.tsx)과 AI 결재 카드(lib/ai/assistant/tools-staff.ts)가 같은 함수를 쓴다.
 * 정리한 금액 값은 0054 AMOUNT_PATTERN(lib/approval-line.ts)을 늘 통과한다 — scripts/check-number-input.ts가 잰다.
 */

export type NumberKind = 'money' | 'number'

/** 전각 숫자(０-９)를 반각으로. 일부 한글 자판 · 붙여넣기에서 들어온다. */
function halfWidth(raw: string): string {
  return raw.replace(/[０-９．]/g, (c) => (c === '．' ? '.' : String.fromCharCode(c.charCodeAt(0) - 0xfee0)))
}

/**
 * 입력 · 붙여넣기 값을 숫자만 남기고 세 자리마다 쉼표. 금액은 정수(소수점도 지운다), 숫자는 소수점 하나까지.
 * 한글 · 문자 · «만» · «억» · «원» · «₩»은 지운다 — «500만»은 500이 된다(그 자리에서 보이니 사람이 고친다).
 */
export function groupDigits(raw: string, kind: NumberKind): string {
  let s = halfWidth(raw)
  if (kind === 'money') {
    // 금액의 점 — «5.000.000»(점이 세 자리 묶음)이면 쉼표로 읽고, 그 밖(«1,234.50»)이면 소수 부분을 버린다.
    // 점을 그냥 지우면 1,234.50이 123,450이 된다.
    s = /^[^0-9]*[0-9]{1,3}(\.[0-9]{3})+[^0-9.]*$/.test(s) ? s.replace(/\./g, '') : s.replace(/\..*$/, '')
  }
  let int = ''
  let frac: string | null = null
  for (const c of s) {
    if (c >= '0' && c <= '9') {
      if (frac === null) int += c
      else frac += c
    } else if (c === '.' && kind === 'number' && frac === null) {
      frac = ''
    }
  }
  if (!int && frac === null) return ''
  int = int.replace(/^0+(?=\d)/, '')
  if (!int) int = '0'
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return frac === null ? grouped : `${grouped}.${frac}`
}

/** '5,000,000' → 5000000. 비었거나 숫자가 아니면 null. */
export function parseGrouped(v: string): number | null {
  const s = v.replace(/,/g, '').trim()
  if (!s) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

/** 문자열의 caret 왼쪽에 숫자가 몇 개인가 — 쉼표를 다시 넣은 뒤 커서를 같은 숫자 뒤로 돌리는 데 쓴다. */
export function digitsBefore(v: string, caret: number): number {
  let n = 0
  for (let i = 0; i < Math.min(caret, v.length); i++) if (/[0-9.]/.test(v[i])) n++
  return n
}

/** 숫자(와 소수점) count개 바로 뒤의 위치. */
export function caretAfterDigits(v: string, count: number): number {
  if (count <= 0) return 0
  let n = 0
  for (let i = 0; i < v.length; i++) {
    if (/[0-9.]/.test(v[i])) n++
    if (n === count) return i + 1
  }
  return v.length
}

const DIGIT = ['', '일', '이', '삼', '사', '오', '육', '칠', '팔', '구']
const SMALL = ['', '십', '백', '천']
const BIG = ['', '만', '억', '조', '경']

/** 네 자리 한 묶음(0~9999) — 천 · 백 · 십 앞의 «일»은 읽지 않는다(천백, 십). */
function readGroup(n: number): string {
  let out = ''
  const s = String(n).padStart(4, '0')
  for (let i = 0; i < 4; i++) {
    const d = Number(s[i])
    if (!d) continue
    const unit = SMALL[3 - i]
    out += (d === 1 && unit ? '' : DIGIT[d]) + unit
  }
  return out
}

/** 5,000,000 → '오백만 원'. 정수 부분만 읽는다. 만 단위가 1이면 «만»(일만이 아니라), 억 · 조는 «일억» · «일조». */
export function koreanAmount(value: number): string {
  const n = Math.floor(Math.abs(value))
  if (n === 0) return '영 원'
  const parts: string[] = []
  let rest = n
  for (let i = 0; rest > 0 && i < BIG.length; i++) {
    const g = rest % 10000
    rest = Math.floor(rest / 10000)
    if (!g) continue
    const words = g === 1 && i === 1 ? '' : readGroup(g)
    parts.unshift(words + BIG[i])
  }
  return `${parts.join(' ')} 원`
}

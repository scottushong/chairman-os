/**
 * 기억 엔진 — 기한 말(«다음 주 금요일» · «11월까지» · «10/25»)을 **기록한 때(captured_at) · 서울 시간** 기준으로 푼다(순수).
 * AI가 날짜를 지어내지 않게, 날짜는 이 함수가 원문 말에서 확정한 것만 쓴다. 범위만 있는 말(«다음 주» · «11월»)은
 * date = null · ambiguous = true(검토함 «날짜가 모호함»)이고 달(month)만 남긴다 — 바뀜 찾기(11월 → 12월)가 쓴다.
 */

export interface DueResolution {
  /** 확정된 날(YYYY-MM-DD) — 없으면 null */
  date: string | null
  /** 달만 아는 경우(YYYY-MM) — 날짜가 확정이면 그 날의 달 */
  month: string | null
  /** 사람이 확인해야 하나(범위 · 요일만 · 해가 불확실) */
  ambiguous: boolean
  /** 원문에서 찾은 말 */
  phrase: string | null
}

const NONE: DueResolution = { date: null, month: null, ambiguous: false, phrase: null }
const WEEKDAYS: Record<string, number> = { 월: 1, 화: 2, 수: 3, 목: 4, 금: 5, 토: 6, 일: 0 }
const EN_WEEKDAYS: Record<string, number> = { monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6, sunday: 0 }
const EN_MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
}

/** 서울 날짜(연 · 월 · 일 · 요일) — 기록 시각 기준. */
export function seoulDay(iso: string): { y: number; m: number; d: number; dow: number } {
  const t = new Date(new Date(iso).getTime() + 9 * 3600_000)
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate(), dow: t.getUTCDay() }
}

const pad = (n: number) => String(n).padStart(2, '0')
function ymd(y: number, m: number, d: number): string | null {
  const t = new Date(Date.UTC(y, m - 1, d))
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) return null
  return `${y}-${pad(m)}-${pad(d)}`
}
function addDays(y: number, m: number, d: number, n: number): string {
  const t = new Date(Date.UTC(y, m - 1, d + n))
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`
}
const monthOf = (date: string) => date.slice(0, 7)
function lastDay(y: number, m: number): string {
  const t = new Date(Date.UTC(y, m, 0))
  return `${y}-${pad(m)}-${pad(t.getUTCDate())}`
}
/** 달만 있는 말 — 기록한 달보다 앞 달이면 다음 해로 본다(«1월» in 11월 = 내년 1월). */
function monthYear(base: { y: number; m: number }, m: number): number {
  return m < base.m - 1 ? base.y + 1 : base.y
}

/**
 * 글 하나에서 기한 말 하나를 찾아 푼다. 여러 개면 처음 것.
 * @param text 문장(원문)
 * @param capturedAt 기록한 때(ISO)
 */
export function resolveDue(text: string, capturedAt: string): DueResolution {
  const s = text.replace(/\s+/g, ' ')
  const base = seoulDay(capturedAt)

  // 2026-10-25 · 2026.10.25 · 2026/10/25 · 2026년 10월 25일
  let m = /(20\d{2})\s*[-./년]\s*(\d{1,2})\s*[-./월]\s*(\d{1,2})\s*일?/.exec(s)
  if (m) {
    const date = ymd(+m[1], +m[2], +m[3])
    if (date) return { date, month: monthOf(date), ambiguous: false, phrase: m[0].trim() }
  }
  // 10월 25일 · 10/25(해 없음 — 앞 30일보다 이르면 다음 해)
  m = /(?<![\d.])(\d{1,2})\s*월\s*(\d{1,2})\s*일/.exec(s) ?? /(?<![\d./])(\d{1,2})\/(\d{1,2})(?![\d/])/.exec(s)
  if (m) {
    const mm = +m[1]
    const dd = +m[2]
    let date = ymd(base.y, mm, dd)
    if (date && date < addDays(base.y, base.m, base.d, -30)) date = ymd(base.y + 1, mm, dd)
    if (date) return { date, month: monthOf(date), ambiguous: false, phrase: m[0].trim() }
  }
  // 오늘 · 내일 · 모레
  m = /(오늘|내일|모레|글피|today|tomorrow)/i.exec(s)
  if (m) {
    const n = { 오늘: 0, today: 0, 내일: 1, tomorrow: 1, 모레: 2, 글피: 3 }[m[1].toLowerCase() as 'today'] ?? 0
    const date = addDays(base.y, base.m, base.d, n)
    return { date, month: monthOf(date), ambiguous: false, phrase: m[0] }
  }
  // (이번 주 | 이번 | 다음 주 | 다다음 주) 금요일
  m = /(이번\s*주|금주|이번|다음\s*주|차주|다다음\s*주)?\s*([월화수목금토일])요일/.exec(s)
  if (m) {
    const target = WEEKDAYS[m[2]]
    const q = (m[1] ?? '').replace(/\s/g, '')
    // 주는 월요일에 시작한다.
    const mondayOffset = -((base.dow + 6) % 7)
    const weeks = q === '다음주' || q === '차주' ? 1 : q === '다다음주' ? 2 : 0
    const offset = mondayOffset + weeks * 7 + ((target + 6) % 7)
    if (q) {
      const date = addDays(base.y, base.m, base.d, offset)
      return { date, month: monthOf(date), ambiguous: false, phrase: m[0].trim() }
    }
    // 요일만(«금요일까지») — 다가오는 그 요일로 보되 사람이 확인한다.
    const ahead = (target - base.dow + 7) % 7
    const date = addDays(base.y, base.m, base.d, ahead)
    return { date: null, month: monthOf(date), ambiguous: true, phrase: m[0].trim() }
  }
  m = /(this|next)\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i.exec(s)
  if (m) {
    const target = EN_WEEKDAYS[m[2].toLowerCase()]
    const mondayOffset = -((base.dow + 6) % 7)
    const date = addDays(base.y, base.m, base.d, mondayOffset + (m[1].toLowerCase() === 'next' ? 7 : 0) + ((target + 6) % 7))
    return { date, month: monthOf(date), ambiguous: false, phrase: m[0] }
  }
  // 이번 달 말 · 월말 · 다음 달 말
  m = /(이번\s*달|이달|다음\s*달|내달)\s*말(?=$|[\s,.까에쯤경])|월말/.exec(s)
  if (m) {
    const next = /다음\s*달|내달/.test(m[0])
    const y = next && base.m === 12 ? base.y + 1 : base.y
    const mm = next ? (base.m % 12) + 1 : base.m
    const date = lastDay(y, mm)
    return { date, month: monthOf(date), ambiguous: false, phrase: m[0].trim() }
  }
  // 다음 주 · 이번 주 · 다음 달(범위) — 날짜 없음
  m = /(다음\s*주|이번\s*주|차주|금주|다음\s*달|이번\s*달|내달|next week|this week|next month)/i.exec(s)
  if (m) {
    const w = m[1].replace(/\s/g, '').toLowerCase()
    let month: string
    if (/달|month/.test(w)) {
      const next = /다음|내달|next/.test(w)
      const y = next && base.m === 12 ? base.y + 1 : base.y
      month = `${y}-${pad(next ? (base.m % 12) + 1 : base.m)}`
    } else {
      month = monthOf(addDays(base.y, base.m, base.d, /다음|차주|next/.test(w) ? 7 : 0))
    }
    return { date: null, month, ambiguous: true, phrase: m[0] }
  }
  // 11월 · 11월까지 · 11월 중 · 연말
  m = /(?<![\d.])(\d{1,2})\s*월(?!\s*\d)/.exec(s)
  if (m && +m[1] >= 1 && +m[1] <= 12) {
    const mm = +m[1]
    return { date: null, month: `${monthYear(base, mm)}-${pad(mm)}`, ambiguous: true, phrase: m[0] }
  }
  m = /\b(?:by|in|end of)\s+(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\.?(?:\s+(\d{1,2}))?/i.exec(s)
  if (m) {
    const mm = EN_MONTHS[m[1].toLowerCase()]
    const y = monthYear(base, mm)
    if (m[2]) {
      const date = ymd(y, mm, +m[2])
      if (date) return { date, month: monthOf(date), ambiguous: false, phrase: m[0] }
    }
    return { date: null, month: `${y}-${pad(mm)}`, ambiguous: true, phrase: m[0] }
  }
  if (/연말|올해 안|year[- ]end/i.test(s)) {
    return { date: null, month: `${base.y}-12`, ambiguous: true, phrase: /연말|올해 안|year[- ]end/i.exec(s)![0] }
  }
  return NONE
}

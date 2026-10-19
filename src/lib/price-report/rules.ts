import type { PriceRun, SessionUser } from '@/types'

/**
 * 0084 가격 리포트 — 화면의 안내 규칙(순수). **문은 DB다**(표 RLS price_report_reader · price_report_request). 여기 판정은
 * 화면이 버튼을 잠그거나 404를 내는 데만 쓴다 — 어긋나면 DB가 이긴다(check:price-report가 둘을 대조한다).
 */

const EXEC = ['Chairman', 'GroupCFO', 'BusinessCEO', 'Executive']

/** 읽기 — 대표 · 임원 이상(회사 범위는 listBusinesses가 자른다) · '/purchasing/<biz>' 줄. 원가 관리(costing) 줄만 있는 사람은 아니다. */
export function canReadPriceReport(user: SessionUser | null, businessId: string): boolean {
  if (!user) return false
  if (EXEC.includes(user.role)) return true
  if (user.role === 'AIAgent' || user.role === 'Integration') return false
  return !!user.cost?.purchasing[businessId]
}

/** «지금 업데이트» — 대표 · 구매 입력 줄(can_write). */
export function canRequestPriceReport(user: SessionUser | null, businessId: string): boolean {
  if (!user) return false
  if (user.role === 'Chairman') return true
  if (user.role === 'AIAgent' || user.role === 'Integration') return false
  return user.cost?.purchasing[businessId]?.write === true
}

/** 하루 수동 실행 수(env PRICE_REPORT_MANUAL_PER_DAY, 기본 6). DB 천장 12. */
export function manualPerDay(): number {
  const n = Number(process.env.PRICE_REPORT_MANUAL_PER_DAY)
  return Number.isFinite(n) && n >= 1 ? Math.min(Math.floor(n), 12) : 6
}

/** 자동 회차 시각(KST) — .github/workflows/macro-briefing.yml의 cron(UTC 23:00 · 09:00)과 같다. */
export const AUTO_HOURS_KST = [8, 18] as const

/** 다음 자동 시각(KST «M/D HH:00»). GitHub 일정은 몇 분 늦을 수 있다. */
export function nextAutoKst(now = Date.now()): { iso: string; label: string } {
  const kst = new Date(now + 9 * 3_600_000)
  const y = kst.getUTCFullYear()
  const m = kst.getUTCMonth()
  const d = kst.getUTCDate()
  const h = kst.getUTCHours()
  const next = AUTO_HOURS_KST.find((x) => x > h)
  const day = next === undefined ? d + 1 : d
  const hour = next ?? AUTO_HOURS_KST[0]
  const at = new Date(Date.UTC(y, m, day, hour - 9, 0, 0))
  const k = new Date(at.getTime() + 9 * 3_600_000)
  return { iso: at.toISOString(), label: `${k.getUTCMonth() + 1}/${k.getUTCDate()} ${String(hour).padStart(2, '0')}:00` }
}

export function kstLabel(iso: string): string {
  const k = new Date(Date.parse(iso) + 9 * 3_600_000)
  return `${k.getUTCMonth() + 1}/${k.getUTCDate()} ${String(k.getUTCHours()).padStart(2, '0')}:${String(k.getUTCMinutes()).padStart(2, '0')}`
}

export const SLOT_KO: Record<string, string> = { AM: '아침(08시)', PM: '저녁(18시)', manual: '수동' }

/** 지금 «대기 · 수집 중»인 실행(30분 넘은 것은 DB가 실패로 본다 — 0084 price_report_expire). */
export function liveRun(runs: PriceRun[], now = Date.now()): PriceRun | null {
  return runs.find((r) => (r.status === 'queued' || r.status === 'collecting') && Date.parse(r.created_at) > now - 30 * 60_000) ?? null
}

/** 버튼이 잠긴 이유(화면 안내 — DB가 같은 판정을 한 번 더 한다). null = 누를 수 있음. */
export function buttonLock(runs: PriceRun[], perDay: number, now = Date.now()): string | null {
  if (liveRun(runs, now)) return '수집 중 — 끝나면 다시 누를 수 있습니다'
  const last = runs[0]
  if (last && Date.parse(last.created_at) > now - 10 * 60_000) {
    const wait = Math.ceil((Date.parse(last.created_at) + 10 * 60_000 - now) / 60_000)
    return `마지막 실행 뒤 10분 — ${wait}분 뒤에 다시 누를 수 있습니다`
  }
  const today = new Date(now + 9 * 3_600_000).toISOString().slice(0, 10)
  const n = runs.filter((r) => r.trigger === 'manual' && new Date(Date.parse(r.created_at) + 9 * 3_600_000).toISOString().slice(0, 10) === today).length
  if (n >= perDay) return `오늘 ${perDay}번을 다 썼습니다 — 다음 자동 회차를 기다려 주세요`
  return null
}

export const REQUEST_ERROR_KO: Record<string, string> = {
  price_report_denied: '이 회사의 가격 리포트를 업데이트할 권한이 없습니다(구매 입력 · 대표).',
  price_report_busy: '이미 수집 중입니다 — 끝나면 다시 누를 수 있습니다.',
  price_report_too_soon: '마지막 실행 뒤 10분 안에는 다시 누를 수 없습니다.',
  price_report_daily_limit: '오늘 수동 업데이트 횟수를 다 썼습니다.',
  price_report_unavailable: '가격 리포트가 아직 준비 중입니다(0084 반영 전).',
  feature_off: '지금은 쓸 수 없는 기능입니다.',
}

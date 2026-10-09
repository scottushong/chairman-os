// scripts/check-approval-ledger.ts가 이 파일을 바로 import한다 — 런타임 import는 상대 경로로 둔다.
import { bundleTitle, formAmount } from './approval-line'
import { boss, bossText } from './boss'
import { decisionStatusLabel } from './decision-status'
import type { ApprovalStepState, ApprovalStepStatus, ApprovalTemplate, Decision, DecisionStatus, Role } from '@/types'

/**
 * 0059 결재 대장(/approvals/ledger) — 거르기 · 정렬 · 기간 묶음 · 합계. 화면과 엑셀 내려받기가 **같은 함수**를 쓴다.
 *
 * ■ 범위는 DB가 정한다 ■ 여기 들어오는 결재는 이미 RLS(본인 · 결재선 · 회장 · 대장 열람 줄)를 지난 행이다.
 *   이 파일의 거르기는 그 안에서 **좁히기만** 한다 — 어떤 URL 값도 범위를 넓히지 못한다(넓힐 입력이 없다).
 *
 * ■ 날짜는 KST ■ created_at(UTC 시각)을 서울 날짜 'yyyy-mm-dd'로 한 번만 바꾼다(kstDay). 주 · 월 · 분기 · 연은
 *   그 날짜 묶음을 위로 더해 낸다(일 → 주(월요일 시작), 일 → 월 → 분기 → 연). 시각을 다시 읽지 않는다 —
 *   두 길로 따로 세면 경계(자정 · 월말)에서 합이 갈라진다.
 */

/* ------------------------------------------------------------------ 날짜 · 기간 */

export const LEDGER_GRAINS = ['day', 'week', 'month', 'quarter', 'year'] as const
export type LedgerGrain = (typeof LEDGER_GRAINS)[number]

export const LEDGER_GRAIN_LABEL: Record<LedgerGrain, string> = {
  day: '일',
  week: '주',
  month: '월',
  quarter: '분기',
  year: '년',
}

const KST_OFFSET_MS = 9 * 60 * 60 * 1000
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/

/** ISO 시각 → 서울 날짜 'yyyy-mm-dd'. KST는 서머타임이 없어 +9시간이면 끝이다. 못 읽으면 ''. */
export function kstDay(iso: string | null | undefined): string {
  if (!iso) return ''
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return ''
  return new Date(t + KST_OFFSET_MS).toISOString().slice(0, 10)
}

/** 'yyyy-mm-dd'가 실제 있는 날인가(2026-02-30은 아니다). */
export function isDay(s: string | undefined | null): s is string {
  if (!s || !DAY_RE.test(s)) return false
  const d = new Date(`${s}T00:00:00Z`)
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === s
}

function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** 그 날이 든 주의 월요일. 일요일은 앞 월요일의 주다. */
export function weekStart(day: string): string {
  const dow = new Date(`${day}T00:00:00Z`).getUTCDay() // 0 = 일
  return addDays(day, -((dow + 6) % 7))
}

const monthOf = (day: string) => day.slice(0, 7)
const quarterOfMonth = (month: string) => `${month.slice(0, 4)}-Q${Math.ceil(Number(month.slice(5, 7)) / 3)}`
const yearOfQuarter = (quarter: string) => quarter.slice(0, 4)

/** 날짜 하나가 든 기간 키 — day 'yyyy-mm-dd' · week 월요일 'yyyy-mm-dd' · month 'yyyy-mm' · quarter 'yyyy-Qn' · year 'yyyy'. */
export function periodKey(day: string, grain: LedgerGrain): string {
  switch (grain) {
    case 'day':
      return day
    case 'week':
      return weekStart(day)
    case 'month':
      return monthOf(day)
    case 'quarter':
      return quarterOfMonth(monthOf(day))
    case 'year':
      return day.slice(0, 4)
  }
}

/** 기간 키가 그 단위의 모양인가. URL에서 온 값이라 손으로 고쳐 올 수 있다. */
export function isPeriodKey(key: string | undefined, grain: LedgerGrain): key is string {
  if (!key) return false
  switch (grain) {
    case 'day':
      return isDay(key)
    case 'week':
      return isDay(key) && weekStart(key) === key
    case 'month':
      return /^\d{4}-(0[1-9]|1[0-2])$/.test(key)
    case 'quarter':
      return /^\d{4}-Q[1-4]$/.test(key)
    case 'year':
      return /^\d{4}$/.test(key)
  }
}

/** 기간 키 → 첫날 · 끝날(둘 다 포함). */
export function periodRange(key: string, grain: LedgerGrain): { from: string; to: string } {
  switch (grain) {
    case 'day':
      return { from: key, to: key }
    case 'week':
      return { from: key, to: addDays(key, 6) }
    case 'month': {
      const from = `${key}-01`
      const next = new Date(`${from}T00:00:00Z`)
      next.setUTCMonth(next.getUTCMonth() + 1)
      return { from, to: addDays(next.toISOString().slice(0, 10), -1) }
    }
    case 'quarter': {
      const y = key.slice(0, 4)
      const q = Number(key.slice(6))
      const first = `${y}-${String((q - 1) * 3 + 1).padStart(2, '0')}`
      const last = `${y}-${String(q * 3).padStart(2, '0')}`
      return { from: `${first}-01`, to: periodRange(last, 'month').to }
    }
    case 'year':
      return { from: `${key}-01-01`, to: `${key}-12-31` }
  }
}

/** 앞 · 뒤 기간(이전 · 다음 화살표). */
export function shiftPeriod(key: string, grain: LedgerGrain, n: number): string {
  switch (grain) {
    case 'day':
      return addDays(key, n)
    case 'week':
      return addDays(key, 7 * n)
    case 'month': {
      const d = new Date(`${key}-01T00:00:00Z`)
      d.setUTCMonth(d.getUTCMonth() + n)
      return d.toISOString().slice(0, 7)
    }
    case 'quarter': {
      const idx = Number(key.slice(0, 4)) * 4 + Number(key.slice(6)) - 1 + n
      return `${Math.floor(idx / 4)}-Q${(idx % 4) + 1}`
    }
    case 'year':
      return String(Number(key) + n)
  }
}

/** 사람이 읽는 기간 이름 — 파일 이름에도 쓴다(그래서 / · : 같은 글자가 없다). */
export function periodLabel(key: string, grain: LedgerGrain): string {
  return grain === 'week' ? `${key}주` : key
}

/* ------------------------------------------------------------------ 거르기 값(URL) */

export const LEDGER_STATUS_KEYS = ['open', 'approved', 'recorded', 'rejected', 'modified', 'delegated'] as const
export type LedgerStatusKey = (typeof LEDGER_STATUS_KEYS)[number]

export function ledgerStatusKey(d: Pick<Decision, 'status' | 'decided_by_kind'>): LedgerStatusKey {
  if (d.status === 'Approved') return d.decided_by_kind === 'rule' ? 'recorded' : 'approved'
  const map: Record<Exclude<DecisionStatus, 'Approved'>, LedgerStatusKey> = {
    Open: 'open',
    Rejected: 'rejected',
    Modified: 'modified',
    Delegated: 'delegated',
  }
  return map[d.status]
}

/** 상태 칸의 글자 — 화면 다른 곳과 같은 낱말(decisionStatusLabel). */
export const LEDGER_STATUS_LABEL: Record<LedgerStatusKey, string> = {
  open: decisionStatusLabel({ status: 'Open' }),
  approved: decisionStatusLabel({ status: 'Approved' }),
  recorded: decisionStatusLabel({ status: 'Approved', decided_by_kind: 'rule' }),
  rejected: decisionStatusLabel({ status: 'Rejected' }),
  modified: decisionStatusLabel({ status: 'Modified' }),
  delegated: decisionStatusLabel({ status: 'Delegated' }),
}

export const LEDGER_SORT_KEYS = [
  'id', 'date', 'template', 'title', 'requester', 'amount', 'vendor', 'status', 'approver', 'decided',
] as const
export type LedgerSortKey = (typeof LEDGER_SORT_KEYS)[number]

export interface LedgerFilters {
  company?: string
  template?: string
  /** 기간 단위. period가 있을 때만 뜻이 있다. 기본 월. */
  grain: LedgerGrain
  /** 그 단위의 기간 키(periodKey 모양). 있으면 from · to를 덮는다. */
  period?: string
  from?: string
  to?: string
  status?: LedgerStatusKey
  requester?: string
  team?: string
  vendor?: string
  min?: number
  max?: number
  q?: string
  sort: LedgerSortKey
  dir: 'asc' | 'desc'
}

type Params = Record<string, string | string[] | undefined>

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)
const text = (v: string | string[] | undefined) => {
  const s = first(v)?.trim()
  return s ? s.slice(0, 100) : undefined
}
function pick<T extends string>(v: string | undefined, allowed: readonly T[]): T | undefined {
  return v !== undefined && (allowed as readonly string[]).includes(v) ? (v as T) : undefined
}
function money(v: string | string[] | undefined): number | undefined {
  const s = first(v)?.replace(/[,\s원]/g, '')
  if (!s || !/^\d+(\.\d+)?$/.test(s)) return undefined
  return Number(s)
}

/**
 * URL 값 → 거르기. 모르는 값 · 모양이 틀린 값은 조용히 버린다(목록 화면의 규칙, lib/query.ts).
 * 화면과 내려받기 라우트가 같은 이 함수를 쓴다 — 같은 링크면 같은 줄이 나온다.
 */
export function parseLedgerFilters(params: Params): LedgerFilters {
  const grain = pick(first(params.grain), LEDGER_GRAINS) ?? 'month'
  const period = first(params.period)
  const from = first(params.from)
  const to = first(params.to)
  return {
    company: text(params.company),
    template: text(params.template),
    grain,
    period: isPeriodKey(period, grain) ? period : undefined,
    from: isDay(from) ? from : undefined,
    to: isDay(to) ? to : undefined,
    status: pick(first(params.status), LEDGER_STATUS_KEYS),
    requester: text(params.requester),
    team: text(params.team),
    vendor: text(params.vendor),
    min: money(params.min),
    max: money(params.max),
    q: text(params.q),
    sort: pick(first(params.sort), LEDGER_SORT_KEYS) ?? 'date',
    dir: first(params.dir) === 'asc' ? 'asc' : 'desc',
  }
}

/**
 * 거르기 → URL 값(빈 칸은 뺀다). 기본값(월 · 날짜 내림차순)도 뺀다 — 같은 화면에 두 주소가 생기지 않게.
 * 내려받기 감사(approval_ledger_log p_filters)도 이 값을 그대로 적는다.
 */
export function ledgerParams(f: LedgerFilters): Record<string, string> {
  const out: Record<string, string> = {}
  const put = (k: string, v: string | number | undefined) => {
    if (v !== undefined && v !== '') out[k] = String(v)
  }
  put('company', f.company)
  put('template', f.template)
  if (f.grain !== 'month') put('grain', f.grain)
  put('period', f.period)
  if (!f.period) {
    put('from', f.from)
    put('to', f.to)
  }
  put('status', f.status)
  put('requester', f.requester)
  put('team', f.team)
  put('vendor', f.vendor)
  put('min', f.min)
  put('max', f.max)
  put('q', f.q)
  if (f.sort !== 'date') put('sort', f.sort)
  if (f.dir !== 'desc') put('dir', f.dir)
  return out
}

/** 실제로 거르는 날짜 구간. 기간이 있으면 그 기간, 없으면 from · to(한쪽만 있어도 된다). */
export function dateWindow(f: LedgerFilters): { from?: string; to?: string } {
  if (f.period) return periodRange(f.period, f.grain)
  return { from: f.from, to: f.to }
}

/** 파일 이름 · 머리에 쓰는 기간 이름. */
export function windowLabel(f: LedgerFilters): string {
  if (f.period) return periodLabel(f.period, f.grain)
  if (f.from || f.to) return `${f.from ?? ''}~${f.to ?? ''}`
  return '전체'
}

/* ------------------------------------------------------------------ 대장 한 줄 */

export interface LedgerRow {
  id: string
  business_id: string
  /** 올린 날(KST). created_at이 없으면 ''. */
  day: string
  created_at: string | null
  template_key: string
  template_name: string
  title: string
  requester: string
  team: string
  amount: number | null
  vendor: string
  link: string | null
  status: LedgerStatusKey
  status_label: string
  /** 지금 차례인 결재자. 없으면 null(«—»). */
  approver: string | null
  decided_at: string | null
  decided_day: string
  form: Record<string, string>
}

/** 구입처 칸. 양식마다 이름이 조금씩 달랐다(vendor · store · 구입처). */
const VENDOR_KEYS = ['vendor', 'store', '구입처'] as const
export function formVendor(form: Record<string, string>): string {
  for (const k of VENDOR_KEYS) {
    const v = form[k]?.trim()
    if (v) return v
  }
  return ''
}

/** http(s) 링크만 링크로 건다 — javascript: 같은 값이 칸에 들어와도 눌리는 링크가 되지 않게. */
export function safeUrl(v: string | undefined): string | null {
  const s = v?.trim()
  if (!s) return null
  try {
    const u = new URL(s)
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null
  } catch {
    return null
  }
}

function firstLink(form: Record<string, string>, template: ApprovalTemplate | undefined): string | null {
  for (const f of template?.fields ?? []) {
    if (f.type !== 'url') continue
    const u = safeUrl(form[f.key])
    if (u) return u
  }
  return null
}

/** 0059 전 결재(단계 줄 없음)의 지금 차례 — 팀장 대기면 얼린 결재선의 팀장, 아니면 대표 큐. */
function legacyApprover(d: Decision, viewer: Role | null | undefined): string | null {
  if (d.status !== 'Open') return null
  if (d.lead_status === 'pending') {
    const lead = d.approval_line?.find((s) => s.step === 'lead')
    if (lead?.name) return bossText(lead.name, viewer)
  }
  if (d.chairman_required || d.escalated) return boss(viewer)
  return null
}

/**
 * 결재 · 단계 · 양식 → 대장 줄. 양식 결재(template_key 있음)만 받는다.
 * DB에서 온 글자(제목 · 결재자 이름)는 보는 사람에 맞춘다(bundleTitle · bossText — 직원에게 «회장»이 보이지 않게).
 */
export function buildLedgerRows(
  decisions: Decision[],
  steps: ApprovalStepState[],
  templates: ApprovalTemplate[],
  viewer: Role | null | undefined,
): LedgerRow[] {
  const tpl = new Map(templates.map((t) => [t.template_key as string, t]))
  const pending = new Map<string, ApprovalStepState>()
  const hasSteps = new Set<string>()
  for (const s of steps) {
    hasSteps.add(s.decision_id)
    if (s.status === 'pending') pending.set(s.decision_id, s)
  }
  return decisions
    .filter((d) => !!d.template_key)
    .map((d) => {
      const form = d.form ?? {}
      const t = tpl.get(d.template_key as string)
      const step = pending.get(d.decision_id)
      const status = ledgerStatusKey(d)
      return {
        id: d.decision_id,
        business_id: d.business_id,
        day: kstDay(d.created_at),
        created_at: d.created_at ?? null,
        template_key: d.template_key as string,
        template_name: t?.name_ko ?? (d.template_key as string),
        title: bundleTitle(d.title, viewer),
        requester: d.requester_name?.trim() || d.created_by || '—',
        team: d.requester_team_name?.trim() ?? '',
        amount: formAmount(form),
        vendor: formVendor(form),
        link: firstLink(form, t),
        status,
        status_label: decisionStatusLabel(d),
        approver: step
          ? bossText(step.approver_name, viewer)
          : hasSteps.has(d.decision_id)
            ? null
            : legacyApprover(d, viewer),
        decided_at: d.decided_at ?? null,
        decided_day: kstDay(d.decided_at),
        form,
      }
    })
}

const has = (hay: string, needle: string) => hay.toLowerCase().includes(needle.toLowerCase())

/** 거르기. 들어온 줄 안에서 좁히기만 한다. */
export function filterLedger(rows: LedgerRow[], f: LedgerFilters): LedgerRow[] {
  const { from, to } = dateWindow(f)
  return rows.filter((r) => {
    if (f.company && r.business_id !== f.company) return false
    if (f.template && r.template_key !== f.template) return false
    if (from && (!r.day || r.day < from)) return false
    if (to && (!r.day || r.day > to)) return false
    if (f.status && r.status !== f.status) return false
    if (f.requester && !has(r.requester, f.requester)) return false
    if (f.team && !has(r.team, f.team)) return false
    if (f.vendor && !has(r.vendor, f.vendor)) return false
    if (f.min !== undefined && (r.amount === null || r.amount < f.min)) return false
    if (f.max !== undefined && (r.amount === null || r.amount > f.max)) return false
    if (f.q) {
      const hay = [r.id, r.title, r.requester, ...Object.values(r.form)].join('\n')
      if (!has(hay, f.q)) return false
    }
    return true
  })
}

function sortValue(r: LedgerRow, key: LedgerSortKey): string | number | null {
  switch (key) {
    case 'id':
      return r.id
    case 'date':
      return r.created_at ? Date.parse(r.created_at) : null
    case 'template':
      return r.template_name
    case 'title':
      return r.title
    case 'requester':
      return r.requester
    case 'amount':
      return r.amount
    case 'vendor':
      return r.vendor || null
    case 'status':
      return r.status_label
    case 'approver':
      return r.approver
    case 'decided':
      return r.decided_at ? Date.parse(r.decided_at) : null
  }
}

/** 정렬. 빈 값은 방향과 상관없이 맨 뒤다. 같으면 결재 번호 내림차순(최근 것 먼저). */
export function sortLedger(rows: LedgerRow[], sort: LedgerSortKey, dir: 'asc' | 'desc'): LedgerRow[] {
  const sign = dir === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
    const va = sortValue(a, sort)
    const vb = sortValue(b, sort)
    if (va === null || vb === null) {
      if (va !== vb) return va === null ? 1 : -1
    } else if (va !== vb) {
      const c = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb), 'ko')
      if (c !== 0) return c * sign
    }
    return b.id.localeCompare(a.id, 'en', { numeric: true })
  })
}

/* ------------------------------------------------------------------ 합계 */

export interface Bucket {
  count: number
  sum: number
}

export interface LedgerGroup extends Bucket {
  key: string
  label: string
}

const add = (m: Map<string, Bucket>, key: string, b: Bucket) => {
  const cur = m.get(key) ?? { count: 0, sum: 0 }
  m.set(key, { count: cur.count + b.count, sum: cur.sum + b.sum })
}

/** 날짜 묶음 — 줄마다 한 번만 날짜를 본다. 금액이 없는 줄은 건수에만 든다. */
export function dayBuckets(rows: LedgerRow[]): Map<string, Bucket> {
  const m = new Map<string, Bucket>()
  for (const r of rows) if (r.day) add(m, r.day, { count: 1, sum: r.amount ?? 0 })
  return m
}

function regroup(src: Map<string, Bucket>, keyOf: (k: string) => string): Map<string, Bucket> {
  const m = new Map<string, Bucket>()
  for (const [k, b] of src) add(m, keyOf(k), b)
  return m
}

/**
 * 날짜 묶음을 위로 더한다 — 일 → 주(월요일 시작), 일 → 월 → 분기 → 연. 각 단계는 바로 아래 단계의 합이다.
 * 주는 월을 걸쳐 있어 월 사슬에 끼지 않는다(둘 다 일에서 바로 오른다).
 */
export function rollUp(days: Map<string, Bucket>, grain: LedgerGrain): Map<string, Bucket> {
  if (grain === 'day') return new Map(days)
  if (grain === 'week') return regroup(days, weekStart)
  const months = regroup(days, monthOf)
  if (grain === 'month') return months
  const quarters = regroup(months, quarterOfMonth)
  if (grain === 'quarter') return quarters
  return regroup(quarters, yearOfQuarter)
}

const toGroups = (m: Map<string, Bucket>, label: (k: string) => string): LedgerGroup[] =>
  [...m].map(([key, b]) => ({ key, label: label(key), ...b }))

const bySumDesc = (a: LedgerGroup, b: LedgerGroup) => b.sum - a.sum || b.count - a.count || a.label.localeCompare(b.label, 'ko')

export interface LedgerTotals extends Bucket {
  /** 날짜가 없는 줄은 기간 묶음에 들지 않는다 — 그 건수. 보통 0. */
  undated: number
  byMonth: LedgerGroup[]
  /** 고른 단위의 기간 묶음(월이면 byMonth와 같다). */
  byPeriod: LedgerGroup[]
  byTemplate: LedgerGroup[]
  byVendor: LedgerGroup[]
  byTeam: LedgerGroup[]
}

export function ledgerTotals(rows: LedgerRow[], grain: LedgerGrain): LedgerTotals {
  const days = dayBuckets(rows)
  const periodSorted = (m: Map<string, Bucket>, g: LedgerGrain) =>
    toGroups(m, (k) => periodLabel(k, g)).sort((a, b) => a.key.localeCompare(b.key))
  const by = (keyOf: (r: LedgerRow) => string, labelOf: (r: LedgerRow) => string) => {
    const m = new Map<string, Bucket>()
    const labels = new Map<string, string>()
    for (const r of rows) {
      const k = keyOf(r)
      labels.set(k, labelOf(r))
      add(m, k, { count: 1, sum: r.amount ?? 0 })
    }
    return toGroups(m, (k) => labels.get(k) ?? k).sort(bySumDesc)
  }
  return {
    count: rows.length,
    sum: rows.reduce((s, r) => s + (r.amount ?? 0), 0),
    undated: rows.filter((r) => !r.day).length,
    byMonth: periodSorted(rollUp(days, 'month'), 'month'),
    byPeriod: periodSorted(rollUp(days, grain), grain),
    byTemplate: by((r) => r.template_key, (r) => r.template_name),
    byVendor: by((r) => r.vendor || '', (r) => r.vendor || '(구입처 없음)'),
    byTeam: by((r) => r.team || '', (r) => r.team || '팀 없음'),
  }
}

/* ------------------------------------------------------------------ 결재선 이력 */

export const STEP_STATUS_LABEL: Record<ApprovalStepStatus, string> = {
  waiting: '대기 중',
  pending: '차례',
  approved: '승인',
  rejected: '반려',
  cancelled: '취소',
}

export interface LedgerHistoryLine {
  id: string
  title: string
  seq: number
  approver: string
  why: string
  status: string
  decided_at: string | null
  note: string
}

/**
 * 결재선 이력 — 단계 줄(0059) 하나에 한 줄.
 * 0059 전 결재(단계 줄 없음)는 얼린 결재선(approval_line)의 칸마다 한 줄을 내고 상태는 «단계 기록 없음»으로 둔다 —
 * 예전 길은 칸별 처리 시각을 남기지 않았다. 마지막 칸에만 결재의 최종 처리 시각과 최종 상태를 적는다. 결재선도 없으면 뺀다.
 */
export function ledgerHistory(
  rows: LedgerRow[],
  steps: ApprovalStepState[],
  decisions: Decision[],
  viewer: Role | null | undefined,
): LedgerHistoryLine[] {
  const byId = new Map<string, ApprovalStepState[]>()
  for (const s of steps) byId.set(s.decision_id, [...(byId.get(s.decision_id) ?? []), s])
  const dec = new Map(decisions.map((d) => [d.decision_id, d]))
  const out: LedgerHistoryLine[] = []
  for (const r of rows) {
    const own = (byId.get(r.id) ?? []).sort((a, b) => a.seq - b.seq)
    if (own.length > 0) {
      for (const s of own) {
        out.push({
          id: r.id,
          title: r.title,
          seq: s.seq,
          approver: bossText(s.approver_name, viewer),
          why: bossText(s.why, viewer),
          status: STEP_STATUS_LABEL[s.status],
          decided_at: s.decided_at,
          note: s.note ?? '',
        })
      }
      continue
    }
    const line = dec.get(r.id)?.approval_line ?? []
    line.forEach((s, i) => {
      const last = i === line.length - 1 && r.status !== 'open'
      out.push({
        id: r.id,
        title: r.title,
        seq: i + 1,
        approver: bossText(s.name || '—', viewer),
        why: bossText(s.why ?? '', viewer),
        status: last ? `${r.status_label} (단계 기록 없음)` : '단계 기록 없음',
        decided_at: last ? r.decided_at : null,
        note: '',
      })
    })
  }
  return out
}

/* ------------------------------------------------------------------ 내려받기 이름 */

/** 회사 짧은 이름 — business_id 'biz_dy' → 'DY'. 회사를 안 골랐으면 «전체». */
export function companyShort(businessId: string | undefined): string {
  if (!businessId) return '전체'
  return businessId.replace(/^biz_/, '').replace(/[^A-Za-z0-9가-힣_-]/g, '').toUpperCase() || '전체'
}

/** 결재대장_<회사>_<기간>.xlsx — 예: 결재대장_DY_2026-10.xlsx */
export function ledgerFileName(f: LedgerFilters): string {
  return `결재대장_${companyShort(f.company)}_${windowLabel(f)}.xlsx`
}

/* ------------------------------------------------------------------ 내려받기 권한 · 감사 값 */

/**
 * 엑셀을 내려받을 수 있는가 — 0059 approval_ledger_log의 거울(판정은 DB다).
 *   회장       회사를 안 골라도(전체) 되고, 회사를 골라도 된다.
 *   그 밖      «결재 대장 열람» 줄('/approvals/ledger/<회사>')이 있는 **그 회사를 고른 때만**.
 * 단추를 이 값으로만 그리고, 라우트도 같은 값으로 먼저 거절한다(403) — DB가 approval_not_found로 한 번 더 막는다.
 */
export function canExportLedger(
  role: Role | null | undefined,
  ledger: readonly string[] | undefined,
  company: string | undefined,
): boolean {
  if (role === 'Chairman') return true
  return !!company && (ledger ?? []).includes(company)
}

/** 감사 p_filters — JSON 2000자 이하(0059). 넘으면 글자 값을 줄인다. */
export const LEDGER_AUDIT_MAX = 2000
export function auditFilters(f: LedgerFilters): Record<string, string> {
  const params = ledgerParams(f)
  for (const cut of [100, 40, 12]) {
    const out = Object.fromEntries(Object.entries(params).map(([k, v]) => [k, v.slice(0, cut)]))
    if (JSON.stringify(out).length <= LEDGER_AUDIT_MAX) return out
  }
  return { company: (f.company ?? '').slice(0, 100), truncated: 'true' }
}

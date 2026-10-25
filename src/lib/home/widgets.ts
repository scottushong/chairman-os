/**
 * 0086 «내 홈» 위젯 — 순수 규칙(서버 · DB를 모른다). 화면 · 서버 액션 · dummy 저장소 · 검사(check:home-widgets)가 같이 쓴다.
 *
 *   카탈로그   위젯 종류 · 이름 · 짧은 설명 · 기본 크기 · 표시 범위(필터) · 연동 상태.
 *   기본 배치  개인 설정이 없는 사람(지시문 3절): 내 업무(넓게) · 전자결재 / 일정 · 요청한 업무 · 근태·휴가 / 즐겨찾기.
 *   정규화     서버에서 읽은 배치를 화면이 그릴 수 있게 — 모르는 종류(없어진 위젯 · 새 판의 위젯)는 건너뛰되 저장 때 그대로 돌려준다
 *              (새 위젯이 생기거나 없어졌다고 배치를 지우지 않는다). 모양이 틀린 줄 · 같은 종류 두 번째는 버린다.
 *   모양 검사  DB home_widgets_valid(0086)와 같은 규칙 — 서버 액션이 먼저 거른다.
 *   저장 규칙  revision 충돌(다른 탭 · 기기가 먼저 저장) — dummy 저장소가 0086 home_layout_save와 같은 답을 내도록 여기 둔다.
 *
 * 홈에는 급여 · 원가 · BOM · 재무 숫자 · 원료 단가를 싣지 않는다(지시문 7절) — 그런 위젯 종류가 없고, 결재 금액도 싣지 않는다.
 *
 * 0097 구역 층(board.ts)이 이 카탈로그를 넓혔다 — 대표 첫 화면 위젯(재무 · 투자 · 아침 루틴 판단 · 기억 검토함)은 audience로 갈린다:
 *   all      누구나(0086 아홉 + 프로젝트 현황) — 직원 홈에 보이는 것은 이것뿐(check:home-widgets · check:dashboard).
 *   top      대표 · 그룹 CFO(재무 숫자) · chair 대표만 · invest 대표 · «/investment» 지정자. DB home_kind_allowed(0097)가 같은 문을 한 번 더 본다.
 *   listOnly 위젯은 «준비 중»으로 목록에만 보인다(넣을 수 없다 — 예시 숫자를 지어내지 않는다).
 */

import { BOARD_WIDGETS } from '@/lib/dashboard/catalog'

export const HOME_SCHEMA_VERSION = 1
export const HOME_MAX_WIDGETS = 30

export type WidgetSize = 's' | 'm' | 'l'
export const WIDGET_SIZES: readonly WidgetSize[] = ['s', 'm', 'l']
export const SIZE_LABEL: Record<WidgetSize, string> = { s: '작게', m: '넓게', l: '전체 폭' }

/** 0097 데이터 범위 — biz 'all'(전체 계열사 통합) 또는 회사 id · project 프로젝트 id. 비어 있으면 구역 범위를 물려받는다. */
export interface Scope {
  biz?: string
  project?: string | null
}

export interface WidgetSettings {
  /** 표시 범위(종류마다 정해진 값 중 하나). */
  filter?: string
  /** 즐겨찾기 항목 키(순서 = 화면 순서). */
  items?: string[]
  /** 0097 — 구역 범위 덮어쓰기(없으면 구역 범위). */
  scope?: Scope
}

export interface HomeWidget {
  id: string
  kind: string
  size: WidgetSize
  settings: WidgetSettings
}

/**
 * 연동 상태(화면 안내 · 결정 문서와 같은 말).
 *   live     기존 기능의 조회 그대로(그 기능의 권한).
 *   partial  일부만 — 나머지 칸은 «연동 준비 중».
 *   pending  이 시스템에 아직 없는 기능 — 위젯은 «연동 준비 중»만(예시 데이터를 지어내지 않는다).
 */
export type WidgetLink = 'live' | 'partial' | 'pending'

/** 0097 누가 넣을 수 있나(위 머리 주석). */
export type Audience = 'all' | 'top' | 'chair' | 'invest'
/** 0097 위젯 라이브러리 탭(시안 «전체 · 경영 · 투자 · 프로젝트 · 일정»에 «재무 · 업무»를 더함). */
export type WidgetGroup = '경영' | '재무' | '투자' | '업무' | '프로젝트' | '일정'
export const WIDGET_GROUPS: readonly WidgetGroup[] = ['경영', '재무', '투자', '업무', '프로젝트', '일정']

export interface WidgetDef {
  kind: string
  label: string
  description: string
  defaultSize: WidgetSize
  filters: readonly { key: string; label: string }[]
  link: WidgetLink
  /** 전자결재(0087 approvals) 스위치가 켜져 있어야 쓰는 위젯. */
  needsApprovals?: boolean
  /** 전체 목록 주소. */
  moreHref?: string
  /** 0097 — 기본 'all'. */
  audience?: Audience
  /** 0097 — 라이브러리 탭. 기본 '업무'. */
  group?: WidgetGroup
  /** 0097 — 회사 범위를 따르는가('biz') · 프로젝트까지('project'). 없으면 범위와 무관(화면에 그렇게 적는다). */
  scoped?: 'biz' | 'project'
  /** 0097 — «준비 중»으로 목록에만(넣을 수 없음). */
  listOnly?: boolean
}

export const WIDGETS: readonly WidgetDef[] = [
  {
    kind: 'my_tasks',
    group: '업무',
    label: '내 업무',
    description: '내가 맡은 열린 업무 — 기한 지남 · 오늘 마감 먼저',
    defaultSize: 'm',
    filters: [
      { key: 'open', label: '진행 중' },
      { key: 'week', label: '이번 주 마감' },
      { key: 'overdue', label: '기한 지남' },
    ],
    link: 'live',
    moreHref: '/tasks',
    scoped: 'project',
  },
  {
    kind: 'approvals',
    group: '경영',
    label: '전자결재 · 승인 대기',
    description: '내 결재 대기 · 내가 올린 문서(전자결재와 같은 건수)',
    defaultSize: 's',
    filters: [
      { key: 'todo', label: '내 결재 대기' },
      { key: 'mine', label: '내가 올린 문서' },
    ],
    link: 'live',
    needsApprovals: true,
    moreHref: '/e-approval',
  },
  {
    kind: 'schedule',
    group: '일정',
    label: '일정',
    description: '캘린더에 보이는 일정 · 마감(오늘 · 이번 주)',
    defaultSize: 's',
    filters: [
      { key: 'today', label: '오늘' },
      { key: 'week', label: '이번 주' },
    ],
    link: 'partial',
    moreHref: '/calendar',
    scoped: 'biz',
  },
  {
    kind: 'requested',
    group: '업무',
    label: '요청한 업무',
    description: '내가 올린 요청(결재 요청)의 처리 상태 · 담당 · 마감',
    defaultSize: 's',
    filters: [
      { key: 'open', label: '처리 중' },
      { key: 'all', label: '전체' },
    ],
    link: 'partial',
    moreHref: '/me?tab=requests',
    scoped: 'biz',
  },
  {
    kind: 'attendance',
    group: '업무',
    label: '근태·휴가',
    description: '오늘 출근 · 잔여 연차 · 부서 부재자 — 근태 기능 연동 준비 중',
    defaultSize: 's',
    filters: [],
    link: 'pending',
  },
  {
    kind: 'favorites',
    group: '업무',
    label: '즐겨찾기',
    description: '자주 쓰는 결재 양식 · 메뉴 바로가기',
    defaultSize: 's',
    filters: [],
    link: 'live',
  },
  {
    kind: 'notices',
    group: '업무',
    label: '공지',
    description: '볼 수 있는 회사 · 그룹 공지 — 게시일 · 필독 · 읽음',
    defaultSize: 's',
    filters: [
      { key: 'all', label: '전체' },
      { key: 'unread', label: '안 읽음' },
    ],
    link: 'partial',
    moreHref: '/groupware',
  },
  {
    kind: 'recent_docs',
    group: '업무',
    label: '최근 문서',
    description: '내가 볼 수 있는 최근 문서(일반 등급) — 문서명 · 날짜 · 등록자',
    defaultSize: 's',
    filters: [],
    link: 'live',
    moreHref: '/documents',
  },
  {
    kind: 'facility',
    group: '업무',
    label: '안전·설비 요청',
    description: '내가 올린 설비수리 품의 — 설비 대장 · 조치 기한은 연동 준비 중',
    defaultSize: 's',
    filters: [],
    link: 'partial',
    needsApprovals: true,
    moreHref: '/e-approval?box=mine',
  },
  {
    kind: 'projects',
    group: '프로젝트',
    label: '프로젝트 현황',
    description: '볼 수 있는 진행 중 프로젝트 — 진행률 · 마감 · 상태',
    defaultSize: 'm',
    filters: [
      { key: 'open', label: '진행 중' },
      { key: 'all', label: '전체' },
    ],
    link: 'live',
    moreHref: '/projects',
    scoped: 'project',
  },
  // 0097 대표 첫 화면 위젯(직원 카탈로그에 없다 — audience)은 lib/dashboard/catalog.ts에 있다.
  ...BOARD_WIDGETS,
]

export const WIDGET_KINDS: readonly string[] = WIDGETS.map((w) => w.kind)
export const widgetDef = (kind: string): WidgetDef | undefined => WIDGETS.find((w) => w.kind === kind)
export const audienceOf = (def: Pick<WidgetDef, 'audience'>): Audience => def.audience ?? 'all'
/** 0086 직원 카탈로그(누구나 넣는 것) — 직원 홈 · check:home-widgets가 본다. */
export const STAFF_WIDGETS: readonly WidgetDef[] = WIDGETS.filter((w) => audienceOf(w) === 'all')

/** 기본 배치(지시문 3절). id는 종류와 같게 — 처음 저장할 때 그대로 간다. */
export function defaultLayout(): HomeWidget[] {
  const row = (kind: string, size: WidgetSize, filter?: string): HomeWidget => ({ id: kind, kind, size, settings: filter ? { filter } : {} })
  return [row('my_tasks', 'm', 'open'), row('approvals', 's', 'todo'), row('schedule', 's', 'today'), row('requested', 's', 'open'), row('attendance', 's'), row('favorites', 's')]
}

/** 표시 범위 — 그 종류가 아는 값이 아니면 첫 값. */
export function filterOf(w: Pick<HomeWidget, 'kind' | 'settings'>): string | undefined {
  const def = widgetDef(w.kind)
  if (!def || def.filters.length === 0) return undefined
  return def.filters.some((f) => f.key === w.settings.filter) ? w.settings.filter : def.filters[0].key
}

const ID = /^[a-z0-9_-]{1,40}$/
const KIND = /^[a-z][a-z0-9_]{1,30}$/
const ITEM = /^[a-z]{2,8}:[A-Za-z0-9_-]{1,60}$/
const BIZ = /^(all|[a-z][a-z0-9_]{1,40})$/
const PROJECT = /^[A-Za-z0-9_-]{1,60}$/

/** 범위 모양(DB home_scope_valid와 같다) — 틀린 칸은 버린다. 빈 범위는 undefined. */
export function scopeShape(v: unknown): Scope | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined
  const r = v as Record<string, unknown>
  const out: Scope = {}
  if (typeof r.biz === 'string' && BIZ.test(r.biz)) out.biz = r.biz
  if (typeof r.project === 'string' && PROJECT.test(r.project)) out.project = r.project
  return out.biz || out.project ? out : undefined
}

/** 한 줄의 모양(DB home_widgets_valid의 줄 검사와 같다) — 종류는 모양만. */
function rowShape(v: unknown): HomeWidget | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const r = v as Record<string, unknown>
  if (typeof r.id !== 'string' || !ID.test(r.id)) return null
  if (typeof r.kind !== 'string' || !KIND.test(r.kind)) return null
  if (typeof r.size !== 'string' || !(WIDGET_SIZES as readonly string[]).includes(r.size)) return null
  if (r.settings !== undefined && (!r.settings || typeof r.settings !== 'object' || Array.isArray(r.settings))) return null
  const s = (r.settings ?? {}) as Record<string, unknown>
  const settings: WidgetSettings = {}
  if (typeof s.filter === 'string' && s.filter.length <= 30) settings.filter = s.filter
  if (Array.isArray(s.items)) settings.items = s.items.filter((x): x is string => typeof x === 'string' && ITEM.test(x)).slice(0, 20)
  const scope = scopeShape(s.scope)
  if (scope) settings.scope = scope
  return { id: r.id, kind: r.kind, size: r.size as WidgetSize, settings }
}

/**
 * 서버에서 읽은 배치 → { 그릴 것, 모르는 종류(저장 때 그대로 돌려줄 것) }.
 * raw가 배열이 아니거나(줄 없음 · 판이 다름) 그릴 것이 하나도 없는 «모양 틀림»이면 기본 배치. 빈 배열(전부 지운 사람)은 빈 홈 그대로.
 */
export function normalizeLayout(raw: unknown, schemaVersion: number | null = HOME_SCHEMA_VERSION): { widgets: HomeWidget[]; unknown: HomeWidget[]; usedDefault: boolean } {
  if (!Array.isArray(raw) || schemaVersion !== HOME_SCHEMA_VERSION) return { widgets: defaultLayout(), unknown: [], usedDefault: true }
  const widgets: HomeWidget[] = []
  const unknown: HomeWidget[] = []
  const ids = new Set<string>()
  const kinds = new Set<string>()
  for (const v of raw.slice(0, HOME_MAX_WIDGETS)) {
    const w = rowShape(v)
    if (!w || ids.has(w.id)) continue
    ids.add(w.id)
    if (!widgetDef(w.kind)) {
      unknown.push(w)
      continue
    }
    // 초기 판은 같은 위젯 두 번을 막는다(지시문 5절) — 두 번째부터 버린다.
    if (kinds.has(w.kind)) continue
    kinds.add(w.kind)
    widgets.push({ ...w, settings: { ...w.settings, ...(filterOf(w) ? { filter: filterOf(w) } : {}) } })
  }
  return { widgets, unknown, usedDefault: false }
}

/** 저장 전 모양 검사 — DB home_widgets_valid와 같은 규칙(배열 · 30개 · 20KB · 줄 모양 · id 겹침 없음). */
export function layoutValid(widgets: unknown): widgets is HomeWidget[] {
  if (!Array.isArray(widgets) || widgets.length > HOME_MAX_WIDGETS) return false
  if (JSON.stringify(widgets).length > 20000) return false
  const ids = new Set<string>()
  for (const v of widgets) {
    const w = rowShape(v)
    if (!w || ids.has(w.id)) return false
    ids.add(w.id)
  }
  return true
}

/** 저장할 값 — 그린 위젯(화면 순서) 뒤에 모르는 종류를 그대로 붙인다. 설정은 아는 값만 남긴다. */
export function layoutForSave(widgets: readonly HomeWidget[], unknown: readonly HomeWidget[] = []): HomeWidget[] {
  const clean = widgets.map((w) => {
    const settings: WidgetSettings = {}
    const f = filterOf(w)
    if (f) settings.filter = f
    if (w.kind === 'favorites' && w.settings.items) settings.items = w.settings.items.filter((x) => ITEM.test(x)).slice(0, 20)
    const scope = scopeShape(w.settings.scope)
    if (scope && widgetDef(w.kind)?.scoped) settings.scope = scope
    return { id: w.id, kind: w.kind, size: w.size, settings }
  })
  return [...clean, ...unknown]
}

/** 새 위젯 id — 종류 + 짧은 꼬리(같은 종류를 지웠다 다시 넣어도 겹치지 않게). */
export function newWidgetId(kind: string, taken: readonly string[]): string {
  if (!taken.includes(kind)) return kind
  for (let i = 2; i < 100; i++) if (!taken.includes(`${kind}-${i}`)) return `${kind}-${i}`
  return `${kind}-${Date.now().toString(36)}`.slice(0, 40)
}

/** 이동(앞 · 뒤) — 범위 밖이면 그대로. */
export function moveWidget(list: readonly HomeWidget[], index: number, by: -1 | 1): HomeWidget[] {
  const to = index + by
  if (index < 0 || index >= list.length || to < 0 || to >= list.length) return [...list]
  const next = [...list]
  ;[next[index], next[to]] = [next[to], next[index]]
  return next
}

/** 끌어 놓기 — from 자리의 위젯을 to 자리로. */
export function dropWidget(list: readonly HomeWidget[], from: number, to: number): HomeWidget[] {
  if (from === to || from < 0 || from >= list.length || to < 0 || to >= list.length) return [...list]
  const next = [...list]
  const [w] = next.splice(from, 1)
  next.splice(to, 0, w)
  return next
}

/** 두 배치가 같은가(취소 · 나갈 때 확인 판정). */
export function sameLayout(a: readonly HomeWidget[], b: readonly HomeWidget[]): boolean {
  return JSON.stringify(layoutForSave(a)) === JSON.stringify(layoutForSave(b))
}

/* ------------------------------------------------------------------ 저장 규칙(dummy · 검사) */

export interface LayoutRow {
  user_id: string
  schema_version: number
  revision: number
  widgets: HomeWidget[]
  updated_at: string
}

/**
 * 0086 home_layout_save를 옮겨 적은 것 — 사용자는 호출한 세션(uid)으로만 정한다(본문에 사용자 id 없음).
 * 줄이 없으면 expected = 0이어야 하고, 있으면 지금 revision = expected여야 한다. 아니면 'home_conflict'. 돌려주는 값 = 새 판.
 */
export function saveLayoutIn(rows: Map<string, LayoutRow>, uid: string, expected: number, schema: number, widgets: unknown, now = new Date().toISOString()): number {
  if (!Number.isInteger(expected) || expected < 0 || schema !== HOME_SCHEMA_VERSION || !layoutValid(widgets)) throw new Error('home_invalid')
  const row = rows.get(uid)
  const current = row?.revision ?? 0
  if (current !== expected) throw new Error('home_conflict')
  const revision = current + 1
  rows.set(uid, { user_id: uid, schema_version: schema, revision, widgets: JSON.parse(JSON.stringify(widgets)) as HomeWidget[], updated_at: now })
  return revision
}

/* ------------------------------------------------------------------ 고르기(순수 — data.ts와 검사가 같이 쓴다) */

/** 이번 주 끝(일요일) — 한국 업무 달력(월요일 시작). 날짜는 문자열로만(lib/calendar.ts와 같은 방식). */
export function weekEnd(today: string): string {
  const t = Date.parse(`${today}T00:00:00Z`)
  const dow = (new Date(t).getUTCDay() + 6) % 7
  return new Date(t + (6 - dow) * 86_400_000).toISOString().slice(0, 10)
}

/** 내 업무 — 내가 맡은 열린 업무 · 필터(진행 중 = 전부 · 이번 주 마감 = 일요일까지(지난 것 포함) · 기한 지남) · 정렬(기한 지남 → 마감 임박 → 마감 없음). */
export function pickMyTasks<T extends { owner_user_id?: string | null; status: string; deadline: string | null; title: string }>(tasks: readonly T[], me: string, today: string, filter: string): T[] {
  const end = weekEnd(today)
  return tasks
    // owner는 화면 이름표다(어댑터가 이름으로 바꾼다) — 사람 비교는 id로만.
    .filter((t) => t.owner_user_id === me && t.status !== 'Done')
    .filter((t) => (filter === 'overdue' ? !!t.deadline && t.deadline < today : filter === 'week' ? !!t.deadline && t.deadline <= end : true))
    .sort((a, b) => (a.deadline ?? '9999').localeCompare(b.deadline ?? '9999') || a.title.localeCompare(b.title))
}

/** 요청한 업무 — 내가 올린 양식 결재(/me «내 요청»과 같은 줄) · 처리 중 = Open. */
export function pickRequested<D extends { created_by?: string | null; template_key?: string; status: string; decision_id: string; created_at?: string }>(decisions: readonly D[], me: string, filter: string): D[] {
  return decisions
    .filter((d) => d.created_by === me && !!d.template_key)
    .filter((d) => (filter === 'open' ? d.status === 'Open' : true))
    .sort((a, b) => (b.created_at ?? b.decision_id).localeCompare(a.created_at ?? a.decision_id))
}

/* ------------------------------------------------------------------ 위젯 내용(서버 → 화면) */

export type Tone = 'blue' | 'orange' | 'green' | 'red' | 'gray'

export interface WidgetItem {
  id: string
  title: string
  href: string
  badge?: { text: string; tone: Tone }
  meta?: string
  right?: string
  /** 개발용 예시 줄(시드) — 화면이 «예시» 꼬리표를 단다. */
  example?: boolean
}

/** 0097 숫자 칸(재무 지표 · 투자 KPI) — 값은 서버가 글자로 만든다(재무 현황 · 투자 화면과 같은 포맷). */
export interface WidgetStat {
  label: string
  value: string
  sub?: string | null
  tone?: 'up' | 'down' | 'muted'
  href?: string
}

/** 0097 표(계열사 현황 · 자금 전망 회사별). */
export interface WidgetTable {
  head: string[]
  /** 숫자 칸(오른쪽 정렬) 번호. */
  numeric?: number[]
  rows: { id: string; cells: string[]; href?: string; badge?: { text: string; tone: Tone } }[]
}

/** 0097 데이터 상태(0094 표기와 같은 말) — 위젯 머리에 작게. */
export type DataBadge = 'LIVE' | 'PARTIAL' | 'UNAVAILABLE'

export type WidgetData =
  | {
      state: 'ok'
      count: number
      items: WidgetItem[]
      note?: string
      links?: { href: string; label: string }[]
      stats?: WidgetStat[]
      table?: WidgetTable
      /** 긴 글(브리핑 요약). */
      text?: string
      status?: DataBadge
      /** 기준(«2026년 9월 · 대양산업» 같은 한 줄). */
      basis?: string
      /** 건수 칸을 숨긴다(숫자 칸 위젯). */
      hideCount?: boolean
    }
  | { state: 'pending'; text: string; links?: { href: string; label: string }[] }
  | { state: 'denied'; text: string }
  | { state: 'error'; text: string }

/** 즐겨찾기로 고를 수 있는 것(서버가 그 사람의 메뉴 · 양식에서 만든다). */
export interface FavoriteOption {
  key: string
  label: string
  href: string
  group: '결재 양식' | '메뉴'
}

export const HOME_ERROR_TEXT: Record<string, string> = {
  home_conflict: '다른 탭이나 기기에서 먼저 저장했습니다. «최신 배치 불러오기»로 새 배치를 받은 뒤 다시 고쳐 주세요.',
  home_denied: '«내 홈»을 쓸 수 없습니다(기능이 꺼져 있거나 권한이 없습니다).',
  home_invalid: '배치 모양이 올바르지 않습니다. 새로고침 뒤 다시 시도해 주세요.',
  home_kind_denied: '이 계정으로는 넣을 수 없는 위젯이 들어 있습니다. 그 위젯을 빼고 다시 저장해 주세요.',
}

export function homeErrorText(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e)
  const key = /home_[a-z_]+/.exec(m)?.[0]
  return (key && HOME_ERROR_TEXT[key]) || '저장하지 못했습니다. 잠시 뒤 다시 시도해 주세요.'
}

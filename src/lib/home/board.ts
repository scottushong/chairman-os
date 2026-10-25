/**
 * 0097 구역(Section) 층 — 0086 위젯 엔진(widgets.ts) 위에 얹은 순수 규칙(서버 · DB를 모른다). 배치 → 구역 → 위젯.
 * 대표 첫 화면(/) · 직원 홈(/home)이 같은 것을 쓴다. 화면 · 서버 액션 · dummy 저장소 · 검사(check:dashboard)가 같이 쓴다.
 *
 *   판 2      home_layouts.sections(0097). 판 1 줄(0086 widgets)은 «구역 하나»로 펼친다(대표 · CFO는 기본 구역 뒤에 붙인다).
 *   기본 배치  대표: 오늘의 경영(판단 · 승인 대기) · 재무 지표 · 투자 · 아침 브리핑. 그룹 CFO: 재무 지표 · 내 업무.
 *             직원: 구역 하나(0086 기본 배치 그대로).
 *   범위      구역 scope.biz(회사 · 'all' = 전체 계열사 통합) · scope.project. 위젯 settings.scope가 있으면 덮는다.
 *   모양 검사  DB home_sections_valid와 같은 규칙. 저장 규칙(saveBoardIn) = home_layout_save_sections 거울(revision · 종류 문).
 *   위젯 삭제는 배치에서만 뺀다 — 원본 데이터와 무관하다.
 */

import {
  defaultLayout,
  dropWidget,
  layoutForSave,
  layoutValid,
  moveWidget,
  newWidgetId,
  normalizeLayout,
  scopeShape,
  widgetDef,
  type HomeWidget,
  type Scope,
} from './widgets'

export const BOARD_SCHEMA_VERSION = 2
export const MAX_SECTIONS = 12
export const MAX_BOARD_WIDGETS = 60
export const SECTION_TITLE_MAX = 40

export interface BoardSection {
  id: string
  title: string
  hidden: boolean
  collapsed: boolean
  scope: Scope
  widgets: HomeWidget[]
  /** 이 앱이 모르는 종류(새 판 · 없어진 위젯) — 그리지 않고 저장 때 그대로 돌려준다. */
  unknown: HomeWidget[]
}

/** 누구의 기본 배치인가(역할에서 정한다 — 화면 · 서버 액션 · 검사가 같은 함수). */
export type BoardPersona = 'chair' | 'cfo' | 'staff'

export function personaOf(role: string | null | undefined): BoardPersona {
  return role === 'Chairman' ? 'chair' : role === 'GroupCFO' ? 'cfo' : 'staff'
}

const W = (kind: string, size: HomeWidget['size'], id = kind, filter?: string): HomeWidget => ({ id, kind, size, settings: filter ? { filter } : {} })
const S = (id: string, title: string, widgets: HomeWidget[], scope: Scope = { biz: 'all' }): BoardSection => ({ id, title, hidden: false, collapsed: false, scope, widgets, unknown: [] })

/** 기본 배치(지시문 8). 직원 = 구역 하나(0086 기본 배치). */
export function defaultBoard(persona: BoardPersona): BoardSection[] {
  if (persona === 'chair') {
    return [
      S('today', '오늘의 경영', [W('ai_judgment', 'm'), W('approvals', 's', 'approvals', 'todo')]),
      S('finance', '재무 지표', [W('fin_kpis', 'l'), W('cash_forecast', 'm'), W('fin_checklist', 's'), W('companies', 'l')]),
      S('invest', '투자', [W('inv_kpis', 'l'), W('inv_buy_zone', 's'), W('inv_monthly', 's')]),
      S('brief', '아침 브리핑', [W('inv_brief', 'm'), W('inv_alerts', 's')]),
    ]
  }
  if (persona === 'cfo') {
    return [S('finance', '재무 지표', [W('fin_kpis', 'l'), W('cash_forecast', 'm'), W('fin_checklist', 's'), W('companies', 'l')]), S('main', '내 업무', defaultLayout())]
  }
  return [S('main', '내 업무 공간', defaultLayout())]
}

const ID = /^[a-z0-9_-]{1,40}$/

/** 구역 하나의 모양 — 틀리면 null(버린다). 위젯은 0086 정규화(모르는 종류 → unknown · 같은 종류 두 번째 버림). */
function sectionShape(v: unknown): BoardSection | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const r = v as Record<string, unknown>
  if (typeof r.id !== 'string' || !ID.test(r.id)) return null
  const title = typeof r.title === 'string' ? r.title.trim().slice(0, SECTION_TITLE_MAX) : ''
  if (!title) return null
  const n = normalizeLayout(Array.isArray(r.widgets) ? r.widgets : [], 1)
  return {
    id: r.id,
    title,
    hidden: r.hidden === true,
    collapsed: r.collapsed === true,
    scope: scopeShape(r.scope) ?? { biz: 'all' },
    widgets: n.widgets,
    unknown: n.unknown,
  }
}

export interface BoardRead {
  revision: number
  schema_version: number | null
  widgets: unknown
  sections?: unknown
}

/**
 * 서버에서 읽은 줄 → 그릴 구역. 줄 없음 · 모르는 판 = 기본 배치(usedDefault).
 * 판 1(0086): 위젯을 구역 하나로 — 대표 · CFO는 기본 구역 뒤에 «내 홈»으로 붙인다(0086에서 고친 배치를 잃지 않는다).
 * 위젯 id가 구역 사이에서 겹치면 뒤의 것을 버린다(DB도 막는다).
 */
export function normalizeBoard(read: BoardRead, persona: BoardPersona): { sections: BoardSection[]; usedDefault: boolean } {
  if (read.schema_version === BOARD_SCHEMA_VERSION && Array.isArray(read.sections)) {
    const out: BoardSection[] = []
    const sids = new Set<string>()
    const wids = new Set<string>()
    for (const v of read.sections.slice(0, MAX_SECTIONS)) {
      const s = sectionShape(v)
      if (!s || sids.has(s.id)) continue
      sids.add(s.id)
      const keep = (w: HomeWidget) => (wids.has(w.id) ? false : (wids.add(w.id), true))
      out.push({ ...s, widgets: s.widgets.filter(keep), unknown: s.unknown.filter(keep) })
    }
    return { sections: out, usedDefault: false }
  }
  if (read.schema_version === 1 && Array.isArray(read.widgets)) {
    const n = normalizeLayout(read.widgets, 1)
    const legacy: BoardSection = { ...S('main', '내 홈', n.widgets), unknown: n.unknown }
    if (persona === 'staff') return { sections: [{ ...legacy, title: '내 업무 공간' }], usedDefault: false }
    const base = defaultBoard(persona).filter((s) => s.id !== 'main')
    const taken = new Set(base.flatMap((s) => s.widgets.map((w) => w.id)))
    const fixId = (w: HomeWidget) => (taken.has(w.id) ? { ...w, id: newWidgetId(w.kind, [...taken]) } : w)
    return { sections: [...base, { ...legacy, widgets: legacy.widgets.map(fixId), unknown: legacy.unknown.map(fixId) }], usedDefault: false }
  }
  return { sections: defaultBoard(persona), usedDefault: true }
}

/** 저장할 값(DB 모양) — 구역마다 그린 위젯 뒤에 모르는 종류를 그대로 붙인다. */
export interface SavedSection {
  id: string
  title: string
  hidden: boolean
  collapsed: boolean
  scope: Scope
  widgets: HomeWidget[]
}

export function boardForSave(sections: readonly BoardSection[]): SavedSection[] {
  return sections.map((s) => ({
    id: s.id,
    title: s.title.trim().slice(0, SECTION_TITLE_MAX) || '구역',
    hidden: s.hidden,
    collapsed: s.collapsed,
    scope: scopeShape(s.scope) ?? { biz: 'all' },
    widgets: layoutForSave(s.widgets, s.unknown),
  }))
}

/** 모양 검사 — DB home_sections_valid와 같은 규칙(12구역 · 60KB · 구역 id · 제목 · 위젯 = 0086 검사 · 위젯 id 배치 전체에서 하나 · 합계 60). */
export function boardValid(v: unknown): v is SavedSection[] {
  if (!Array.isArray(v) || v.length > MAX_SECTIONS || JSON.stringify(v).length > 60000) return false
  const sids = new Set<string>()
  const wids = new Set<string>()
  let total = 0
  for (const s of v) {
    if (!s || typeof s !== 'object' || Array.isArray(s)) return false
    const r = s as Record<string, unknown>
    if (typeof r.id !== 'string' || !ID.test(r.id) || sids.has(r.id)) return false
    sids.add(r.id)
    if (typeof r.title !== 'string' || r.title.trim().length < 1 || r.title.trim().length > SECTION_TITLE_MAX) return false
    if (r.hidden !== undefined && typeof r.hidden !== 'boolean') return false
    if (r.collapsed !== undefined && typeof r.collapsed !== 'boolean') return false
    if (r.scope !== undefined && (!r.scope || typeof r.scope !== 'object' || Array.isArray(r.scope))) return false
    if (!layoutValid(r.widgets)) return false
    for (const w of r.widgets) {
      if (wids.has(w.id)) return false
      wids.add(w.id)
      total++
    }
  }
  return total <= MAX_BOARD_WIDGETS
}

export const sameBoard = (a: readonly BoardSection[], b: readonly BoardSection[]) => JSON.stringify(boardForSave(a)) === JSON.stringify(boardForSave(b))

/* ------------------------------------------------------------------ 범위 */

/** 위젯이 실제로 쓰는 범위 — 위젯 덮어쓰기 > 구역 > 전체. 범위와 무관한 위젯은 늘 전체. */
export function effectiveScope(section: Pick<BoardSection, 'scope'>, w: Pick<HomeWidget, 'kind' | 'settings'>): { biz: string; project: string | null; overridden: boolean } {
  const def = widgetDef(w.kind)
  if (!def?.scoped) return { biz: 'all', project: null, overridden: false }
  const own = scopeShape(w.settings.scope)
  const biz = own?.biz ?? section.scope.biz ?? 'all'
  const project = def.scoped === 'project' ? (own?.project ?? (own?.biz ? null : (section.scope.project ?? null))) : null
  return { biz, project, overridden: !!own }
}

/* ------------------------------------------------------------------ 편집 도구(순수 — 화면이 부른다) */

const allWidgetIds = (sections: readonly BoardSection[]) => sections.flatMap((s) => [...s.widgets, ...s.unknown].map((w) => w.id))

export function newSectionId(sections: readonly BoardSection[]): string {
  const taken = new Set(sections.map((s) => s.id))
  for (let i = 1; i < 100; i++) if (!taken.has(`sec-${i}`)) return `sec-${i}`
  return `sec-${Date.now().toString(36)}`.slice(0, 40)
}

/** 새 구역(맨 뒤 또는 at 자리). 12개면 그대로. */
export function addSection(sections: readonly BoardSection[], title: string, at = sections.length): BoardSection[] {
  if (sections.length >= MAX_SECTIONS) return [...sections]
  const next = [...sections]
  next.splice(Math.max(0, Math.min(at, next.length)), 0, S(newSectionId(sections), title.trim().slice(0, SECTION_TITLE_MAX) || '새 구역', []))
  return next
}

export const patchSection = (sections: readonly BoardSection[], id: string, fn: (s: BoardSection) => BoardSection) => sections.map((s) => (s.id === id ? fn(s) : s))

export function renameSection(sections: readonly BoardSection[], id: string, title: string): BoardSection[] {
  const t = title.trim().slice(0, SECTION_TITLE_MAX)
  return t ? patchSection(sections, id, (s) => ({ ...s, title: t })) : [...sections]
}

/** 구역 앞 · 뒤. */
export function moveSection(sections: readonly BoardSection[], index: number, by: -1 | 1): BoardSection[] {
  const to = index + by
  if (index < 0 || index >= sections.length || to < 0 || to >= sections.length) return [...sections]
  const next = [...sections]
  ;[next[index], next[to]] = [next[to], next[index]]
  return next
}

/** 구역 지우기 — 안의 위젯 배치도 함께 빠진다(원본 데이터와 무관). */
export const removeSection = (sections: readonly BoardSection[], id: string) => sections.filter((s) => s.id !== id)

export function addWidget(sections: readonly BoardSection[], sectionId: string, kind: string): BoardSection[] {
  const def = widgetDef(kind)
  if (!def || def.listOnly || allWidgetIds(sections).length >= MAX_BOARD_WIDGETS) return [...sections]
  const id = newWidgetId(kind, allWidgetIds(sections))
  return patchSection(sections, sectionId, (s) =>
    s.widgets.some((w) => w.kind === kind) ? s : { ...s, widgets: [...s.widgets, { id, kind, size: def.defaultSize, settings: def.filters.length ? { filter: def.filters[0].key } : {} }] },
  )
}

export const removeWidget = (sections: readonly BoardSection[], sectionId: string, widgetId: string) => patchSection(sections, sectionId, (s) => ({ ...s, widgets: s.widgets.filter((w) => w.id !== widgetId) }))

export const patchWidget = (sections: readonly BoardSection[], sectionId: string, widgetId: string, fn: (w: HomeWidget) => HomeWidget) =>
  patchSection(sections, sectionId, (s) => ({ ...s, widgets: s.widgets.map((w) => (w.id === widgetId ? fn(w) : w)) }))

/** 구역 안 앞 · 뒤(0086 moveWidget). */
export const nudgeWidget = (sections: readonly BoardSection[], sectionId: string, index: number, by: -1 | 1) => patchSection(sections, sectionId, (s) => ({ ...s, widgets: moveWidget(s.widgets, index, by) }))

/**
 * 위젯 옮기기 — 같은 구역이면 0086 dropWidget, 다른 구역이면 빼서 to 자리(없으면 맨 뒤)에 넣는다.
 * 받는 구역에 같은 종류가 이미 있으면 옮기지 않는다(구역마다 한 번 — 0086 규칙). ok = 옮겼는가.
 */
export function transferWidget(
  sections: readonly BoardSection[],
  from: { section: string; index: number },
  to: { section: string; index?: number },
): { sections: BoardSection[]; ok: boolean } {
  const src = sections.find((s) => s.id === from.section)
  const dst = sections.find((s) => s.id === to.section)
  const w = src?.widgets[from.index]
  if (!src || !dst || !w) return { sections: [...sections], ok: false }
  if (src.id === dst.id) {
    const at = to.index === undefined ? src.widgets.length - 1 : Math.min(to.index, src.widgets.length - 1)
    return { sections: patchSection(sections, src.id, (s) => ({ ...s, widgets: dropWidget(s.widgets, from.index, at) })), ok: at !== from.index }
  }
  if (dst.widgets.some((x) => x.kind === w.kind)) return { sections: [...sections], ok: false }
  return {
    sections: sections.map((s) => {
      if (s.id === src.id) return { ...s, widgets: s.widgets.filter((_, i) => i !== from.index) }
      if (s.id === dst.id) {
        const next = [...s.widgets]
        next.splice(to.index === undefined ? next.length : Math.max(0, Math.min(to.index, next.length)), 0, w)
        return { ...s, widgets: next }
      }
      return s
    }),
    ok: true,
  }
}

/* ------------------------------------------------------------------ 저장 규칙(dummy · 검사) — 0097 home_layout_save_sections 거울 */

export interface BoardRow {
  user_id: string
  schema_version: number
  revision: number
  widgets: HomeWidget[]
  sections?: SavedSection[] | null
  updated_at: string
}

/** 종류 문은 부르는 쪽이 준다(대표 · CFO · 지정자 판정 = DB home_kind_allowed). 거부면 'home_kind_denied'. */
export function saveBoardIn(rows: Map<string, BoardRow>, uid: string, expected: number, sections: unknown, kindAllowed: (kind: string) => boolean, now = new Date().toISOString()): number {
  if (!Number.isInteger(expected) || expected < 0 || !boardValid(sections)) throw new Error('home_invalid')
  for (const s of sections) for (const w of s.widgets) if (!kindAllowed(w.kind)) throw new Error('home_kind_denied')
  const row = rows.get(uid)
  const current = row?.revision ?? 0
  if (current !== expected) throw new Error('home_conflict')
  const revision = current + 1
  rows.set(uid, { user_id: uid, schema_version: BOARD_SCHEMA_VERSION, revision, widgets: [], sections: JSON.parse(JSON.stringify(sections)) as SavedSection[], updated_at: now })
  return revision
}

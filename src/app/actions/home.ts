'use server'

import { currentUser } from '@/lib/auth/session'
import { boardForSave, boardValid, normalizeBoard, personaOf, type BoardSection } from '@/lib/home/board'
import { homeAccess, kindAllowed, widgetData } from '@/lib/home/data'
import { homeStore } from '@/lib/home/store'
import { filterOf, homeErrorText, layoutForSave, layoutValid, normalizeLayout, widgetDef, type HomeWidget, type WidgetData } from '@/lib/home/widgets'

/**
 * 0086 «내 홈» 서버 액션 — 사용자는 세션이 정한다(본문에 사용자 id를 받지 않는다). 판정은 DB(live — RLS · home_layout_save) · widgets.ts(dummy).
 *   saveHomeLayout   본 판(expected) + 배치. 다른 탭 · 기기가 먼저 저장했으면 conflict(화면은 편집 내용을 그대로 들고 «최신 배치 불러오기»를 보인다).
 *   reloadHomeLayout 충돌 뒤 최신 배치를 다시 받는다.
 *   loadHomeWidget   위젯 하나의 내용(그 기능의 기존 권한) — 위젯마다 따로 불러 한 위젯 실패가 홈 전체를 막지 않는다.
 */

export interface SaveResult {
  ok: boolean
  revision?: number
  conflict?: boolean
  error?: string
}

export async function saveHomeLayout(expected: number, widgets: HomeWidget[], unknown: HomeWidget[] = []): Promise<SaveResult> {
  const user = await currentUser()
  if (!user) return { ok: false, error: homeErrorText('home_denied') }
  if (!(await homeAccess(user)).home) return { ok: false, error: homeErrorText('home_denied') }
  if (!Number.isInteger(expected) || expected < 0) return { ok: false, error: homeErrorText('home_invalid') }
  const body = layoutForSave(Array.isArray(widgets) ? widgets.filter((w) => !!widgetDef(w?.kind)) : [], Array.isArray(unknown) ? unknown : [])
  if (!layoutValid(body)) return { ok: false, error: homeErrorText('home_invalid') }
  try {
    const revision = await (await homeStore()).save(expected, body)
    return { ok: true, revision }
  } catch (e) {
    console.error('[home] 배치 저장 실패', e)
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, conflict: /home_conflict/.test(msg), error: homeErrorText(e) }
  }
}

export async function reloadHomeLayout(): Promise<{ ok: boolean; revision?: number; widgets?: HomeWidget[]; unknown?: HomeWidget[]; error?: string }> {
  const user = await currentUser()
  if (!user || !(await homeAccess(user)).home) return { ok: false, error: homeErrorText('home_denied') }
  try {
    const r = await (await homeStore()).read()
    const n = normalizeLayout(r.widgets, r.schema_version)
    return { ok: true, revision: r.revision, widgets: n.widgets, unknown: n.unknown }
  } catch (e) {
    console.error('[home] 배치 읽기 실패', e)
    return { ok: false, error: '최신 배치를 불러오지 못했습니다.' }
  }
}

export async function loadHomeWidget(kind: string, filter?: string): Promise<WidgetData> {
  const user = await currentUser()
  if (!user) return { state: 'denied', text: '로그인이 필요합니다.' }
  const access = await homeAccess(user)
  if (!access.home) return { state: 'denied', text: '«내 홈»을 쓸 수 없는 계정입니다.' }
  const def = widgetDef(String(kind))
  if (!def) return { state: 'error', text: '알 수 없는 위젯입니다.' }
  return widgetData(user, access, def.kind, filterOf({ kind: def.kind, settings: { filter: typeof filter === 'string' ? filter : undefined } }))
}

/* ------------------------------------------------------------------ 0097 구역 배치 */

/**
 * 구역 배치 저장 — 본 판(expected) + 구역들. 0086 충돌 규칙 그대로. 이 사람이 넣을 수 없는 위젯(직원의 재무 · 투자 위젯)이 있으면
 * 저장하지 않는다(DB home_kind_allowed가 한 번 더 본다). 모르는 종류(없어진 위젯)는 그대로 둔다.
 */
export async function saveBoardLayout(expected: number, sections: BoardSection[]): Promise<SaveResult> {
  const user = await currentUser()
  if (!user) return { ok: false, error: homeErrorText('home_denied') }
  const access = await homeAccess(user)
  if (!access.home) return { ok: false, error: homeErrorText('home_denied') }
  if (!Number.isInteger(expected) || expected < 0 || !Array.isArray(sections)) return { ok: false, error: homeErrorText('home_invalid') }
  const body = boardForSave(sections.map((s) => ({ ...s, widgets: Array.isArray(s?.widgets) ? s.widgets : [], unknown: Array.isArray(s?.unknown) ? s.unknown : [] })))
  if (!boardValid(body)) return { ok: false, error: homeErrorText('home_invalid') }
  if (body.some((s) => s.widgets.some((w) => !kindAllowed(access, w.kind)))) return { ok: false, error: homeErrorText('home_kind_denied') }
  try {
    const revision = await (await homeStore()).saveSections(expected, body, (kind) => kindAllowed(access, kind))
    return { ok: true, revision }
  } catch (e) {
    console.error('[home] 구역 배치 저장 실패', e)
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, conflict: /home_conflict/.test(msg), error: homeErrorText(e) }
  }
}

export async function reloadBoard(): Promise<{ ok: boolean; revision?: number; sections?: BoardSection[]; error?: string }> {
  const user = await currentUser()
  if (!user || !(await homeAccess(user)).home) return { ok: false, error: homeErrorText('home_denied') }
  try {
    const r = await (await homeStore()).read()
    return { ok: true, revision: r.revision, sections: normalizeBoard(r, personaOf(user.role)).sections }
  } catch (e) {
    console.error('[home] 배치 읽기 실패', e)
    return { ok: false, error: '최신 배치를 불러오지 못했습니다.' }
  }
}

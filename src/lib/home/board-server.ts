import 'server-only'

import { getRepository } from '@/lib/repository'
import type { SessionUser } from '@/types'

import { defaultBoard, normalizeBoard, personaOf, type BoardSection } from './board'
import { favoriteOptions, homeAccess, kindAllowed, libraryKinds, type HomeAccess } from './data'
import { homeStore } from './store'
import { WIDGETS, type FavoriteOption } from './widgets'

/**
 * 0097 구역 판의 서버 준비 — 대표 첫 화면(/)과 직원 홈(/home)이 같은 것을 부른다.
 * 배치는 본인 줄(0086 RLS), 범위 고르기의 회사 · 프로젝트는 그 사람 세션으로 읽은 목록(RLS) — 볼 수 없는 회사는 고를 수도 없다.
 */
export interface BoardProps {
  access: HomeAccess
  sections: BoardSection[]
  revision: number
  usedDefault: boolean
  loadFailed: boolean
  library: string[]
  addable: string[]
  defaults: BoardSection[]
  favorites: FavoriteOption[]
  businesses: { id: string; name: string }[]
  projects: { id: string; name: string; biz: string }[]
  mode: 'live' | 'dummy'
}

export async function loadBoardProps(user: SessionUser): Promise<BoardProps> {
  const access = await homeAccess(user)
  const persona = personaOf(user.role)
  const store = await homeStore()
  const repo = await getRepository()
  const [got, favorites, businesses, projects] = await Promise.all([
    store.read().then(
      (r) => ({ r, failed: false }),
      (e) => {
        console.error('[home] 배치 읽기 실패 — 기본 배치로 그린다(편집은 막는다)', e)
        return { r: { revision: 0, schema_version: null, widgets: null, sections: null, updated_at: null }, failed: true }
      },
    ),
    favoriteOptions(user, access).catch(() => [] as FavoriteOption[]),
    repo.listBusinesses().catch(() => []),
    repo.listProjects().catch(() => []),
  ])
  const board = normalizeBoard(got.r, persona)
  const addable = WIDGETS.filter((w) => kindAllowed(access, w.kind)).map((w) => w.kind)
  const live = businesses.filter((b) => b.status !== 'Archived').sort((a, b) => a.sort_order - b.sort_order)
  return {
    access,
    // 기본 배치에는 이 사람이 쓸 수 있는 위젯만(스위치가 꺼진 투자 위젯 등은 처음부터 넣지 않는다). 저장된 배치는 그대로(«권한 없음» 칸).
    sections: board.usedDefault ? board.sections.map((s) => ({ ...s, widgets: s.widgets.filter((w) => addable.includes(w.kind)) })) : board.sections,
    revision: got.r.revision,
    usedDefault: board.usedDefault,
    loadFailed: got.failed,
    library: libraryKinds(access),
    addable,
    defaults: defaultBoard(persona),
    favorites,
    businesses: live.map((b) => ({ id: b.business_id, name: b.name })),
    projects: projects.filter((p) => p.status !== 'Done').map((p) => ({ id: p.project_id, name: p.name, biz: p.business_id })),
    mode: store.mode,
  }
}

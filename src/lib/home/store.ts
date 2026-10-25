import 'server-only'

import { existsSync, readFileSync, writeFileSync } from 'node:fs'

import { currentUser } from '@/lib/auth/session'
import { DATA_MODE } from '@/lib/env'
import { dummyViewer } from '@/lib/repository/dummy-org'
import { createSupabaseServerClient } from '@/lib/supabase/server'

import { saveBoardIn, type BoardRow, type SavedSection } from './board'
import { HOME_SCHEMA_VERSION, saveLayoutIn, type HomeWidget, type LayoutRow } from './widgets'

/**
 * 0086 «내 홈» 배치 저장소 — 화면(서버 컴포넌트)과 서버 액션이 여기만 부른다.
 *   live   사람 세션의 Supabase. 읽기 = home_layouts 본인 줄(RLS) · 쓰기 = home_layout_save RPC(정의자 · auth.uid() · revision 충돌).
 *          요청 본문의 사용자 id를 받지 않는다 — 사용자는 세션이 정한다.
 *   dummy  widgets.ts saveLayoutIn(0086을 옮겨 적은 것). 상태는 globalThis 한 벌 — DUMMY_HOME_STATE=<파일>이면 그 파일에 남겨
 *          서버를 다른 DUMMY_USER로 다시 켜도 이어진다(직원 A · B 시험).
 * 0097 구역 층: read가 sections(판 2)도 돌려주고, saveSections = home_layout_save_sections RPC(판 2 · 종류 문 home_kind_allowed).
 *   0097 전 DB(sections 칸 없음 42703)면 sections 없이 다시 읽는다 — 판 1 줄은 그대로 그린다.
 */

export interface HomeLayoutRead {
  /** 줄이 없으면 0(처음 저장 때 expected = 0). */
  revision: number
  schema_version: number | null
  /** 줄이 없으면 null(→ 기본 배치). */
  widgets: unknown
  /** 0097 판 2 구역(판 1 · 0097 전 DB면 null). */
  sections: unknown
  updated_at: string | null
}

export interface HomeStore {
  mode: 'live' | 'dummy'
  read(): Promise<HomeLayoutRead>
  save(expected: number, widgets: HomeWidget[]): Promise<number>
  /** 0097 — 종류 문(kindAllowed)은 dummy만 쓴다(live는 DB home_kind_allowed). */
  saveSections(expected: number, sections: SavedSection[], kindAllowed: (kind: string) => boolean): Promise<number>
}

const MISSING = new Set(['PGRST202', '42883', 'PGRST205', '42P01'])

async function liveStore(): Promise<HomeStore> {
  const sb = await createSupabaseServerClient()
  const user = await currentUser()
  return {
    mode: 'live',
    async read() {
      if (!user) throw new Error('home_denied')
      const first = await sb.from('home_layouts').select('schema_version, revision, widgets, sections, updated_at').eq('user_id', user.user_id).maybeSingle()
      // 0097 전 DB — sections 칸이 없다(42703). 판 1 칸만 다시 읽는다.
      const { data, error } =
        first.error?.code === '42703' ? await sb.from('home_layouts').select('schema_version, revision, widgets, updated_at').eq('user_id', user.user_id).maybeSingle() : first
      if (error) throw new Error(MISSING.has(error.code ?? '') ? 'home_unavailable' : `Supabase ${error.code ?? '?'}: ${error.message}`)
      if (!data) return { revision: 0, schema_version: null, widgets: null, sections: null, updated_at: null }
      const row = data as { schema_version: number; revision: number; widgets: unknown; sections?: unknown; updated_at: string }
      return { revision: Number(row.revision), schema_version: Number(row.schema_version), widgets: row.widgets, sections: row.sections ?? null, updated_at: row.updated_at }
    },
    async save(expected, widgets) {
      const { data, error } = await sb.rpc('home_layout_save', { p_expected: expected, p_schema: HOME_SCHEMA_VERSION, p_widgets: widgets })
      if (error) {
        const key = /home_[a-z]+/.exec(error.message)?.[0]
        throw new Error(key ?? (MISSING.has(error.code ?? '') ? 'home_unavailable' : `Supabase ${error.code ?? '?'}: ${error.message}`))
      }
      return Number(data)
    },
    async saveSections(expected, sections) {
      const { data, error } = await sb.rpc('home_layout_save_sections', { p_expected: expected, p_sections: sections })
      if (error) {
        const key = /home_[a-z_]+/.exec(error.message)?.[0]
        throw new Error(key ?? (MISSING.has(error.code ?? '') ? 'home_unavailable' : `Supabase ${error.code ?? '?'}: ${error.message}`))
      }
      return Number(data)
    },
  }
}

// ── dummy ─────────────────────────────────────────────────────────────
type DummyRow = LayoutRow & Partial<Pick<BoardRow, 'sections'>>
const G = globalThis as { __homeDummy?: Map<string, DummyRow> }

function stateFile() {
  return process.env.DUMMY_HOME_STATE?.trim() || null
}
function loadRows(): Map<string, DummyRow> {
  const file = stateFile()
  if (file && existsSync(file)) return new Map(JSON.parse(readFileSync(file, 'utf8')) as [string, DummyRow][])
  return (G.__homeDummy ??= new Map())
}
function saveRows(rows: Map<string, DummyRow>) {
  G.__homeDummy = rows
  const file = stateFile()
  if (file) writeFileSync(file, JSON.stringify([...rows]))
}

function dummyStore(): HomeStore {
  const uid = dummyViewer().user_id
  return {
    mode: 'dummy',
    async read() {
      const row = loadRows().get(uid)
      return row
        ? { revision: row.revision, schema_version: row.schema_version, widgets: row.widgets, sections: row.schema_version === 2 ? (row.sections ?? null) : null, updated_at: row.updated_at }
        : { revision: 0, schema_version: null, widgets: null, sections: null, updated_at: null }
    },
    async save(expected, widgets) {
      // dummy 시험 손잡이 — DUMMY_HOME_FAIL=1이면 저장이 늘 실패한다(«저장 실패 시 편집 내용 유지» 화면 확인용). live에는 없다.
      if (process.env.DUMMY_HOME_FAIL === '1') throw new Error('dummy 저장 실패(시험)')
      const rows = loadRows()
      const rev = saveLayoutIn(rows, uid, expected, HOME_SCHEMA_VERSION, widgets)
      saveRows(rows)
      return rev
    },
    async saveSections(expected, sections, kindAllowed) {
      if (process.env.DUMMY_HOME_FAIL === '1') throw new Error('dummy 저장 실패(시험)')
      const rows = loadRows() as Map<string, BoardRow>
      const rev = saveBoardIn(rows, uid, expected, sections, kindAllowed)
      saveRows(rows as Map<string, DummyRow>)
      return rev
    },
  }
}

/** 요청마다 하나. */
export async function homeStore(): Promise<HomeStore> {
  return DATA_MODE === 'dummy' ? dummyStore() : liveStore()
}

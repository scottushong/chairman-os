/**
 * FORCE ROW LEVEL SECURITY가 있던 표가 꺼지면 FAIL (2026-10-12 대표 지시).
 *
 * supabase/migrations/*.sql을 번호 순서로 읽어 «alter table … [no] force row level security»를 따라간다.
 * 한 번이라도 FORCE가 걸렸던 표가 마지막 파일까지 읽은 뒤 꺼져 있으면 실패다. 같은 파일 안에서
 * 내렸다 다시 거는 춤(0003 시드 · 0034 audit_log · 0071 teams)은 끝 상태가 FORCE라 통과한다.
 *
 * 예외는 아래 목록뿐 — 정의자 함수가 소유자 권한으로 돌아야 해서 **일부러** 내린 표와 그 파일 · 이유.
 * 새로 내리려면 이 목록에 줄을 더해야 하고, 그 줄이 리뷰에서 보인다. 0071은 처음에 tasks · process_charts를
 * 내렸다가 대표 지시로 되돌렸다(«동기화 통로» — 0071 머리 주석).
 */
import { readdirSync, readFileSync } from 'node:fs'

const DIR = new URL('../supabase/migrations/', import.meta.url)

/** 표 → 내린 파일. check-migrations.ts의 definerUnderNonBypassOwner()가 같은 표를 «FORCE 없음»으로 지킨다. */
export const DELIBERATE_NO_FORCE = {
  chairman_kakao_token: '0023 — kakao_token_for_send() 정의자(07:00 cron)',
  chairman_checkins: '0023 — chairman_recent_condition() 정의자',
  projects: '0027 — project_business_id() 정의자',
  user_settings: '0029 — chairman_brief_timezone() 정의자',
  chairman_brief_sends: '0029 — 아침 알림 정의자',
  decisions: '0034 — founder_dependency_rows() 정의자',
  official_statements: '0051 — ECOUNT 넣기 RPC 정의자(머리 주석 «FORCE와 definer»)',
  official_statement_lines: '0051 — ECOUNT 넣기 RPC 정의자',
}

const RE = /alter\s+table\s+(?:only\s+)?(?:if\s+exists\s+)?(?:public\.)?"?([a-z_0-9]+)"?\s+(no\s+)?force\s+row\s+level\s+security/gi

// 주석을 지운다(줄 주석 · 블록 주석). 글자 상수 안의 «--»는 이 파일들에 없다고 본다.
function stripComments(sql) {
  return sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ')
}

/** docs: [{ name, sql }] — 번호 순서. */
export function forceStates(docs) {
  const state = new Map()
  const ever = new Map()
  for (const { name: f, sql: raw } of docs) {
    const sql = stripComments(raw)
    for (const m of sql.matchAll(RE)) {
      const table = m[1].toLowerCase()
      const on = !m[2]
      state.set(table, { on, file: f })
      if (on && !ever.has(table)) ever.set(table, f)
    }
  }
  return { state, ever }
}

export function forceViolations(docs) {
  const { state, ever } = forceStates(docs)
  const bad = []
  for (const [table, first] of ever) {
    const now = state.get(table)
    if (!now.on && !(table in DELIBERATE_NO_FORCE)) bad.push(`${table}: ${first}에서 FORCE를 걸었는데 ${now.file}이 내렸다`)
  }
  return bad
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())
if (isMain) {
  const files = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort()
  const docs = files.map((name) => ({ name, sql: readFileSync(new URL(name, DIR), 'utf8') }))
  const bad = forceViolations(docs)
  if (bad.length) {
    console.error(`FAIL: FORCE RLS가 있던 표가 꺼졌다\n  ${bad.join('\n  ')}`)
    process.exit(1)
  }
  const { state } = forceStates(docs)
  const on = [...state].filter(([, s]) => s.on).length
  console.log(`PASS: FORCE RLS — ${on}개 표 FORCE 유지 · 일부러 내린 표 ${Object.keys(DELIBERATE_NO_FORCE).length}개(목록)`)
}

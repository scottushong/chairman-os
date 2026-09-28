/**
 * Phase 6-2 블록 3 — «soft delete 전면: 실제 DELETE 정책 없음 확인».
 *
 * 0001~마지막 마이그레이션을 PGlite에 올리고 **카탈로그에서** 잰다:
 *   ① permissive DELETE 권한(FOR ALL · FOR DELETE)이 남은 표는 허용 목록뿐이다.
 *   ② 기록 표 스물셋은 전부 deleted_at 칸과 «지운 줄 숨김» restrictive select를 가진다.
 * 새 마이그레이션이 기록 표에 DELETE 정책을 다시 열거나, 새 기록 표를 만들면서 DELETE를 열면
 * 여기서 걸린다 — 그 표를 soft delete로 만들거나, 지우는 것이 정상인 표라면 허용 목록에 이유와 함께 더한다.
 *
 * check:db-safety가 이 스크립트를 부른다(원문 지시). 단독 실행: npx tsx scripts/check-soft-delete.ts
 */
import assert from 'node:assert/strict'

import { PGlite } from '@electric-sql/pglite'
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm'

import { applyAll } from './pglite'

/** 지우는 것이 곧 정상 동작인 표 — 0042 5절 머리 주석과 같은 목록 · 같은 이유. */
const DELETE_ALLOWED: Record<string, string> = {
  user_business_access: '권한 부여 줄 — 회수가 삭제다',
  user_module_access: '권한 부여 줄 — 회수가 삭제다',
  user_settings: '개인 화면 설정',
  shares: '공유 회수',
  ai_chats: '본인 대화 — 본인 삭제권',
  ai_chat_messages: '본인 대화 — 본인 삭제권',
  chairman_kakao_token: '외부 연결 해제',
  chairman_google_token: '외부 연결 해제',
  finance_kpis: '외부 원천(시트) 재적재',
  fx_rates: '외부 원천 재적재',
  cost_indices: '외부 원천 재적재',
  market_multiples: '외부 원천 재적재',
  journal_lines: 'ECOUNT 열린 달 재동기화(마감 달은 막힌다)',
  business_strategy: '회사당 한 줄 설정',
  process_charts: '링크 설정',
  city_layout: '화면 배치',
  doc_folders: '폴더 구조(문서는 폴더 밖으로 나온다)',
  exception_rules: '규칙 설정',
  attention_scores: '재계산되는 점수',
  // 자연 키 — 키가 곧 그 줄이라 숨기면 같은 키로 다시 못 쓴다(0042 리뷰 I4). 지우는 대신 값을 고친다.
  chairman_checkins: '자연 키(날짜)',
  initiative_notes: '자연 키(이니셔티브당 한 줄)',
  chairman_directions: '자연 키(회사당 한 줄)',
  dependency_areas: '자연 키(회사 × 영역)',
  autonomy_assessments: '자연 키(회사 × 분기)',
  absence_tests: '자연 키(회사 × 일수)',
  teams: '자연 키(team_id)',
  // 0045 — 첨부는 파일 실체와 같이 지운다(버킷 객체를 먼저 지우고 줄을 지운다). 감사에 삭제가 남는다.
  attachments: '파일 실체와 같이 지운다 — 감사에 delete_request',
  attachment_vault_viewers: '권한 부여 줄 — 회수가 삭제다',
}

const SOFT = [
  'businesses', 'projects', 'goals', 'monthly_priorities', 'critical_risks', 'milestones',
  'business_keymen', 'initiatives', 'initiative_keymen', 'initiative_docs', 'events',
  'chairman_projects', 'documents', 'notices',
]

/** DELETE를 닫고 «지우기 = 회수(revoked_at)»인 표 — deleted_at으로 숨기지 않는다(0042 리뷰 I5). */
const REVOKE_ONLY = ['user_profiles', 'user_invitations']

async function main() {
  const db = new PGlite({ extensions: { pg_trgm } })
  await applyAll(db)

  const del = await db.query<{ t: string; p: string }>(`
    select tablename as t, policyname as p from pg_policies
     where schemaname = 'public' and permissive = 'PERMISSIVE' and cmd in ('ALL', 'DELETE')
     order by 1, 2`)
  const offenders = del.rows.filter((r) => !(r.t in DELETE_ALLOWED))
  assert.deepEqual(
    offenders,
    [],
    `soft delete: 허용 목록 밖의 표에 DELETE 정책이 있다 — ${offenders.map((o) => `${o.t}.${o.p}`).join(', ')}`,
  )

  for (const t of REVOKE_ONLY) {
    const d = await db.query(`select 1 from pg_policies where schemaname = 'public' and tablename = $1 and permissive = 'PERMISSIVE' and cmd in ('ALL', 'DELETE')`, [t])
    assert.equal(d.rows.length, 0, `soft delete: ${t}에 DELETE 정책이 남아 있다 — 지우기는 회수다`)
  }

  for (const t of SOFT) {
    const col = await db.query(`select 1 from information_schema.columns where table_schema = 'public' and table_name = $1 and column_name = 'deleted_at'`, [t])
    assert.equal(col.rows.length, 1, `soft delete: ${t}에 deleted_at이 없다`)
    const hide = await db.query<{ permissive: string; cmd: string }>(
      `select permissive, cmd from pg_policies where schemaname = 'public' and tablename = $1 and policyname = 'soft_delete_hidden'`,
      [t],
    )
    assert.deepEqual(hide.rows[0], { permissive: 'RESTRICTIVE', cmd: 'SELECT' }, `soft delete: ${t}에 «지운 줄 숨김»이 없다`)
  }
  await db.close()
  console.log(`PASS: soft delete — DELETE 정책은 허용 목록 ${Object.keys(DELETE_ALLOWED).length}개 표에만, 기록 표 ${SOFT.length}개는 deleted_at + 숨김, 사람 · 초대는 회수`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

/**
 * docs/onboarding/staging-tests/0059_staging_test.sql을 PGlite에서 미리 돌린다 — staging과 비슷한 사람(회장 · 리허설 직원 ·
 * DY 중간 상사)을 심고, 파일이 «0059 STAGING PASS»로 끝나는지 본다. staging에는 쓰지 않는다(파일 자체가 늘 되돌린다).
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { PGlite } from '@electric-sql/pglite'
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm'

import { applyAll } from './pglite'

async function main() {
  const db = new PGlite({ extensions: { pg_trgm } })
  await applyAll(db)
  const chair = '00000000-0000-0000-0000-00000059c001'
  const member = '00000000-0000-0000-0000-00000059c002'
  const mid = '00000000-0000-0000-0000-00000059c003'
  const ceo = '00000000-0000-0000-0000-00000059c004'
  await db.exec(`
    grant usage on schema public, auth to authenticated, anon;
    grant select, insert, update, delete on all tables in schema public to authenticated;
    grant usage, select on all sequences in schema public to authenticated;
    revoke all on table approval_steps from authenticated;
    grant select on table approval_steps to authenticated;
    alter table auth.users add column instance_id uuid, add column aud text, add column role text;
    insert into auth.users (id, email) values ('${chair}', 'chair@x'), ('${member}', 'rehearsal.member@example.com'), ('${mid}', 'mid@x'), ('${ceo}', 'ceo@x');
    insert into user_profiles (user_id, role, display_name, max_security_class, team_id) values
      ('${chair}', 'Chairman', '회장', 'Vault', null),
      ('${ceo}', 'BusinessCEO', 'DY 대표이사', 'Restricted', null),
      ('${mid}', 'TeamLead', '중간 상사', 'Normal', 'team_dy_support'),
      ('${member}', 'Member', '리허설 직원', 'Normal', 'team_dy_support');
    update user_profiles set reports_to = '${chair}' where user_id in ('${member}', '${ceo}');
    update user_profiles set reports_to = '${ceo}' where user_id = '${mid}';
    insert into user_business_access values ('${member}', 'biz_dy'), ('${mid}', 'biz_dy'), ('${ceo}', 'biz_dy');
    update approval_templates set attachment_required = false;
    -- 0059 전에 끝난 양식 결재 한 건(g).
    alter table decisions disable trigger decisions_approval_line_trigger;
    insert into decisions (decision_id, business_id, title, template_key, form, created_by, status, decided_by_kind, lead_status, chairman_required, approval_line)
      values ('dec_old1', 'biz_dy', '옛 기록 완료', 'expense', '{"amount":"400000"}', '${member}', 'Approved', 'rule', 'skipped', false, '[]');
    alter table decisions enable trigger decisions_approval_line_trigger;
  `)
  const sql = readFileSync(join(__dirname, '..', 'docs', 'onboarding', 'staging-tests', '0059_staging_test.sql'), 'utf8')
  let message = ''
  try {
    await db.exec(sql)
  } catch (e) {
    message = e instanceof Error ? e.message : String(e)
  }
  try {
    await db.exec('rollback')
  } catch {
    // 이미 끝난 트랜잭션
  }
  console.log(message)
  assert.match(message, /^0059 STAGING PASS /, 'staging 시험 SQL이 PASS로 끝나지 않는다')
  assert.match(message, /d\(상사 종결 · 사슬 3칸/, '중간 상사 → DY 대표 → 대표 사슬을 돌지 않았다')
  // 파일은 아무것도 남기지 않는다.
  assert.deepEqual((await db.query(`select 1 from decisions where decision_id like 'dec_t59%'`)).rows, [], 'staging 시험 SQL이 결재를 남겼다')
  await db.close()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

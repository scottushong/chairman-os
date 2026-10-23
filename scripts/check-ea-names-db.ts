/**
 * 0093 전자결재 — 대표 단계 처리자 이름 «대표». check-migrations.ts가 부른다(PGlite).
 *   **적용 순간의 DB 상태가 입력이다**(0049 백필과 같다): 0091까지 올린 DB에 옛 이력(대표 실명)을 쌓고 0093을 올린다.
 *   직원 · 후속 담당 · 대결자 화면(ea_doc · ea_list · ea_my_settings)에 대표 실명이 없다 · 대표 본인 화면은 실명 ·
 *   백필은 이름 글자만(사람 · 시각 · 상태 그대로) · 처리자 바꾸기로 대표가 서도 «대표» · 기안자 검색으로 실명을 못 찾는다.
 */
import assert from 'node:assert/strict'

import { PGlite } from '@electric-sql/pglite'
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm'

import { applyAll, applyOne } from './pglite'

const U = {
  chair: '00000000-0000-0000-0000-0000000093a1',
  a: '00000000-0000-0000-0000-0000000093a2', // 기안
  b: '00000000-0000-0000-0000-0000000093a3', // 검토(팀장)
  d: '00000000-0000-0000-0000-0000000093a4', // 대표의 대결자
  e: '00000000-0000-0000-0000-0000000093a5', // 후속 담당
}
const REAL = '홍길동'

export async function eaNamesDb(): Promise<string> {
  const db = new PGlite({ extensions: { pg_trgm } })
  await applyAll(db, '0091_finance_auto.sql')
  await db.exec(`alter table user_profiles disable trigger user_profiles_draft_grant`)
  await db.exec(`
    grant usage on schema public, auth to authenticated, anon;
    insert into auth.users values ${Object.values(U).map((id, i) => `('${id}', 'n${i}@x')`).join(', ')};
    insert into user_profiles (user_id, role, display_name, max_security_class, team_id) values
      ('${U.chair}', 'Chairman', '${REAL}', 'Vault', null), ('${U.a}', 'Member', '박지훈', 'Normal', 'team_dy_production'),
      ('${U.b}', 'TeamLead', '김민수', 'Normal', 'team_dy_production'), ('${U.d}', 'Member', '이대결', 'Normal', null),
      ('${U.e}', 'Member', '최구매', 'Normal', null);
    insert into user_business_access select u, 'biz_dy' from unnest(array['${U.a}', '${U.b}', '${U.d}', '${U.e}']::uuid[]) u;
  `)

  const as = async <T>(uid: string, sql: string): Promise<T[]> => {
    await db.exec(`begin; select set_config('request.jwt.claim.sub', '${uid}', true); set local role authenticated;`)
    try {
      const r = await db.query<T>(sql)
      await db.exec('commit')
      return r.rows
    } catch (e) {
      await db.exec('rollback')
      throw new Error(`0093: 거부되면 안 되는 호출이 거부됐다 — ${(e as Error).message} · ${sql.slice(0, 140)}`)
    }
  }
  const one = async <T>(uid: string, sql: string) => (await as<T>(uid, sql))[0]
  const su = async <T>(sql: string) => (await db.query<T>(sql)).rows
  const line = (...steps: string[]) => JSON.stringify(steps.map((s) => (s === 'CEO' ? { role: 'Chairman', kind: 'approve' } : { user_id: s, kind: 'approve' })))
  const draft = async (uid: string, title: string, ln: string, fu: string | null = null) =>
    (await one<{ id: string }>(uid, `select ea_save_draft(null, 'biz_dy', 'general', '${title}', '내용', '{}'::jsonb, '${ln}'::jsonb, '[]'::jsonb, null, null, ${fu ? `'${fu}'` : 'null'}, null) as id`)).id
  const act = (uid: string, doc: string, seq: number, req: string) => one(uid, `select ea_act('${doc}', ${seq}, 'approve', '확인', '${req}') as s`)
  const view = async (uid: string, doc: string) => JSON.stringify((await one<{ j: unknown }>(uid, `select ea_doc('${doc}') as j`)).j)

  await one(U.chair, `select feature_switch_set('approvals', 'biz_dy', true, 'all', '시험 — 0093') as x`)
  // 후속 처리가 생기는 양식(general은 후속 없음 → 구매 대신 일반 양식에 후속을 붙인다)
  await su(`update ea_forms set followup_kind = '총무 처리' where form_key = 'general'`)

  // ── 0093 전: 옛 이력 쌓기 ──
  // 1) 대표 단계를 대표 본인이 승인
  const g1 = await draft(U.a, '대표 본인 승인 문서', line(U.b, 'CEO'), U.e)
  await one(U.a, `select ea_submit('${g1}', 'req-93-sub-01') as n`)
  await act(U.b, g1, 1, 'req-93-act-01')
  await act(U.chair, g1, 2, 'req-93-act-02')
  // 2) 대표 단계를 대결자가 승인
  const today = (await su<{ t: string }>(`select ((now() at time zone 'Asia/Seoul')::date)::text t`))[0].t
  await one(U.chair, `select ea_proxy_save('${U.d}', '${today}', '${today}', array['general'], null) as id`)
  const g2 = await draft(U.a, '대결 승인 문서', line('CEO'))
  await one(U.a, `select ea_submit('${g2}', 'req-93-sub-02') as n`)
  await act(U.d, g2, 1, 'req-93-act-03')
  // 3) 옛 처리자 바꾸기(0087 판)로 대표가 사람 단계에 실명으로 선 줄
  const g3 = await draft(U.a, '처리자 바꾼 문서', line(U.b))
  await one(U.a, `select ea_submit('${g3}', 'req-93-sub-03') as n`)
  await one(U.chair, `select ea_reassign('${g3}', 1, '${U.chair}', '팀장 휴가') as ok`)
  const pre3 = (await su<{ approver_name: string }>(`select approver_name from ea_steps where doc_id = '${g3}'`))[0]
  assert.equal(pre3.approver_name, REAL, '0093 시험 전제: 0087 판 처리자 바꾸기가 실명을 적지 않았다')
  // 4) 대표가 올린 문서
  const g4 = await draft(U.chair, '대표가 올린 문서', line(U.b))
  await one(U.chair, `select ea_submit('${g4}', 'req-93-sub-04') as n`)

  const pre = await view(U.a, g1)
  assert.ok(pre.includes(REAL), '0093 시험 전제: 0087 판 이력에 대표 실명이 서지 않는다(재현 실패)')
  const snapSteps = await su<{ doc_id: string; seq: number; acted_by: string | null; acted_at: string | null; status: string; approver_user: string | null }>(
    `select doc_id, seq, acted_by, acted_at::text, status, approver_user from ea_steps order by doc_id, seq`)
  const snapEvents = await su<{ event_id: number; actor: string | null; at: string; action: string }>(`select event_id, actor, at::text, action from ea_events order by event_id`)

  // ── 0093 적용 ──
  await applyOne(db, '0093_ea_boss_name.sql')

  // 백필: 이름 글자만
  assert.equal((await su<{ approver_name: string }>(`select approver_name from ea_steps where doc_id = '${g3}'`))[0].approver_name, '대표', '0093: 처리자 바꾸기로 선 대표 칸이 실명 그대로')
  const ev3 = (await su<{ before: { from: string }; after: { to: string } }>(`select before, after from ea_events where doc_id = '${g3}' and action = 'reassign'`))[0]
  assert.equal(ev3.after.to, '대표', '0093: 처리자 바꾸기 이력의 «to»가 실명 그대로')
  assert.equal(ev3.before.from, '김민수', '0093: 대표 아닌 이름까지 바꿨다')
  assert.deepEqual(await su(`select doc_id, seq, acted_by, acted_at::text, status, approver_user from ea_steps order by doc_id, seq`), snapSteps, '0093: 백필이 단계의 사람 · 시각 · 상태를 바꿨다')
  assert.deepEqual(await su(`select event_id, actor, at::text, action from ea_events order by event_id`), snapEvents, '0093: 백필이 이력의 사람 · 시각을 바꿨다')

  // 직원 · 후속 담당 · 대결자 화면에 실명 없음
  for (const [uid, doc, who] of [[U.a, g1, '기안자'], [U.b, g1, '앞 결재자'], [U.e, g1, '후속 담당'], [U.a, g2, '기안자(대결 문서)'], [U.d, g2, '대결자'], [U.a, g3, '기안자(바꾼 문서)'], [U.b, g4, '결재자(대표가 올린 문서)']] as const) {
    const v = await view(uid, doc)
    assert.ok(!v.includes(REAL), `0093: ${who} 화면(ea_doc)에 대표 실명 — ${v.slice(0, 300)}`)
    assert.ok(!/회장|Chairman"/.test(v.replace(/"role":"Chairman"/g, '')), `0093: ${who} 화면에 «회장»`)
  }
  const v1 = JSON.parse(await view(U.a, g1)) as { events: { action: string; actor: string }[]; steps: { seq: number; acted_by_name: string | null }[] }
  assert.equal(v1.events.find((e) => e.action === 'approve' && e.actor !== '김민수')?.actor, '대표', '0093: 대표 승인 이력이 «대표»가 아니다')
  assert.equal(v1.steps.find((s) => s.seq === 2)?.acted_by_name, '대표', '0093: 대표 단계 처리자가 «대표»가 아니다')
  assert.equal(v1.events.find((e) => e.action === 'approve' && e.actor === '김민수')?.actor, '김민수', '0093: 직원 처리자 이름까지 가렸다')
  const v2 = JSON.parse(await view(U.a, g2)) as { events: { action: string; actor: string; original: string | null }[] }
  const e2 = v2.events.find((e) => e.action === 'approve')!
  assert.deepEqual([e2.actor, e2.original], ['이대결', '대표'], '0093: 대결 이력(처리자 실명 · 원 결재자 «대표»)')
  const proxyFor = (await one<{ j: { proxy_for: { owner: string }[] } }>(U.d, `select ea_my_settings() as j`)).j.proxy_for
  assert.deepEqual(proxyFor.map((p) => p.owner), ['대표'], '0093: 대결자 설정 화면에 대표 실명')
  const todoB = await as<{ doc_id: string; drafter_name: string }>(U.b, `select doc_id, drafter_name from ea_list('todo')`)
  assert.equal(todoB.find((r) => r.doc_id === g4)?.drafter_name, '대표', '0093: 목록 기안자 칸에 대표 실명')
  assert.equal((await as(U.b, `select doc_id from ea_list('todo', '${REAL.slice(0, 2)}')`)).length, 0, '0093: 직원이 대표 실명으로 검색해 대표 문서를 골랐다')
  assert.equal((await as(U.b, `select doc_id from ea_list('todo', '대표')`)).length, 1, '0093: «대표»로 검색해 대표가 올린 문서를 못 찾는다')

  // 대표 본인 화면은 실명
  const vc = JSON.parse(await view(U.chair, g1)) as { events: { action: string; actor: string }[] }
  assert.ok(vc.events.some((e) => e.actor === REAL), '0093: 대표 본인 화면에서 자기 이름이 «대표»로 바뀌었다(실명 보여도 되는 자리)')

  // 새 처리자 바꾸기 → «대표»
  const g5 = await draft(U.a, '새로 바꾼 문서', line(U.b))
  await one(U.a, `select ea_submit('${g5}', 'req-93-sub-05') as n`)
  await one(U.chair, `select ea_reassign('${g5}', 1, '${U.chair}', '팀장 휴가') as ok`)
  assert.equal((await su<{ approver_name: string }>(`select approver_name from ea_steps where doc_id = '${g5}'`))[0].approver_name, '대표', '0093: 새 처리자 바꾸기가 실명을 적었다')
  assert.equal((await su<{ to: string }>(`select after ->> 'to' as to from ea_events where doc_id = '${g5}' and action = 'reassign'`))[0].to, '대표', '0093: 새 처리자 바꾸기 이력에 실명')
  await one(U.b, `select ea_reassign('${g5}', 1, '${U.b}', '되돌림') as ok`).then(
    () => assert.fail('0093: 직원이 처리자를 바꿨다'),
    (e: Error) => assert.match(e.message, /ea_denied/),
  )

  // 잠금: 도움 함수는 직접 못 부른다
  await as(U.a, `select ea_shown_name('${U.chair}')`).then(
    () => assert.fail('0093: 직원이 ea_shown_name을 직접 불렀다'),
    (e: Error) => assert.match(e.message, /permission denied/),
  )
  await db.close()
  return '0093 대표 이름(옛 이력 백필 — 이름 글자만 · 사람 · 시각 · 상태 그대로 · 직원 · 후속 담당 · 대결자 화면 실명 없음 · 대결 원 결재자 «대표» · 기안자 칸 · 검색 · 대표 본인 실명 · 처리자 바꾸기 «대표» · 잠금)'
}

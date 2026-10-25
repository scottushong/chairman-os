/**
 * 0087 전자결재 — check-migrations.ts가 부른다(PGlite · 전부 적용한 DB). 지시문 10번 확인 기준을 DB에서 잰다.
 *   스위치: 기본 대표만 → 회사 줄을 켜면 그 회사 전원.
 *   상신 검증: 필수 칸 · 합계 · 첨부 · 결재선(기안자 · 같은 사람 · 마지막 승인) · 전결 규칙(금액 이상 = 대표 단계).
 *   결재할 문서 = 지금 내 차례만 · 결재 예정 따로 · 참조자 · 예정 결재자 · 남은 승인 못 함 · 반려는 사유 필수 · 중간 승인 ≠ 승인 완료.
 *   같은 요청 두 번 = 한 번 · 같은 단계 다른 요청 = 거부 · 회수(처리 전만) · 재상신(새 판 · 처음부터 · 원문서 그대로) · 대결(기록 둘).
 *   후속 처리 한 번 · 완료해도 문서 상태 그대로 · 후속 담당자는 승인 뒤에만 읽음 · 첨부 버킷 읽기 = 문서 읽기.
 *   건수 = 목록(홈 위젯과 같은 함수) · 권한 없는 사람은 목록 · 상세 · 알림 어디에도 제목 없음 · anon 잠금 · 관리자(대표)만 양식 · 규칙.
 */
import assert from 'node:assert/strict'

import { PGlite } from '@electric-sql/pglite'
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm'

import { applyAll } from './pglite'

const U = {
  chair: '00000000-0000-0000-0000-0000000087a1',
  a: '00000000-0000-0000-0000-0000000087a2', // 기안(생산팀 사원)
  b: '00000000-0000-0000-0000-0000000087a3', // 검토(팀장)
  c: '00000000-0000-0000-0000-0000000087a4', // 참조
  d: '00000000-0000-0000-0000-0000000087a5', // B의 대결자
  e: '00000000-0000-0000-0000-0000000087a6', // 후속 담당(구매)
  x: '00000000-0000-0000-0000-0000000087a7', // 아무 관계 없는 같은 회사 직원
  agent: '00000000-0000-0000-0000-0000000087a8',
}

export async function approvalsDb(): Promise<string> {
  const db = new PGlite({ extensions: { pg_trgm } })
  await applyAll(db)
  await db.exec(`alter table user_profiles disable trigger user_profiles_draft_grant`)
  await db.exec(`
    grant usage on schema public, auth to authenticated, anon;
    insert into auth.users values ${Object.values(U).map((id, i) => `('${id}', 'e${i}@x')`).join(', ')};
    insert into user_profiles (user_id, role, display_name, max_security_class, team_id) values
      ('${U.chair}', 'Chairman', '홍대표', 'Vault', null), ('${U.a}', 'Member', '박지훈', 'Normal', 'team_dy_production'),
      ('${U.b}', 'TeamLead', '김민수', 'Normal', 'team_dy_production'), ('${U.c}', 'Member', '정하늘', 'Normal', null),
      ('${U.d}', 'Member', '이대결', 'Normal', null), ('${U.e}', 'Member', '최구매', 'Normal', null),
      ('${U.x}', 'Member', '남남', 'Normal', 'team_dy_production'), ('${U.agent}', 'AIAgent', 'agent', 'Restricted', null);
    insert into user_business_access select u, 'biz_dy' from unnest(array['${U.a}', '${U.b}', '${U.c}', '${U.d}', '${U.e}', '${U.x}', '${U.agent}']::uuid[]) u;
  `)

  const as = async <T>(uid: string | null, sql: string, role: 'authenticated' | 'anon' = 'authenticated'): Promise<T[] | string> => {
    await db.exec(`begin; select set_config('request.jwt.claim.sub', '${uid ?? ''}', true); set local role ${role};`)
    try {
      const r = await db.query<T>(sql)
      await db.exec('commit')
      return r.rows
    } catch (e) {
      await db.exec('rollback')
      return String((e as Error).message)
    }
  }
  const one = async <T>(uid: string, sql: string): Promise<T> => {
    const r = await as<T>(uid, sql)
    assert.ok(Array.isArray(r), `0087: 거부되면 안 되는 호출이 거부됐다 — ${String(r).slice(0, 200)} · ${sql.slice(0, 140)}`)
    return (r as T[])[0]
  }
  const deny = async (uid: string | null, sql: string, re: RegExp, why: string, role: 'authenticated' | 'anon' = 'authenticated') => {
    const r = await as(uid, sql, role)
    assert.ok(typeof r === 'string' && re.test(r), `0087: ${why} — ${typeof r === 'string' ? r.slice(0, 160) : JSON.stringify(r).slice(0, 160)}`)
  }
  const su = async <T>(sql: string) => (await db.query<T>(sql)).rows
  const list = async (uid: string, box: string) => (await as<{ doc_id: string; status: string; my_result: string; as_proxy: boolean; title: string }>(uid, `select * from ea_list('${box}')`)) as { doc_id: string; status: string; my_result: string; as_proxy: boolean; title: string }[]
  const counts = async (uid: string) => (await one<{ c: Record<string, number> }>(uid, `select ea_counts() as c`)).c
  const line = (...steps: string[]) => JSON.stringify(steps.map((s) => (s === 'CEO' ? { role: 'Chairman', kind: 'approve' } : s.startsWith('agree:') ? { user_id: s.slice(6), kind: 'agree' } : { user_id: s, kind: 'approve' })))
  const draft = (uid: string, form: string, title: string, fields: object, ln: string, o: { refs?: string; fu?: string; doc?: string; due?: string } = {}) =>
    one<{ id: string }>(uid, `select ea_save_draft(${o.doc ? `'${o.doc}'` : 'null'}, 'biz_dy', '${form}', '${title}', '신청 내용입니다', '${JSON.stringify(fields)}'::jsonb,
       '${ln}'::jsonb, '${o.refs ?? '[]'}'::jsonb, ${o.due ? `'${o.due}'` : 'null'}, null, ${o.fu ? `'${o.fu}'` : 'null'}, null) as id`)
  const attach = async (uid: string, doc: string, name = 'quote.pdf') => {
    await one(uid, `insert into storage.objects (bucket_id, name, owner) values ('ea-files', '${doc}/${name}', '${uid}') returning id`)
    return one<{ id: string }>(uid, `select ea_file_add('${doc}', '${doc}/${name}', '견적서.pdf', 1000, 'application/pdf') as id`)
  }
  const act = (uid: string, doc: string, seq: number, action: 'approve' | 'reject', comment: string | null, req: string) =>
    `select ea_act('${doc}', ${seq}, '${action}', ${comment === null ? 'null' : `'${comment}'`}, '${req}') as s`
  const purchase = { item: '소모품', qty: '10', vendor: '가나상사', purpose: '포장기 유지보수', supply: '320000', vat: '32000', total: '352000' }

  // ── 스위치: 기본 대표만 ──
  await deny(U.a, `select ea_save_draft(null, 'biz_dy', 'general', 't', 'b', '{}'::jsonb, '[]'::jsonb, '[]'::jsonb, null, null, null, null)`, /ea_denied/, '스위치가 꺼진 회사(기본 대표만)에서 직원이 작성했다')
  assert.equal((await su<{ n: number }>(`select count(*)::int n from ea_forms where form_key <> 'investment'`))[0].n, 6, '초기 양식 여섯이 아니다(0096 «투자 승인»은 따로)')
  await one(U.chair, `select feature_switch_set('approvals', 'biz_dy', true, 'all', '시험 — DY 전원') as x`)

  // ── 상신 검증 ──
  const d1 = (await draft(U.a, 'purchase', '포장기 소모품 구매품의', { ...purchase, total: '350000' }, line(U.b, 'CEO'), { refs: JSON.stringify([{ user_id: U.c, kind: 'cc' }]), fu: U.e })).id
  assert.equal((await list(U.b, 'todo')).length, 0, '임시저장이 결재자에게 보인다')
  assert.equal(await one<{ j: unknown }>(U.b, `select ea_doc('${d1}') as j`).then((r) => r.j), null, '임시저장 상세가 결재자에게 열린다')
  await deny(U.a, `select ea_submit('${d1}', 'req-sub-0001')`, /ea_total/, '공급가 + 부가세 ≠ 합계가 상신됐다')
  await draft(U.a, 'purchase', '포장기 소모품 구매품의', purchase, line(U.b, 'CEO'), { doc: d1, fu: U.e })
  await deny(U.a, `select ea_submit('${d1}', 'req-sub-0002')`, /ea_attachment/, '첨부 필수 양식이 첨부 없이 상신됐다')
  await attach(U.a, d1)
  await draft(U.a, 'purchase', '포장기 소모품 구매품의', purchase, line(U.a, 'CEO'), { doc: d1, fu: U.e, refs: JSON.stringify([{ user_id: U.c, kind: 'cc' }]) })
  await deny(U.a, `select ea_submit('${d1}', 'req-sub-0003')`, /ea_line/, '기안자가 자기 결재선에 섰다')
  await draft(U.a, 'purchase', '포장기 소모품 구매품의', purchase, line(U.b, 'agree:' + U.c), { doc: d1, fu: U.e })
  await deny(U.a, `select ea_submit('${d1}', 'req-sub-0004')`, /ea_line/, '마지막 단계가 합의인데 상신됐다')
  await draft(U.a, 'purchase', '포장기 소모품 구매품의', { ...purchase, supply: '20000000', vat: '2000000', total: '22000000' }, line(U.b), { doc: d1, fu: U.e })
  await deny(U.a, `select ea_submit('${d1}', 'req-sub-0005')`, /ea_line_rule/, '1천만 원 이상 구매가 대표 단계 없이 상신됐다(전결 규칙)')
  await draft(U.a, 'purchase', '포장기 소모품 구매품의', purchase, line(U.b, 'CEO'), { doc: d1, fu: U.e, refs: JSON.stringify([{ user_id: U.c, kind: 'cc' }]), due: '2000-01-01' })
  const no1 = await one<{ n: string }>(U.a, `select ea_submit('${d1}', 'req-sub-0006') as n`)
  assert.match(no1.n, /^GW-\d{4}-\d{4}$/, '문서번호 모양')
  await deny(U.a, `select ea_save_draft('${d1}', 'biz_dy', 'purchase', '바꿈', 'x', '{}'::jsonb, '[]'::jsonb, '[]'::jsonb, null, null, null, null)`, /ea_not_draft/, '상신 뒤 내용을 덮어썼다')
  await deny(U.a, `insert into storage.objects (bucket_id, name, owner) values ('ea-files', '${d1}/late.pdf', '${U.a}')`, /row-level security|policy/, '상신 뒤 첨부를 더 올렸다')

  // ── 결재할 문서 = 지금 내 차례만 ──
  assert.deepEqual((await list(U.b, 'todo')).map((r) => r.doc_id), [d1], 'B의 결재할 문서')
  assert.equal((await list(U.chair, 'todo')).length, 0, '대표(2단계)에게 아직 차례가 아닌 문서가 결재할 문서에 보인다')
  assert.deepEqual((await list(U.chair, 'planned')).map((r) => r.doc_id), [d1], '대표의 결재 예정')
  assert.deepEqual((await list(U.c, 'refs')).map((r) => r.doc_id), [d1], '참조자의 참조 · 공유')
  assert.equal((await list(U.c, 'todo')).length, 0, '참조자에게 결재할 문서가 생겼다')
  assert.equal((await list(U.x, 'todo')).length + (await list(U.x, 'refs')).length + (await list(U.x, 'planned')).length, 0, '관계없는 직원에게 문서가 보인다')
  assert.equal(await one<{ j: unknown }>(U.x, `select ea_doc('${d1}') as j`).then((r) => r.j), null, '관계없는 직원이 상세를 읽는다')
  assert.deepEqual(await counts(U.b), { todo: 1, planned: 0, mine: 0, drafts: 0, history: 0, refs: 0, followups: 0 }, 'B 건수')
  const listOverdue = await one<{ overdue: boolean }>(U.b, `select overdue from ea_list('todo')`)
  assert.equal(listOverdue.overdue, true, '기한이 지난 문서에 기한 초과가 없다')

  // ── 처리 권한 ──
  await deny(U.chair, act(U.chair, d1, 2, 'approve', null, 'req-act-0001'), /ea_step_not_waiting/, '예정 결재자(대표)가 앞질러 승인했다')
  await deny(U.chair, act(U.chair, d1, 1, 'approve', null, 'req-act-0002'), /ea_not_your_turn/, '대표가 남의 단계를 승인했다')
  await deny(U.c, act(U.c, d1, 1, 'approve', null, 'req-act-0003'), /ea_not_your_turn/, '참조자가 승인했다')
  await deny(U.x, act(U.x, d1, 1, 'approve', null, 'req-act-0004'), /ea_not_your_turn|ea_denied/, '관계없는 직원이 승인했다')
  await deny(U.b, act(U.b, d1, 1, 'reject', '', 'req-act-0005'), /ea_reason/, '사유 없이 반려됐다')
  await deny(U.agent, act(U.agent, d1, 1, 'approve', null, 'req-act-0006'), /ea_denied/, 'AI Agent가 결재했다')

  // ── 중간 승인 · 같은 요청 두 번 · 두 탭 ──
  assert.equal((await one<{ s: string }>(U.b, act(U.b, d1, 1, 'approve', '확인했습니다', 'req-act-0010'))).s, 'in_progress', '중간 승인 뒤 문서가 진행 중이 아니다')
  assert.equal((await one<{ s: string }>(U.b, act(U.b, d1, 1, 'approve', '확인했습니다', 'req-act-0010'))).s, 'in_progress', '같은 요청 재시도가 다른 결과')
  await deny(U.b, act(U.b, d1, 1, 'approve', null, 'req-act-0011'), /ea_step_not_waiting/, '같은 단계를 두 번째 탭에서 또 승인했다')
  await deny(U.b, act(U.b, d1, 1, 'reject', '다른 탭에서 반려', 'req-act-0012'), /ea_step_not_waiting/, '승인한 단계를 다른 탭에서 반려했다')
  assert.equal((await su<{ n: number }>(`select count(*)::int n from ea_events where doc_id = '${d1}' and action = 'approve'`))[0].n, 1, '승인 이력이 한 줄이 아니다')
  assert.equal((await su<{ n: number }>(`select count(*)::int n from notifications where user_id = '${U.chair}' and link like '%${d1}%'`))[0].n, 1, '대표에게 결재 요청 알림이 한 번이 아니다(재시도 중복)')
  const hist = (await list(U.b, 'history'))[0]
  assert.equal(hist.my_result, 'approved', 'B 처리 이력의 내 결과')
  assert.equal(hist.status, 'in_progress', '중간 승인자의 처리 이력에 문서가 승인 완료로 보인다')
  await deny(U.a, `select ea_withdraw('${d1}', 'req-wd-0001')`, /ea_withdraw_acted/, '처리 이력이 있는 문서가 회수됐다')
  assert.deepEqual((await list(U.chair, 'todo')).map((r) => r.doc_id), [d1], '중간 승인 뒤 다음 담당자(대표)에게 넘어가지 않았다')

  // ── 반려 → 재상신 → 승인 → 후속 처리 ──
  assert.equal((await one<{ s: string }>(U.chair, act(U.chair, d1, 2, 'reject', '견적 두 곳 비교 필요', 'req-act-0020'))).s, 'rejected', '반려')
  assert.equal((await su<{ n: number }>(`select count(*)::int n from notifications where user_id = '${U.a}' and title like '반려:%'`))[0].n, 1, '기안자에게 반려 알림이 없다')
  assert.equal((await su<{ n: number }>(`select count(*)::int n from ea_followups where doc_id = '${d1}'`))[0].n, 0, '반려 문서에 후속 처리가 생겼다')
  const v2 = (await one<{ id: string }>(U.a, `select ea_resubmit('${d1}') as id`)).id
  assert.notEqual(v2, d1, '재상신이 새 판이 아니다')
  const orig = (await su<{ status: string; title: string }>(`select status, title from ea_docs where doc_id = '${d1}'`))[0]
  assert.equal(orig.status, 'rejected', '재상신이 원문서 상태를 바꿨다')
  assert.equal((await su<{ n: number }>(`select count(*)::int n from ea_files where doc_id = '${v2}'`))[0].n, 1, '새 판에 첨부가 이어지지 않았다')
  const v2no = await one<{ n: string }>(U.a, `select ea_submit('${v2}', 'req-sub-0010') as n`)
  assert.notEqual(v2no.n, no1.n, '새 판의 문서번호가 원문서와 같다')
  const steps2 = await su<{ seq: number; status: string }>(`select seq, status from ea_steps where doc_id = '${v2}' order by seq`)
  assert.deepEqual(steps2, [{ seq: 1, status: 'waiting' }, { seq: 2, status: 'planned' }], '재상신이 처음부터 시작하지 않았다(이전 승인 승계)')
  const v2doc = (await one<{ j: { versions: { doc_id: string }[]; doc: { version: number } } }>(U.b, `select ea_doc('${v2}') as j`)).j
  assert.equal(v2doc.doc.version, 2, '새 판 번호')
  assert.deepEqual(v2doc.versions.map((v) => v.doc_id), [d1], '새 판이 원문서와 이어지지 않았다')
  await one(U.b, act(U.b, v2, 1, 'approve', null, 'req-act-0030'))
  assert.equal(await one<{ j: unknown }>(U.e, `select ea_doc('${v2}') as j`).then((r) => r.j), null, '후속 담당자가 승인 전 문서를 읽는다')
  assert.equal((await one<{ s: string }>(U.chair, act(U.chair, v2, 2, 'approve', null, 'req-act-0031'))).s, 'approved', '최종 승인')
  assert.equal((await one<{ s: string }>(U.chair, act(U.chair, v2, 2, 'approve', null, 'req-act-0031'))).s, 'approved', '최종 승인 재시도')
  assert.equal((await su<{ n: number }>(`select count(*)::int n from ea_followups where doc_id = '${v2}'`))[0].n, 1, '후속 처리가 한 번이 아니다')
  assert.deepEqual((await list(U.e, 'followups')).map((r) => r.doc_id), [v2], '후속 담당자의 후속 처리')
  assert.ok((await one<{ j: unknown }>(U.e, `select ea_doc('${v2}') as j`)).j, '후속 담당자가 승인 뒤 문서를 못 읽는다')
  await deny(U.b, `select ea_followup_update('${v2}', 'done', '발주 완료', 'X-1', 'req-fu-0001')`, /ea_denied/, '후속 담당자가 아닌 사람이 후속 처리를 끝냈다')
  await deny(U.e, `select ea_followup_update('${v2}', 'done', '', null, 'req-fu-0002')`, /ea_reason/, '결과 없이 후속 처리가 완료됐다')
  await one(U.e, `select ea_followup_update('${v2}', 'doing', null, null, 'req-fu-0003') as s`)
  await one(U.e, `select ea_followup_update('${v2}', 'done', '발주서 PO-77 발송', '20261019-1', 'req-fu-0004') as s`)
  const fu = (await su<{ status: string; ecount_slip: string; done_by: string }>(`select status, ecount_slip, done_by from ea_followups where doc_id = '${v2}'`))[0]
  assert.deepEqual(fu, { status: 'done', ecount_slip: '20261019-1', done_by: U.e }, '후속 처리 완료 기록')
  assert.equal((await su<{ status: string }>(`select status from ea_docs where doc_id = '${v2}'`))[0].status, 'approved', '후속 처리 완료가 문서 상태를 바꿨다')
  await deny(U.e, `select ea_followup_update('${v2}', 'doing', null, null, 'req-fu-0005')`, /ea_followup_done/, '끝난 후속 처리를 되돌렸다')

  // ── 첨부 읽기 = 문서 읽기 ──
  const objRead = async (uid: string) => ((await as<{ n: number }>(uid, `select count(*)::int n from storage.objects where bucket_id = 'ea-files'`)) as { n: number }[])[0].n
  assert.equal(await objRead(U.x), 0, '관계없는 직원이 첨부 객체를 본다')
  assert.equal(await objRead(U.c), 1, '참조자가 첨부를 못 본다')
  assert.equal(await objRead(U.e), 1, '후속 담당자가 승인된 문서 첨부를 못 본다')

  // ── 참조: 열람과 확인 ──
  const refs0 = (await counts(U.c)).refs
  assert.equal(refs0, 2, '참조 미확인(원문서 · 새 판)')
  await one(U.c, `select ea_ref_mark('${d1}', false) as ok`)
  assert.equal((await counts(U.c)).refs, refs0, '열어 보기만 했는데 미확인 건수가 줄었다')
  await one(U.c, `select ea_ref_mark('${d1}', true) as ok`)
  assert.equal((await counts(U.c)).refs, refs0 - 1, '확인 뒤 미확인 건수가 그대로다')
  await deny(U.x, `select ea_ref_mark('${d1}', true)`, /ea_denied/, '관계없는 직원이 확인을 눌렀다')

  // ── 대결 ──
  const today = (await su<{ t: string }>(`select ((now() at time zone 'Asia/Seoul')::date)::text t`))[0].t
  await one(U.b, `select ea_proxy_save('${U.d}', '${today}', '${today}', array['general'], null) as id`)
  const g = (await draft(U.a, 'general', '사무용품 정리 일반품의', {}, line(U.b))).id
  await one(U.a, `select ea_submit('${g}', 'req-sub-0020') as n`)
  assert.deepEqual((await list(U.d, 'todo')).map((r) => [r.doc_id, r.as_proxy]), [[g, true]], '대결자의 결재할 문서에 대결 문서가 없다')
  assert.equal((await list(U.d, 'todo')).some((r) => r.doc_id === v2), false, '대결 범위(양식) 밖 문서가 대결자에게 보인다')
  await one(U.d, act(U.d, g, 1, 'approve', '대결 승인', 'req-act-0040'))
  const gs = (await su<{ acted_by: string; acted_as_proxy: boolean; approver_user: string }>(`select acted_by, acted_as_proxy, approver_user from ea_steps where doc_id = '${g}'`))[0]
  assert.deepEqual(gs, { acted_by: U.d, acted_as_proxy: true, approver_user: U.b }, '대결 기록(원 결재자 · 실제 처리자)')
  assert.equal((await su<{ original_user: string }>(`select original_user from ea_events where doc_id = '${g}' and action = 'approve'`))[0].original_user, U.b, '이력에 원 결재자가 없다')

  // ── 회수: 처리 전에만 · 기안자만 · 기록은 남는다 ──
  const w = (await draft(U.a, 'general', '회수 시험 일반품의', {}, line(U.b))).id
  await one(U.a, `select ea_submit('${w}', 'req-sub-0030') as n`)
  await deny(U.x, `select ea_withdraw('${w}', 'req-wd-0010')`, /ea_denied/, '기안자 아닌 사람이 회수했다')
  await one(U.a, `select ea_withdraw('${w}', 'req-wd-0011') as ok`)
  assert.equal((await su<{ status: string }>(`select status from ea_docs where doc_id = '${w}'`))[0].status, 'withdrawn', '회수 상태')
  assert.equal((await su<{ n: number }>(`select count(*)::int n from ea_events where doc_id = '${w}' and action in ('submit', 'withdraw')`))[0].n, 2, '회수가 상신 기록을 지웠다')
  assert.equal((await list(U.b, 'todo')).some((r) => r.doc_id === w), false, '회수한 문서가 결재할 문서에 남았다')

  // ── 건수 = 목록(홈 위젯 · 메뉴 같은 함수) ──
  for (const uid of [U.a, U.b, U.chair, U.c, U.e]) {
    const c = await counts(uid)
    assert.equal(c.todo, (await list(uid, 'todo')).length, '결재할 문서 건수 ≠ 목록')
    assert.equal(c.drafts, (await list(uid, 'drafts')).length, '임시저장 건수 ≠ 목록')
  }

  // ── 알림: 권한 없는 사람에게 제목이 가지 않음 · 대표 말 ──
  assert.equal((await su<{ n: number }>(`select count(*)::int n from notifications where user_id = '${U.x}'`))[0].n, 0, '관계없는 직원에게 알림이 갔다')
  assert.equal((await su<{ n: number }>(`select count(*)::int n from notifications where link like '/e-approval%' and (title like '%회장%' or title like '%Chairman%')`))[0].n, 0, '알림에 «회장»')

  // ── 관리자 ──
  await deny(U.b, `select ea_form_save('general', '일반품의', '[]'::jsonb, false, null, false, null, true)`, /ea_denied/, '직원이 양식을 바꿨다')
  await deny(U.b, `select ea_line_rule_save(null, 'general', null, 0, true, null, true)`, /ea_denied/, '직원이 결재선 규칙을 바꿨다')
  assert.equal((await one<{ v: number }>(U.chair, `select ea_form_save('purchase', '구매품의', '[{"key":"item","label":"품목","type":"text","required":true}]'::jsonb, true, '구매 담당자 발주', true, null, true) as v`)).v, 2, '양식 버전이 오르지 않았다')
  assert.equal((await su<{ v: number }>(`select (form_snapshot ->> 'version')::int v from ea_docs where doc_id = '${v2}'`))[0].v, 1, '양식을 바꿨더니 상신된 문서의 양식 판이 바뀌었다')
  assert.equal(await one<{ j: unknown }>(U.chair, `select ea_doc('${w}') as j`).then((r) => r.j), null, '관리자(대표)가 결재선에 없는 문서를 읽는다')

  // ── 사람 고르기 ──
  const people = (await as<{ user_id: string }>(U.a, `select user_id from ea_people()`)) as { user_id: string }[]
  assert.ok(people.some((p) => p.user_id === U.b) && !people.some((p) => p.user_id === U.chair || p.user_id === U.agent || p.user_id === U.a), '사람 고르기 목록(같은 회사 · 대표 · 시스템 계정 · 본인 빼고)')

  // ── 잠금 ──
  await deny(null, `select * from ea_list('todo')`, /permission denied/, 'anon이 목록을 불렀다', 'anon')
  await deny(U.a, `select * from ea_docs`, /permission denied/, '표를 직접 읽었다')
  await deny(U.a, `update ea_steps set status = 'approved'`, /permission denied/, '단계를 직접 고쳤다')
  await deny(U.a, `select ea_notify('${U.a}', 'x', '${d1}', 'todo')`, /permission denied/, '알림 도움 함수를 직접 불렀다')

  // 임시저장 지우기
  const dd = (await draft(U.a, 'general', '지울 초안', {}, '[]')).id
  await deny(U.b, `select ea_delete_draft('${dd}')`, /ea_denied/, '남의 임시저장을 지웠다')
  await one(U.a, `select ea_delete_draft('${dd}') as ok`)
  await deny(U.a, `select ea_delete_draft('${v2}')`, /ea_not_draft/, '상신한 문서를 지웠다')

  return '0087 전자결재(스위치 · 상신 검증 · 내 차례만 · 예정 · 참조 · 반려 사유 · 중간 승인 · 재시도 · 두 탭 · 회수 · 재상신 · 대결 · 후속 한 번 · 첨부 권한 · 건수 = 목록 · 알림 · 관리자 · anon)'
}

/**
 * 0083 공식 결산 v2 — check-migrations.ts가 부른다(PGlite · 전부 적용한 DB).
 *   증빙: 링크 없이 올린 원본(fin-official-evidence)만으로 저장 · 버킷에 없는 파일 · 다른 회사 파일 거부 · 둘 다 없으면 거부.
 *   버킷: 장부를 쓰는 사람만 올림 · 읽는 사람만 봄 · 지우기 · 옮기기 없음 · 비공개.
 *   닫히지 않은 결산: 이유 없으면 거부 · 회사 대표(마감 권한 없음)는 거부 · 대표(Chairman)는 이유와 함께 저장(칸 · 감사에 남음).
 *   같은 해: p_replace 없이 거부 · 있으면 supersede. 같은 계정 두 줄 · 없는 계정 → 말로 거부.
 *   학습: 저장하면 official_account_map에 앉고 · 다시 저장하면 hits가 늘고 · 바꾸면 1로 · 남의 계정 코드는 버린다 · 직접 쓰기 없음.
 *   옛 official_statement_save는 그대로 돈다(앱이 DB보다 먼저 나가도).
 */
import assert from 'node:assert/strict'

import { PGlite } from '@electric-sql/pglite'
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm'

import { applyAll } from './pglite'

const U = {
  chair: '00000000-0000-0000-0000-0000000083a1',
  ceo: '00000000-0000-0000-0000-0000000083a2', // DY 회사 대표 — can_keep_books(biz_dy) · 마감 권한 없음
  member: '00000000-0000-0000-0000-0000000083a3',
  agent: '00000000-0000-0000-0000-0000000083a4',
}
const SHA = 'a'.repeat(64)
const FILE = `biz_dy/${SHA}.pdf`

export async function officialV2(): Promise<string> {
  const db = new PGlite({ extensions: { pg_trgm } })
  await applyAll(db)
  await db.exec(`alter table user_profiles disable trigger user_profiles_draft_grant`)
  await db.exec(`
    grant usage on schema public, auth to authenticated, anon;
    insert into auth.users values ('${U.chair}', 'o1@x'), ('${U.ceo}', 'o2@x'), ('${U.member}', 'o3@x'), ('${U.agent}', 'o4@x');
    insert into user_profiles (user_id, role, display_name, max_security_class, team_id) values
      ('${U.chair}', 'Chairman', 'ch', 'Vault', null), ('${U.ceo}', 'BusinessCEO', 'dy대표', 'Restricted', null),
      ('${U.member}', 'Member', '직원', 'Normal', 'team_dy_production'), ('${U.agent}', 'AIAgent', 'agent', 'Normal', null);
    insert into user_business_access values ('${U.ceo}', 'biz_dy'), ('${U.member}', 'biz_dy');
    insert into accounts (business_id, account_code, name, category, section, cash_flow, source, fetched_at) values
      ('biz_dy', '1030', '보통예금', 'asset', 'cash', null, 'ecount', now()),
      ('biz_dy', '2510', '외상매입금', 'liability', 'payable', 'operating', 'ecount', now()),
      ('biz_dy', '3310', '자본금', 'equity', 'equity', 'financing', 'ecount', now()),
      ('biz_dy', '4040', '제품매출', 'revenue', 'revenue', 'operating', 'ecount', now()),
      ('biz_dy', '8160', '수도광열비', 'other', 'sga', 'operating', 'ecount', now()),
      ('biz_vana', '9999', '남의계정', 'other', 'sga', 'operating', 'manual', now())
    on conflict do nothing;
  `)
  // DY는 표준 계정과목표를 받지 않는다(0016) — 위 다섯 줄 말고는 없어야 한다(운영 «맞춘 계정이 없습니다»의 한 갈래).
  const dyAccounts = (await db.query<{ n: number }>(`select count(*)::int n from accounts where business_id = 'biz_dy'`)).rows[0].n
  assert.equal(dyAccounts, 5, `0083: 마이그레이션만으로 DY 계정이 ${dyAccounts - 5}개 더 생겼다(DY는 ECOUNT 계정 올리기로만 받는다)`)

  const as = async <T>(uid: string, sql: string): Promise<T[] | string> => {
    await db.exec(`begin; select set_config('request.jwt.claim.sub', '${uid}', true); set local role authenticated;`)
    try {
      const r = await db.query<T>(sql)
      await db.exec('commit')
      return r.rows
    } catch (e) {
      await db.exec('rollback')
      return String((e as Error).message)
    }
  }
  const put = (uid: string, name: string) => as(uid, `insert into storage.objects (bucket_id, name, owner) values ('fin-official-evidence', '${name}', '${uid}') returning 1`)
  const lines = (cash: number, pay: number, eq: number, extra = '') =>
    `'[{"account_code":"1030","amount":${cash}},{"account_code":"2510","amount":${pay}},{"account_code":"3310","amount":${eq}},{"account_code":"4040","amount":-500},{"account_code":"8160","amount":120}${extra}]'::jsonb`
  const save = (uid: string, o: { year?: string; url?: string | null; file?: string | null; l?: string; reason?: string | null; replace?: boolean; learn?: string }) =>
    as<{ id: number }>(
      uid,
      `select official_statement_save_v2('biz_dy', 'year', '${o.year ?? '2025'}', ${o.url ? `'${o.url}'` : 'null'}, ${o.file ? `'${o.file}'` : 'null'}, '세무사 2025',
        ${o.l ?? lines(1000, -400, -600)}, ${o.reason ? `'${o.reason}'` : 'null'}, ${o.replace ? 'true' : 'false'}, ${o.learn ?? `'[]'::jsonb`}) as id`,
    )

  // 버킷
  assert.equal((await db.query<{ public: boolean }>(`select public from storage.buckets where id = 'fin-official-evidence'`)).rows[0]?.public, false, '0083: 증빙 버킷이 비공개가 아니다')
  assert.equal(typeof (await put(U.member, FILE)), 'string', '0083: 장부 권한 없는 직원이 증빙을 올렸다')
  assert.equal(typeof (await put(U.agent, FILE)), 'string', '0083: AI Agent가 증빙을 올렸다')
  assert.equal(typeof (await put(U.ceo, `biz_vana/${SHA}.pdf`)), 'string', '0083: 다른 회사 증빙을 올렸다')
  assert.equal(typeof (await put(U.ceo, `biz_dy/x.pdf`)), 'string', '0083: 경로 모양이 틀린 증빙을 받았다')
  assert.deepEqual(await put(U.ceo, FILE), [{ '?column?': 1 }], '0083: 회사 대표가 증빙을 못 올린다')
  assert.equal(((await as(U.member, `select 1 from storage.objects where name = '${FILE}'`)) as unknown[]).length, 0, '0083: 직원이 증빙을 본다')
  assert.equal(((await as(U.chair, `select 1 from storage.objects where name = '${FILE}'`)) as unknown[]).length, 1, '0083: 대표가 증빙을 못 본다')
  assert.equal(((await as(U.ceo, `delete from storage.objects where name = '${FILE}' returning 1`)) as unknown[]).length, 0, '0083: 증빙을 지웠다')
  assert.equal(((await as(U.ceo, `update storage.objects set name = 'biz_dy/${'b'.repeat(64)}.pdf' where name = '${FILE}' returning 1`)) as unknown[]).length, 0, '0083: 증빙을 옮겼다')

  // 증빙
  assert.match(String(await save(U.ceo, {})), /official_evidence_missing/, '0083: 증빙 없이 저장됐다')
  assert.match(String(await save(U.ceo, { file: `biz_dy/${'c'.repeat(64)}.pdf` })), /official_evidence_file_missing/, '0083: 버킷에 없는 파일을 증빙으로 받았다')
  assert.match(String(await save(U.ceo, { file: `biz_vana/${SHA}.pdf` })), /official_evidence_file_missing/, '0083: 다른 회사 파일을 증빙으로 받았다')
  assert.match(String(await save(U.member, { file: FILE })), /books_forbidden/, '0083: 직원이 결산을 저장했다')
  assert.match(String(await save(U.agent, { file: FILE })), /books_forbidden/, '0083: AI Agent가 결산을 저장했다')
  assert.match(String(await save(U.ceo, { file: FILE, l: lines(1000, -400, -600, ',{"account_code":"1030","amount":1}') })), /official_line_duplicate/, '0083: 같은 계정 두 줄이 23505 말고 말로 거부되지 않는다')
  assert.match(String(await save(U.ceo, { file: FILE, l: lines(1000, -400, -600, ',{"account_code":"9999","amount":1}') })), /official_line_unknown_account/, '0083: 다른 회사 계정을 받았다')

  const learn = `'[{"std_key":"sga:전기료","account_code":"8160"},{"std_key":"asset:현금및현금성자산","account_code":"1030"},{"std_key":"sga:남의","account_code":"9999"},{"std_key":"BAD KEY","account_code":"1030"}]'::jsonb`
  const first = await save(U.ceo, { file: FILE, learn })
  assert.ok(Array.isArray(first), `0083: 링크 없이 올린 원본만으로 저장되지 않는다 — ${first}`)
  const row = (await db.query<{ evidence_url: string | null; evidence_file: string; unbalanced_reason: string | null }>(`select evidence_url, evidence_file, unbalanced_reason from official_statements where business_id = 'biz_dy' and superseded_at is null`)).rows
  assert.deepEqual(row, [{ evidence_url: null, evidence_file: FILE, unbalanced_reason: null }], '0083: 증빙 파일 · 이유 칸이 틀리게 앉았다')
  const map = async () => (await db.query<{ std_key: string; account_code: string; hits: number }>(`select std_key, account_code, hits from official_account_map where business_id = 'biz_dy' order by std_key`)).rows
  assert.deepEqual(await map(), [
    { std_key: 'asset:현금및현금성자산', account_code: '1030', hits: 1 },
    { std_key: 'sga:전기료', account_code: '8160', hits: 1 },
  ], '0083: 학습 표가 틀리다(남의 계정 · 모양 틀린 키는 버려야)')
  assert.equal(((await as(U.ceo, `select 1 from official_account_map`)) as unknown[]).length, 2, '0083: 장부를 쓰는 사람이 학습 표를 못 읽는다')
  assert.equal(((await as(U.member, `select 1 from official_account_map`)) as unknown[]).length, 0, '0083: 직원이 학습 표를 읽는다')
  assert.equal(typeof (await as(U.chair, `insert into official_account_map (business_id, std_key, account_code) values ('biz_dy', 'sga:x', '8160') returning 1`)), 'string', '0083: 학습 표에 직접 썼다')

  // 같은 해 — 바꾸기 확인
  assert.match(String(await save(U.ceo, { file: FILE })), /official_exists/, '0083: 같은 해 확정을 확인 없이 덮었다')
  const replaced = await save(U.ceo, { url: 'https://drive.example/2025.pdf', replace: true, learn: `'[{"std_key":"sga:전기료","account_code":"8160"}]'::jsonb` })
  assert.ok(Array.isArray(replaced), `0083: «바꾸기»로 저장되지 않는다 — ${replaced}`)
  assert.equal((await db.query<{ n: number }>(`select count(*)::int n from official_statements where business_id = 'biz_dy' and period_key = '2025' and superseded_at is null`)).rows[0].n, 1, '0083: 같은 해 활성 결산이 하나가 아니다')
  assert.equal((await map()).find((m) => m.std_key === 'sga:전기료')?.hits, 2, '0083: 같은 맞춤을 다시 저장해도 hits가 늘지 않는다')

  // 닫히지 않은 결산
  const off = lines(1000, -400, -590)
  assert.match(String(await save(U.chair, { year: '2024', file: FILE, l: off })), /official_unbalanced/, '0083: 닫히지 않은 결산이 이유 없이 저장됐다')
  assert.match(String(await save(U.ceo, { year: '2024', file: FILE, l: off, reason: '세무사 반올림 차이 10원' })), /official_unbalanced_forbidden/, '0083: 마감 권한 없는 회사 대표가 닫히지 않은 결산을 저장했다')
  const forced = await save(U.chair, { year: '2024', file: FILE, l: off, reason: '세무사 반올림 차이 10원' })
  assert.ok(Array.isArray(forced), `0083: 대표가 이유를 적어도 닫히지 않은 결산을 못 저장한다 — ${forced}`)
  const r24 = (await db.query<{ unbalanced_reason: string; note: string }>(`select s.unbalanced_reason, a.note from official_statements s join audit_log a on a.entity_table = 'official_statements' and a.entity_id = s.id::text where s.period_key = '2024' and s.business_id = 'biz_dy'`)).rows[0]
  assert.equal(r24?.unbalanced_reason, '세무사 반올림 차이 10원', '0083: 닫히지 않은 이유가 칸에 없다')
  assert.match(r24?.note ?? '', /닫히지 않음\(차이 10\.00원\)/, '0083: 감사 기록에 닫히지 않은 차이가 없다')

  // 옛 함수
  const old = await as(U.ceo, `select official_statement_save('biz_dy', 'year', '2023', 'https://drive.example/2023.pdf', '옛 길', ${lines(1000, -400, -600)}) as id`)
  assert.ok(Array.isArray(old), `0083: 옛 official_statement_save가 돌지 않는다 — ${old}`)
  // 학습 표는 계정이 지워지면 같이 사라진다(FK cascade) — 계정을 지우는 길은 없지만 남은 줄이 엉뚱한 계정을 가리키지 않게.
  await db.close()
  return '0083 공식 결산 v2(증빙 버킷 비공개 · 올리기 장부 권한 · 직원 · AI 못 봄 · 지우기 · 옮기기 없음 · 원본만으로 저장 · 없는 파일 · 남의 파일 · 같은 계정 두 줄 · 남의 계정 · 학습 · hits · 직접 쓰기 없음 · 같은 해 바꾸기 확인 · 닫히지 않음 이유 · 마감 권한 · 감사 · 옛 함수)'
}

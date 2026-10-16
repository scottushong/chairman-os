/**
 * 0082 자료 올리기 수신함(fin-upload-inbox) — check-migrations.ts가 부른다(PGlite · 전부 적용한 DB).
 *   본인 폴더 · 장부를 쓰는 사람만 올리고 · 보고 · 지운다. 남의 폴더(대표 포함) · 다른 회사 · 장부 권한 없는 직원 · AI Agent ·
 *   경로 모양이 틀린 것 · 다른 버킷 흉내는 막힌다. update 정책이 없다(덮어쓰기 · 옮기기 없음). 버킷은 비공개.
 */
import assert from 'node:assert/strict'

import { PGlite } from '@electric-sql/pglite'
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm'

import { applyAll } from './pglite'

const U = {
  chair: '00000000-0000-0000-0000-0000000082a1',
  ceo: '00000000-0000-0000-0000-0000000082a2', // DY 회사 대표 — can_keep_books(biz_dy)
  member: '00000000-0000-0000-0000-0000000082a3', // DY 직원 — 재무 줄 없음
  agent: '00000000-0000-0000-0000-0000000082a4',
}

export async function finUploadInbox(): Promise<string> {
  const db = new PGlite({ extensions: { pg_trgm } })
  await applyAll(db)
  await db.exec(`alter table user_profiles disable trigger user_profiles_draft_grant`)
  await db.exec(`
    grant usage on schema public, auth to authenticated, anon;
    insert into auth.users values ('${U.chair}', 'i1@x'), ('${U.ceo}', 'i2@x'), ('${U.member}', 'i3@x'), ('${U.agent}', 'i4@x');
    insert into user_profiles (user_id, role, display_name, max_security_class, team_id) values
      ('${U.chair}', 'Chairman', 'ch', 'Vault', null), ('${U.ceo}', 'BusinessCEO', 'dy대표', 'Restricted', null),
      ('${U.member}', 'Member', '직원', 'Normal', 'team_dy_production'), ('${U.agent}', 'AIAgent', 'agent', 'Normal', null);
    insert into user_business_access values ('${U.ceo}', 'biz_dy'), ('${U.member}', 'biz_dy');
  `)
  const q = async (uid: string, sql: string): Promise<number | 'denied'> => {
    await db.exec(`begin; select set_config('request.jwt.claim.sub', '${uid}', true); set local role authenticated;`)
    try {
      const r = await db.query(sql)
      await db.exec('commit')
      // select는 줄 수, 쓰기는 바뀐 줄 수(PGlite는 select에도 affectedRows 0을 준다).
      return /^\s*select/i.test(sql) ? r.rows.length : (r.affectedRows ?? 0)
    } catch (e) {
      await db.exec('rollback')
      if (/row-level security|permission denied/.test(String(e))) return 'denied'
      throw e
    }
  }
  const put = (uid: string, name: string, bucket = 'fin-upload-inbox') => q(uid, `insert into storage.objects (bucket_id, name, owner) values ('${bucket}', '${name}', '${uid}')`)
  const see = async (uid: string, name: string) => q(uid, `select 1 from storage.objects where bucket_id = 'fin-upload-inbox' and name = '${name}'`)

  const mine = `biz_dy/${U.ceo}/a.xlsx`
  assert.equal((await db.query<{ public: boolean }>(`select public from storage.buckets where id = 'fin-upload-inbox'`)).rows[0]?.public, false, '0082: 수신함 버킷이 비공개가 아니다')
  assert.equal(await put(U.ceo, mine), 1, '0082: 회사 대표가 본인 폴더에 못 올린다')
  assert.equal(await see(U.ceo, mine), 1, '0082: 올린 사람이 자기 파일을 못 본다')
  assert.equal(await put(U.ceo, `biz_dy/${U.member}/b.xlsx`), 'denied', '0082: 남의 폴더에 올렸다')
  assert.equal(await put(U.ceo, `biz_vana/${U.ceo}/c.xlsx`), 'denied', '0082: 장부 권한 없는 회사 폴더에 올렸다')
  assert.equal(await put(U.ceo, `biz_dy/${U.ceo}`), 'denied', '0082: 경로 모양(세 칸)이 틀린데 올렸다')
  assert.equal(await put(U.ceo, `biz_dy/${U.ceo}/x/y.xlsx`), 'denied', '0082: 네 칸 경로를 받았다')
  assert.equal(await put(U.member, `biz_dy/${U.member}/d.xlsx`), 'denied', '0082: 재무 줄 없는 직원이 올렸다')
  assert.equal(await put(U.agent, `biz_dy/${U.agent}/e.xlsx`), 'denied', '0082: AI Agent가 올렸다')
  assert.equal(await see(U.chair, mine), 0, '0082: 대표가 남의 수신함 파일을 본다')
  assert.equal(await see(U.member, mine), 0, '0082: 직원이 남의 수신함 파일을 본다')
  assert.equal(await put(U.chair, `biz_vana/${U.chair}/f.pdf`), 1, '0082: 대표가 본인 폴더(어느 회사든)에 못 올린다')
  assert.equal(await q(U.ceo, `update storage.objects set name = 'biz_dy/${U.ceo}/z.xlsx' where name = '${mine}'`), 0, '0082: 수신함 파일을 옮겼다(update 정책 없음)')
  assert.equal(await q(U.chair, `delete from storage.objects where name = '${mine}'`), 0, '0082: 대표가 남의 수신함 파일을 지웠다')
  assert.equal(await q(U.ceo, `delete from storage.objects where name = '${mine}'`), 1, '0082: 올린 사람이 자기 파일을 못 지운다')
  // 다른 버킷의 같은 모양 경로는 이 정책으로 열리지 않는다(attachments는 0045 규칙 — 줄이 없으면 거부).
  assert.equal(await put(U.ceo, `biz_dy/${U.ceo}/g.xlsx`, 'attachments'), 'denied', '0082: 수신함 규칙이 attachments 버킷을 열었다')
  await db.close()
  return '0082 수신함(본인 폴더 · 장부 권한 · 남의 폴더 · 다른 회사 · 직원 · AI Agent · 경로 모양 · 대표도 남의 것 못 봄 · update 없음 · 지우기 본인 · 다른 버킷 안 열림 · 비공개)'
}

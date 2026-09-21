/**
 * 접속 현황 검사 — npm run check:activity (블록 7)
 *
 * 이 기능은 **사람의 행동을 기록한다.** 잘못 만들면 감시 도구가 되고, 못 만들면 감사가
 * 안 된다. 그 둘을 가르는 것은 전부 조용히 깨진다 — 5분 억제가 안 걸리면 기록이 수십 줄이
 * 되어 아무도 안 읽고, 회장 게이트가 새면 팀장이 팀원의 동선을 보고, 보관 기간이 안 걸리면
 * 2년 치가 남고, 도시 칸에 IP가 새어도 화면에는 아무 표시가 없다. 전부 여기서 잰다.
 *
 * 네 덩이다.
 *   A. DB   — PGlite에 마이그레이션 전부를 올리고 **BYPASSRLS 없는 소유자**에서 잰다.
 *             그 조건이 요점이다: audit_log에는 FORCE row level security가 걸려 있고
 *             (0002:200), 이 저장소는 그 함정을 네 번 만났다(0023·0027·0029). 소유자가
 *             superuser인 harness에서만 재면 record_read()가 production에서만 조용히
 *             실패하는 상태를 그대로 통과시킨다.
 *   B. 규칙 — 이상 징후 다섯 종. DB를 안 쓴다(lib/activity.ts는 순수 함수다).
 *             종마다 **만드는 입력과 안 만드는 입력을 둘 다** 넣는다.
 *   C. dummy — 회장 게이트와 5분 억제가 dummy 어댑터에도 같은 모양으로 있는가.
 *             확인은 dummy로만 하므로, 여기가 다르면 화면에서 본 것이 거짓이 된다.
 *   D. 고지 — 로그인 화면 문구·/privacy·기록 호출부가 **실제로 그 자리에 있는가.**
 *             고지는 이 기능의 일부이지 옵션이 아니다. 지워져도 아무 기능이 안 깨지므로
 *             검사가 없으면 조용히 사라진다.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { PGlite } from '@electric-sql/pglite'
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm'

import {
  ACTIVITY_RETENTION_DAYS,
  detectAnomalies,
  loginsOn,
  onlineNow,
  summarizeUserAgent,
  type ActivityEvent,
  type ActivityPerson,
} from '../src/lib/activity'
import { dummyRepository } from '../src/lib/repository/dummy'
import { DUMMY_UID } from '../src/lib/repository/dummy-org'
import { applyAll } from './pglite'

const SRC = join(__dirname, '..', 'src')
const src = (...p: string[]) => readFileSync(join(SRC, ...p), 'utf8')

const U = {
  chair: '00000000-0000-0000-0000-0000000b7001',
  lead: '00000000-0000-0000-0000-0000000b7002',
  member: '00000000-0000-0000-0000-0000000b7003',
  member2: '00000000-0000-0000-0000-0000000b7004',
  agent: '00000000-0000-0000-0000-0000000b7005',
  integration: '00000000-0000-0000-0000-0000000b7006',
  /** auth.users에만 있고 user_profiles에는 없는 계정. auth_role()이 null인 세션을 만든다. */
  ghost: '00000000-0000-0000-0000-0000000b7007',
}

const UA_FULL =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

/* =====================================================================
 * A. DB
 * ===================================================================== */

async function database() {
  const db = new PGlite({ extensions: { pg_trgm } })
  await applyAll(db)

  /**
   * **이 실험의 전제**: 표와 기록 함수를 BYPASSRLS 없는 역할에게 넘긴다.
   * Supabase에서 소유자가 무엇이든 동작해야 한다는 것이 요구다(check-migrations의
   * definerUnderNonBypassOwner()와 같은 설정·같은 이유). user_profiles와 user_settings도
   * 같이 넘기는 것은 Supabase 흉내다 — 거기서는 public의 표가 전부 한 소유자다.
   */
  await db.exec(`
    create role app_owner nosuperuser nobypassrls nologin;
    grant usage on schema auth to app_owner;
    grant select on auth.users to app_owner;
    grant execute on all functions in schema public to app_owner;
    alter table public.audit_log        owner to app_owner;
    alter table public.activity_digest  owner to app_owner;
    alter table public.user_settings    owner to app_owner;
    alter table public.user_profiles    owner to app_owner;
    alter function public.record_read(text, text, text, text, text, text, text)  owner to app_owner;
    alter function public.record_login_failure(text, text, text)                 owner to app_owner;
    alter function public.activity_events(integer)                               owner to app_owner;
    grant usage on schema public, auth to authenticated, anon;
  `)
  const owner = await db.query<{ s: boolean; b: boolean }>(
    `select rolsuper as s, rolbypassrls as b from pg_roles where rolname = 'app_owner'`,
  )
  assert.equal(owner.rows[0].s, false, '실험 설정이 깨졌다 — app_owner가 superuser다')
  assert.equal(owner.rows[0].b, false, '실험 설정이 깨졌다 — app_owner가 bypassrls다')
  const forced = await db.query<{ f: boolean }>(
    `select relforcerowsecurity as f from pg_class where relname = 'audit_log'`,
  )
  assert.equal(
    forced.rows[0]?.f,
    true,
    'audit_log의 FORCE가 사라졌다 — 이 검사가 재려는 조건(소유자도 정책을 받는다)이 성립하지 않는다. 0031은 그 FORCE를 그대로 두기로 한 파일이다',
  )

  await db.exec(`
    insert into auth.users values
      ('${U.chair}', 'chair@x'), ('${U.lead}', 'lead@x'), ('${U.member}', 'member@x'),
      ('${U.member2}', 'member2@x'), ('${U.agent}', 'agent@x'),
      ('${U.integration}', 'sync@x'), ('${U.ghost}', 'ghost@x');
    insert into user_profiles (user_id, role, display_name, reports_to) values
      ('${U.chair}',       'Chairman',    '회장',    null),
      ('${U.lead}',        'TeamLead',    '팀장',    '${U.chair}'),
      ('${U.member}',      'Member',      '직원',    '${U.lead}'),
      ('${U.member2}',     'Member',      '직원2',   '${U.lead}'),
      ('${U.agent}',       'AIAgent',     'AI',      '${U.chair}'),
      ('${U.integration}', 'Integration', 'sync',    '${U.chair}');
    -- 시간대는 user_settings에서 온다(0029 current_tz). 없는 사람은 tz가 null이고
    -- 화면이 '—'를 그린다 — 서울로 추측하지 않는다.
    insert into user_settings (user_id, current_tz) values ('${U.member}', 'Asia/Seoul');
  `)

  /** 한 사람의 세션으로 SQL 한 줄. 끝나면 되돌린다. */
  async function rows<T>(uid: string | null, sql: string, role = 'authenticated'): Promise<T[]> {
    await db.exec(
      `begin; select set_config('request.jwt.claim.sub', ${uid ? `'${uid}'` : `''`}, true); set local role ${role};`,
    )
    try {
      return (await db.query<T>(sql)).rows
    } finally {
      await db.exec('rollback')
    }
  }
  /** 첫 칸 하나. */
  async function val<T>(uid: string | null, sql: string, role = 'authenticated'): Promise<T | null> {
    const r = await rows<Record<string, T>>(uid, sql, role)
    return r.length ? (Object.values(r[0])[0] ?? null) : null
  }
  /**
   * 한 사람의 세션으로 **되돌리지 않고** 실행한다. 기록을 남기는 문장(record_read 등)은
   * 이쪽이어야 한다 — rows()는 끝나고 rollback하므로 그 안에서 남긴 줄은 다음 단언이
   * 볼 수 없다. 처음에 rows()로 쟀더니 "6분 뒤 2줄"이 늘 1줄이었다.
   */
  async function acting<T>(uid: string | null, sql: string, role = 'authenticated'): Promise<T | null> {
    await db.exec(
      `select set_config('request.jwt.claim.sub', ${uid ? `'${uid}'` : `''`}, false); set role ${role};`,
    )
    try {
      const r = await db.query<Record<string, T>>(sql)
      return r.rows.length ? (Object.values(r.rows[0])[0] ?? null) : null
    } finally {
      await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`)
    }
  }

  /** 문장이 거부되는가(예외를 던지는가). */
  async function rejected(uid: string | null, sql: string, role = 'authenticated'): Promise<string | null> {
    try {
      await rows(uid, sql, role)
      return null
    } catch (e) {
      return e instanceof Error ? e.message : String(e)
    }
  }

  const readCall = (path: string, extra = '') =>
    `select record_read('${path}', 'page', null, null, null, 'Chrome · Windows', 'Seoul, KR'${extra})`

  /** 과거의 열람 기록 한 줄. record_read()를 안 거치고 소유자 권한(superuser)으로 심는다. */
  async function seedRead(uid: string, path: string, ago: string, overrides = `'Asia/Seoul'`) {
    await db.exec(`
      insert into audit_log (occurred_at, actor_user_id, actor_role, action, entity_table, after, note)
      values (now() - interval '${ago}', '${uid}', 'Member', 'read', 'screen',
              jsonb_build_object('path', '${path}', 'kind', 'page', 'device', 'Chrome · Windows',
                                 'city', 'Seoul, KR', 'tz', ${overrides}),
              '페이지 진입');
    `)
  }

  const countRead = (uid: string, path: string) =>
    `select count(*)::int from audit_log where actor_user_id = '${uid}' and action = 'read' and after->>'path' = '${path}'`

  // ── A-1. 5분 중복 억제 ─────────────────────────────────────────────
  //   브리프 5절 그대로: 같은 path를 **4분 뒤** 다시 들어가면 기록 1줄, **6분 뒤**면 2줄.
  //   now()를 앞뒤로 못 옮기므로 '앞선 기록'을 그만큼 과거에 심고 지금 한 번 부른다.
  await seedRead(U.member, '/tasks', '4 minutes')
  assert.equal(
    await acting<boolean>(U.member, readCall('/tasks')),
    false,
    '5분 억제: 4분 전에 본 같은 화면을 다시 열었는데 새 줄이 남았다 — 새로고침 한 번에 기록이 수십 줄이 되고, 그 순간 이 표는 읽을 수 없는 것이 되어 감사 도구가 아니게 된다',
  )
  assert.equal(
    await val<number>(U.member, countRead(U.member, '/tasks')),
    1,
    '5분 억제: 4분 뒤 재진입이 1줄이어야 한다',
  )

  await seedRead(U.member2, '/tasks', '6 minutes')
  assert.equal(
    await acting<boolean>(U.member2, readCall('/tasks')),
    true,
    '5분 억제: 6분 전 기록이 창 밖인데도 새 줄이 안 남았다 — 억제 창이 5분보다 넓다',
  )
  assert.equal(
    await val<number>(U.member2, countRead(U.member2, '/tasks')),
    2,
    '5분 억제: 6분 뒤 재진입은 2줄이어야 한다',
  )

  // 다른 화면은 같은 창 안이어도 따로 센다. '같은 화면'이 곧 경로라는 정의가 살아 있는가.
  assert.equal(
    await acting<boolean>(U.member, readCall('/documents')),
    true,
    '5분 억제: 방금 다른 화면을 열었는데 억제됐다 — 억제 키가 경로가 아니라 사람 하나가 되어 있다(그러면 이 기능은 한 사람의 하루에 몇 줄만 남긴다)',
  )

  // ── A-2. 시스템 계정은 기록 대상이 아니다 ──────────────────────────
  assert.equal(
    await acting<boolean>(U.agent, readCall('/')),
    false,
    'AIAgent가 열람 기록을 남긴다 — 야간 Job은 화면을 보지 않는다. 정책의 AIAgent 분기가 read를 막아 42501이 나기 전에 함수가 먼저 돌려보내야 한다',
  )
  assert.equal(
    await acting<boolean>(U.integration, readCall('/')),
    false,
    'Integration이 열람 기록을 남긴다 — ECOUNT 동기화 계정은 화면을 보지 않는다',
  )

  // ── A-3. IP·원문 UA가 칸으로 새지 않는다 ──────────────────────────
  //   **이 기능의 유일한 되돌릴 수 없는 사고가 여기다.**
  const stored = (uid: string, path: string, key: string) =>
    `select after->>'${key}' from audit_log where actor_user_id = '${uid}' and after->>'path' = '${path}' order by id desc limit 1`

  // IPv4가 도시 칸에 실려 오면 버린다.
  await acting(U.member2, `select record_read('/ip4', 'page', null, null, null, 'Chrome · Windows', '203.0.113.7')`)
  assert.equal(
    await val<string>(U.chair, stored(U.member2, '/ip4', 'city')),
    null,
    'IP 원본이 도시 칸으로 샜다(IPv4) — record_read()에 p_ip 인자가 없어도 앱의 버그 한 줄이면 이 칸으로 들어온다. activity_city()가 그것을 막는 유일한 줄이다',
  )
  // IPv6도.
  await acting(U.member2, `select record_read('/ip6', 'page', null, null, null, 'Chrome · Windows', '2001:db8::1')`)
  assert.equal(
    await val<string>(U.chair, stored(U.member2, '/ip6', 'city')),
    null,
    'IP 원본이 도시 칸으로 샜다(IPv6) — 콜론이 든 문자열은 도시 이름이 아니다',
  )
  // 진짜 도시는 남는다. 위 둘만 재면 도시 칸을 통째로 버리는 구현도 통과한다.
  await acting(U.member2, `select record_read('/city', 'page', null, null, null, 'Chrome · Windows', 'Ho Chi Minh City, VN')`)
  assert.equal(
    await val<string>(U.chair, stored(U.member2, '/city', 'city')),
    'Ho Chi Minh City, VN',
    '도시 이름이 저장되지 않는다 — 막는 것이 과해서 도시 칸이 늘 비면 화면은 영원히 "—"다',
  )
  // 원문 User-Agent는 버린다. 잘라서 저장하지 않는다 — 잘린 UA도 지문이다.
  await acting(U.member2, `select record_read('/ua', 'page', null, null, null, '${UA_FULL}', 'Seoul, KR')`)
  assert.equal(
    await val<string>(U.chair, stored(U.member2, '/ua', 'device')),
    null,
    '원문 User-Agent가 기기 칸에 그대로 저장됐다 — 그 문자열은 글꼴·확장·빌드 번호까지 담은 지문이고, 몇 달 치를 쌓으면 이 표가 사람을 추적하는 표가 된다',
  )
  assert.equal(
    await val<string>(U.chair, stored(U.member2, '/city', 'device')),
    'Chrome · Windows',
    '요약된 기기 이름까지 버려진다 — 그러면 ② 새 기기 판정이 영원히 서지 않는다',
  )

  // 구조 단언 — **IP를 받을 자리 자체가 없는가.** 위 행동 검사는 '들어와도 버린다'를
  // 재고, 이 줄은 '애초에 받지 않는다'를 잰다. 칸을 만들어 두면 언젠가 누가 채운다.
  const args = await val<string>(
    null,
    `select pg_get_function_arguments(oid) from pg_proc where proname = 'record_read'`,
    'postgres',
  )
  assert.ok(args, 'record_read() 함수를 카탈로그에서 못 찾는다 — 이 검사가 아무것도 재지 않고 있다')
  assert.equal(
    /\bp_ip\b|ip_address|remote_addr/.test(args ?? ''),
    false,
    `record_read()에 IP를 받는 인자가 생겼다 — 도시까지라는 이 기능의 약속이 깨진다: ${args}`,
  )

  // ── A-4. 회장이 아니면 0건 ─────────────────────────────────────────
  const chairSees = await val<number>(U.chair, 'select count(*)::int from activity_events(30)')
  assert.ok(
    (chairSees ?? 0) > 0,
    '회장이 접속 현황을 0건 받는다 — 화면이 통째로 빈다(activity_events()가 아무것도 안 준다)',
  )
  assert.equal(
    await val<number>(U.lead, 'select count(*)::int from activity_events(30)'),
    0,
    '팀장이 접속 현황 데이터를 받는다 — 원문은 "RLS: Chairman만"이다. 화면의 404만으로는 못 막는다',
  )
  assert.equal(
    await val<number>(U.member, 'select count(*)::int from activity_events(30)'),
    0,
    '직원이 접속 현황 데이터를 받는다',
  )
  /**
   * 프로필 없는 계정. **자기 이름으로 된 줄을 먼저 심어 둔다.**
   *
   * 음성 대조가 여기서 "검사가 아무것도 재지 않는다"를 잡아냈다. 심어 두지 않으면
   * 이 계정은 게이트를 지나가더라도 audit_log_read가 0행을 주므로(볼 것이 없다),
   * coalesce를 빼도 단언이 초록으로 통과한다. 자기 줄이 있어야 게이트만 재어진다.
   */
  await seedRead(U.ghost, '/ghost', '1 hour')
  assert.equal(
    await val<number>(U.ghost, 'select count(*)::int from activity_events(30)'),
    0,
    'user_profiles에 행이 없는 계정이 접속 현황을 통째로 받는다 — auth_role()이 null이면 `auth_role() <> \'Chairman\'`도 null이고, `if null then` 은 거짓이라 게이트를 그냥 지나간다. coalesce가 그 구멍을 막는 유일한 줄이다',
  )
  // 대조군 — 팀장의 0건이 '함수의 게이트' 때문인가, '볼 것이 없어서'인가.
  // 0026이 audit_log_read에 subtree를 얹어 놓아서 팀장은 팀원의 줄을 **볼 수 있다.**
  // 그런데도 activity_events()가 0을 준다는 것이 이 검사의 요점이다.
  assert.ok(
    (await val<number>(
      U.lead,
      `select count(*)::int from audit_log where actor_user_id = '${U.member}' and action = 'read'`,
    ) ?? 0) > 0,
    '이 실험의 전제가 깨졌다 — 팀장이 팀원의 감사 기록을 한 줄도 못 본다면 위의 "팀장 0건"은 함수의 게이트가 아니라 RLS가 만든 것이고, 게이트는 아무것도 재지 못한 셈이다',
  )

  // ── A-5. 보관 기간 180일 ───────────────────────────────────────────
  //   지우지 않는다. **읽을 수 있는 사람을 0명으로** 만든다.
  await seedRead(U.member, '/old-179', `${ACTIVITY_RETENTION_DAYS - 1} days`)
  await seedRead(U.member, '/old-181', `${ACTIVITY_RETENTION_DAYS + 1} days`)
  await db.exec(`
    insert into audit_log (occurred_at, actor_user_id, actor_role, action, entity_table, entity_id, note)
    values (now() - interval '400 days', '${U.member}', 'Member', 'update', 'tasks', 'tsk_x', '오래된 업무 변경');
  `)
  assert.equal(
    await val<number>(U.chair, countRead(U.member, '/old-179')),
    1,
    `보관 기간: ${ACTIVITY_RETENTION_DAYS - 1}일 된 열람 기록이 회장에게 안 보인다 — 창이 180일보다 좁다`,
  )
  assert.equal(
    await val<number>(U.chair, countRead(U.member, '/old-181')),
    0,
    `보관 기간: ${ACTIVITY_RETENTION_DAYS + 1}일 된 열람 기록이 회장에게 아직 보인다 — /privacy에 "${ACTIVITY_RETENTION_DAYS}일 뒤 아무도 못 본다"고 적어 놓고 지키지 않는 상태다`,
  )
  assert.equal(
    await val<number>(U.member, countRead(U.member, '/old-181')),
    0,
    '보관 기간: 본인에게는 보관 기간이 지난 자기 열람 기록이 아직 보인다 — 창은 사람마다가 아니라 기록마다 걸려야 한다',
  )
  assert.equal(
    await val<number>(
      U.chair,
      `select count(*)::int from audit_log where actor_user_id = '${U.member}' and action = 'update' and entity_table = 'tasks'`,
    ),
    1,
    '보관 기간이 열람 기록이 아닌 감사 기록까지 잘랐다 — 장부·문서·결정의 기록은 보존 기간이 다르고, 0031이 그것을 줄일 권한은 없다',
  )

  // ── A-6. 기록은 지워지지도 고쳐지지도 않는다 ───────────────────────
  const delMsg = await rejected(U.chair, `delete from audit_log where action = 'read'`)
  assert.ok(
    delMsg,
    'append-only: 회장이 열람 기록을 지울 수 있다 — 감사 기록에서 지울 수 있는 줄은 "없었던 일"과 구별되지 않는다(0001의 revoke + 트리거)',
  )
  const updMsg = await rejected(U.chair, `update audit_log set note = 'x' where action = 'read'`)
  assert.ok(
    updMsg,
    'append-only: 회장이 열람 기록을 고칠 수 있다',
  )

  // ── A-7. 실패한 로그인 ─────────────────────────────────────────────
  const failCount = `select count(*)::int from audit_log where action = 'login' and after->>'ok' = 'false'`
  assert.equal(await val<number>(U.chair, failCount), 0, '이 검사의 시작점이 깨졌다 — 아직 실패 기록이 없어야 한다')

  await acting(null, `select record_login_failure('member@x', 'Chrome · Windows', 'Seoul, KR')`, 'anon')
  assert.equal(
    await val<number>(U.chair, failCount),
    1,
    '실패한 로그인이 한 줄도 안 남는다 — 세션이 없는 자리라 audit_log_insert에 익명 분기가 필요하고, 그것이 없으면 42501로 조용히 막힌다. 그러면 원문의 "오늘 로그인(성공·실패)"에서 실패가 영영 0건이다',
  )
  assert.equal(
    await val<string>(
      U.chair,
      `select actor_user_id::text from audit_log where action = 'login' and after->>'ok' = 'false' order by id desc limit 1`,
    ),
    U.member,
    '실패 기록이 누구 것인지 지목하지 않는다 — 이메일에서 계정을 못 찾은 채 남겼다면 ④ 이상 징후가 사람을 묶지 못한다',
  )
  // 모르는 이메일로는 아무것도 안 생긴다. 이 문이 부풀리기 통로가 되지 않게 하는 줄이다.
  await acting(null, `select record_login_failure('nobody@nowhere', null, null)`, 'anon')
  assert.equal(
    await val<number>(U.chair, failCount),
    1,
    '등록되지 않은 이메일로도 실패 기록이 생긴다 — 아무나 audit_log를 부풀릴 수 있고, 그 표에 없는 사람의 이름이 쌓인다',
  )
  // 익명이 audit_log에 **직접** 쓰는 길은 없다. 정책의 익명 분기가 함수 밖으로 새지 않는가.
  const anonInsert = await rejected(
    null,
    `insert into audit_log (actor_user_id, actor_role, action, entity_table, after)
     values ('${U.member}', 'Member', 'login', 'auth.users', jsonb_build_object('ok', 'false'))`,
    'anon',
  )
  assert.ok(
    anonInsert,
    '익명 세션이 audit_log에 직접 INSERT할 수 있다 — 0031이 연 익명 분기가 definer 함수 밖으로 샜다. 자물쇠는 revoke다(revoke insert ... from anon)',
  )
  // 로그인한 사람이 이 문을 부르면 아무 일도 없다(자기 실패를 지어낼 수 없다).
  await acting(U.member2, `select record_login_failure('member@x', null, null)`)
  assert.equal(
    await val<number>(U.chair, failCount),
    1,
    '로그인한 세션이 남의 로그인 실패를 만들어 낼 수 있다 — 이 문은 익명 전용이다',
  )

  // ── A-8. activity_digest — 숫자만, 그리고 누가 읽는가 ──────────────
  const cols = await rows<{ c: string }>(
    null,
    `select column_name as c from information_schema.columns where table_name = 'activity_digest' order by 1`,
    'postgres',
  )
  assert.deepEqual(
    cols.map((r) => r.c),
    ['doc_reads', 'events', 'people', 'updated_at', 'week_start'],
    'activity_digest에 숫자가 아닌 칸이 생겼다 — 이 표는 야간 Job(AIAgent)이 읽는 유일한 자리다. 사람·경로·도시가 한 칸이라도 들어가는 순간 브리핑이 요약이 아니라 명단이 된다',
  )
  const digest = (col: string) => `select ${col} from activity_digest order by week_start desc limit 1`
  const eventsBefore = (await val<number>(U.chair, digest('events'))) ?? 0
  assert.ok(
    eventsBefore > 0,
    'activity_digest가 안 쌓인다 — 브리핑의 주간 한 줄이 영원히 null이다(배선은 됐는데 한 번도 안 켜지는 코드가 된다)',
  )

  /**
   * people은 '이번 주에 한 번이라도 기록을 남긴 사람 수'다. **이름은 어디에도 안 남는다.**
   *
   * 앞선 단언들이 쓴 두 직원은 이미 이번 주 기록을 심어 둔 상태라 people을 올리지 않는다
   * (그것이 맞는 동작이다). 그래서 여기서는 이번 주 기록이 없는 두 사람으로 잰다 —
   * 한 사람이 두 번 들어와도 1명이어야 한다는 것까지.
   */
  const peopleBefore = (await val<number>(U.chair, digest('people'))) ?? 0
  await acting(U.lead, readCall('/lead-1'))
  await acting(U.lead, readCall('/lead-2'))
  await acting(U.chair, readCall('/chair-1'))
  assert.equal(
    await val<number>(U.chair, digest('people')),
    peopleBefore + 2,
    'activity_digest.people가 사람 수를 안 센다 — 이번 주 첫 줄인지를 audit_log insert **뒤에** 보면 늘 0이 되고(방금 넣은 줄을 자기가 본다), 한 사람의 재방문마다 올리면 사람 수가 아니라 방문 수가 된다',
  )
  assert.equal(
    await val<number>(U.chair, digest('events')),
    eventsBefore + 3,
    'activity_digest.events가 남긴 줄 수를 안 센다',
  )
  assert.equal(
    await val<number>(U.agent, 'select count(*)::int from activity_digest'),
    1,
    '야간 Job(AIAgent)이 주간 집계를 못 읽는다 — 브리핑 한 줄이 서지 않는다',
  )
  assert.equal(
    await val<number>(U.member, 'select count(*)::int from activity_digest'),
    0,
    '직원이 그룹 전체의 접속 집계를 읽는다 — 이 표는 회장과 야간 Job만 본다',
  )
  assert.equal(
    await val<number>(U.lead, 'select count(*)::int from activity_digest'),
    0,
    '팀장이 그룹 전체의 접속 집계를 읽는다',
  )

  // ── A-9. 화면이 읽는 모양 그대로 오는가 ────────────────────────────
  const sample = await rows<ActivityEvent>(
    U.chair,
    `select * from activity_events(30) where path = '/city' limit 1`,
  )
  assert.equal(sample.length, 1, 'activity_events()가 방금 남긴 줄을 안 준다')
  assert.equal(sample[0].kind, 'page', 'activity_events()의 kind 칸이 비어 있다 — 화면이 종류를 못 그린다')
  assert.equal(sample[0].city, 'Ho Chi Minh City, VN', 'activity_events()의 도시 칸이 비어 있다')
  assert.equal(sample[0].ok, null, '열람 기록에 성공/실패가 붙어 있다 — 그 개념은 로그인에만 있다')

  await db.close()
}

/* =====================================================================
 * B. 이상 징후 다섯 종 — 순수 규칙
 *    종마다 **만드는 입력**과 **안 만드는 입력**을 둘 다 넣는다.
 *    한쪽만 재면 "무조건 태그하는 구현"과 "아무것도 안 하는 구현"이 각각 통과한다.
 * ===================================================================== */

const SEOUL = 'Asia/Seoul'
const T0 = Date.parse('2026-09-15T00:00:00Z')

function ev(minutes: number, over: Partial<ActivityEvent> = {}): ActivityEvent {
  return {
    occurred_at: new Date(T0 + minutes * 60_000).toISOString(),
    actor_user_id: 'u1',
    actor_role: 'Member',
    action: 'read',
    entity_id: null,
    entity_table: null,
    business_id: null,
    path: '/tasks',
    kind: 'page',
    device: 'Chrome · Windows',
    city: 'Seoul, KR',
    tz: SEOUL,
    ok: null,
    ...over,
  }
}

const PEOPLE: ActivityPerson[] = [
  { user_id: 'u1', display_name: '직원', status: 'active', left_on: null, revoked_at: null },
  {
    user_id: 'gone',
    display_name: '퇴사자',
    status: 'left',
    left_on: '2026-09-01',
    revoked_at: '2026-09-01T00:00:00.000Z',
  },
]

const kinds = (events: ActivityEvent[]) => detectAnomalies(events, PEOPLE).map((a) => a.kind)

function rules() {
  // ① 심야 접속 — KST 02:40은 UTC 전날 17:40이다.
  const lateNight = [ev(0, { occurred_at: '2026-09-14T17:40:00.000Z' })]
  assert.ok(
    kinds(lateNight).includes('late_night'),
    '① 심야: 현지 02:40 접속이 태그되지 않는다 — 시간대를 안 보고 서버 시각으로 재면 이 입력이 그냥 지나간다',
  )
  // 같은 순간이라도 시간대가 다르면 심야가 아니다. 이것이 '현지 시간'을 실제로 재는 자리다.
  assert.equal(
    kinds([ev(0, { occurred_at: '2026-09-14T17:40:00.000Z', tz: 'Europe/London' })]).includes('late_night'),
    false,
    '① 심야: 런던 시간 18:40을 심야로 태그한다 — 같은 순간을 서울(02:40)과 런던(18:40)에 넣어 두 판정이 갈라지지 않으면 현지 시간을 안 쓰고 있는 것이다',
  )
  // 낮 시간은 태그하지 않는다.
  assert.equal(
    kinds([ev(0, { occurred_at: '2026-09-15T05:00:00.000Z' })]).includes('late_night'),
    false,
    '① 심야: 현지 14:00 접속을 심야로 태그한다',
  )
  // 시간대를 모르면 판정하지 않는다 — 서울로 가정하면 해외 근무가 매일 심야가 된다.
  assert.equal(
    kinds([ev(0, { occurred_at: '2026-09-14T17:40:00.000Z', tz: null })]).includes('late_night'),
    false,
    '① 심야: 시간대를 모르는 기록을 서울로 가정해 태그한다 — 해외에 있는 사람이 매일 심야로 찍힌다',
  )

  // ② 새 기기 · 새 도시
  const newDevice = [ev(0), ev(10), ev(20, { device: 'Safari · iOS' })]
  assert.ok(kinds(newDevice).includes('new_origin'), '② 새 기기: 앞선 기록에 없던 기기가 태그되지 않는다')
  const newCity = [ev(0), ev(10), ev(20, { city: 'Ho Chi Minh City, VN' })]
  assert.ok(kinds(newCity).includes('new_origin'), '② 새 도시: 앞선 기록에 없던 도시가 태그되지 않는다')
  // 같은 기기·같은 도시만 있으면 태그가 없다.
  assert.equal(
    kinds([ev(0), ev(10), ev(20)]).includes('new_origin'),
    false,
    '② 새 기기·도시: 처음부터 끝까지 같은 기기·같은 도시인데 태그가 붙는다 — 그러면 모든 사람에게 늘 붙는 태그가 된다',
  )
  // 기준선이 없는 첫 기록은 태그하지 않는다. 처음은 늘 처음이다.
  assert.equal(
    kinds([ev(0)]).includes('new_origin'),
    false,
    '② 새 기기·도시: 그 사람의 첫 기록 하나를 "새 기기"로 태그한다 — 입사 첫날 전원이 이상 징후가 된다',
  )
  /**
   * 돌아온 기기는 새 기기가 아니다.
   *
   * 네 번째가 **다시 iOS**여야 한다. [WIN, iOS, WIN]으로 재면 마지막 WIN은 처음부터
   * 기준선에 있던 값이라, 태그한 값을 기준선에 안 넣는 구현도 1을 돌려준다
   * (음성 대조가 그것을 잡아냈다). 한 번 태그된 값이 기준선에 들어갔는지를 재려면
   * 그 값으로 한 번 더 돌아와야 한다.
   */
  assert.equal(
    kinds([ev(0), ev(10, { device: 'Safari · iOS' }), ev(20), ev(30, { device: 'Safari · iOS' })]).filter(
      (k) => k === 'new_origin',
    ).length,
    1,
    '② 새 기기: 예전에 쓰던 기기로 돌아온 것을 다시 "새 기기"로 센다 — 한 번 태그한 값은 그 뒤로 기준선에 들어가야 한다',
  )

  // ③ 짧은 시간에 많은 문서 열람
  const burst = Array.from({ length: 8 }, (_, i) => ev(i, { kind: 'document', path: `/documents/d${i}` }))
  assert.ok(kinds(burst).includes('doc_burst'), '③ 문서 폭주: 10분 안에 문서 8건이 태그되지 않는다')
  // 7건은 아니다(경계).
  assert.equal(
    kinds(burst.slice(0, 7)).includes('doc_burst'),
    false,
    '③ 문서 폭주: 10분 안에 7건인데 태그된다 — 경계가 8이 아니다',
  )
  // 8건이어도 창 밖으로 흩어져 있으면 아니다.
  const spread = Array.from({ length: 8 }, (_, i) => ev(i * 30, { kind: 'document', path: `/documents/d${i}` }))
  assert.equal(
    kinds(spread).includes('doc_burst'),
    false,
    '③ 문서 폭주: 4시간에 걸쳐 본 문서 8건을 "짧은 시간"으로 태그한다 — 창을 안 보고 건수만 세고 있다',
  )
  // 페이지 진입 8건은 문서 열람이 아니다.
  assert.equal(
    kinds(Array.from({ length: 8 }, (_, i) => ev(i, { path: `/p${i}` }))).includes('doc_burst'),
    false,
    '③ 문서 폭주: 문서가 아닌 화면 8건을 문서 열람으로 센다',
  )

  // ④ 로그인 실패 연속
  const fails = [0, 1, 2].map((m) => ev(m, { action: 'login', ok: false, path: '/login', kind: null }))
  assert.ok(kinds(fails).includes('login_failures'), '④ 로그인 실패: 5분 안에 3회 실패가 태그되지 않는다')
  assert.equal(
    kinds(fails.slice(0, 2)).includes('login_failures'),
    false,
    '④ 로그인 실패: 2회인데 태그된다 — 경계가 3이 아니다',
  )
  assert.equal(
    kinds([0, 30, 60].map((m) => ev(m, { action: 'login', ok: false, path: '/login', kind: null }))).includes(
      'login_failures',
    ),
    false,
    '④ 로그인 실패: 한 시간에 흩어진 3회를 "연속"으로 태그한다',
  )
  assert.equal(
    kinds([0, 1, 2].map((m) => ev(m, { action: 'login', ok: true, path: '/login', kind: null }))).includes(
      'login_failures',
    ),
    false,
    '④ 로그인 실패: 성공한 로그인 3회를 실패로 센다',
  )

  // ⑤ 퇴사 처리된 계정의 활동
  const afterLeave = [ev(0, { actor_user_id: 'gone', occurred_at: '2026-09-10T02:00:00.000Z' })]
  assert.ok(
    kinds(afterLeave).includes('revoked_active'),
    '⑤ 퇴사 계정: 권한 회수 뒤의 활동이 태그되지 않는다 — 회수된 계정은 아무것도 못 해야 정상이고, 그 위반이 이 화면이 잡아야 할 가장 심각한 것이다',
  )
  // 회수 **전**의 활동은 정상이다.
  assert.equal(
    kinds([ev(0, { actor_user_id: 'gone', occurred_at: '2026-08-20T02:00:00.000Z' })]).includes('revoked_active'),
    false,
    '⑤ 퇴사 계정: 퇴사 전에 남긴 기록까지 태그한다 — 그러면 퇴사자는 과거 전부가 이상 징후가 된다',
  )
  // 재직 중인 사람은 태그하지 않는다.
  assert.equal(
    kinds([ev(0)]).includes('revoked_active'),
    false,
    '⑤ 퇴사 계정: 재직 중인 사람을 퇴사 계정으로 태그한다',
  )

  // 근거 문구에 숫자가 들어 있는가. "수상하다"고만 말하는 태그는 만들지 않는다.
  for (const a of detectAnomalies([...burst, ...fails, ...newDevice], PEOPLE)) {
    assert.ok(
      /\d/.test(a.reason),
      `이상 징후 '${a.kind}'의 근거에 숫자가 없다 — 근거 없이 "수상하다"고만 말하는 태그는 만들지 않는다: ${a.reason}`,
    )
  }

  // 현재 접속 중 — 5분 창.
  const now = new Date(T0 + 60 * 60_000)
  assert.equal(
    onlineNow([ev(58), ev(50, { actor_user_id: 'u2' })], now).length,
    1,
    '현재 접속 중: 최근 5분 창이 안 걸린다 — 10분 전에 다녀간 사람이 "접속 중"으로 뜬다',
  )
  assert.equal(
    onlineNow([ev(58, { action: 'login', ok: true })], now).length,
    0,
    '현재 접속 중: 로그인 줄을 "접속 중"으로 센다 — 로그인은 한 번의 사건이지 지금 보고 있다는 뜻이 아니다',
  )

  /**
   * 오늘 로그인 — KST 날짜로 고른다.
   *
   * **건수만 재면 안 된다.** 처음에 길이만 쟀더니 UTC로 자르는 구현도 같은 1을 돌려줘
   * 음성 대조가 초록으로 지나갔다. 아래 셋은 KST로 자르면 {A,B}, UTC로 자르면 {B,C}로
   * **개수가 같고 내용만 다르다** — 그래서 어느 줄이 왔는지를 잰다.
   */
  const LOGIN_A = '2026-09-14T16:00:00.000Z' // KST 09-15 01:00 · UTC 09-14
  const LOGIN_B = '2026-09-15T05:00:00.000Z' // KST 09-15 14:00 · UTC 09-15
  const LOGIN_C = '2026-09-15T16:00:00.000Z' // KST 09-16 01:00 · UTC 09-15
  const logins = [LOGIN_A, LOGIN_B, LOGIN_C].map((occurred_at) =>
    ev(0, { action: 'login', ok: true, occurred_at }),
  )
  assert.deepEqual(
    loginsOn(logins, '2026-09-15').map((e) => e.occurred_at),
    [LOGIN_B, LOGIN_A],
    "오늘 로그인: KST 날짜로 안 고른다 — UTC로 자르면 한국 아침 01시의 로그인이 '어제'가 되고, 그 대신 내일 새벽 것이 오늘로 끌려온다",
  )

  // 기기 요약 — 원문 UA가 그대로 새지 않는가(DB 쪽 guard의 앞단).
  assert.equal(
    summarizeUserAgent(UA_FULL),
    'Chrome · Windows',
    '기기 요약: 원문 User-Agent에서 브라우저·OS를 못 읽는다',
  )
  assert.equal(summarizeUserAgent('무슨 소린지 모를 문자열'), null, '기기 요약: 모르는 UA에 이름을 지어낸다')
}

/* =====================================================================
 * C. dummy 어댑터 — 확인은 dummy로만 한다. 여기가 DB와 다르면 화면에서 본 것이 거짓이다.
 * ===================================================================== */

async function dummy() {
  process.env.DUMMY_USER = 'sales_lead'
  assert.equal(
    (await dummyRepository.listActivityEvents(30)).length,
    0,
    'dummy: 팀장 세션에 접속 현황이 보인다 — DB 쪽 게이트(activity_events의 첫 줄)와 다른 답을 하고 있고, dummy로 확인하는 이 저장소에서는 그것이 곧 "화면에서 본 것이 거짓"이다',
  )

  process.env.DUMMY_USER = 'chairman'
  const seen = await dummyRepository.listActivityEvents(30)
  assert.ok(seen.length > 0, 'dummy: 회장 세션에도 접속 현황이 비어 있다 — 시드가 화면을 한 번도 못 세운다')

  // 시드가 다섯 종을 전부 세우는가. 하나라도 빠지면 화면에서 그 태그를 본 적이 없게 된다.
  const people: ActivityPerson[] = [
    { user_id: DUMMY_UID.chair, display_name: '회장', status: 'active', left_on: null, revoked_at: null },
    { user_id: DUMMY_UID.salesLead, display_name: '영업팀장', status: 'active', left_on: null, revoked_at: null },
    { user_id: DUMMY_UID.salesStaff, display_name: '영업 직원', status: 'active', left_on: null, revoked_at: null },
    { user_id: DUMMY_UID.salesStaff2, display_name: '영업 직원 2', status: 'active', left_on: null, revoked_at: null },
    { user_id: DUMMY_UID.buyLead, display_name: '구매팀장', status: 'active', left_on: null, revoked_at: null },
    {
      user_id: DUMMY_UID.leaver,
      display_name: '퇴사자',
      status: 'left',
      left_on: new Date(Date.now() - 12 * 86_400_000).toISOString().slice(0, 10),
      revoked_at: new Date(Date.now() - 12 * 86_400_000).toISOString(),
    },
  ]
  const found = new Set(detectAnomalies(seen, people).map((a) => a.kind))
  for (const kind of ['late_night', 'new_origin', 'doc_burst', 'login_failures', 'revoked_active'] as const) {
    assert.ok(
      found.has(kind),
      `dummy 시드가 이상 징후 '${kind}'를 한 번도 안 세운다 — 화면에서 그 태그를 눈으로 본 적이 없다는 뜻이다`,
    )
  }
  // 아무 태그도 안 붙는 사람이 시드에 있는가. 전원에게 태그가 붙으면 "조건을 안 만드는
  // 입력은 태그를 안 만든다"를 화면에서 볼 수 없다.
  const tagged = new Set(detectAnomalies(seen, people).map((a) => a.user_id))
  assert.equal(
    tagged.has(DUMMY_UID.salesStaff2),
    false,
    'dummy 시드에 태그가 하나도 안 붙는 사람이 없다 — 전원이 이상 징후면 그 목록은 아무 말도 하지 않는다',
  )

  // 시드가 센 이번 주 건수. 아래 recordRead 두 번이 여기에 얼마나 더하는지를 잰다.
  const seedWeekEvents = (await dummyRepository.getActivityWeek())?.events ?? 0

  // 5분 억제가 dummy에도 있는가.
  assert.equal(
    await dummyRepository.recordRead({
      path: '/check-activity',
      kind: 'page',
      entity_id: null,
      entity_table: null,
      business_id: null,
      device: 'Chrome · Windows',
      city: 'Seoul, KR',
    }),
    true,
    'dummy: 첫 기록이 안 남는다',
  )
  assert.equal(
    await dummyRepository.recordRead({
      path: '/check-activity',
      kind: 'page',
      entity_id: null,
      entity_table: null,
      business_id: null,
      device: 'Chrome · Windows',
      city: 'Seoul, KR',
    }),
    false,
    'dummy: 같은 화면을 바로 다시 열었는데 또 한 줄이 남는다 — DB에는 5분 억제가 있고 dummy에는 없으면, dummy로 하는 확인이 억제를 한 번도 안 본다',
  )

  const week = await dummyRepository.getActivityWeek()
  assert.ok(
    week && week.events >= seedWeekEvents && seedWeekEvents > 0,
    'dummy: 주간 집계가 시드를 안 센다 — 브리핑 한 줄이 "이번 주 0건"이라는 거짓말을 한다',
  )
  // 방금 남긴 한 줄만 늘었는가. 두 번 불렀지만 둘째는 억제됐다 — 억제된 재진입이
  // 집계에는 세어지면, 화면의 줄 수와 브리핑의 숫자가 갈라진다.
  assert.equal(
    (week?.events ?? 0) - seedWeekEvents,
    1,
    'dummy: 주간 집계가 억제된 재진입까지 센다(또는 남긴 줄을 안 센다) — 화면의 줄 수와 브리핑의 숫자가 갈라진다',
  )
  assert.equal(
    Object.keys(week ?? {}).some((k) => /user|name|path|city|device/.test(k)),
    false,
    'dummy 주간 집계에 사람·경로·도시 칸이 있다 — 브리핑에 명단이 실린다',
  )
}

/* =====================================================================
 * D. 고지 — 지워져도 아무 기능이 안 깨지므로, 검사가 없으면 조용히 사라진다.
 * ===================================================================== */

function notices() {
  const login = src('app', 'login', 'page.tsx')
  assert.ok(
    login.includes('ACTIVITY_RETENTION_DAYS'),
    '로그인 고지: 보관 기간을 숫자로 손으로 적었거나 아예 없다 — 상수에서 가져와야 기간을 바꾸는 날 고지가 같이 따라온다',
  )
  assert.ok(
    /IP 주소 원본은 남기지 않습니다/.test(login),
    '로그인 고지: "IP 원본을 남기지 않는다"는 문장이 없다 — 이 기능이 지키는 가장 중요한 약속이고, 말하지 않으면 지키는 줄 아무도 모른다',
  )
  assert.ok(
    /never the raw IP address/.test(login),
    '로그인 고지: 영문 문구가 없다 — 원문은 ko/en 둘 다를 시켰다',
  )
  assert.ok(
    /href="\/privacy"/.test(login),
    '로그인 고지: /privacy로 가는 링크가 없다 — 고지가 문서로 이어지지 않으면 한 문단짜리 안내일 뿐이다',
  )

  const privacy = src('app', 'privacy', 'page.tsx')
  assert.ok(
    privacy.includes('ACTIVITY_RETENTION_DAYS'),
    '/privacy: 보관 기간이 상수에서 오지 않는다 — 코드와 문서가 갈라지는 날 문서 쪽이 거짓이 된다',
  )
  assert.ok(
    /<Article title="1\. 열람 기록/.test(privacy),
    '/privacy에 열람 기록 **항목**이 없다 — 원문이 고지 문구와 함께 시킨 둘 중 하나다. 본문 어딘가에 그 낱말이 있는 것과 항목이 서 있는 것은 다르다(음성 대조가 이 차이를 잡아냈다)',
  )
  assert.ok(
    /행 자체를 삭제하지는 않습니다/.test(privacy),
    '/privacy가 "행을 지우지는 않는다"는 절충을 숨겼다 — 읽을 수 없게 하는 것과 지우는 것은 다른 일이고, 그 차이를 안 적으면 문서가 실제보다 강하게 약속한다',
  )
  assert.ok(
    /English summary/.test(privacy),
    '/privacy에 영문 요약이 없다 — 고지가 ko/en 둘 다여야 한다는 요구는 문서에도 걸린다',
  )

  const proxy = readFileSync(join(SRC, 'proxy.ts'), 'utf8')
  assert.ok(
    /PUBLIC_PATHS\s*=\s*\[[^\]]*'\/privacy'/.test(proxy),
    '/privacy가 로그인해야 열린다 — 로그인 전에 읽을 수 없는 개인정보 처리방침은 고지가 아니다(proxy.ts PUBLIC_PATHS)',
  )

  // 기록하는 자리가 실제로 배선돼 있는가. 원문이 지목한 셋이다.
  const wired: [string, string[]][] = [
    ['페이지 진입(대시보드)', ['app', '(dashboard)', 'page.tsx']],
    ['페이지 진입(문서 목록)', ['app', '(dashboard)', 'documents', 'page.tsx']],
    ['문서 열람', ['app', '(dashboard)', 'documents', '[id]', 'page.tsx']],
    ['재무 화면 조회', ['app', '(dashboard)', 'finance', '[business_id]', 'page.tsx']],
    ['접속 현황 화면 자신', ['app', '(dashboard)', 'settings', 'activity', 'page.tsx']],
  ]
  for (const [what, path] of wired) {
    assert.ok(
      src(...path).includes('recordScreenRead('),
      `${what}에서 열람 기록을 남기지 않는다 — 원문이 지목한 세 가지(페이지 진입·문서 열람·재무 화면 조회) 중 하나가 배선되지 않았다`,
    )
  }

  // 회장 화면이 두 겹으로 막혀 있는가(화면의 404 + 함수의 게이트).
  const screen = src('app', '(dashboard)', 'settings', 'activity', 'page.tsx')
  assert.ok(
    /role !== 'Chairman'[\s\S]{0,40}notFound\(\)/.test(screen),
    '접속 현황 화면에 회장 게이트가 없다 — DB 게이트만 믿으면 화면이 빈 표로 떠서 "고장"처럼 보인다',
  )
}

async function main() {
  await database()
  rules()
  await dummy()
  notices()
  console.log(
    'PASS: 5분 중복 억제(4분 1줄 · 6분 2줄 · 다른 경로 따로), 시스템 계정 제외, ' +
      'IP·원문 UA 차단(IPv4·IPv6·UA + p_ip 인자 부재), 회장 전용 게이트(팀장·직원·프로필 없는 계정 0건 + subtree 대조군), ' +
      `보관 ${ACTIVITY_RETENTION_DAYS}일(179 보임 · 181 안 보임 · 본인도 · 다른 action은 그대로), append-only(삭제·수정 거부), ` +
      '로그인 실패(익명 기록 · 모르는 이메일 무시 · 익명 직접 INSERT 차단 · 로그인 세션 무시), ' +
      'activity_digest(숫자만 · AIAgent 읽기 · 직원·팀장 차단), 이상 징후 5종 양·음 대조, ' +
      'dummy 게이트·억제·시드 5종, 고지(로그인 ko/en · /privacy 공개 · 기록 호출부 5곳)',
  )
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

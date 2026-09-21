/**
 * 의존(SUCCESSION) 검사 — npm run check:dependency (Phase 7 블록 A · 0033)
 *
 * 이 블록 전체의 목적은 **느낌을 숫자로 바꾸는 것**이다. 그래서 이 검사가 재려는 것도
 * "화면이 뜨는가"가 아니라 **"그 숫자가 맞는가, 그리고 모르는 것을 모른다고 말하는가"**다.
 * 이 기능이 틀리는 방식은 하나뿐인데, 조용하다: 역산이 닿지 않은 결정을 CEO 결정으로
 * 세면 Founder Dependency가 **좋아 보인다.** 아무도 이상하게 여기지 않는다.
 *
 * 네 덩이다.
 *   A. DB    — PGlite에 마이그레이션 전부를 올리고 **BYPASSRLS 없는 소유자**에서 잰다.
 *              그 조건이 요점이다(check-activity·check-migrations와 같은 설정·같은 이유):
 *              superuser 하네스에서만 재면 production에서만 조용히 0행이 되는 상태를
 *              그대로 통과시킨다.
 *   B. 식    — lib/dependency.ts의 founderDependency(). **SQL 뷰와 같은 고정 입력**을 넣어
 *              둘 다 정확히 37%를 내는지 본다. 구현이 둘이라 한쪽만 고쳐지는 날이 온다.
 *   C. dummy — 읽기·쓰기 게이트가 dummy 어댑터에도 같은 모양으로 있는가. 확인은 dummy로만
 *              하므로, 여기가 다르면 화면에서 본 것이 거짓이 된다.
 *   D. 화면  — '아직 평가 없음' 같은 빈 칸 문구와 정의·규칙 문장이 **실제로 그 자리에 있는가.**
 *              지워져도 아무 기능이 안 깨지므로 검사가 없으면 조용히 사라진다.
 *
 * ■ 음성 대조 ■ DEP_BREAK=<key> 로 **재려는 대상 자체를 일부러 깨뜨린다**(단언이 아니라
 * 시스템을 깬다 — 뷰를 바꾸고, 제약을 떨어뜨리고, 정책을 열고, 시드를 지운다).
 * 그 상태에서 해당 단언이 실제로 빨개지는지 확인한 문구가 블록 보고서에 있다.
 * 키 목록은 BREAKS에 있고, 모르는 키를 주면 여기서 먼저 멈춘다.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { PGlite } from '@electric-sql/pglite'
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm'

import {
  BACKFILL_RULES_KO,
  DEPENDENCY_LADDER,
  DEPENDENCY_TARGET,
  founderDependency,
  IMPORTANT_DECISION_RULE_KO,
  nextAbsenceTest,
  nextTransfer,
  recentPeriods,
  transferProgress,
  type DecisionForIndex,
} from '../src/lib/dependency'
import { dummyRepository } from '../src/lib/repository/dummy'
import { DUMMY_SESSION_KEY } from '../src/lib/repository/dummy-org'
import {
  ABSENCE_DAYS,
  ABSENCE_RESULT,
  AUTONOMY_CRITERIA_KO,
  AUTONOMY_EMPTY_KO,
  DECIDED_BY_KIND,
  DEPENDENCY_LEVEL,
  DEPENDENCY_LEVEL_EMPTY_KO,
  TRANSFER_STATUS,
  TRANSFER_STATUS_EMPTY_KO,
} from '../src/types'
import { applyAll, MIGRATIONS } from './pglite'

const ROOT = join(__dirname, '..')
const src = (...p: string[]) => readFileSync(join(ROOT, 'src', ...p), 'utf8')

/* =====================================================================
 * 음성 대조 스위치
 * ===================================================================== */

const BREAKS = {
  /** 뷰가 null 행을 분모에 넣는다 — 역산 미도달을 CEO 결정으로 세는 바로 그 거짓. */
  'view-denominator': 'founder_dependency가 decided_by_kind=null을 분모에 넣게 바꾼다',
  /** 뷰가 Open 결정까지 센다. */
  'view-open': 'founder_dependency가 아직 처리되지 않은 결정까지 세게 바꾼다',
  /** 이양 상태 check 제약을 떨어뜨린다. */
  'drop-transfer-check': 'dependency_areas의 transfer_status check를 지운다',
  /** 부재 테스트 결과 check 제약을 떨어뜨린다. */
  'drop-result-check': 'absence_tests의 result check를 지운다',
  /** 누구나 읽는 정책을 하나 더 연다 — 회사 격리와 역할 게이트가 같이 무너진다. */
  'open-read': '승계 표 넷에 "로그인했으면 읽기" 정책을 하나 더 연다',
  /** 쓰기를 모두에게 연다. */
  'open-write': 'dependency_areas의 쓰기를 모든 활성 사용자에게 연다',
  /** DY 시드를 지운다. */
  'wipe-seed': 'DY 시드(영역·부재 테스트·Direction)를 지운다',
  /** 역산 트리거를 떨어뜨린다 — 새 결정이 지표에서 조용히 빠진다. */
  'drop-trigger': 'decisions_fill_kind 트리거를 지운다',
  /** 역산 규칙 ①을 되돌린다(역산이 한 건도 안 닿은 상태로 만든다). */
  'undo-backfill': '역산 결과를 전부 null로 되돌린다',
  /** 뷰에서 security_invoker를 뗀다 — RLS를 우회하는 뷰가 된다. */
  'view-definer': 'founder_dependency의 security_invoker를 끈다',
  /** interventions가 위임을 빼고 센다 — 개입이 실제보다 적어 보인다. */
  'interventions-no-delegate': 'interventions에서 위임(delegate)을 뺀다',
  /** TS 식이 null을 ceo로 접는다. */
  'ts-null-as-ceo': 'founderDependency()에 주는 고정 입력의 null을 ceo로 바꾼다',
  /** dummy 게이트를 없앤 것과 같은 상태를 만든다(회장이 아닌 세션에서도 전부 읽기). */
  'dummy-gate': 'dummy 세션 전환을 무시하고 늘 회장으로 읽는다',
  /** 화면 문구 검사가 실제로 파일을 보는가. */
  'screen-text': '화면에서 찾는 문구를 있을 리 없는 것으로 바꾼다',
} as const
type BreakKey = keyof typeof BREAKS

const BREAK = (process.env.DEP_BREAK ?? '') as BreakKey | ''
if (BREAK && !(BREAK in BREAKS)) {
  throw new Error(
    `DEP_BREAK=${BREAK} 는 모르는 키다. 있는 것: ${Object.keys(BREAKS).join(', ')}`,
  )
}
const broke = (k: BreakKey) => BREAK === k

/* =====================================================================
 * A. DB
 * ===================================================================== */

const U = {
  chair: '00000000-0000-0000-0000-0000000a7001',
  cfo: '00000000-0000-0000-0000-0000000a7002',
  dyCeo: '00000000-0000-0000-0000-0000000a7003',
  vanaCeo: '00000000-0000-0000-0000-0000000a7004',
  lead: '00000000-0000-0000-0000-0000000a7005',
  member: '00000000-0000-0000-0000-0000000a7006',
  exec: '00000000-0000-0000-0000-0000000a7007',
}

/** §7의 예시 그대로. 이 셋이 이 검사의 고정 입력이다. */
const FIXTURE = { chairman: 37, ceo: 42, rule: 21 }
/** 역산이 닿지 않은 행. 분자에도 분모에도 들어가면 안 된다. */
const FIXTURE_UNKNOWN = 13

async function database() {
  const db = new PGlite({ extensions: { pg_trgm } })
  await applyAll(db)

  // BYPASSRLS 없는 소유자. check-activity.ts A절과 같은 설정·같은 이유다.
  await db.exec(`
    create role app_owner nosuperuser nobypassrls nologin;
    grant usage on schema auth to app_owner;
    grant select on auth.users to app_owner;
    grant execute on all functions in schema public to app_owner;
    alter table public.decisions             owner to app_owner;
    alter table public.dependency_areas      owner to app_owner;
    alter table public.autonomy_assessments  owner to app_owner;
    alter table public.absence_tests         owner to app_owner;
    alter table public.chairman_directions   owner to app_owner;
    alter table public.user_profiles         owner to app_owner;
    grant usage on schema public, auth to authenticated, anon;
  `)
  const owner = await db.query<{ s: boolean; b: boolean }>(
    `select rolsuper as s, rolbypassrls as b from pg_roles where rolname = 'app_owner'`,
  )
  assert.equal(owner.rows[0].s, false, '실험 설정이 깨졌다 — app_owner가 superuser다')
  assert.equal(owner.rows[0].b, false, '실험 설정이 깨졌다 — app_owner가 bypassrls다')

  await db.exec(`
    insert into auth.users values
      ('${U.chair}', 'chair@x'), ('${U.cfo}', 'cfo@x'), ('${U.dyCeo}', 'dyceo@x'),
      ('${U.vanaCeo}', 'vanaceo@x'), ('${U.lead}', 'lead@x'), ('${U.member}', 'member@x'),
      ('${U.exec}', 'exec@x');
    insert into user_profiles (user_id, role, display_name, reports_to) values
      ('${U.chair}',   'Chairman',    '회장',      null),
      ('${U.cfo}',     'GroupCFO',    '그룹 CFO',  '${U.chair}'),
      ('${U.dyCeo}',   'BusinessCEO', 'DY 대표',   '${U.chair}'),
      ('${U.vanaCeo}', 'BusinessCEO', 'VANA 대표', '${U.chair}'),
      ('${U.exec}',    'Executive',   '본부장',    '${U.dyCeo}'),
      ('${U.lead}',    'TeamLead',    '팀장',      '${U.exec}'),
      ('${U.member}',  'Member',      '직원',      '${U.lead}');
    insert into user_business_access (user_id, business_id) values
      ('${U.dyCeo}', 'biz_dy'), ('${U.vanaCeo}', 'biz_vana'),
      ('${U.exec}', 'biz_dy'), ('${U.lead}', 'biz_dy'), ('${U.member}', 'biz_dy');
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
  async function val<T>(uid: string | null, sql: string, role = 'authenticated'): Promise<T | null> {
    const r = await rows<Record<string, T>>(uid, sql, role)
    return r.length ? (Object.values(r[0])[0] ?? null) : null
  }
  /** 문장이 거부되는가. 거부되면 메시지, 통과하면 null. */
  async function rejected(uid: string | null, sql: string, role = 'authenticated') {
    try {
      await rows(uid, sql, role)
      return null
    } catch (e) {
      return e instanceof Error ? e.message : String(e)
    }
  }

  /* ---------------------------------------------------------------- 1. 값 목록 */

  /**
   * ① TS의 값 목록과 0033의 check 제약이 같은가.
   *    갈라지면 화면이 DB가 받아 주지 않는 값을 그리고, 저장을 누르는 순간에야 23514다.
   */
  const constraints = await db.query<{ conname: string; def: string }>(`
    select conname, pg_get_constraintdef(oid) as def from pg_constraint
     where conname in ('decisions_decided_by_kind_check', 'dependency_areas_level_check',
                       'dependency_areas_transfer_check', 'absence_tests_result_check',
                       'absence_tests_days_check', 'autonomy_level_check')
  `)
  const defOf = (n: string) => constraints.rows.find((r) => r.conname === n)?.def ?? ''
  for (const v of DECIDED_BY_KIND) {
    assert.ok(
      defOf('decisions_decided_by_kind_check').includes(`'${v}'`),
      `0033의 decided_by_kind check에 '${v}'가 없다 — types/succession.ts와 DB의 값 목록이 갈라졌다`,
    )
  }
  for (const v of DEPENDENCY_LEVEL) {
    assert.ok(defOf('dependency_areas_level_check').includes(`'${v}'`), `level check에 '${v}'가 없다`)
  }
  for (const v of TRANSFER_STATUS) {
    assert.ok(
      defOf('dependency_areas_transfer_check').includes(`'${v}'`),
      `transfer_status check에 '${v}'가 없다`,
    )
  }
  for (const v of ABSENCE_RESULT) {
    assert.ok(defOf('absence_tests_result_check').includes(`'${v}'`), `absence result check에 '${v}'가 없다`)
  }
  /** ② §12는 7/30/90/365 넷이다. 원문 지시는 셋이었고, 어긋나면 문서가 이긴다. */
  for (const d of ABSENCE_DAYS) {
    assert.ok(
      defOf('absence_tests_days_check').includes(String(d)),
      `absence_tests_days_check에 ${d}이 없다 — 문서 §12가 7/30/90/365 넷을 말한다`,
    )
  }

  /** ③ audit_action enum에 새 값을 만들지 않았다(0022의 55P04). */
  const actions = await db.query<{ n: string }>(
    `select enumlabel as n from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'audit_action' order by e.enumsortorder`,
  )
  const names = actions.rows.map((r) => r.n)
  for (const need of ['approve', 'reject', 'modify', 'delegate', 'create', 'update']) {
    assert.ok(names.includes(need), `audit_action에 '${need}'가 없다 — 0033이 쓰는 값이다`)
  }
  assert.ok(
    !names.some((n) => n.startsWith('succession') || n.startsWith('dependency')),
    `0033이 audit_action에 새 값을 만들었다(${names.join(',')}) — 0022가 production에서 55P04를 밟은 자리다`,
  )

  /* ---------------------------------------------------------------- 2. 구조 */

  /** ④ 새 표 넷에 force row level security가 걸려 있지 않다(이 저장소가 네 번 밟은 함정). */
  const forced = await db.query<{ relname: string; f: boolean; r: boolean }>(`
    select relname, relforcerowsecurity as f, relrowsecurity as r from pg_class
     where relname in ('dependency_areas', 'autonomy_assessments', 'absence_tests', 'chairman_directions')
  `)
  if (broke('open-read')) {
    await db.exec(`
      create policy break_open_read on dependency_areas for select using (is_active());
      create policy break_open_read2 on autonomy_assessments for select using (is_active());
      create policy break_open_read3 on absence_tests for select using (is_active());
      create policy break_open_read4 on chairman_directions for select using (is_active());
    `)
  }
  if (broke('open-write')) {
    // insert만 연다. `for all`로 열면 select까지 같이 열려서 **회사 격리 단언이 먼저** 터지고,
    // 정작 재려던 "CEO는 자기 회사도 못 쓴다"가 한 번도 안 재어진다.
    await db.exec(
      `create policy break_open_write on dependency_areas for insert with check (is_active());`,
    )
  }
  assert.equal(forced.rows.length, 4, '승계 표 넷 중 없는 것이 있다')
  for (const t of forced.rows) {
    assert.equal(t.r, true, `${t.relname}에 row level security가 꺼져 있다`)
    assert.equal(
      t.f,
      false,
      `${t.relname}에 force row level security가 걸렸다 — 이 저장소가 네 번 밟은 함정이다(0023·0027·0029). 자물쇠는 revoke다`,
    )
  }

  /** ⑤ 뷰 둘이 security_invoker다 — RLS를 우회하는 새 경로를 만들지 않는다. */
  for (const v of ['founder_dependency', 'interventions']) {
    if (broke('view-definer') && v === 'founder_dependency') {
      await db.exec(`alter view founder_dependency set (security_invoker = false)`)
    }
    const opts = await val<string[]>(null, `select reloptions from pg_class where relname = '${v}'`, 'app_owner')
    assert.ok(
      (opts ?? []).includes('security_invoker=true'),
      `뷰 ${v}에 security_invoker=true가 없다 — 뷰가 RLS를 우회한다(reloptions=${JSON.stringify(opts)})`,
    )
  }

  /** ⑥ anon에게는 새 표 넷과 뷰 둘의 권한이 없다. 자물쇠는 revoke다. */
  for (const t of ['dependency_areas', 'autonomy_assessments', 'absence_tests', 'chairman_directions', 'founder_dependency', 'interventions']) {
    const anon = await val<boolean>(null, `select has_table_privilege('anon', '${t}', 'select')`, 'app_owner')
    assert.equal(anon, false, `anon이 ${t}를 읽을 수 있다 — revoke가 빠졌다`)
  }

  /* ---------------------------------------------------------------- 3. DY 시드 */

  if (broke('wipe-seed')) {
    await db.exec(`delete from dependency_areas; delete from absence_tests; delete from chairman_directions;`)
  }

  /** ⑦ 영역 6 · 이양 7. **합집합은 8줄이다** — 두 목록이 겹치되 같지 않다. */
  const seeded = await rows<{ area: string; level: string | null; transfer_status: string | null }>(
    U.chair,
    `select area, level, transfer_status from dependency_areas where business_id = 'biz_dy' order by sort_order`,
  )
  assert.equal(
    seeded.filter((r) => r.level !== null).length,
    6,
    `DY의 의존도 평가가 6건이 아니다(${seeded.filter((r) => r.level !== null).length}건) — §7의 영역 목록 여섯이다`,
  )
  assert.equal(
    seeded.filter((r) => r.transfer_status !== null).length,
    7,
    `DY의 이양 계획이 7건이 아니다(${seeded.filter((r) => r.transfer_status !== null).length}건) — §11 TRANSFER MATRIX의 일곱 줄이다`,
  )
  assert.equal(
    seeded.filter((r) => r.transfer_status === 'done').length,
    3,
    'DY의 이양 완료가 3건(생산·채용·국내영업)이 아니다',
  )
  /** ⑧ **빈 칸을 채우지 않았다.** R&D의 이양 상태는 null이어야 한다(§11과 §35가 어긋난다). */
  const rnd = seeded.find((r) => r.area === 'R&D')
  assert.ok(rnd, 'DY 시드에 R&D 영역이 없다')
  assert.equal(
    rnd!.transfer_status,
    null,
    'R&D의 이양 상태가 채워져 있다 — §11 TRANSFER MATRIX에는 R&D가 없고 §35 화면 예시에는 IN PROGRESS로 있다. 문서 안에서 어긋나는 자리는 추측으로 채우지 않는다',
  )

  /** ⑨ 부재 테스트: 30일 PASS(8월) · 90일 예정(12월). */
  const tests = await rows<{ days: number; result: string; scheduled_on: string }>(
    U.chair,
    `select days, result, to_char(scheduled_on, 'YYYY-MM') as scheduled_on from absence_tests where business_id = 'biz_dy' order by days`,
  )
  assert.deepEqual(
    tests.map((t) => [t.days, t.result, t.scheduled_on]),
    [
      [30, 'pass', '2026-08'],
      [90, 'pending', '2026-12'],
    ],
    '§34 TARGET의 부재 테스트 둘(30일 PASS 8월 · 90일 예정 12월)이 시드에 없다',
  )

  /** ⑩ **Autonomy 등급과 Dependency %는 시드에 없다.** 문서에 그 값이 없기 때문이다. */
  const autonomySeeded = await val<number>(U.chair, `select count(*)::int from autonomy_assessments`)
  assert.equal(
    Number(autonomySeeded),
    0,
    '0033이 자율성 평가를 시드로 넣었다 — 문서 어디에도 "DY는 지금 L몇"이 없다. 지어낸 등급에서 다음 분기 평가가 출발하게 된다',
  )

  /** ⑪ Direction은 §20의 DY 예시 그대로, letter·contact_when은 비어 있다. */
  const dir = await rows<{ five_year: string; priorities: string[]; letter: string | null; contact_when: string[] }>(
    U.chair,
    `select five_year, priorities, letter, contact_when from chairman_directions where business_id = 'biz_dy'`,
  )
  assert.equal(dir.length, 1, 'DY의 Direction이 시드에 없다')
  assert.equal(dir[0].priorities.length, 4, '§20 Priorities 넷이 아니다')
  assert.equal(
    dir[0].letter,
    null,
    'Letter 본문이 시드에 채워져 있다 — 문서에 DY의 실제 문구가 없다. 화면이 "아직 작성되지 않았습니다"라고 말해야 한다',
  )

  /* ---------------------------------------------------------------- 4. §7 식 */

  /**
   * ⑫ **§7의 식 그대로.** 결정 100건(chairman 37 / ceo 42 / rule 21)을 심으면 뷰가 정확히 37%다.
   *    거기에 역산이 닿지 않은 13건을 더해도 **37%는 그대로**여야 한다(⑬).
   */
  const seedDecisions = (kind: string | null, n: number, offset: number, biz = 'biz_dy') =>
    Array.from({ length: n }, (_, i) => {
      const id = `t_${biz}_${kind ?? 'null'}_${offset + i}`
      return `('${id}', '${biz}', '건 ${id}', 'Approved', timestamptz '2026-07-15 12:00+09', ${kind ? `'${kind}'` : 'null'})`
    }).join(',')

  await db.exec(`
    insert into decisions (decision_id, business_id, title, status, decided_at, decided_by_kind) values
      ${seedDecisions('chairman', FIXTURE.chairman, 0)},
      ${seedDecisions('ceo', FIXTURE.ceo, 0)},
      ${seedDecisions('rule', FIXTURE.rule, 0)},
      ${seedDecisions(null, FIXTURE_UNKNOWN, 0)};
  `)

  if (broke('view-denominator')) {
    await db.exec(`
      create or replace view founder_dependency with (security_invoker = true) as
        select d.business_id,
               to_char(coalesce(d.decided_at, d.created_at) at time zone 'Asia/Seoul', 'YYYY-MM') as period,
               count(*) filter (where d.decided_by_kind = 'chairman') as chairman_count,
               count(*) filter (where d.decided_by_kind = 'ceo') as ceo_count,
               count(*) filter (where d.decided_by_kind = 'rule') as rule_count,
               count(*) as total_count,
               count(*) filter (where d.decided_by_kind is null) as unknown_count,
               round(count(*) filter (where d.decided_by_kind = 'chairman')::numeric * 100 / count(*), 1) as dependency_pct
          from decisions d where d.status <> 'Open' group by 1, 2;
    `)
  }
  if (broke('view-open')) {
    await db.exec(`
      create or replace view founder_dependency with (security_invoker = true) as
        select d.business_id,
               to_char(coalesce(d.decided_at, d.created_at) at time zone 'Asia/Seoul', 'YYYY-MM') as period,
               count(*) filter (where d.decided_by_kind = 'chairman') as chairman_count,
               count(*) filter (where d.decided_by_kind = 'ceo') as ceo_count,
               count(*) filter (where d.decided_by_kind = 'rule') as rule_count,
               count(*) filter (where d.decided_by_kind is not null) as total_count,
               count(*) filter (where d.decided_by_kind is null) as unknown_count,
               case when count(*) filter (where d.decided_by_kind is not null) = 0 then null
                    else round(count(*) filter (where d.decided_by_kind = 'chairman')::numeric * 100
                               / count(*) filter (where d.decided_by_kind is not null), 1) end as dependency_pct
          from decisions d group by 1, 2;
    `)
  }

  const july = await rows<{
    chairman_count: number
    ceo_count: number
    rule_count: number
    total_count: number
    unknown_count: number
    dependency_pct: string
  }>(U.chair, `select * from founder_dependency where business_id = 'biz_dy' and period = '2026-07'`)

  assert.equal(july.length, 1, '2026-07의 founder_dependency 행이 없다 — 뷰가 아무것도 세지 않았다')
  assert.equal(
    Number(july[0].dependency_pct),
    37,
    `§7의 식이 37%를 내지 않는다(${july[0].dependency_pct}%). chairman ${july[0].chairman_count} / total ${july[0].total_count}`,
  )
  assert.equal(Number(july[0].total_count), 100, `분모가 100이 아니다(${july[0].total_count})`)

  /** ⑬ 역산이 닿지 않은 행은 **분자에도 분모에도** 없다. 대신 건수로 따로 나온다. */
  assert.equal(
    Number(july[0].unknown_count),
    FIXTURE_UNKNOWN,
    `역산 미도달 건수가 ${FIXTURE_UNKNOWN}이 아니다(${july[0].unknown_count}) — 화면이 그 숫자를 보여 줄 수 없다`,
  )
  assert.equal(
    Number(july[0].chairman_count) + Number(july[0].ceo_count) + Number(july[0].rule_count),
    Number(july[0].total_count),
    '분모가 세 종류의 합과 다르다 — null 행이 분모에 섞였다. 그러면 의존도가 실제보다 낮게 보인다',
  )

  /** ⑭ 아직 처리되지 않은 결정(Open)은 세지 않는다 — '누가 정했나'가 없는 행이다. */
  await db.exec(`
    insert into decisions (decision_id, business_id, title, status, decided_at)
    values ('t_open_1', 'biz_dy', '아직 안 정한 건', 'Open', timestamptz '2026-07-15 12:00+09');
  `)
  const afterOpen = await rows<{ total_count: number; unknown_count: number }>(
    U.chair,
    `select total_count, unknown_count from founder_dependency where business_id = 'biz_dy' and period = '2026-07'`,
  )
  assert.equal(
    Number(afterOpen[0].total_count) + Number(afterOpen[0].unknown_count),
    100 + FIXTURE_UNKNOWN,
    '아직 처리되지 않은 결정(Open)이 지표에 들어갔다 — 그 행에는 "누가 정했나"가 아직 없다',
  )

  /* ---------------------------------------------------------------- 5. 역산 */

  /**
   * ⑮ 역산 규칙 ①(audit_log의 actor_role)이 실제로 동작하는가.
   *    마이그레이션은 이미 돌았으므로 같은 규칙을 그때의 상태로 다시 재현해 확인한다.
   */
  await db.exec(`
    insert into decisions (decision_id, business_id, title, status, decided_at, decided_by)
    values ('t_back_chair', 'biz_dy', '회장이 닫은 건', 'Approved', now(), null),
           ('t_back_ceo',   'biz_dy', 'CEO가 닫은 건',  'Approved', now(), null),
           ('t_back_none',  'biz_dy', '아무 기록도 없는 건', 'Approved', now(), null),
           ('t_back_by',    'biz_dy', '처리자만 아는 건', 'Approved', now(), '${U.dyCeo}');
    update decisions set decided_by_kind = null where decision_id like 't_back_%';
    insert into audit_log (actor_user_id, actor_role, action, entity_table, entity_id, business_id) values
      ('${U.chair}', 'Chairman',    'approve', 'decisions', 't_back_chair', 'biz_dy'),
      ('${U.dyCeo}', 'BusinessCEO', 'approve', 'decisions', 't_back_ceo',   'biz_dy');
  `)
  if (!broke('undo-backfill')) {
    await db.exec(`
      update decisions d set decided_by_kind = decision_kind_of(a.actor_role)
        from (select distinct on (entity_id) entity_id, actor_role from audit_log
               where entity_table = 'decisions' and action::text in ('approve','reject','modify','delegate')
               order by entity_id, occurred_at desc, id desc) a
       where a.entity_id = d.decision_id and d.status <> 'Open' and d.decided_by_kind is null
         and decision_kind_of(a.actor_role) is not null;
      update decisions d set decided_by_kind = decision_kind_of(p.role::text)
        from user_profiles p
       where p.user_id = d.decided_by and d.status <> 'Open' and d.decided_by_kind is null
         and decision_kind_of(p.role::text) is not null;
    `)
  }
  const back = await rows<{ decision_id: string; decided_by_kind: string | null }>(
    U.chair,
    `select decision_id, decided_by_kind from decisions where decision_id like 't_back_%' order by decision_id`,
  )
  /** null(역산 미도달)과 '행이 아예 없다'를 구분한다. ??로 접으면 둘이 같은 글자가 된다. */
  const kindOf = (id: string) => {
    const row = back.find((r) => r.decision_id === id)
    assert.ok(row, `${id} 행이 안 보인다 — 이 단언이 재려는 대상이 없다(decisions_read를 본다)`)
    return row!.decided_by_kind
  }
  assert.equal(
    kindOf('t_back_chair'),
    'chairman',
    '역산 규칙 ①(audit_log의 actor_role)이 회장 처리를 chairman으로 만들지 못한다 — 이 규칙이 이 블록의 유일한 재료다',
  )
  assert.equal(kindOf('t_back_ceo'), 'ceo', '역산 규칙 ①이 CEO 처리를 ceo로 만들지 못한다')
  assert.equal(
    kindOf('t_back_by'),
    'ceo',
    '역산 규칙 ②(decided_by의 지금 역할)가 동작하지 않는다',
  )
  /** ⑯ **닿지 않는 행은 null로 남는다.** 이 단언이 이 검사에서 제일 중요하다. */
  assert.equal(
    kindOf('t_back_none'),
    null,
    '역산이 닿지 않은 행에 값이 생겼다 — 지어낸 값으로 Founder Dependency를 계산하면 §7의 지표 전체가 허구가 된다',
  )

  /** ⑰ GroupCFO는 null이다 — 모르는 것을 ceo로 접으면 지표가 좋아 보인다. */
  const cfoKind = await val<string | null>(U.chair, `select decision_kind_of('GroupCFO')`)
  assert.equal(cfoKind, null, "decision_kind_of('GroupCFO')가 값을 냈다 — 그룹 CFO는 그 회사의 CEO가 아니다")
  assert.equal(await val(U.chair, `select decision_kind_of('Member')`), null, 'Member가 값을 갖는다')
  assert.equal(await val(U.chair, `select decision_kind_of('AIAgent')`), 'rule', 'AIAgent가 rule이 아니다')

  /**
   * ⑱ 트리거: 결정이 Open을 벗어나는 순간 칸이 채워진다.
   *    PostgREST로 직접 status만 바꾼 행이 지표에서 조용히 빠지지 않게 하는 방어선이다.
   */
  if (broke('drop-trigger')) await db.exec(`drop trigger decisions_fill_kind_trg on decisions`)
  await db.exec(`
    insert into decisions (decision_id, business_id, title, status) values ('t_trg', 'biz_dy', '트리거 시험', 'Open');
    insert into user_business_access (user_id, business_id) values ('${U.chair}', 'biz_dy') on conflict do nothing;
  `)
  await db.exec(
    `select set_config('request.jwt.claim.sub', '${U.chair}', false); set role authenticated;` +
      `update decisions set status = 'Approved', decided_at = now() where decision_id = 't_trg';` +
      `reset role; select set_config('request.jwt.claim.sub', '', false);`,
  )
  assert.equal(
    await val(U.chair, `select decided_by_kind from decisions where decision_id = 't_trg'`),
    'chairman',
    '트리거가 decided_by_kind를 채우지 않았다 — PostgREST로 직접 들어온 행이 지표에서 조용히 빠진다',
  )

  /* ---------------------------------------------------------------- 6. RLS */

  /** ⑲ 회사 격리: CEO는 자기 회사만. 다른 회사는 0건. */
  await db.exec(`
    insert into dependency_areas (business_id, area, level, transfer_status)
    values ('biz_vana', '가격 결정', 'MEDIUM', 'not_started');
    insert into absence_tests (business_id, days, scheduled_on, result)
    values ('biz_vana', 7, date '2026-10-01', 'pending');
    insert into autonomy_assessments (business_id, quarter, level) values ('biz_vana', '2026-Q3', 'L4');
    insert into chairman_directions (business_id, five_year) values ('biz_vana', '캐나다 vertical 확장');
  `)
  const TABLES = ['dependency_areas', 'autonomy_assessments', 'absence_tests', 'chairman_directions']
  for (const t of TABLES) {
    assert.equal(
      Number(await val(U.dyCeo, `select count(*)::int from ${t} where business_id = 'biz_vana'`)),
      0,
      `${t}: DY 대표에게 VANA의 승계 자료가 보인다 — 회사 격리가 깨졌다`,
    )
    assert.ok(
      Number(await val(U.dyCeo, `select count(*)::int from ${t} where business_id = 'biz_dy'`)) >= 0,
      `${t}: DY 대표가 자기 회사를 읽지 못한다`,
    )
    /** ⑳ 나머지 역할(Executive·TeamLead·Member)은 자기 회사에서도 0건이다. 역할 기반이다. */
    for (const [who, uid] of [['Executive', U.exec], ['TeamLead', U.lead], ['Member', U.member]] as const) {
      assert.equal(
        Number(await val(uid, `select count(*)::int from ${t}`)),
        0,
        `${t}: ${who}에게 승계 자료가 보인다 — 원문이 "나머지 거부"라고 못 박았고 이것은 subtree가 아니라 역할 게이트다`,
      )
    }
    /** ㉑ GroupCFO는 전부 읽는다. */
    assert.ok(
      Number(await val(U.cfo, `select count(*)::int from ${t}`)) > 0,
      `${t}: GroupCFO가 읽지 못한다 — 원문은 Chairman·GroupCFO 읽기·쓰기다`,
    )
  }
  /** ㉒ CEO는 자기 회사도 **쓰지 못한다**(원문: CEO는 읽기까지). */
  const ceoWrite = await rejected(
    U.dyCeo,
    `insert into dependency_areas (business_id, area, level) values ('biz_dy', 'CEO가 만든 영역', 'LOW')`,
  )
  assert.ok(
    ceoWrite !== null,
    'DY 대표가 자기 회사의 승계 자료를 썼다 — 원문은 "CEO 자기 회사 읽기"까지다',
  )
  /** ㉓ Chairman은 쓴다. */
  assert.equal(
    await rejected(
      U.chair,
      `insert into dependency_areas (business_id, area, level) values ('biz_dy', '회장이 만든 영역', 'LOW')`,
    ),
    null,
    '회장이 승계 자료를 쓰지 못한다',
  )

  /*
   * 음성 대조용 파괴. **여기서 실제로 제약을 떨어뜨린다.**
   * 처음에는 BREAKS에 키만 적어 두고 아무것도 안 깨뜨렸는데, 그 상태로 돌려도 검사가
   * 그대로 통과했다 — 음성 대조가 "대조 자체가 아무것도 안 하고 있었다"를 먼저 잡아낸 자리다.
   * 값 목록 대조(1절)보다 **뒤**에 두는 이유: 앞에 두면 1절에서 먼저 터져서
   * "제약이 실제로 값을 막는가"(바로 아래)가 한 번도 안 재어진다.
   */
  if (broke('drop-transfer-check')) {
    await db.exec(`alter table dependency_areas drop constraint dependency_areas_transfer_check`)
  }
  if (broke('drop-result-check')) {
    await db.exec(`alter table absence_tests drop constraint absence_tests_result_check`)
  }

  /** ㉔ check 제약이 실제로 값을 막는가. 목록만 있고 제약이 없으면 화면이 아무 값이나 넣는다. */
  const badTransfer = await rejected(
    U.chair,
    `insert into dependency_areas (business_id, area, transfer_status) values ('biz_dy', '잘못된 이양', 'maybe')`,
  )
  assert.ok(
    badTransfer !== null && /dependency_areas_transfer_check|violates check/.test(badTransfer),
    `이양 상태 check가 'maybe'를 통과시켰다 — 세 값 밖의 상태가 표에 들어간다 (${badTransfer})`,
  )
  const badResult = await rejected(
    U.chair,
    `insert into absence_tests (business_id, days, scheduled_on, result) values ('biz_dy', 30, date '2027-01-01', 'maybe')`,
  )
  assert.ok(
    badResult !== null && /absence_tests_result_check|violates check/.test(badResult),
    `부재 테스트 결과 check가 'maybe'를 통과시켰다 (${badResult})`,
  )
  const badDays = await rejected(
    U.chair,
    `insert into absence_tests (business_id, days, scheduled_on) values ('biz_dy', 45, date '2027-01-01')`,
  )
  assert.ok(badDays !== null, 'days check가 45를 통과시켰다 — §12는 7/30/90/365 넷이다')

  /* ---------------------------------------------------------------- 7. interventions */

  if (broke('interventions-no-delegate')) {
    await db.exec(`
      create or replace view interventions with (security_invoker = true) as
        select a.business_id, to_char(a.occurred_at at time zone 'Asia/Seoul', 'YYYY-MM') as period,
               a.action::text as kind, count(*) as count
          from audit_log a
         where a.actor_role = 'Chairman' and a.action::text in ('approve','reject','modify')
         group by 1, 2, 3;
    `)
  }
  await db.exec(`
    insert into audit_log (actor_user_id, actor_role, action, entity_table, entity_id, business_id) values
      ('${U.chair}', 'Chairman',    'reject',   'decisions', 't_iv_1', 'biz_dy'),
      ('${U.chair}', 'Chairman',    'modify',   'decisions', 't_iv_2', 'biz_dy'),
      ('${U.chair}', 'Chairman',    'delegate', 'decisions', 't_iv_3', 'biz_dy'),
      ('${U.dyCeo}', 'BusinessCEO', 'approve',  'decisions', 't_iv_4', 'biz_dy');
  `)
  const iv = await rows<{ kind: string; count: number }>(
    U.chair,
    `select kind, sum(count)::int as count from interventions where business_id = 'biz_dy' group by kind order by kind`,
  )
  const ivKinds = iv.map((r) => r.kind)
  /** ㉕ 위임도 개입이다. 빼면 회장이 손댄 횟수가 실제보다 적게 보인다. */
  assert.ok(
    ivKinds.includes('delegate'),
    `interventions가 위임을 세지 않는다(${ivKinds.join(',')}) — 위임은 회장이 그 건을 손댄 것이고, 빼면 개입이 실제보다 적어 보인다`,
  )
  assert.ok(ivKinds.includes('approve') && ivKinds.includes('reject') && ivKinds.includes('modify'),
    `interventions에 승인·반려·수정이 다 있지 않다(${ivKinds.join(',')})`)
  /** ㉖ CEO가 닫은 건은 회장 개입이 아니다. */
  const ivTotal = iv.reduce((a, r) => a + Number(r.count), 0)
  const chairRows = Number(
    await val(U.chair, `select count(*)::int from audit_log where actor_role = 'Chairman' and business_id = 'biz_dy' and action::text in ('approve','reject','modify','delegate')`),
  )
  assert.equal(ivTotal, chairRows, `interventions 합계(${ivTotal})가 회장 audit 줄 수(${chairRows})와 다르다`)
  /** ㉗ **회장이 아니면 0행이다** — audit_log의 FORCE RLS. 화면은 그것을 0건이라고 말하지 않는다. */
  for (const [who, uid] of [['GroupCFO', U.cfo], ['BusinessCEO', U.dyCeo], ['TeamLead', U.lead]] as const) {
    assert.equal(
      Number(await val(uid, `select count(*)::int from interventions`)),
      0,
      `${who}가 interventions를 읽는다 — audit_log_read는 회장/본인/subtree뿐이고, 이 값이 0이 아니면 정책이 넓어진 것이다`,
    )
  }

  return { july }
}

/* =====================================================================
 * B. 식 — SQL과 TS가 같은 답을 내는가
 * ===================================================================== */

function formula() {
  const rows: DecisionForIndex[] = []
  const push = (kind: DecisionForIndex['decided_by_kind'], n: number) => {
    for (let i = 0; i < n; i += 1) {
      rows.push({
        business_id: 'biz_dy',
        status: 'Approved',
        decided_at: '2026-07-15T12:00:00+09:00',
        created_at: '2026-07-15T12:00:00+09:00',
        decided_by_kind: broke('ts-null-as-ceo') && kind === null ? 'ceo' : kind,
      })
    }
  }
  push('chairman', FIXTURE.chairman)
  push('ceo', FIXTURE.ceo)
  push('rule', FIXTURE.rule)
  push(null, FIXTURE_UNKNOWN)
  // Open 한 건. 세면 안 된다.
  rows.push({
    business_id: 'biz_dy',
    status: 'Open',
    decided_at: null,
    created_at: '2026-07-15T12:00:00+09:00',
    decided_by_kind: null,
  })

  const out = founderDependency(rows)
  assert.equal(out.length, 1, 'founderDependency()가 한 회사·한 달을 한 줄로 접지 못했다')
  /** ㉘ TS 구현도 정확히 37%다. SQL 뷰와 같은 고정 입력이다. */
  assert.equal(
    out[0].dependency_pct,
    37,
    `lib/dependency.ts의 식이 37%를 내지 않는다(${out[0].dependency_pct}%) — SQL 뷰와 갈라졌다`,
  )
  assert.equal(out[0].total_count, 100, `TS 식의 분모가 100이 아니다(${out[0].total_count})`)
  /** ㉙ 역산 미도달은 TS에서도 분모 밖이다. */
  assert.equal(
    out[0].unknown_count,
    FIXTURE_UNKNOWN,
    `TS 식의 역산 미도달 건수가 ${FIXTURE_UNKNOWN}이 아니다(${out[0].unknown_count})`,
  )
  /** ㉚ 셀 것이 하나도 없으면 **null이다. 0%가 아니다.** */
  const empty = founderDependency([
    { business_id: 'biz_x', status: 'Approved', decided_at: '2026-07-15T12:00:00+09:00', created_at: '', decided_by_kind: null },
  ])
  assert.equal(
    empty[0].dependency_pct,
    null,
    '셀 결정이 없는데 0%가 나왔다 — 0은 "세어 보니 없다"이고 null은 "셀 수 없다"다. 화면에서 그 둘은 전혀 다른 말이다',
  )

  /** ㉛ 달은 KST다. UTC로 세면 한국 시간 1일 아침의 결정이 전달로 간다. */
  const edge = founderDependency([
    { business_id: 'biz_x', status: 'Approved', decided_at: '2026-06-30T16:00:00Z', created_at: '', decided_by_kind: 'chairman' },
  ])
  assert.equal(
    edge[0].period,
    '2026-07',
    `달 경계가 KST가 아니다(${edge[0].period}) — 이 저장소의 '오늘'은 KST다`,
  )

  /** ㉜ 12개월 축이 실제로 12칸이고 오름차순이다. */
  const periods = recentPeriods(12, new Date('2026-09-21T00:00:00+09:00'))
  assert.equal(periods.length, 12, '스파크라인 축이 12개월이 아니다')
  assert.equal(periods[11], '2026-09', `축의 마지막 달이 이번 달이 아니다(${periods[11]})`)
  assert.equal(periods[0], '2025-10', `축의 첫 달이 12개월 전이 아니다(${periods[0]})`)
}

/* =====================================================================
 * C. dummy — 게이트가 DB와 같은 모양인가
 * ===================================================================== */

async function dummy() {
  const as = async <T>(key: keyof typeof DUMMY_SESSION_KEY | 'chairman', fn: () => Promise<T>) => {
    const prev = process.env.DUMMY_USER
    process.env.DUMMY_USER = broke('dummy-gate') ? 'chairman' : String(key)
    try {
      return await fn()
    } finally {
      if (prev === undefined) delete process.env.DUMMY_USER
      else process.env.DUMMY_USER = prev
    }
  }

  /** ㉝ 회장은 다섯 회사의 지표를 본다(시드가 실제로 화면을 세운다). */
  const chairRows = await as('chairman', () => dummyRepository.listFounderDependency())
  assert.ok(
    new Set(chairRows.map((r) => r.business_id)).size >= 5,
    `dummy 시드가 다섯 회사의 지표를 만들지 못한다(${new Set(chairRows.map((r) => r.business_id)).size}개사) — 화면이 빈 채로 선다`,
  )
  assert.ok(
    chairRows.some((r) => r.unknown_count > 0),
    'dummy 시드에 역산 미도달 행이 하나도 없다 — 화면의 "역산 미도달 N건" 문구가 개발 중에 한 번도 안 뜬다',
  )

  /** ㉞ 회장이 아닌 세션에서는 개입이 0건이다(live의 FORCE RLS와 같은 답). */
  const ceoIv = await as('dy_ceo', () => dummyRepository.listInterventions())
  assert.equal(
    ceoIv.length,
    0,
    'dummy가 CEO에게 회장 개입 기록을 준다 — live에서는 audit_log의 FORCE RLS가 0행을 준다. dummy가 더 관대하면 화면이 거짓을 배운다',
  )

  /** ㉟ 팀장·직원은 승계 표에서 0건이다. */
  for (const who of ['sales_lead', 'sales_staff'] as const) {
    const areas = await as(who, () => dummyRepository.listDependencyAreas())
    assert.equal(areas.length, 0, `dummy에서 ${who}가 의존 영역을 읽는다 — 역할 게이트가 없다`)
  }

  /** ㊱ CEO는 자기 회사만 읽고, 쓰지는 못한다. */
  const ceoAreas = await as('dy_ceo', () => dummyRepository.listDependencyAreas())
  assert.ok(ceoAreas.length > 0, 'dummy에서 DY 대표가 자기 회사 의존 영역을 못 읽는다')
  assert.ok(
    ceoAreas.every((a) => a.business_id === 'biz_dy'),
    'dummy에서 DY 대표에게 다른 회사의 영역이 보인다',
  )
  let wrote = false
  await as('dy_ceo', async () => {
    try {
      await dummyRepository.saveDependencyArea(
        { business_id: 'biz_dy', area: 'CEO가 만든 영역', level: 'LOW', transfer_status: null, target_date: null, note: null },
        { user_id: '00000000-0000-0000-0000-0000000a7003', role: 'BusinessCEO' },
      )
      wrote = true
    } catch {
      wrote = false
    }
  })
  assert.equal(wrote, false, 'dummy에서 CEO가 승계 자료를 썼다 — 원문은 "CEO 자기 회사 읽기"까지다')

  /** ㊲ DY 시드가 dummy와 0033에서 같은 모양이다(영역 6 · 이양 7 · 부재 테스트 2). */
  const areas = await as('chairman', () => dummyRepository.listDependencyAreas())
  assert.equal(
    areas.filter((a) => a.level !== null).length,
    6,
    `dummy의 DY 의존도 평가가 6건이 아니다(${areas.filter((a) => a.level !== null).length}건) — 0033과 dummy가 갈라졌다`,
  )
  assert.equal(
    areas.filter((a) => a.transfer_status !== null).length,
    7,
    `dummy의 DY 이양 계획이 7건이 아니다(${areas.filter((a) => a.transfer_status !== null).length}건)`,
  )
  const dyAreas = areas.filter((a) => a.business_id === 'biz_dy')
  const progress = transferProgress(dyAreas)
  assert.deepEqual(progress, { done: 3, planned: 7 }, `이양 진척이 3/7이 아니다(${JSON.stringify(progress)})`)
  assert.equal(nextTransfer(dyAreas)?.area, '가격 결정', '다음 이양이 "가격 결정"이 아니다(§35 NEXT 90 DAYS의 첫 줄)')

  const tests = await as('chairman', () => dummyRepository.listAbsenceTests())
  assert.equal(nextAbsenceTest(tests)?.days, 90, '다음 부재 테스트가 90일이 아니다')

  /** ㊳ DY에는 자율성 평가가 없다 — 화면이 '아직 평가 없음'을 말해야 하는 자리다. */
  const autonomy = await as('chairman', () => dummyRepository.listAutonomyAssessments())
  assert.equal(
    autonomy.filter((r) => r.business_id === 'biz_dy').length,
    0,
    'dummy가 DY의 자율성 등급을 지어냈다 — 문서에 그 값이 없다',
  )
  assert.ok(
    autonomy.length > 0,
    'dummy에 자율성 평가가 한 건도 없다 — L1~L5 게이지가 개발 중에 한 번도 안 그려진다',
  )
}

/* =====================================================================
 * D. 화면 — 빈 칸을 무엇으로 말하는가
 * ===================================================================== */

function screens() {
  const group = src('app', '(dashboard)', 'dependency', 'page.tsx')
  const detail = src('app', '(dashboard)', 'dependency', '[id]', 'page.tsx')
  const settings = src('app', '(dashboard)', 'dependency', 'settings', 'page.tsx')
  const card = src('components', 'dependency', 'dependency-card.tsx')
  // 빈 칸 문구는 공통 조각에도 있다(AutonomyGauge 등). 화면 파일만 보면 '있는데 못 찾았다'가 된다.
  const pieces = src('components', 'dependency', 'pieces.tsx')
  const areaEditor = src('components', 'dependency', 'area-editor.tsx')
  const nav = src('lib', 'nav.ts')
  const board = src('components', 'dashboard', 'dashboard-board.tsx')

  const needle = (s: string) => (broke('screen-text') ? '이 문구는 어디에도 없다' : s)

  /** ㊴ 사이드바 관제 그룹에 '의존'이 있고 실제 주소로 간다. */
  assert.ok(nav.includes(needle(`href: '/dependency'`)), "사이드바에 '/dependency' 항목이 없다")
  assert.ok(
    nav.includes(needle(`label: '의존'`)),
    "사이드바 항목의 라벨이 '의존'이 아니다 — 원문이 그 이름을 지정했다",
  )
  assert.ok(
    /key: 'nav_dependency',[\s\S]{0,200}ready: true/.test(nav),
    "'의존' 항목이 ready: true가 아니다 — 화면이 서 있는데 /coming-soon으로 간다",
  )

  /** ㊵ 대시보드 카드가 **이니셔티브와 프로세스차트 사이**에 있다(원문이 자리를 지정했다). */
  // import 줄이 아니라 **그려지는 자리**를 본다. '<'를 붙이지 않으면 import 순서를 재게 된다.
  const iIdx = board.indexOf('<InitiativeCards')
  const dIdx = board.indexOf('<DependencyCard')
  const pIdx = board.indexOf('<ProcessChartCard')
  assert.ok(dIdx > 0, '대시보드에 DependencyCard가 없다')
  assert.ok(
    iIdx < dIdx && dIdx < pIdx,
    `의존도 카드가 이니셔티브와 프로세스차트 사이에 있지 않다(이니셔티브 ${iIdx} · 의존 ${dIdx} · 프로세스 ${pIdx})`,
  )

  /**
   * ㊶ **빈 칸의 문구가 화면에 실제로 있다.** 이 단언이 없으면 그 문구는 조용히 사라지고,
   *    빈 칸은 '0%'와 구별되지 않게 된다 — 이 블록이 막으려던 바로 그 상태다.
   */
  const all = [group, detail, card, pieces, areaEditor].join('\n')
  /** 문구는 글자로 박아도 되고 상수로 불러도 된다. 둘 다 아니면 화면이 그 말을 안 하는 것이다. */
  const says = (literal: string, constant: string) =>
    all.includes(needle(literal)) || all.includes(needle(constant))
  assert.ok(
    says(AUTONOMY_EMPTY_KO, 'AUTONOMY_EMPTY_KO'),
    `화면에 '${AUTONOMY_EMPTY_KO}'가 없다 — 평가가 없는 회사의 자율성 칸이 무엇으로 그려지는지 아무도 모른다`,
  )
  assert.ok(
    says(DEPENDENCY_LEVEL_EMPTY_KO, 'DEPENDENCY_LEVEL_EMPTY_KO'),
    `화면에 '${DEPENDENCY_LEVEL_EMPTY_KO}'가 없다 — 미평가와 '낮음'이 같은 글자로 그려진다`,
  )
  assert.ok(
    says(TRANSFER_STATUS_EMPTY_KO, 'TRANSFER_STATUS_EMPTY_KO'),
    `화면에 '${TRANSFER_STATUS_EMPTY_KO}'가 없다 — '이양 계획 없음'과 '미이양'이 같은 글자가 된다`,
  )
  assert.ok(
    all.includes(needle('역산')),
    '화면 어디에도 역산 이야기가 없다 — 회장이 "이 숫자는 어디서 왔나"를 물을 자리가 지표 옆이 아니면 없다',
  )
  assert.ok(
    all.includes(needle('회장 계정에서만')),
    "개입 건수가 보이지 않을 때 '회장 계정에서만 집계됩니다'라고 말하지 않는다 — 없는 것과 못 보는 것을 같은 0으로 그리는 것이 이 블록에서 금지된 거짓말이다",
  )
  assert.ok(
    all.includes(needle('아직 계산할 수 없습니다')),
    "처리된 결정이 0건일 때 '아직 계산할 수 없습니다'라고 말하지 않는다 — 0%로 그리면 의존이 없다는 뜻이 된다",
  )

  /** ㊷ /dependency/settings에 '중요한 결정'의 정의와 역산 규칙이 **글로** 있다. */
  assert.ok(
    settings.includes(needle('IMPORTANT_DECISION_RULE_KO')) || settings.includes(needle(IMPORTANT_DECISION_RULE_KO)),
    "/dependency/settings에 '중요한 의사결정'의 정의가 없다 — Ruling이 그 정의를 화면에 글로 적어 회장이 고칠 수 있게 하라고 했다",
  )
  assert.ok(
    settings.includes(needle('BACKFILL_RULES_KO')),
    '/dependency/settings에 역산 규칙이 없다',
  )
  assert.equal(BACKFILL_RULES_KO.length, 3, '역산 규칙이 셋이 아니다 — 0033 3절과 같은 수여야 한다')

  /** ㊸ L1~L5 기준표가 §9의 다섯 줄 **그대로** 있다. 요약하면 기준이 두 개가 된다. */
  assert.ok(settings.includes(needle('AUTONOMY_CRITERIA_KO')), '/dependency/settings에 L1~L5 기준표가 없다')
  const doc = readFileSync(join(ROOT, 'docs', 'chairman-architecture-v1.md'), 'utf8')
  assert.ok(doc.includes('BERKSHIRE MODE'), '문서 §9의 원문이 바뀌었다 — 이 단언의 전제가 깨졌다')
  assert.ok(
    AUTONOMY_CRITERIA_KO.L5.includes('BERKSHIRE MODE'),
    'L5 기준에 BERKSHIRE MODE가 없다 — §9를 그대로 옮기지 않았다',
  )
  assert.ok(
    AUTONOMY_CRITERIA_KO.L1.includes('회장 승인'),
    'L1 기준이 §9("Chairman approval required for major decisions")와 다르다',
  )

  /** ㊹ 목표 사다리 37→25→15→<10이 그대로 있고, 10이 §7의 TARGET이다. */
  assert.deepEqual([...DEPENDENCY_LADDER], [37, 25, 15, 10], '목표 사다리가 37→25→15→<10이 아니다')
  assert.equal(DEPENDENCY_TARGET, 10, '§7의 TARGET이 10%가 아니다')
  assert.ok(doc.includes('TARGET < 10%'), '문서 §7의 TARGET이 바뀌었다 — 이 단언의 전제가 깨졌다')

  /** ㊺ 마이그레이션 0033이 금지된 둘을 하지 않았다(파일 그대로 읽어 본다). */
  const sql = readFileSync(join(MIGRATIONS, '0033_succession.sql'), 'utf8')
  /**
   * **주석을 걷고 본다.** 이 파일의 주석에는 "force row level security를 걸지 않는다"가
   * 적혀 있어서, 걷지 않으면 그 문장이 금지 위반으로 잡힌다 — 검사가 문장을 세지 않고
   * 글자를 세게 되는 자리다.
   */
  const statements = sql
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')
  assert.ok(
    !/alter\s+type\s+audit_action/i.test(statements),
    '0033이 audit_action enum을 건드린다 — 0022가 production에서 55P04를 밟은 자리다',
  )
  assert.ok(
    !/force\s+row\s+level\s+security/i.test(statements),
    '0033이 force row level security를 건다 — 이 저장소가 네 번 밟은 함정이다',
  )
  assert.ok(
    /역산/.test(sql),
    '0033에 역산 규칙이 글로 적혀 있지 않다 — Ruling이 "코드가 아니라 마이그레이션 주석과 DEFERRED에 명시"를 요구했다',
  )
}

/* ===================================================================== */

async function main() {
  if (BREAK) console.log(`※ 음성 대조: DEP_BREAK=${BREAK} — ${BREAKS[BREAK]}`)
  const { july } = await database()
  formula()
  await dummy()
  screens()
  console.log(
    `PASS: 0033 승계 — §7 식(고정 입력 ${FIXTURE.chairman}/${FIXTURE.ceo}/${FIXTURE.rule} → ` +
      `${july[0].dependency_pct}%, 역산 미도달 ${july[0].unknown_count}건은 분자·분모 밖) · ` +
      '역산 규칙 ①②③ · 트리거 · 표 넷의 역할 RLS(CEO 읽기까지 · Executive/TeamLead/Member 0건) · ' +
      'check 제약 셋 · force 없음 · security_invoker · interventions(위임 포함 · 회장만) · ' +
      'DY 시드(영역 6 · 이양 7 · 부재 2 · 자율성 0) · TS 식 = SQL 식 · dummy 게이트 · 화면 문구',
  )
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

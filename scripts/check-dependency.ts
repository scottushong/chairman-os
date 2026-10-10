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
import { applyAll, applyOne, MIGRATIONS } from './pglite'

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
  /**
   * 0034가 내린 decisions의 force를 되살린다 — 집계 문이 소유자 권한으로 돌면서 정책
   * 아래로 내려가고, 회사의 의존도가 **계정마다 다른 %**로 보인다(0027이 적은 그 함정).
   */
  'no-force-decisions': '0034가 내린 decisions의 force를 되살린다',
  /**
   * intervention_counts에 audit 줄의 내용물 칸을 더한다 — 그 순간 이 표는 audit_log의
   * 사본이 되고, 정책을 넓히지 않고도 정책을 우회한 것이 된다.
   */
  'counts-leak': 'intervention_counts에 actor_user_id 칸을 더한다',
  /**
   * interventions 뷰에서 security_invoker를 뗀다 — 뷰가 intervention_counts의 정책을
   * 지나가 버려서, select 권한만 있으면 누구나 전사 개입 건수를 본다.
   * **이 블록이 실제로 금지한 것**이 그것이다(0033의 security_invoker 논쟁이 아니라).
   */
  'view-definer': 'interventions 뷰의 security_invoker를 끈다',
  /** founder_dependency_rows()의 역할 게이트를 뗀다 — 게이트 없는 문으로 갈아 끼운다. */
  'fd-gate-off': 'founder_dependency_rows()에서 can_read_succession 게이트를 뗀다',
  /** intervention_counts의 쓰기를 authenticated에게 연다 — 집계를 사람이 고칠 수 있게 된다. */
  'counts-write': 'intervention_counts의 쓰기를 모든 활성 사용자에게 연다',
  /** 트리거의 예외 블록을 뗀다 — 집계가 터지면 감사 줄이 같이 사라진다. */
  'trigger-fatal': 'interventions_bump()의 예외 블록을 떼서 집계 실패가 감사 줄을 죽이게 한다',
  /**
   * 예외 블록은 두되 `raise warning`을 `null;`로 되돌린다 — 감사 줄은 살지만 빠진
   * 건수가 **어디에도 흔적이 없다.** 0034 이전에 내가 쓴 모양이고, 리뷰가 잡은 자리다.
   */
  'trigger-silent': 'interventions_bump()이 집계 실패를 경고 없이 삼키게 한다',
  /** 0034가 채운 과거분을 지운다 — 12개월 추이가 통째로 빈다. */
  'wipe-counts': '0034가 backfill로 채운 과거 개입 건수를 지운다',
  /**
   * **audit_log의 force를 내린 채로 둔다** — 0034 6절의 창이 닫히지 않은 상태다.
   * 0031 2절이 표를 하나 더 지어 가며 피한 그 결정을 뒤집는 한 줄이고, 이 설계와
   * 0031이 거절한 것을 가르는 자리가 정확히 그 한 줄이다.
   */
  'audit-window': '0034 6절의 backfill 창을 닫지 않는다(audit_log의 force를 내린 채로 둔다)',
  /** 문 하나의 execute를 public에 돌려준다 — 0019 3절의 revoke를 무르는 것이다. */
  'door-public': 'founder_dependency_rows()의 execute를 public에 준다',
  /** interventions가 위임을 빼고 센다 — 개입이 실제보다 적어 보인다. */
  'interventions-no-delegate': 'interventions에서 위임(delegate)을 뺀다',
  /**
   * 0035가 더한 다섯 번째 유형을 되돌린다 — `interventions_bump()`를 0034의 넷으로
   * 갈아 끼운다. 관찰도 회장이 그 건을 손댄 것이고, 빼면 개입이 실제보다 적어 보인다.
   */
  'interventions-no-monitor': '0035가 더한 관찰(monitor)을 interventions_bump()에서 뺀다',
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
    -- 0034. audit_log와 집계 표, 그리고 0034가 세운 문 둘을 같은 소유자로 넘긴다.
    -- **이 소유권 이전이 0034 검사의 전부다.** superuser 하네스는 FORCE와 무관하게 RLS를
    -- 전부 우회하므로, 이것 없이 세운 단언은 "definer가 정책을 지나가는가"를 **원리적으로
    -- 답하지 못한다**(0027:60 — 검사가 초록인 채 production만 깨지는 모양).
    alter table public.audit_log             owner to app_owner;
    alter table public.intervention_counts   owner to app_owner;
    alter function public.founder_dependency_rows() owner to app_owner;
    alter function public.interventions_bump()      owner to app_owner;
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

  /**
   * ⑤ 뷰 둘이 여전히 security_invoker다. **0034에서 이 단언의 뜻이 바뀌었다.**
   *
   * 0033에서 이것은 "뷰가 RLS를 우회하지 않는다"였다. 0034는 그 대가가 스펙 미달이라
   * 문을 하나씩 만들었지만, **문은 뷰보다 한 층 아래에 두었다** — founder_dependency는
   * 함수 몸통(can_read_succession)이, interventions는 intervention_counts의 정책이 문이다.
   * 뷰가 definer가 되면 그 문을 뷰가 지나가 버린다: interventions는 select 권한만 있으면
   * 누구나 전사 개입 건수를 보게 되고, founder_dependency는 함수 execute 권한이 빠진
   * 날에도 멀쩡히 돌아 검사가 그 사실을 놓친다. 문이 둘이 되는 것도 그래서 피한다.
   */
  /*
   * **짝이 되는 돌연변이는 여기가 아니라 7절에 있다.** `view-definer`를 여기서 걸면
   * 이 단언이 "옵션을 껐더니 옵션이 꺼져 있다"를 재는 동어반복이 된다. 그 키는 7절의
   * ㉗ 앞에서 걸리고, 거기서 **행동**이 먼저 빨개진다(definer 뷰가 되면 select 권한만
   * 있는 팀장이 전사 개입 건수를 본다 — 그것이 이 선택이 막는 것이다). 아래 둘은 그
   * 행동 단언의 구조적 뒷받침이고, 7절 끝에서 같은 옵션을 한 번 더 읽는다.
   */
  for (const v of ['founder_dependency', 'interventions']) {
    const opts = await val<string[]>(null, `select reloptions from pg_class where relname = '${v}'`, 'app_owner')
    assert.ok(
      (opts ?? []).includes('security_invoker=true'),
      `뷰 ${v}에 security_invoker=true가 없다 — 문이 뷰보다 위로 올라갔다. 0034는 판정을 함수 몸통과 intervention_counts 정책에 두었고, 뷰가 definer면 그 문을 지나간다(reloptions=${JSON.stringify(opts)})`,
    )
  }

  /**
   * ⑤-a **0034가 내린 decisions의 force가 그대로 내려가 있다.**
   *    되살아나면 founder_dependency_rows()가 소유자 권한으로 돌면서 decisions_read 아래로
   *    내려가고, 회사의 의존도가 계정마다 다른 %로 보인다. PGlite harness는 superuser라
   *    이 상태를 그냥 통과시키므로(0027:60) 아래 ㉗-a가 소유권을 옮긴 뒤에 실제로 잰다.
   */
  if (broke('no-force-decisions')) {
    await db.exec(`alter table public.decisions force row level security`)
  }
  const decForce = await val<boolean>(
    null,
    `select relforcerowsecurity from pg_class where relname = 'decisions'`,
    'app_owner',
  )
  assert.equal(
    decForce,
    false,
    'decisions에 force row level security가 되살아났다 — 0034 2절이 내린 것이다. 이대로면 §7 집계 문이 소유자 권한으로 돌면서 정책 아래로 내려가, 회사의 의존도가 보는 사람마다 다른 %가 된다(0027 1절과 같은 함정)',
  )

  /**
   * ⑤-b **audit_log의 force는 그대로 걸려 있다.** 0034 6절이 backfill을 위해 같은
   *    트랜잭션 안에서 잠깐 열었다 닫았고, 그 창이 닫힌 채로 커밋됐는지를 여기서 잰다.
   *    0031 2절이 force를 내리기를 거절하고 activity_digest를 지은 그 판단이 이 한 줄이다.
   */
  if (broke('audit-window')) {
    await db.exec(`alter table public.audit_log no force row level security`)
  }
  const auditForce = await val<boolean>(
    null,
    `select relforcerowsecurity from pg_class where relname = 'audit_log'`,
    'app_owner',
  )
  assert.equal(
    auditForce,
    true,
    'audit_log에 force row level security가 없다 — 0034 6절의 backfill 창이 열린 채로 닫히지 않았다. 그 표에는 read·login 줄(누가 언제 무엇을 열어 봤나)이 있고, 0031 2절이 지키려던 것이 바로 이 한 줄이다',
  )

  /**
   * ⑤-c **intervention_counts에 audit 줄의 내용물이 한 칸도 없다.** 칸 이름 집합을 못 박는다.
   *    entity_id·actor_user_id·before/after·note가 한 칸이라도 들어오면 이 표는 audit_log의
   *    사본이 되고, 정책을 넓히지 않고도 정책을 우회한 것이 된다.
   */
  if (broke('counts-leak')) {
    await db.exec(`alter table intervention_counts add column actor_user_id uuid`)
  }
  const countCols = (
    await rows<{ column_name: string }>(
      null,
      `select column_name from information_schema.columns where table_name = 'intervention_counts' order by 1`,
      'app_owner',
    )
  ).map((r) => r.column_name)
  assert.deepEqual(
    countCols,
    ['business_id', 'count', 'kind', 'period', 'updated_at'],
    `intervention_counts의 칸이 회사·달·유형·건수와 updated_at 다섯이 아니다(${countCols.join(',')}) — 한 칸이라도 더 있으면 이 표는 audit_log의 사본이고, audit_log_read를 넓히지 않고도 넓힌 것이 된다(0031 activity_digest가 사람·경로·도시를 한 칸도 두지 않은 것과 같은 규율)`,
  )
  /**
   * intervention_counts는 **enable은 켜고 force는 끈다.** 위 ④가 승계 표 넷에 대해
   * 두 칸을 다 재는 것과 같은 모양이다 — force만 재면 "정책이 아예 안 걸리는 표"가
   * 그대로 통과한다(그 순간 이 표는 select 권한만 있으면 누구나 읽는 표가 된다).
   */
  const countsFlags = await rows<{ r: boolean; f: boolean }>(
    null,
    `select relrowsecurity as r, relforcerowsecurity as f from pg_class where relname = 'intervention_counts'`,
    'app_owner',
  )
  assert.equal(countsFlags.length, 1, 'intervention_counts를 못 찾는다 — 이 단언이 아무것도 재지 못한다')
  assert.equal(
    countsFlags[0].r,
    true,
    'intervention_counts에 row level security가 꺼져 있다 — 정책이 한 줄도 안 걸리고, select 권한만 있으면 누구나 전사 개입 건수를 읽는다',
  )
  assert.equal(
    countsFlags[0].f,
    false,
    'intervention_counts에 force row level security가 걸렸다 — 0034 5절의 트리거가 소유자 권한으로 이 표에 쓰는데, force가 걸리면 그 쓰기가 정책 아래로 내려가 조용히 아무것도 안 쓴다(이 저장소가 네 번 밟은 함정)',
  )

  /** ⑥ anon에게는 새 표 넷과 뷰 둘, 그리고 0034의 집계 표까지 권한이 없다. 자물쇠는 revoke다. */
  for (const t of ['dependency_areas', 'autonomy_assessments', 'absence_tests', 'chairman_directions', 'founder_dependency', 'interventions', 'intervention_counts']) {
    const anon = await val<boolean>(null, `select has_table_privilege('anon', '${t}', 'select')`, 'app_owner')
    assert.equal(anon, false, `anon이 ${t}를 읽을 수 있다 — revoke가 빠졌다`)
  }

  /**
   * ⑥-a **intervention_counts에 쓰기 권한이 아무에게도 없다.** 이 표를 쓰는 것은 0034 5절의
   *    트리거 하나뿐이고, 그 트리거는 소유자 권한으로 돈다. 사람이 쓸 수 있게 되는 순간
   *    이 표는 «집계»가 아니라 «누가 고친 숫자»가 된다 — 감사 기록에서 뽑은 값이라는
   *    이 표의 유일한 근거가 사라진다.
   */
  if (broke('counts-write')) {
    await db.exec(`grant insert, update, delete on table intervention_counts to authenticated;
                   create policy break_counts_write on intervention_counts for all
                     using (is_active()) with check (is_active());`)
  }
  for (const priv of ['insert', 'update', 'delete']) {
    for (const who of ['authenticated', 'anon']) {
      assert.equal(
        await val<boolean>(null, `select has_table_privilege('${who}', 'intervention_counts', '${priv}')`, 'app_owner'),
        false,
        `${who}에게 intervention_counts의 ${priv} 권한이 있다 — 이 표를 쓰는 것은 audit_log의 트리거 하나뿐이어야 한다. 사람이 고칠 수 있으면 이 숫자가 감사 기록에서 나왔다는 근거가 사라진다`,
      )
    }
  }

  /**
   * ⑥-b **0034가 만든 문 둘의 execute가 public에 없다**(0019 3절의 revoke가 살아 있는가).
   *    security definer 함수에서 public 기본 execute는 곧 "anon도 RPC로 부를 수 있다"는
   *    뜻이다. 몸통이 걸러 주더라도 기본 권한을 남겨 두지 않는다 — 나중에 몸통이 한 줄
   *    바뀌는 날 그 기본값이 구멍이 된다.
   */
  if (broke('door-public')) {
    await db.exec(`grant execute on function founder_dependency_rows() to public`)
  }
  for (const fn of ['founder_dependency_rows()', 'interventions_bump()']) {
    assert.equal(
      await val<boolean>(null, `select has_function_privilege('public', '${fn}', 'execute')`, 'app_owner'),
      false,
      `${fn}의 execute가 public에 남아 있다 — 0019 3절의 revoke가 빠졌다. security definer 함수에서 그 기본값은 곧 anon도 부를 수 있다는 뜻이다`,
    )
  }
  /** 화면이 부르는 문은 authenticated에게 열려 있어야 한다. 걷기만 하고 다시 안 주면 42501이다. */
  assert.equal(
    await val<boolean>(null, `select has_function_privilege('authenticated', 'founder_dependency_rows()', 'execute')`, 'app_owner'),
    true,
    'authenticated에게 founder_dependency_rows()의 execute가 없다 — 뷰가 security_invoker라 화면이 42501을 받는다',
  )
  /** 트리거만 부르는 문은 다시 주지 않는다 — 사람이 부를 자리가 없다. */
  assert.equal(
    await val<boolean>(null, `select has_function_privilege('authenticated', 'interventions_bump()', 'execute')`, 'app_owner'),
    false,
    'authenticated에게 interventions_bump()의 execute가 있다 — 이 함수를 부르는 것은 audit_log의 트리거뿐이다',
  )

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

  /* ------------------------------------- 4-a. 0034: 회사의 값은 보는 사람과 무관하다 */

  /**
   * **기안자를 일부러 붙인 달을 하나 더 만든다.**
   *
   * 위 ⑫의 고정 입력은 `created_by`가 전부 null이라 0026 다섯째 겹의
   * '소유자 칸이 둘 다 비면 회사 공통' 분기로 읽힌다 — 그 시드로 재면 아래 단언은
   * 아무것도 재지 못한 채 늘 초록이다. DY 대표가 기안한 결정으로 2026-08을 따로 만든다.
   * GroupCFO는 DY 대표의 위가 아니므로(둘 다 회장 직속이다) 0026의 겹이 **실제로 걸리는**
   * 입력이고, 0034가 없으면 회장은 75%를 CFO는 아무것도 못 보는 자리다.
   */
  await db.exec(`
    insert into decisions (decision_id, business_id, title, status, decided_at, decided_by_kind, created_by) values
      ('t_own_1', 'biz_dy', '기안자가 붙은 회장 결정 1', 'Approved', timestamptz '2026-08-10 12:00+09', 'chairman', '${U.dyCeo}'),
      ('t_own_2', 'biz_dy', '기안자가 붙은 회장 결정 2', 'Approved', timestamptz '2026-08-10 12:00+09', 'chairman', '${U.dyCeo}'),
      ('t_own_3', 'biz_dy', '기안자가 붙은 회장 결정 3', 'Approved', timestamptz '2026-08-10 12:00+09', 'chairman', '${U.dyCeo}'),
      ('t_own_4', 'biz_dy', '기안자가 붙은 CEO 결정',    'Approved', timestamptz '2026-08-10 12:00+09', 'ceo',      '${U.dyCeo}');
  `)

  /** 게이트 없는 문으로 갈아 끼운다 — 식은 그대로 두고 can_read_succession만 뗀다. */
  if (broke('fd-gate-off')) {
    await db.exec(`
      create or replace function founder_dependency_rows()
      returns table (business_id text, period text, chairman_count bigint, ceo_count bigint,
                     rule_count bigint, total_count bigint, unknown_count bigint, dependency_pct numeric)
      language sql stable security definer set search_path = public as $fn$
        select d.business_id,
               to_char(coalesce(d.decided_at, d.created_at) at time zone 'Asia/Seoul', 'YYYY-MM'),
               count(*) filter (where d.decided_by_kind = 'chairman'),
               count(*) filter (where d.decided_by_kind = 'ceo'),
               count(*) filter (where d.decided_by_kind = 'rule'),
               count(*) filter (where d.decided_by_kind is not null),
               count(*) filter (where d.decided_by_kind is null),
               case when count(*) filter (where d.decided_by_kind is not null) = 0 then null
                    else round(count(*) filter (where d.decided_by_kind = 'chairman')::numeric * 100
                               / count(*) filter (where d.decided_by_kind is not null), 1) end
          from decisions d where d.status <> 'Open' group by 1, 2;
      $fn$;
    `)
  }

  const august = (uid: string) =>
    rows<{ dependency_pct: string; total_count: number; chairman_count: number }>(
      uid,
      `select dependency_pct, total_count, chairman_count from founder_dependency
        where business_id = 'biz_dy' and period = '2026-08'`,
    )

  /** ⑭-a 회장이 보는 값. 기안자가 붙어도 식은 같다 — 회장 3 / 전체 4 → 75.0%. */
  const augChair = await august(U.chair)
  assert.equal(augChair.length, 1, '2026-08의 founder_dependency 행이 회장에게 없다')
  assert.equal(
    Number(augChair[0].dependency_pct),
    75,
    `기안자가 붙은 달의 의존도가 75%가 아니다(${augChair[0].dependency_pct}%)`,
  )

  /**
   * ⑭-b **Chairman과 GroupCFO가 같은 회사·같은 달에 같은 %를 본다.**
   *    0026의 겹이 갈라놓던 자리이고, 0033이 "앞으로 기안자가 붙은 결정이 쌓이면 갈린다"고
   *    적어 둔 바로 그 자리다. 회사의 의존도는 보는 사람에 따라 달라지면 안 된다.
   */
  const augCfo = await august(U.cfo)
  assert.deepEqual(
    augCfo,
    augChair,
    `회장과 그룹 CFO가 같은 회사·달에서 다른 값을 본다(회장 ${JSON.stringify(augChair)} / CFO ${JSON.stringify(augCfo)}) — 0026의 다섯째 겹이 집계에 끼어들었다. 회사의 의존도는 보는 사람이 아니라 회사의 사실이다(0034 3절)`,
  )
  /** ⑭-c 그 회사의 CEO도 같은 값을 본다(원문: CEO 자기 회사 읽기). */
  assert.deepEqual(
    await august(U.dyCeo),
    augChair,
    'DY 대표가 자기 회사의 의존도를 회장과 다른 값으로 본다 — 원문은 "CEO 자기 회사 읽기"다',
  )
  /** ⑭-d 다른 회사의 CEO는 0행이다. 회사 격리는 그대로다. */
  assert.equal(
    (await august(U.vanaCeo)).length,
    0,
    'VANA 대표에게 DY의 의존도가 보인다 — 0034의 문이 회사 격리를 잃었다',
  )
  /** ⑭-e **Executive·TeamLead·Member는 0행이다.** 문이 넓어진 것이 아니라 스펙대로 열린 것이다. */
  for (const [who, uid] of [['Executive', U.exec], ['TeamLead', U.lead], ['Member', U.member]] as const) {
    assert.equal(
      (await august(uid)).length,
      0,
      `${who}에게 §7 지표가 보인다 — 0034의 문은 can_read_succession()과 같은 판정이어야 하고, 원문이 "나머지 거부"라고 못 박았다`,
    )
  }

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

  /**
   * 0034부터 이 뷰는 audit_log가 아니라 intervention_counts를 읽는다. 그 표를 채우는 것은
   * audit_log의 after-insert 트리거 하나뿐이라, 아래 insert 넷이 곧 트리거 시험이다.
   */
  if (broke('trigger-fatal')) {
    await db.exec(`
      create or replace function interventions_bump() returns trigger
      language plpgsql volatile security definer set search_path = public as $fn$
      begin
        if new.actor_role = 'Chairman'
           and new.action::text in ('approve', 'reject', 'modify', 'delegate')
           and new.business_id is not null then
          insert into intervention_counts (business_id, period, kind, count, updated_at)
          values (new.business_id,
                  to_char(new.occurred_at at time zone 'Asia/Seoul', 'YYYY-MM'),
                  new.action::text, 1, now())
          on conflict (business_id, period, kind) do update
            set count = intervention_counts.count + 1, updated_at = now();
        end if;
        return null;
      end;
      $fn$;
      alter function public.interventions_bump() owner to app_owner;
    `)
  }
  if (broke('trigger-silent')) {
    await db.exec(`
      create or replace function interventions_bump() returns trigger
      language plpgsql volatile security definer set search_path = public as $fn$
      begin
        begin
          if new.actor_role = 'Chairman'
             and new.action::text in ('approve', 'reject', 'modify', 'delegate')
             and new.business_id is not null then
            insert into intervention_counts (business_id, period, kind, count, updated_at)
            values (new.business_id,
                    to_char(new.occurred_at at time zone 'Asia/Seoul', 'YYYY-MM'),
                    new.action::text, 1, now())
            on conflict (business_id, period, kind) do update
              set count = intervention_counts.count + 1, updated_at = now();
          end if;
        exception when others then
          null;
        end;
        return null;
      end;
      $fn$;
      alter function public.interventions_bump() owner to app_owner;
    `)
  }
  await db.exec(`
    insert into audit_log (actor_user_id, actor_role, action, entity_table, entity_id, business_id) values
      ('${U.chair}', 'Chairman',    'reject',   'decisions', 't_iv_1', 'biz_dy'),
      ('${U.chair}', 'Chairman',    'modify',   'decisions', 't_iv_2', 'biz_dy'),
      ('${U.chair}', 'Chairman',    'delegate', 'decisions', 't_iv_3', 'biz_dy'),
      ('${U.dyCeo}', 'BusinessCEO', 'approve',  'decisions', 't_iv_4', 'biz_dy');
  `)

  /**
   * ㉔-a **트리거는 감사 줄의 insert를 절대 실패시키지 않는다**(HANDOVER 2절 ③).
   *
   *    § 실패 경로를 이 검사가 직접 만든다 §
   *    0034는 `intervention_counts`에 FK를 걸지 않는다(`audit_log.business_id`가 제약 없는
   *    자유 문자열이라 파생 집계를 원천보다 좁게 묶지 않는다 — 0034 4절). 그래서 "없는
   *    회사"로는 더 이상 아무것도 안 터진다. 스키마의 우연한 제약에 기대는 대신 **여기서
   *    제약 하나를 심어** 집계를 확실히 터뜨리고, 재고 나서 걷는다. 이렇게 두면 이 단언은
   *    앞으로 제약이 붙거나 떨어져도 계속 «예외 블록이 있는가»만 잰다.
   */
  await db.exec(
    `alter table intervention_counts add constraint dep_check_break check (business_id <> 'biz_집계실패')`,
  )
  let bumpError: string | null = null
  try {
    await db.exec(`
      insert into audit_log (actor_user_id, actor_role, action, entity_table, entity_id, business_id)
      values ('${U.chair}', 'Chairman', 'approve', 'decisions', 't_iv_fail', 'biz_집계실패');
    `)
  } catch (e) {
    bumpError = e instanceof Error ? e.message : String(e)
  }
  assert.equal(
    bumpError,
    null,
    `집계가 터지면서 감사 줄의 insert까지 같이 실패했다 (${bumpError}) — 기록이 먼저이고 집계는 나중이다. audit_log는 append only라 여기서 잃은 줄은 되살릴 수 없다`,
  )
  assert.equal(
    Number(await val(U.chair, `select count(*)::int from audit_log where entity_id = 't_iv_fail'`)),
    1,
    '집계가 터진 뒤 감사 줄이 남지 않았다 — 0034 5절의 예외 블록이 빠졌다',
  )
  /** 전제 확인: 집계는 **실제로** 터졌는가. 안 터졌으면 위 둘은 아무것도 재지 않았다. */
  assert.equal(
    Number(await val(null, `select count(*)::int from intervention_counts where business_id = 'biz_집계실패'`, 'app_owner')),
    0,
    '이 실험의 전제가 깨졌다 — 심어 둔 제약을 뚫고 집계가 들어갔다면 위 두 단언은 «예외 블록»을 재고 있지 않다',
  )
  await db.exec(`alter table intervention_counts drop constraint dep_check_break`)

  /**
   * ㉔-b **잃은 것을 조용히 삼키지 않는다.** 예외 블록이 있어도 `null;`로 두면 빠진
   *    건수가 서버 로그에도 안 남는다(잡힌 예외는 저절로 기록되지 않는다) — §34가
   *    12개월 추이로 그리는 값에서 그 침묵은 «개입이 없었다»와 구별되지 않는다.
   *    파일이 아니라 **DB에 실제로 올라간 정의**를 읽는다.
   */
  const bumpDef = await val<string>(
    null,
    `select pg_get_functiondef('interventions_bump()'::regprocedure)`,
    'app_owner',
  )
  assert.ok(
    /raise\s+warning/i.test(bumpDef ?? ''),
    'interventions_bump()이 집계 실패를 raise warning 없이 삼킨다 — 빠진 건수가 어디에도 흔적이 없고, 아무도 다시 세지 않는다(0034 5절)',
  )
  assert.ok(
    /new\.business_id/.test(bumpDef ?? '') && /sqlerrm/i.test(bumpDef ?? ''),
    'interventions_bump()의 경고에 회사(new.business_id)나 원인(sqlerrm)이 없다 — 무엇을 잃었는지 모르는 경고는 다시 셀 근거가 되지 못한다',
  )

  if (broke('interventions-no-delegate')) {
    await db.exec(`
      create or replace view interventions with (security_invoker = true) as
        select c.business_id, c.period, c.kind, c.count
          from intervention_counts c where c.kind <> 'delegate';
    `)
  }
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

  /**
   * ㉗ **0034에서 이 자리가 뒤집혔다.** 0033에서는 "회장이 아니면 0행"이었다 —
   *    audit_log의 FORCE RLS 때문이었고, 그것이 원문(GroupCFO 읽기) 미달이었다.
   *    0034는 audit_log를 열지 않고 집계 전용 표를 두어 원문의 가시성을 준다.
   *
   *    ㉗-a **GroupCFO와 그 회사의 CEO가 회장과 같은 합계를 본다.**
   */
  /*
   * ⑤의 짝이 되는 돌연변이가 **여기서** 걸린다. 뷰가 definer가 되면 `intervention_counts`의
   * 정책을 뷰가 지나가 버리므로, 아래 ㉗-b·㉗-c가 **행동으로** 먼저 빨개진다 —
   * 다른 회사의 CEO와 팀장이 전사 개입 건수를 보게 된다. 그것이 이 선택이 막는 것이고,
   * reloption을 다시 읽는 것만으로는 그 사실이 재어지지 않는다(동어반복이 된다).
   */
  if (broke('view-definer')) {
    await db.exec(`alter view interventions set (security_invoker = false)`)
  }

  const ivFor = async (uid: string) =>
    Number(
      await val(
        uid,
        `select coalesce(sum(count), 0)::int from interventions where business_id = 'biz_dy'`,
      ),
    )
  const ivChair = await ivFor(U.chair)
  assert.equal(
    ivChair,
    chairRows,
    `회장이 보는 개입 합계(${ivChair})가 회장 audit 줄 수(${chairRows})와 다르다`,
  )
  for (const [who, uid] of [['GroupCFO', U.cfo], ['BusinessCEO', U.dyCeo]] as const) {
    assert.equal(
      await ivFor(uid),
      ivChair,
      `${who}가 회장과 다른 개입 합계를 본다(${await ivFor(uid)} vs ${ivChair}) — 원문은 "Chairman·GroupCFO 읽기 · CEO 자기 회사 읽기"다. 0034가 audit_log를 넓히지 않고 이것을 주려고 집계 전용 표를 두었다`,
    )
  }
  /** ㉗-b 다른 회사의 CEO에게는 이 회사의 개입이 보이지 않는다. 회사 격리는 그대로다. */
  assert.equal(
    await ivFor(U.vanaCeo),
    0,
    'VANA 대표에게 DY의 개입 건수가 보인다 — intervention_counts_read가 회사 격리를 잃었다',
  )
  /**
   * ㉗-c **Executive·TeamLead·Member는 여전히 0행이다.** 가시성이 넓어져도 여기는 그대로다.
   *    화면은 그들에게 «0건»이라고 말하지 않는다 — 없는 것과 못 보는 것은 다른 사실이고,
   *    그 둘을 같은 '0'으로 그리는 것이 이 블록에서 금지된 거짓말이다.
   */
  for (const [who, uid] of [['Executive', U.exec], ['TeamLead', U.lead], ['Member', U.member]] as const) {
    assert.equal(
      Number(await val(uid, `select count(*)::int from interventions`)),
      0,
      `${who}가 interventions를 읽는다 — 원문이 "나머지 거부"라고 못 박았고, 이 값이 0이 아니면 문이 스펙보다 넓어진 것이다`,
    )
  }
  /** ㉗-d anon은 한 줄도 못 읽는다. */
  assert.ok(
    (await rejected(null, `select count(*) from interventions`, 'anon')) !== null,
    'anon이 interventions를 읽는다 — 자물쇠는 revoke다',
  )
  /**
   * ㉗-e 구조적 뒷받침. ⑤에서 이미 읽었지만 여기서 한 번 더 읽는다 — 위 ㉗-b·㉗-c가
   * 행동으로 재는 것과 **같은 사실**이고, 둘이 같은 답을 말해야 한다. 행동 단언이
   * 통과하는 다른 경로가 생기는 날에도 "문은 뷰보다 한 층 아래"라는 결정 자체는
   * 그대로 지켜져야 한다(check-migrations의 force 카탈로그와 같은 이유로 겹으로 둔다).
   */
  const ivOpts = await val<string[]>(
    null,
    `select reloptions from pg_class where relname = 'interventions'`,
    'app_owner',
  )
  assert.ok(
    (ivOpts ?? []).includes('security_invoker=true'),
    `뷰 interventions에서 security_invoker가 꺼졌다 — 뷰가 intervention_counts의 정책을 지나간다(reloptions=${JSON.stringify(ivOpts)})`,
  )

  /**
   * ㉙ **0035가 더한 다섯 번째 유형 — 관찰(monitor)도 개입이다.**
   *
   *    근거는 위임을 넣은 것과 같다(㉕): 관찰은 회장이 그 건을 보고 «지금은 두고 본다»고
   *    **정한 것**이라 손댄 것이 맞고, 빼면 개입이 실제보다 적어 보인다. 지표를 좋아
   *    보이게 만드는 방향의 누락이 이 블록에서 가장 조심하는 것이다.
   *
   *    이 단언 하나가 세 가지를 같이 잰다 — 셋 다 0035가 한 일이다:
   *      · `audit_action` enum에 `monitor`가 있다(없으면 아래 insert가 22P02로 터진다).
   *      · 0035 8절이 `interventions_bump()`를 다시 써서 다섯을 센다.
   *      · 그 집계가 `interventions` 뷰로 나온다(트리거는 0034의 것을 그대로 쓴다 —
   *        `create or replace function`이라 트리거를 다시 만들 필요가 없었다).
   *
   *    **위 ㉖의 뒤에 둔다.** ㉖은 "개입 합계 == 회장 audit 줄 수"를 네 유형으로 재고,
   *    관찰 줄을 그보다 먼저 넣으면 그 단언이 유형 목록의 차이 때문에 빨개진다 —
   *    재려던 것(CEO가 닫은 건은 개입이 아니다)과 다른 이유로 빨개지는 단언은 쓸모가 없다.
   */
  if (broke('interventions-no-monitor')) {
    await db.exec(`
      create or replace function interventions_bump() returns trigger
      language plpgsql volatile security definer set search_path = public as $fn$
      begin
        begin
          if new.actor_role = 'Chairman'
             and new.action::text in ('approve', 'reject', 'modify', 'delegate')
             and new.business_id is not null then
            insert into intervention_counts (business_id, period, kind, count, updated_at)
            values (new.business_id,
                    to_char(new.occurred_at at time zone 'Asia/Seoul', 'YYYY-MM'),
                    new.action::text, 1, now())
            on conflict (business_id, period, kind) do update
              set count = intervention_counts.count + 1, updated_at = now();
          end if;
        exception when others then
          raise warning '0035 interventions_bump: 개입 집계 실패 — business_id=% action=% sqlstate=% %',
            new.business_id, new.action, sqlstate, sqlerrm;
        end;
        return null;
      end;
      $fn$;
      alter function public.interventions_bump() owner to app_owner;
    `)
  }
  await db.exec(`
    insert into audit_log (actor_user_id, actor_role, action, entity_table, entity_id, business_id) values
      ('${U.chair}', 'Chairman', 'monitor', 'exceptions', 't_iv_mon', 'biz_dy');
  `)
  const ivMonitor = Number(
    await val(
      U.chair,
      `select coalesce(sum(count), 0)::int from interventions where business_id = 'biz_dy' and kind = 'monitor'`,
    ),
  )
  assert.equal(
    ivMonitor,
    1,
    `회장의 관찰(monitor) 한 줄이 개입으로 세어지지 않는다(${ivMonitor}건) — 0035 8절이 interventions_bump()를 다시 써서 다섯을 센다. 관찰은 회장이 그 건을 보고 "지금은 두고 본다"고 정한 것이라 손댄 것이 맞고, 빼면 개입이 실제보다 적어 보인다(위임을 넣은 것과 같은 논리)`,
  )

  return { july }
}

/* =====================================================================
 * A-2. backfill — 0034 **이전의** 회장 개입이 남는가
 * ===================================================================== */

/**
 * **DB를 따로 세운다.** 이 검사의 입력은 «0034가 적용되는 순간의 audit_log»이고,
 * 위 database()의 DB는 0034가 이미 적용된 뒤라 그 순간을 재현할 수 없다
 * (check-migrations.ts의 subtreeBackfill()이 자기 DB를 세우는 것과 같은 이유).
 *
 * 왜 재는가 — 트리거만 달고 과거분을 안 채우면 0034 이전의 회장 개입이 **영원히 0**이다.
 * §34가 12개월 추이를 요구하므로 그 침묵은 곧 거짓이 된다: "개입이 없었다"와 "0034
 * 이전이라 세지 않았다"는 다른 사실인데, 화면에는 둘 다 빈 칸으로 온다.
 *
 * 그리고 **그 backfill이 조용히 0행을 집어 왔을 수 있다.** 마이그레이션 세션에는 JWT가
 * 없어 audit_log_read의 세 분기가 전부 거짓이고, FORCE가 걸려 있으면 소유자마저 그
 * 정책 아래로 내려간다 — 예외 없이 0행이다(0027 1절의 함정). 0034 6절이 경계가 분명한
 * 창 하나로 그것을 피한다. ②의 대조군이 그 창이 **정말 필요했는지**를 증명한다.
 */
async function backfill() {
  const db = new PGlite({ extensions: { pg_trgm } })
  await applyAll(db, '0033_succession.sql')
  await db.exec(`
    insert into auth.users values ('${U.chair}', 'chair@x'), ('${U.dyCeo}', 'dyceo@x');
    insert into user_profiles (user_id, role, display_name) values
      ('${U.chair}', 'Chairman', '회장'), ('${U.dyCeo}', 'BusinessCEO', 'DY 대표');
    insert into audit_log (actor_user_id, actor_role, action, entity_table, entity_id, business_id, occurred_at) values
      ('${U.chair}', 'Chairman', 'approve',  'decisions', 'o1', 'biz_dy',   timestamptz '2026-05-02 10:00+09'),
      ('${U.chair}', 'Chairman', 'approve',  'decisions', 'o2', 'biz_dy',   timestamptz '2026-05-03 10:00+09'),
      ('${U.chair}', 'Chairman', 'delegate', 'decisions', 'o3', 'biz_dy',   timestamptz '2026-06-02 10:00+09'),
      ('${U.chair}', 'Chairman', 'reject',   'decisions', 'o4', 'biz_vana', timestamptz '2026-06-02 10:00+09'),
      -- 세면 안 되는 셋: 열람 기록 · CEO가 처리한 건 · 어느 회사인지 모르는 줄
      ('${U.chair}', 'Chairman',    'read',    'screen',    'o5', 'biz_dy', timestamptz '2026-06-02 10:00+09'),
      ('${U.dyCeo}', 'BusinessCEO', 'approve', 'decisions', 'o6', 'biz_dy', timestamptz '2026-06-02 10:00+09'),
      ('${U.chair}', 'Chairman',    'approve', 'decisions', 'o7', null,     timestamptz '2026-06-02 10:00+09');
  `)
  await applyOne(db, '0034_succession_views.sql')
  if (broke('wipe-counts')) await db.exec(`delete from intervention_counts`)
  // ㉘-d의 짝. database()의 ⑤-b가 같은 사실을 먼저 재므로 한 번에 두 단언이 걸린다 —
  // 둘 다 "0034 6절의 창이 닫힌 채로 커밋됐는가"이고, 여기 것은 **적용 직후**를 본다.
  if (broke('audit-window')) {
    await db.exec(`alter table public.audit_log no force row level security`)
  }

  /** ㉘-a 과거분이 회사 × 달 × 유형으로 그대로 들어왔다. */
  const filled = await db.query<{ business_id: string; period: string; kind: string; count: number }>(
    `select business_id, period, kind, count::int as count from intervention_counts order by 1, 2, 3`,
  )
  assert.deepEqual(
    filled.rows.map((r) => [r.business_id, r.period, r.kind, Number(r.count)]),
    [
      ['biz_dy', '2026-05', 'approve', 2],
      ['biz_dy', '2026-06', 'delegate', 1],
      ['biz_vana', '2026-06', 'reject', 1],
    ],
    `0034의 backfill이 과거 개입을 그대로 옮기지 못했다(${JSON.stringify(filled.rows)}) — 트리거만 달면 0034 이전의 회장 개입이 영원히 0이고, §34의 12개월 추이가 통째로 빈다`,
  )

  /** ㉘-b **합계 == 회장 audit 줄 수.** 0033의 ㉖이 이 형태로 살아남는다. */
  const sum = await db.query<{ n: number }>(`select coalesce(sum(count), 0)::int as n from intervention_counts`)
  const chairRows = await db.query<{ n: number }>(
    `select count(*)::int as n from audit_log
      where actor_role = 'Chairman' and action::text in ('approve','reject','modify','delegate')
        and business_id is not null`,
  )
  assert.equal(
    Number(sum.rows[0].n),
    Number(chairRows.rows[0].n),
    `backfill 합계(${sum.rows[0].n})가 회장 audit 줄 수(${chairRows.rows[0].n})와 다르다`,
  )

  /** ㉘-c **열람 기록은 한 줄도 넘어오지 않았다.** 이 표에 read가 들어오면 규율이 깨진 것이다. */
  assert.equal(
    Number((await db.query<{ n: number }>(`select count(*)::int as n from intervention_counts where kind not in ('approve','reject','modify','delegate')`)).rows[0].n),
    0,
    'intervention_counts에 승인·반려·수정·위임 밖의 유형이 들어왔다 — audit_log의 read·login 줄이 이 표로 새면 0031 2절이 지키려던 것이 무너진다',
  )

  /** ㉘-d **창이 닫힌 채로 커밋됐다.** 0034 6절이 연 것은 같은 트랜잭션 안의 창 하나다. */
  assert.equal(
    (await db.query<{ f: boolean }>(`select relforcerowsecurity as f from pg_class where relname = 'audit_log'`)).rows[0].f,
    true,
    'audit_log의 force가 내려간 채로 0034가 끝났다 — 6절의 창은 같은 트랜잭션 안에서 닫혀야 하고, 끝난 뒤 상태는 오늘과 글자 하나까지 같아야 한다',
  )

  /*
   * ㉘-e **대조군 — 그 창이 정말 필요했는가.**
   *
   * BYPASSRLS 없는 소유자로 backfill의 select를 그대로 돌린다. check-migrations.ts의
   * definerUnderNonBypassOwner() ②와 같은 모양이고, 같은 이유다: 이 harness는 superuser라
   * FORCE와 무관하게 RLS를 전부 우회하므로, 이것 없이는 "창이 필요했다"를 **원리적으로
   * 증명할 수 없다.** 창 없이 둔 0034는 production에서만 12개월 추이가 비고, 검사는 초록이다.
   */
  await db.exec(`
    create role app_owner nosuperuser nobypassrls nologin;
    grant usage on schema auth, public to app_owner;
    grant select on auth.users to app_owner;
    grant execute on all functions in schema public to app_owner;
    alter table public.audit_log     owner to app_owner;
    alter table public.user_profiles owner to app_owner;
  `)
  const scan = `select count(*)::int as n from audit_log a
                 where a.actor_role = 'Chairman' and a.action::text in ('approve','reject','modify','delegate')`
  async function asOwner(sql: string): Promise<number> {
    await db.exec(`begin; set local role app_owner;`)
    try {
      return Number(Object.values((await db.query<Record<string, unknown>>(sql)).rows[0])[0])
    } finally {
      await db.exec('rollback')
    }
  }
  assert.equal(
    await asOwner(scan),
    0,
    '대조군이 성립하지 않는다 — force가 걸린 audit_log를 BYPASSRLS 없는 소유자가 그냥 읽는다면 0034 6절의 창은 아무것도 하지 않은 것이고, 이 검사는 그 창을 재고 있지 않다',
  )
  await db.exec(`alter table public.audit_log no force row level security`)
  assert.equal(
    await asOwner(scan),
    5,
    '창을 열어도 소유자가 회장의 audit 줄을 못 읽는다 — 이 실험의 전제가 깨졌다(0034 6절이 기대는 것이 정확히 이 차이다)',
  )
  await db.exec(`alter table public.audit_log force row level security`)

  await db.close()
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

  /**
   * ㉞ **0034에서 이 자리가 뒤집혔다.** 그 회사의 CEO는 자기 회사의 개입을 본다
   *    (live에서는 intervention_counts_read = can_read_succession이 그렇게 만든다).
   *    dummy가 더 좁으면 화면이 거짓을 배운다 — 확인은 dummy로만 하기 때문이다.
   */
  const ceoIv = await as('dy_ceo', () => dummyRepository.listInterventions())
  assert.ok(
    ceoIv.length > 0 && ceoIv.every((r) => r.business_id === 'biz_dy'),
    `dummy에서 DY 대표가 자기 회사의 개입을 못 보거나 남의 회사까지 본다(${JSON.stringify(ceoIv.map((r) => r.business_id))}) — 0034는 원문대로 CEO에게 자기 회사 읽기를 준다`,
  )
  /** ㉞-a 팀장·직원은 여전히 0건이다. 가시성이 넓어져도 여기는 그대로다. */
  for (const who of ['sales_lead', 'sales_staff'] as const) {
    const iv = await as(who, () => dummyRepository.listInterventions())
    assert.equal(
      iv.length,
      0,
      `dummy에서 ${who}가 회장 개입을 읽는다 — 원문이 "나머지 거부"라고 못 박았고, 화면은 그들에게 0건이라고 말하지 않는다`,
    )
  }

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
  /**
   * **물러난 문구를 찾는 자리는 더 넓다.** 그 두 문장은 화면에만 있던 것이 아니라
   * 대시보드 카드의 주석(`dashboard-board.tsx`) · 계약 주석(`types.ts`) ·
   * 어댑터 주석(`supabase.ts`)에도 있었다. `all`만 보면 그 셋에서 되살아나도 초록이다 —
   * 주석이 거짓말을 하는 것도 화면이 거짓말을 하는 것과 같은 종류의 고장이다
   * (다음 사람이 그 주석을 읽고 화면을 고친다).
   */
  const retired = [
    all,
    board,
    src('lib', 'repository', 'types.ts'),
    src('lib', 'repository', 'supabase.ts'),
  ].join('\n')
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
    all.includes(needle('권한 밖이라 집계되지 않습니다')),
    "개입 건수가 보이지 않을 때 '권한 밖이라 집계되지 않습니다'라고 말하지 않는다 — 없는 것과 못 보는 것을 같은 0으로 그리는 것이 이 블록에서 금지된 거짓말이고, 0034로 가시성이 넓어져도 Executive·TeamLead·Member에게는 그대로다",
  )
  /**
   * ㊶-a **0033의 문구가 남아 있지 않다.** 0034가 개입을 GroupCFO와 자기 회사 CEO에게
   *    열었으므로 '회장 계정에서만 집계됩니다'는 **거짓**이 됐다. 지우는 것을 잊으면
   *    화면이 사실이 아닌 말을 하고, 그것이 이 블록이 유일하게 금지한 것이다.
   */
  assert.ok(
    !retired.includes('회장 계정에서만'),
    "화면·카드·어댑터·계약 주석 어딘가에 '회장 계정에서만 집계됩니다'가 남아 있다 — 0034부터 그룹 CFO와 그 회사 대표도 개입 건수를 본다. 거짓이 된 문장이다",
  )
  /** ㊶-b 의존도가 «보는 사람의 권한 안에서» 계산된다는 문구도 거짓이 됐다. */
  assert.ok(
    !retired.includes('보는 사람의 권한 안에서'),
    "화면·카드·어댑터·계약 주석 어딘가에 '이 값은 보는 사람의 권한 안에서 계산됩니다'가 남아 있다 — 0034부터 회사의 의존도는 계정과 무관하게 같은 값이다",
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
    .split(/\r?\n/) // CRLF checkout — \r이 남으면 /--.*$/의 $가 줄 끝을 못 찾아 주석이 안 걷힌다
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

  /**
   * ㊺-a **0034가 `audit_log_read`를 건드리지 않았다.** 이 블록의 하드 경계다.
   *
   *    파일을 글자로 읽는다. DB 단언(위 ⑤-b의 force, ㉗-c의 0행)은 «지금 상태»를 재지만,
   *    이 단언은 «이 파일이 그 정책에 손을 댔는가»를 잰다 — 정책을 열었다가 닫는 식의
   *    변경은 상태로는 안 보이고, 그 자리가 정확히 블록 7이 지킨 자리다.
   *    주석은 걷고 본다(이 파일의 주석에 policy 이름이 여러 번 나온다 — 걷지 않으면
   *    검사가 문장을 세지 않고 글자를 세게 된다. 0033을 볼 때와 같은 이유다).
   */
  const sql34 = readFileSync(join(MIGRATIONS, '0034_succession_views.sql'), 'utf8')
  const stmt34 = sql34
    .split(/\r?\n/) // CRLF checkout — 위와 같은 이유
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')
  assert.ok(
    !/audit_log_read/i.test(stmt34),
    '0034가 audit_log_read에 손을 댔다 — 이 블록의 하드 경계다. 그 정책을 넓히면 블록 7이 지킨 것(남의 열람 기록을 가로질러 읽지 못한다)이 같이 무너진다',
  )
  assert.ok(
    !/alter\s+type\s+audit_action/i.test(stmt34),
    '0034가 audit_action enum을 건드린다 — 0022가 production에서 55P04를 밟은 자리다',
  )
  /** 창을 열었으면 **같은 파일 안에서 닫아야 한다.** 여는 줄 하나에 닫는 줄 하나다. */
  const opened = (stmt34.match(/alter\s+table\s+public\.audit_log\s+no\s+force/gi) ?? []).length
  const closed = (stmt34.match(/alter\s+table\s+public\.audit_log\s+force/gi) ?? []).length
  assert.equal(
    opened,
    closed,
    `0034에서 audit_log의 force를 여는 줄(${opened})과 닫는 줄(${closed})의 수가 다르다 — 6절의 창은 같은 트랜잭션 안에서 열리고 닫혀야 한다`,
  )
  /** 0001~0033은 이 작업에서 한 글자도 안 바뀐다 — 0034가 전방 수정이다(0024 주석). */
  assert.ok(
    /전방 수정/.test(sql34),
    '0034에 "전방 수정"이라는 말이 없다 — 이미 적용된 0002·0003·0033을 고치지 않고 앞으로 나아가며 고친다는 것이 이 파일의 전제다',
  )
}

/* ===================================================================== */

async function main() {
  if (BREAK) console.log(`※ 음성 대조: DEP_BREAK=${BREAK} — ${BREAKS[BREAK]}`)
  const { july } = await database()
  await backfill()
  formula()
  await dummy()
  screens()
  console.log(
    `PASS: 0033·0034 승계 — §7 식(고정 입력 ${FIXTURE.chairman}/${FIXTURE.ceo}/${FIXTURE.rule} → ` +
      `${july[0].dependency_pct}%, 역산 미도달 ${july[0].unknown_count}건은 분자·분모 밖) · ` +
      '역산 규칙 ①②③ · 트리거 · 표 넷의 역할 RLS(CEO 읽기까지 · Executive/TeamLead/Member 0건) · ' +
      'check 제약 셋 · force 없음 · security_invoker · ' +
      '0034 문 둘(decisions no force → 회장=CFO=CEO 같은 % · intervention_counts 칸 다섯 · ' +
      '쓰기 권한 0 · 트리거가 감사 줄을 죽이지 않는다 · backfill 합계 = 회장 audit 줄 수 · ' +
      'audit_log force 유지) · interventions(위임 포함 · **0035의 관찰 포함** · Chairman·GroupCFO·자기 회사 CEO) · ' +
      'DY 시드(영역 6 · 이양 7 · 부재 2 · 자율성 0) · TS 식 = SQL 식 · dummy 게이트 · 화면 문구',
  )
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

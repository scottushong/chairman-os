/**
 * 주의(ATTENTION) 검사 — npm run check:attention (Phase 7 블록 B · 0035 · B-1 · B-2)
 *
 * 이 블록이 틀리는 방식은 하나뿐이고, 그것은 조용하다: **«재지 못한 것»이 «이상 없는 것»과
 * 같은 값으로 기록되는 것.** 수치가 끊긴 회사는 예외가 0건이고, 0건은 초록으로 그려지고,
 * 회장은 그것을 "오늘은 조용했다"로 읽는다. 그래서 이 검사가 재려는 것도 "화면이 뜨는가"가
 * 아니라 **"모르는 것을 모른다고 말하는가, 그리고 AI가 정하지 못하게 되어 있는가"**다.
 *
 * 다섯 덩이다.
 *   A. 0035  — PGlite에 마이그레이션 전부를 올리고 **BYPASSRLS 없는 소유자**에서 잰다.
 *              그 조건이 요점이다(check-activity·check-migrations·check-dependency와 같은
 *              설정·같은 이유): superuser 하네스는 정책과 definer에 관한 단언을 **초록인 채
 *              production만 깨지는** 상태로 통과시킨다(0027이 기록한 함정).
 *   B. 계승  — 0035가 0034의 트리거를 다시 쓴 자리. 관찰(monitor)이 다섯 번째로 세어지고,
 *              `audit_log`의 FORCE와 `decisions`의 no force가 그대로인가. 그리고 **화면의
 *              유형별 막대 합이 월 합계와 맞는가** — 0035가 유형을 더한 날 어긋날 뻔했고
 *              오늘 그것을 재는 단언이 이 저장소에 없었다.
 *   C. 순수  — lib/attention/{rules,score,brief}.ts. DB 없이. **0035의 눈금·가중치·경계를
 *              SQL 주석과 TS 상수 양쪽에서 읽어 맞춘다**(0033의 §7 식 선례와 같은 모양).
 *   D. 배선  — lib/attention/stage.ts를 **실제 RLS 아래에서** 돌린다. PGlite 위에 PostgREST를
 *              흉내 낸 하네스를 세우고 AIAgent 세션으로 붙인다 — 야간 Job이 실제로 걷는 길이
 *              그것이고, 그 길에는 `insert … returning`이 정책을 타는 자리가 있다.
 *   E. 글자  — 프롬프트 파일과 배선이 선언하는 입력 키. 코드가 넘기는 키를 프롬프트가 모르면
 *              모델에게는 **없는 키**이고, 그것이 B-2의 Important 1이었다(주의 목록이 회장에게
 *              닿지 않았다). 이 부류는 글자로만 잴 수 있다.
 *
 * ■ 음성 대조 ■ ATT_BREAK=<key> 로 **재려는 대상 자체를 일부러 깨뜨린다.** A·B·D·E에서는
 * 시스템을 깬다(정책을 열고, 제약을 떨어뜨리고, 함수를 갈아 끼우고, 프롬프트에서 키를
 * 지운다). C의 순수 함수는 소스를 고치지 않고 **고정 입력을 깨뜨린다** —
 * check-dependency의 `ts-null-as-ceo`와 같은 자리이고, 같은 한계다(그 단언이 살아 있다는
 * 것까지가 그 돌연변이가 증명하는 것이다). 키마다 «이름값 하는 그 단언»이 빨개지는 것을
 * 돌려서 확인한 문구가 블록 보고서에 있다.
 *
 * ■ 짓지 않은 것 ■ **화면 단언은 여기 없다.** `/attention` · `/attention/rules` · 대시보드
 * 주의 카드는 아직 없고(B-3), B-3이 자기 화면 단언을 이 파일에 더한다. 예외는 개입 막대
 * 하나다 — 그 화면(`/dependency/[id]`)은 이미 있다.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { PGlite } from '@electric-sql/pglite'
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import type { AiAdapter, ExceptionContext } from '../src/lib/ai/adapter'
import {
  EXCEPTION_ANALYSIS_JSON_SCHEMA,
  parseExceptionAnalysis,
} from '../src/lib/ai/exception-schema'
import {
  ATTENTION_BRIEF_MAX,
  attentionItems,
  describeMeasured,
  formatExceptionAnalysis,
  selectAttentions,
} from '../src/lib/attention/brief'
import {
  compare,
  evaluateRule,
  evaluateRules,
  windowMonths,
  type CompanyMeasurements,
  type MetricPoint,
  type RuleOutcome,
  type RunwayReading,
} from '../src/lib/attention/rules'
import {
  attentionScore,
  AXES_WITH_PLANNED_SOURCE,
  AXIS_MAX,
  AXIS_WEIGHT,
  financialImpactAxis,
  LEVEL_BOUNDARY,
  MIN_AXES_FOR_LEVEL,
  type Axis,
} from '../src/lib/attention/score'
import { runAttentionStage } from '../src/lib/attention/stage'
import {
  ATTENTION_AXES,
  INTERVENTION_KINDS,
  INTERVENTION_LABEL_KO,
  type Business,
  type ExceptionRecord,
  type ExceptionRule,
  type FinanceKpi,
  type InterventionRow,
} from '../src/types'
import { applyAll, MIGRATIONS } from './pglite'

const ROOT = join(__dirname, '..')
const src = (...p: string[]) => readFileSync(join(ROOT, 'src', ...p), 'utf8')

/* =====================================================================
 * 음성 대조 스위치
 * ===================================================================== */

const BREAKS = {
  /* ---- A. 0035의 시드·구조·권한 ---- */
  'seed-exception-row': '예외 행 하나를 시드처럼 심는다(0035는 0건을 약속했다)',
  'wipe-rule-seed': '규칙 13종 시드를 지운다',
  'reverse-rule-order': 'sort_order를 뒤집어 §18 목록 순서를 깬다',
  'manual-zero-threshold': '수동 규칙 열 개에 임계 0을 채운다',
  'rls-off': 'exceptions의 row level security를 끈다',
  'force-on': 'exceptions에 force row level security를 건다',
  'anon-select': 'anon에게 exceptions의 select를 준다',
  'grant-delete': 'authenticated에게 예외 delete를 준다(정책까지 열어서)',
  'door-public': '0035가 만든 문 둘의 execute를 public에 돌려준다',
  'counts-write': 'intervention_counts의 쓰기를 모든 활성 사용자에게 연다',
  /* ---- A. 0035의 정책 ---- */
  'read-open-to-business':
    'exceptions_read에서 can_read_restricted()를 뗀다 — B-1이 좁힌 것을 되돌린다',
  'read-no-writer': 'exceptions_read에서 «그 표에 쓰는 사람» 갈래를 뗀다 — B-2가 의존하는 것이다',
  'cfo-not-restricted':
    'can_read_restricted()에서 GroupCFO를 뺀다 — 두 표의 독자가 조용히 갈라지는 날을 만든다',
  'restrictive-permissive': 'ai_agent_no_update를 restrictive에서 permissive로 바꾼다',
  'ai-closed-insert-open': 'ai_agent_no_closed_insert를 지운다',
  'ai-update-open':
    'restrictive를 떼고 exceptions_triage까지 열어 AIAgent가 예외를 고칠 수 있게 한다',
  'triage-open': 'exceptions_triage를 «로그인했으면 처리»로 연다',
  'rules-read-narrow': 'exception_rules의 읽기를 [제한] 독자로 좁힌다',
  'rules-write-open': 'exception_rules의 쓰기를 모든 활성 사용자에게 연다',
  'score-write-cfo': 'can_score_attention()을 can_write_attention()과 같게 넓힌다',
  /* ---- A. check 제약 열둘 ---- */
  'drop-rule-shape': 'exception_rules의 kind_shape check를 지운다',
  'drop-comparator-check': 'exception_rules의 comparator check를 지운다',
  'drop-status-check': 'exceptions의 status check를 지운다',
  'drop-rule-fk': 'exceptions의 rule_key FK를 지운다',
  'drop-monitor-until': 'monitoring ↔ monitor_until check를 지운다',
  'drop-period-shape': 'period의 YYYY-MM 모양 check를 지운다',
  'drop-dedupe': '중복 방지 unique(회사·규칙·기간)를 지운다',
  'drop-axis-source': '축 ↔ 출처 check를 지운다',
  'drop-unknown-axes': 'unknown_axes ↔ 실제 null 개수 check를 지운다',
  'drop-axis-range': '축 0~10 범위 check를 지운다',
  'drop-score-level': 'score ↔ level check를 지운다',
  'drop-score-biz-fk': 'attention_scores의 복합 FK(예외의 회사와 같아야 한다)를 지운다',
  /* ---- B. 0034 계승 ---- */
  'bump-no-monitor': 'interventions_bump()를 0034의 넷으로 갈아 끼운다',
  'audit-no-force': 'audit_log의 force를 내린 채로 둔다',
  'decisions-force': 'decisions에 force를 되살린다',
  'sql-window': '0035 본문에 audit_log의 force를 내리는 줄을 끼워 넣는다',
  'enum-new-action': 'audit_action에 주의 전용 값을 새로 만든다',
  'kinds-drop-monitor': '화면이 도는 유형 목록에서 monitor를 뺀다(라벨을 빠뜨린 날의 모양)',
  'screen-text': '화면·어휘 파일에서 찾는 문구를 있을 리 없는 것으로 바꾼다',
  /* ---- C. 순수 함수 (고정 입력을 깨뜨린다) ---- */
  'rule-manual-as-metric': '수동 규칙 고정 입력의 kind를 metric으로 바꾼다',
  'window-days-swap': '창 고정 입력의 30일과 90일을 맞바꾼다',
  'runway-months-shift': '런웨이 고정 입력의 개월 수를 2.14에서 2.94로 옮긴다',
  'rules-order-input': '규칙 고정 입력의 sort_order를 뒤집는다',
  'boundary-shift': '경계 고정 입력의 축 값을 7에서 6으로 내린다',
  'axis-direction-flip': '런웨이 축 고정 입력의 비교자를 <에서 >로 바꾼다',
  'measured-manual-value': '수동 규칙 고정 입력에 잰 값을 넣는다',
  'items-level-word': '맨 위 항목 고정 입력의 등급을 RED에서 YELLOW로 바꾼다',
  'monitor-days-in-range': '거절되어야 하는 monitor_days 고정 입력을 범위 안으로 바꾼다',
  'unknown-axes-expects-six':
    'DB의 unknown_axes 제약을 «6이어야 한다»로 바꾼다 — TS가 낸 수와 DB가 받는 수가 갈라진 날',
  'kpi-fill-gap': '창 가운데 비워 둔 달을 채운다',
  'kpi-supply-missing': '없다고 둔 수치를 채운다 — «못 쟀다»가 «쟀다»가 된다',
  'comparator-known': '모르는 비교자 고정 입력을 아는 비교자로 바꾼다',
  'abs-inside-threshold': 'abs> 고정 입력의 잰 값을 임계 안쪽으로 바꾼다',
  'runway-unknown-as-clear': '원장이 못 냈다는 고정 입력을 소진 없음으로 바꾼다',
  'weights-from-sql': '0035 5절에서 읽어 온 가중치·경계 값을 한 칸 흔든다',
  'axes-one-less': '로드맵이 닿는 축 수에서 하나를 뺀 고정 입력을 준다',
  'ceo-ability-forward': 'ceo_ability 고정 입력 둘을 뒤집는다(역방향이 아닌 것처럼)',
  'fill-missing-with-zero': '없는 축을 0으로 채운 고정 입력을 준다',
  'axis-beyond-threshold': '«임계에 막 올라섬» 고정 입력을 한참 넘어선 값으로 바꾼다',
  'threshold-zero-as-axis': '임계 0 고정 입력을 0이 아닌 임계로 바꾼다',
  'planned-axes-nonzero': '«상한 셋은 보장이 아니다» 고정 입력의 임계 0을 0이 아닌 값으로 바꾼다',
  'detected-on-utc': '감지 시각을 KST 경계 안쪽으로 되돌린다(UTC 자르기와 답이 같아지는 시각)',
  'brief-open-monitoring': '관찰 중 고정 입력의 status를 open으로 바꾼다',
  'brief-flip-severity': '맨 위 목록 고정 입력의 등급 하나를 바꾼다',
  'brief-limit-off': '맨 위 목록의 상한을 여섯으로 올린다',
  'analysis-four-lines': 'ai_analysis에 네 번째 줄을 붙인다',
  'parser-passthrough': '파서가 모델이 덧붙인 칸을 그대로 통과시키게 한다',
  'schema-open': '출력 스키마의 additionalProperties를 열린 것으로 읽는다',
  'ctx-severity': '모델에 넘긴 입력에 등급을 끼워 넣는다',
  /* ---- D. 배선 ---- */
  'stage-merge-unmeasured': 'evaluated가 «못 쟀다»까지 세게 한다(B-2 수정 전의 모양)',
  'stage-warn-as-failure': '«재지 못했다»를 실패와 같은 칸으로 접는다',
  'wipe-existing-before-rerun': '두 번째 회차 전에 첫 회차가 만든 예외를 지운다',
  'drop-dedupe-tick': '틱 겹침을 재는 DB에서 중복 방지 unique를 지운다',
  'adapter-returns-analysis': '분석을 못 받는 자리에 멀쩡한 어댑터를 준다',
  'plant-all-rules': '심어 둔 기록 실패를 규칙 하나가 아니라 그 회사 전부로 넓힌다',
  'plant-every-company': '심어 둔 기록 실패를 그 회사가 아니라 모든 회사로 넓힌다',
  'score-plant-off': '점수 기록을 터뜨리던 심어 둔 제약을 걷는다',
  'severity-base-yellow': '회장이 RED로 올린 규칙을 YELLOW에 그대로 둔다',
  'rules-read-granted': '규칙 읽기를 막던 revoke를 걷는다',
  'other-unique-named-like-dedupe': '다른 유니크 제약의 이름에 중복 방지 제약 이름을 심는다',
  /* ---- E. 글자 ---- */
  'prompt-drop-key': '프롬프트에서 입력 키 하나(attentions·unmeasured)를 지운다',
  'prompt-unmeasured-optional': '프롬프트에서 «이 순위를 빼는 것은 금지다»를 지운다',
  'wiring-text': '야간 Job 배선에서 찾는 문구를 있을 리 없는 것으로 바꾼다',
} as const
type BreakKey = keyof typeof BREAKS

const BREAK = (process.env.ATT_BREAK ?? '') as BreakKey | ''
if (BREAK && !(BREAK in BREAKS)) {
  throw new Error(`ATT_BREAK=${BREAK} 는 모르는 키다. 있는 것: ${Object.keys(BREAKS).join(', ')}`)
}
const broke = (k: BreakKey) => BREAK === k

/* =====================================================================
 * 하네스 — PGlite + BYPASSRLS 없는 소유자
 * ===================================================================== */

const U = {
  chair: '00000000-0000-0000-0000-0000000c7001',
  cfo: '00000000-0000-0000-0000-0000000c7002',
  dyCeo: '00000000-0000-0000-0000-0000000c7003',
  vanaCeo: '00000000-0000-0000-0000-0000000c7004',
  exec: '00000000-0000-0000-0000-0000000c7005',
  lead: '00000000-0000-0000-0000-0000000c7006',
  member: '00000000-0000-0000-0000-0000000c7007',
  /** 야간 Job 계정. 0003 시드에는 없다 — 예외를 만드는 것이 이 계정이다(0035 7절). */
  agent: '00000000-0000-0000-0000-0000000c7008',
}

/** 일곱 역할. «못 보는 것»과 «없는 것»이 다르다는 규율이 여기서 숫자로 증명된다. */
const ROLES = [
  ['Chairman', U.chair],
  ['GroupCFO', U.cfo],
  ['BusinessCEO', U.dyCeo],
  ['Executive', U.exec],
  ['TeamLead', U.lead],
  ['Member', U.member],
  ['AIAgent', U.agent],
] as const

/**
 * 표와 함수를 BYPASSRLS 없는 역할에게 넘긴다. **이 이전이 이 검사의 전부다** —
 * superuser 하네스는 force와 무관하게 RLS를 전부 우회하므로, 이것 없이 세운 정책 단언은
 * "정책이 무엇을 막는가"를 **원리적으로 답하지 못한다**(0027:60).
 *
 * `user_profiles`·`user_business_access`·`businesses`까지 같이 넘기는 것은 Supabase 흉내다 —
 * 거기서는 public의 표와 함수가 전부 한 소유자라, definer 판정 함수가 어느 표를 읽든
 * 소유자로 읽는다. 여기서만 소유자가 갈리면 재려던 것이 아니라 하네스의 소유권 분할을 잰다.
 */
async function ownedByNonBypassRole(db: PGlite) {
  await db.exec(`
    create role app_owner nosuperuser nobypassrls nologin;
    grant usage on schema auth to app_owner;
    grant select on auth.users to app_owner;
    grant execute on all functions in schema public to app_owner;
    alter table public.exception_rules       owner to app_owner;
    alter table public.exceptions            owner to app_owner;
    alter table public.attention_scores      owner to app_owner;
    alter table public.user_profiles         owner to app_owner;
    alter table public.user_business_access  owner to app_owner;
    alter table public.businesses            owner to app_owner;
    alter table public.finance_kpis          owner to app_owner;
    alter table public.audit_log             owner to app_owner;
    alter table public.intervention_counts   owner to app_owner;
    alter table public.decisions             owner to app_owner;
    alter function public.can_write_attention(text) owner to app_owner;
    alter function public.can_score_attention(text) owner to app_owner;
    alter function public.can_read_restricted()     owner to app_owner;
    alter function public.can_approve()             owner to app_owner;
    alter function public.has_business(text)        owner to app_owner;
    alter function public.is_active()               owner to app_owner;
    alter function public.auth_role()               owner to app_owner;
    alter function public.interventions_bump()      owner to app_owner;
    grant usage on schema public, auth to authenticated, anon;
  `)
  const owner = await db.query<{ s: boolean; b: boolean }>(
    `select rolsuper as s, rolbypassrls as b from pg_roles where rolname = 'app_owner'`,
  )
  assert.equal(owner.rows[0].s, false, '실험 설정이 깨졌다 — app_owner가 superuser다')
  assert.equal(owner.rows[0].b, false, '실험 설정이 깨졌다 — app_owner가 bypassrls다')
}

/** 일곱 사람과 회사 접근. 야간 Job 계정에도 `has_business()`가 필요하다(0035 7절). */
async function seedPeople(db: PGlite) {
  await db.exec(`
    insert into auth.users values
      ('${U.chair}', 'chair@x'), ('${U.cfo}', 'cfo@x'), ('${U.dyCeo}', 'dyceo@x'),
      ('${U.vanaCeo}', 'vanaceo@x'), ('${U.exec}', 'exec@x'), ('${U.lead}', 'lead@x'),
      ('${U.member}', 'member@x'), ('${U.agent}', 'agent@x');
    insert into user_profiles (user_id, role, display_name, reports_to) values
      ('${U.chair}',   'Chairman',    '회장',      null),
      ('${U.cfo}',     'GroupCFO',    '그룹 CFO',  '${U.chair}'),
      ('${U.dyCeo}',   'BusinessCEO', 'DY 대표',   '${U.chair}'),
      ('${U.vanaCeo}', 'BusinessCEO', 'VANA 대표', '${U.chair}'),
      ('${U.exec}',    'Executive',   '본부장',    '${U.dyCeo}'),
      ('${U.lead}',    'TeamLead',    '팀장',      '${U.exec}'),
      ('${U.member}',  'Member',      '직원',      '${U.lead}'),
      ('${U.agent}',   'AIAgent',     '야간 Job',  '${U.chair}');
    insert into user_business_access (user_id, business_id) values
      ('${U.dyCeo}', 'biz_dy'), ('${U.vanaCeo}', 'biz_vana'), ('${U.exec}', 'biz_dy'),
      ('${U.lead}', 'biz_dy'), ('${U.member}', 'biz_dy'),
      ('${U.agent}', 'biz_dy'), ('${U.agent}', 'biz_vana');
  `)
}

/** 한 사람의 세션으로 SQL 한 줄. 끝나면 되돌린다. */
function sessionRunner(db: PGlite) {
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
  async function count(uid: string | null, sql: string): Promise<number> {
    return Number(await val<number>(uid, sql))
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
  /** 세션을 **커밋하는** 쓰기. 남아야 하는 행을 넣을 때만 쓴다. */
  async function write(uid: string, sql: string) {
    await db.exec(
      `begin; select set_config('request.jwt.claim.sub', '${uid}', true); set local role authenticated;`,
    )
    try {
      const r = await db.query(sql)
      await db.exec('commit')
      return r
    } catch (e) {
      await db.exec('rollback')
      throw e
    }
  }
  return { rows, val, count, rejected, write }
}

type Session = ReturnType<typeof sessionRunner>

/* =====================================================================
 * A. 0035 — 시드 · 구조 · 권한 · 정책 · check 제약
 * ===================================================================== */

/** §18 목록 순서 그대로의 열세 줄. 0035 3절의 시드가 이 순서여야 한다. */
const RULE_KEYS_IN_DOC_ORDER = [
  'revenue_variance',
  'ebitda_margin_drop',
  'cash_runway',
  'debt_covenant',
  'major_customer_loss',
  'production_stop',
  'quality_issue',
  'ceo_forecast_miss',
  'turnover_high',
  'capital_project_delay',
  'legal_issue',
  'fraud_signal',
  'security_issue',
] as const

/** 0035 3절이 수치로 잴 수 있다고 본 셋. 나머지 열은 수동 플래그다. */
const METRIC_RULE_KEYS = ['revenue_variance', 'ebitda_margin_drop', 'cash_runway'] as const

async function policies(db: PGlite) {
  await ownedByNonBypassRole(db)
  await seedPeople(db)
  const { rows, val, count, rejected, write } = sessionRunner(db)

  /* ---------------------------------------------------------------- 1. 시드 */

  if (broke('seed-exception-row')) {
    await db.exec(`
      insert into exceptions (business_id, rule_key, period, value, threshold, severity)
      values ('biz_dy', 'cash_runway', '2026-07', 2.1, 6, 'RED');
    `)
  }

  /**
   * ① **예외와 점수가 시드에 0건이다.** 0035가 그것을 글로 약속했고(4절), 이유는
   *    «시드로 넣으면 화면이 첫날부터 있지도 않은 위험을 빨갛게 그린다»다. 회장이 그
   *    빨강을 한 번 열어 보고 아무것도 없는 것을 확인하면 그 뒤로 진짜 빨강도 안 열어 본다.
   *    **가장 먼저 잰다** — 아래 단언들이 자기 행을 심기 전이어야 이 숫자가 «시드»다.
   */
  assert.equal(
    await count(U.chair, `select count(*)::int from exceptions`),
    0,
    '0035 시드에 예외 행이 있다 — 예외는 규칙이 실제로 걸려야 생기는 것이고, 시드로 넣으면 화면이 첫날부터 없는 위험을 빨갛게 그린다(0035 4절)',
  )
  assert.equal(
    await count(U.chair, `select count(*)::int from attention_scores`),
    0,
    '0035 시드에 점수 행이 있다 — 점수는 예외에 붙는 것이고 예외가 0건이다',
  )

  if (broke('wipe-rule-seed')) await db.exec(`delete from exception_rules`)
  if (broke('reverse-rule-order')) {
    await db.exec(`update exception_rules set sort_order = -sort_order`)
  }
  if (broke('manual-zero-threshold')) {
    await db.exec(`
      alter table exception_rules drop constraint exception_rules_kind_shape_check;
      update exception_rules set threshold = 0 where kind = 'manual';
    `)
  }

  /** ② 규칙 13종이 **§18 목록 순서 그대로** 있다. 전제(문서 원문)를 먼저 확인한다. */
  const doc = readFileSync(join(ROOT, 'docs', 'chairman-architecture-v1.md'), 'utf8')
  assert.ok(
    doc.includes('EXCEPTION MANAGEMENT ENGINE') && doc.includes('TRIGGER EXAMPLES'),
    '문서 §18의 원문이 바뀌었다 — 이 단언의 전제가 깨졌다',
  )
  const seeded = await rows<{ rule_key: string; kind: string }>(
    U.member,
    `select rule_key, kind from exception_rules order by sort_order`,
  )
  assert.equal(
    seeded.length,
    RULE_KEYS_IN_DOC_ORDER.length,
    `0035 3절의 규칙 시드가 13종이 아니다(${seeded.length}종) — §18의 TRIGGER EXAMPLES 열세 줄이다`,
  )
  assert.deepEqual(
    seeded.map((r) => r.rule_key),
    [...RULE_KEYS_IN_DOC_ORDER],
    '규칙 시드가 §18 목록 순서로 나오지 않는다 — insert 순서에 기대면 select가 그 순서를 돌려준다는 보장이 없어서 sort_order를 둔 것이고, 화면이 문서와 대조되지 않으면 그 칸은 없는 것과 같다',
  )

  /** ③ `metric` 셋 · `manual` 열. 그 가름이 없으면 «설정이 덜 된 규칙»과 «원래 수동인 규칙»이 같아진다. */
  assert.deepEqual(
    seeded.filter((r) => r.kind === 'metric').map((r) => r.rule_key),
    [...METRIC_RULE_KEYS],
    '0035 시드의 metric 규칙이 셋(매출 변동·마진 하락·현금 런웨이)이 아니다 — 이 저장소에 수치 원천이 있는 것이 그 셋뿐이다',
  )
  assert.equal(
    seeded.filter((r) => r.kind === 'manual').length,
    10,
    '0035 시드의 manual 규칙이 열이 아니다',
  )

  /** ④ **수동 열 개에는 임계가 아예 없다.** 0으로 채우면 "임계 0"이라는 없는 규칙이 생긴다. */
  const manualFilled = await count(
    U.member,
    `select count(*)::int from exception_rules
      where kind = 'manual' and (metric is not null or comparator is not null
                                 or threshold is not null or window_days is not null)`,
  )
  assert.equal(
    manualFilled,
    0,
    `수동 규칙 ${manualFilled}개에 임계·지표·비교자·창이 채워져 있다 — 그 칸들은 «없는 것»이지 0이 아니고, 0으로 채우면 화면이 "임계 0을 넘겼다"는 없는 사실을 그린다`,
  )

  /* ---------------------------------------------------------------- 2. 구조와 권한 */

  if (broke('rls-off')) await db.exec(`alter table exceptions disable row level security`)
  if (broke('force-on')) await db.exec(`alter table exceptions force row level security`)

  /**
   * ⑤ 새 표 셋에 **RLS는 켜고 force는 걸지 않았다.** 두 칸을 다 잰다 —
   *    force만 재면 «정책이 아예 안 걸리는 표»가 그대로 통과하고, 그 순간 그 표는
   *    select 권한만 있으면 누구나 읽는 표가 된다.
   *    force를 재는 이유는 그 반대다: 예외를 **만드는** 문이 야간 Job에서 오고, force가
   *    남아 있으면 그 문이 소유자 권한으로 돌면서도 정책 아래로 내려가 조용히 0행을 준다
   *    (이 저장소가 네 번 밟은 함정 — 0023 · 0027 · 0029 · 0034).
   */
  const flags = await rows<{ relname: string; r: boolean; f: boolean }>(
    null,
    `select relname, relrowsecurity as r, relforcerowsecurity as f from pg_class
      where relname in ('exception_rules', 'exceptions', 'attention_scores') order by relname`,
    'app_owner',
  )
  assert.equal(
    flags.length,
    3,
    `0035의 새 표 셋 중 없는 것이 있다(${flags.map((f) => f.relname).join(',')})`,
  )
  for (const t of flags) {
    assert.equal(
      t.r,
      true,
      `${t.relname}에 row level security가 꺼져 있다 — 정책이 한 줄도 걸리지 않고, select 권한만 있으면 누구나 읽는다`,
    )
    assert.equal(
      t.f,
      false,
      `${t.relname}에 force row level security가 걸렸다 — 이 저장소가 네 번 밟은 함정이다(0023·0027·0029·0034). 자물쇠는 revoke다`,
    )
  }

  if (broke('anon-select')) {
    await db.exec(`grant select on table exceptions to anon;
                   create policy break_anon_read on exceptions for select to anon using (true);`)
  }

  /** ⑥ anon에게는 표 셋의 권한이 하나도 없다. 자물쇠는 revoke다(0035 6절). */
  for (const t of ['exception_rules', 'exceptions', 'attention_scores']) {
    assert.equal(
      await val<boolean>(null, `select has_table_privilege('anon', '${t}', 'select')`, 'app_owner'),
      false,
      `anon이 ${t}를 읽을 수 있다 — revoke가 빠졌다`,
    )
  }
  assert.ok(
    (await rejected(null, `select count(*) from exceptions`, 'anon')) !== null,
    'anon이 exceptions를 읽는다 — 0035 6절의 revoke가 빠졌다',
  )

  if (broke('grant-delete')) {
    await db.exec(`grant delete on table exceptions to authenticated;
                   create policy break_delete on exceptions for delete using (is_active());`)
  }

  /**
   * ⑦ **delete 권한이 아무에게도 없다.** 예외는 지우는 것이 아니라 닫는 것이다
   *    (`status='closed'`). grant가 없고 정책도 없어 두 겹이고, 그래서 0035가 AIAgent에게
   *    restrictive delete를 따로 걸지 않았다 — 잴 것이 없기 때문이다. 그 «잴 것이 없다»가
   *    참인지를 여기서 잰다.
   */
  for (const t of ['exception_rules', 'exceptions', 'attention_scores']) {
    for (const who of ['authenticated', 'anon']) {
      assert.equal(
        await val<boolean>(
          null,
          `select has_table_privilege('${who}', '${t}', 'delete')`,
          'app_owner',
        ),
        false,
        `${who}에게 ${t}의 delete 권한이 있다 — 0035 6절은 그 권한을 아무에게도 주지 않았다. 예외는 지우는 것이 아니라 닫는 것이고, 규칙은 지우는 것이 아니라 enabled=false로 끄는 것이다`,
      )
    }
  }

  if (broke('door-public')) {
    await db.exec(`grant execute on function can_write_attention(text) to public`)
  }

  /**
   * ⑧ 0035가 만든 문 둘의 execute가 **public에 없다**(0019 3절의 revoke가 살아 있는가).
   *    security definer 함수에서 public 기본 execute는 곧 "anon도 RPC로 부를 수 있다"는
   *    뜻이다. 몸통이 `is_active()`로 걸러 주더라도 기본 권한을 남겨 두지 않는다 —
   *    나중에 몸통이 한 줄 바뀌는 날 그 기본값이 구멍이 된다.
   */
  for (const fn of ['can_write_attention(text)', 'can_score_attention(text)']) {
    assert.equal(
      await val<boolean>(
        null,
        `select has_function_privilege('public', '${fn}', 'execute')`,
        'app_owner',
      ),
      false,
      `${fn}의 execute가 public에 남아 있다 — 0019 3절의 revoke가 빠졌다`,
    )
    assert.equal(
      await val<boolean>(
        null,
        `select has_function_privilege('authenticated', '${fn}', 'execute')`,
        'app_owner',
      ),
      true,
      `authenticated에게 ${fn}의 execute가 없다 — 정책이 그 함수를 부르므로 화면과 야간 Job이 42501을 받는다`,
    )
  }

  /**
   * ⑨ `intervention_counts`에 쓰기 권한이 **아무에게도** 없다. 0034가 세운 자리인데
   *    0035가 그 표의 트리거 몸통을 다시 썼으므로 여기서 한 번 더 본다
   *    (check-dependency와 겹이다 — 0035를 통과한 뒤에도 그 사실이 참인가는 다른 질문이다).
   */
  if (broke('counts-write')) {
    await db.exec(`grant insert, update, delete on table intervention_counts to authenticated`)
  }
  for (const priv of ['insert', 'update', 'delete']) {
    assert.equal(
      await val<boolean>(
        null,
        `select has_table_privilege('authenticated', 'intervention_counts', '${priv}')`,
        'app_owner',
      ),
      false,
      `authenticated에게 intervention_counts의 ${priv} 권한이 있다 — 이 표를 쓰는 것은 audit_log의 트리거 하나뿐이어야 하고, 사람이 고칠 수 있으면 이 숫자가 감사 기록에서 나왔다는 근거가 사라진다`,
    )
  }

  return { rows, val, count, rejected, write }
}

/* =====================================================================
 * A-2. 0035의 정책 일곱 — **행동으로** 잰다
 * ===================================================================== */

/**
 * 정책은 «있는가»가 아니라 «무엇을 막는가»로 잰다. 카탈로그를 읽는 단언은 스키마를 다시
 * 진술할 뿐이고, 이 표들의 위험은 스키마가 아니라 **누가 무엇을 보는가**에 있다.
 */
async function policyBehaviour(db: PGlite, s: Session) {
  if (broke('read-open-to-business')) {
    // B-1이 좁힌 것을 되돌린다 — `alerts_read`를 그대로 본떴던 최초 모양이다.
    // 그러면 `finance_kpis`를 한 줄도 못 읽는 DY 팀장이 여기서 "현금 런웨이 2.1개월"을 읽는다.
    await db.exec(`
      drop policy exceptions_read on exceptions;
      create policy exceptions_read on exceptions for select using (has_business(business_id));
    `)
  }
  if (broke('read-no-writer')) {
    // «그 표에 쓰는 사람» 갈래를 뗀다. 야간 Job(AIAgent)이 `can_read_restricted()` 밖이라
    // 자기가 방금 넣은 줄을 `returning`으로 못 읽는다 — B-2가 의존하는 바로 그 갈래다.
    await db.exec(`
      drop policy exceptions_read on exceptions;
      create policy exceptions_read on exceptions
        for select using (has_business(business_id) and can_read_restricted());
    `)
  }
  if (broke('cfo-not-restricted')) {
    // GroupCFO를 `can_read_restricted()`에서 뺀다. 두 표의 «쓰는 사람» 갈래가 서로 다른
    // 함수를 부르므로(can_write_attention ↔ can_score_attention) 그날 두 표의 독자가
    // 조용히 갈라지고 0035:726-733의 주석이 거짓이 된다.
    await db.exec(`
      create or replace function can_read_restricted() returns boolean
      language sql stable security definer set search_path = public as $fn$
        select is_active() and auth_role() in ('Chairman', 'BusinessCEO', 'Executive');
      $fn$;
    `)
  }
  if (broke('score-write-cfo')) {
    await db.exec(`
      create or replace function can_score_attention(target text) returns boolean
      language sql stable security definer set search_path = public as $fn$
        select can_write_attention(target);
      $fn$;
    `)
  }

  /** 읽을 것을 심는다 — 회장 세션으로 커밋한다. 빈 표에서는 누구에게나 0행이라 독자를 가릴 수 없다. */
  const dyId = Number(
    (
      await s.write(
        U.chair,
        `insert into exceptions (business_id, rule_key, period, value, threshold, severity, status)
         values ('biz_dy', 'revenue_variance', '2026-08', 45, 20, 'YELLOW', 'open') returning id`,
      )
    ).rows.map((r) => (r as { id: number }).id)[0],
  )
  const vanaId = Number(
    (
      await s.write(
        U.chair,
        `insert into exceptions (business_id, rule_key, period, value, threshold, severity, status)
         values ('biz_vana', 'cash_runway', '2026-08', 2.1, 6, 'RED', 'open') returning id`,
      )
    ).rows.map((r) => (r as { id: number }).id)[0],
  )
  await s.write(
    U.chair,
    `insert into attention_scores (exception_id, business_id, financial_impact,
       financial_impact_source, unknown_axes)
     values (${dyId}, 'biz_dy', 10, '검사가 심은 축 하나', 5)`,
  )

  /** 그 표에서 DY의 행이 보이는 역할 목록. «0행»과 «못 본다»를 같은 값으로 접지 않는다. */
  const readersOf = async (table: string) => {
    const out: string[] = []
    for (const [role, uid] of ROLES) {
      if ((await s.count(uid, `select count(*)::int from ${table} where business_id = 'biz_dy'`)) > 0) {
        out.push(role)
      }
    }
    return out
  }

  /**
   * ⑩ **AIAgent의 `insert … returning`이 id를 돌려준다.** Postgres는 INSERT의 `returning`에도
   *    SELECT 정책을 걸고, supabase-js의 `.insert().select()`가 내는 문장이 정확히 그것이다.
   *    `exceptions.id`는 identity라 그 값을 알 길이 그 하나뿐이고, 못 읽으면 야간 Job은
   *    `attention_scores.exception_id`를 채울 수 없다 — 점수를 붙일 예외를 가리키지 못한다.
   *    **읽기의 둘째 갈래가 사라지면 42501로 터진다**(조용한 0행이 아니다. 그것이 다행이다).
   *
   *    **아래 독자 목록보다 앞에 둔다.** 그 갈래를 떼면 AIAgent가 독자 목록에서도 빠지므로,
   *    순서를 뒤집으면 이 단언이 재려던 것(`returning`)이 한 번도 재어지지 않는다.
   */
  const agentReturning = await s
    .rows<{ id: number }>(
      U.agent,
      `insert into exceptions (business_id, rule_key, period, value, threshold, severity, status)
       values ('biz_dy', 'ebitda_margin_drop', '2026-08', -8, -5, 'YELLOW', 'open') returning id`,
    )
    .catch(() => null)
  assert.ok(
    agentReturning !== null && agentReturning.length === 1,
    'AIAgent의 insert … returning이 id를 돌려주지 않는다 — exceptions_read의 «그 표에 쓰는 사람» 갈래가 없으면 야간 Job이 자기가 방금 넣은 줄을 못 읽고, 그러면 attention_scores.exception_id를 채울 수 없다(0035 7절 · B-2가 의존하는 갈래)',
  )

  /**
   * ⑪ **`exceptions`의 독자는 다섯이다.** `can_read_restricted()`의 넷(Chairman · GroupCFO ·
   *    BusinessCEO · Executive)에 «그 표에 쓰는 사람»으로 AIAgent가 더해진다.
   *    **TeamLead·Member가 0행인 것이 B-1이 좁힌 자리다** — `exceptions.value`에 들어오는
   *    숫자가 `finance_kpis_read`가 `can_read_restricted()` 뒤에 잠가 둔 바로 그 숫자이고,
   *    같은 사실이 표에 따라 다른 등급으로 잠기면 낮은 쪽이 그 표의 실제 등급이 된다.
   *    그 좁힘을 덮는 검사가 오늘까지 하나도 없었다.
   */
  const readersE = await readersOf('exceptions')
  assert.deepEqual(
    readersE,
    ['Chairman', 'GroupCFO', 'BusinessCEO', 'Executive', 'AIAgent'],
    `exceptions의 독자가 다섯(Chairman·GroupCFO·BusinessCEO·Executive·AIAgent)이 아니다(${readersE.join(',')}) — TeamLead·Member가 여기 들어오면 finance_kpis가 잠가 둔 현금·매출·마진을 그들이 예외 화면에서 읽는다(0035 7절)`,
  )
  /** ⑩-a 회사 격리는 그대로다. 다른 회사의 CEO에게 DY의 예외는 0행이다. */
  assert.equal(
    await s.count(U.vanaCeo, `select count(*)::int from exceptions where business_id = 'biz_dy'`),
    0,
    'VANA 대표에게 DY의 예외가 보인다 — has_business()가 빠졌다',
  )

  /**
   * ⑫ **두 표의 독자 집합이 같다.** 0035:726-733이 그렇게 적혀 있고, 오늘 그것이 참인 이유는
   *    분리합이 아니라 `can_read_restricted()`가 GroupCFO를 품고 있어서다 —
   *    두 표의 «쓰는 사람» 갈래는 **다른 함수**를 부르고(`can_write_attention` ↔
   *    `can_score_attention`) 그 둘이 갈리는 역할이 정확히 GroupCFO 하나다.
   *    **그가 그 함수에서 빠지는 날 두 표가 조용히 갈라지고 그 주석이 거짓이 된다.**
   *    오늘 그 결합을 강제하는 것이 이 한 줄뿐이다.
   */
  const readersS = await readersOf('attention_scores')
  assert.deepEqual(
    readersS,
    readersE,
    `exceptions와 attention_scores의 독자가 갈라졌다(예외 ${readersE.join(',')} / 점수 ${readersS.join(',')}) — 0035 7절이 "두 표의 독자는 정확히 같다"고 적었고, 그것이 참인 이유는 can_read_restricted()가 GroupCFO를 품고 있어서다. 두 표의 «쓰는 사람» 갈래는 서로 다른 함수를 부르므로 그 함수에서 역할 하나가 빠지면 여기서 갈라진다`,
  )

  /**
   * ⑬ **GroupCFO는 예외를 올리지만 점수는 매기지 못한다.** 예외를 올리는 것은 "이 회사에
   *    이런 일이 있다"는 보고이고, 점수는 §19의 여섯 축으로 «회장이 무엇을 볼지» 정하는
   *    일이다. 원문이 점수 쓰기를 "규칙 엔진과 Chairman"으로 적었고, 함수를 하나로 합치면
   *    원문에 없던 역할이 조용히 얹힌다(B-1이 실제로 그렇게 썼다가 되돌렸다).
   */
  const cfoException = await s.rejected(
    U.cfo,
    `insert into exceptions (business_id, rule_key, period, value, threshold, severity)
     values ('biz_dy', 'production_stop', null, null, null, 'YELLOW')`,
  )
  assert.equal(
    cfoException,
    null,
    `그룹 CFO가 예외를 올리지 못한다(${cfoException}) — can_write_attention()은 Chairman·GroupCFO·AIAgent다`,
  )
  const cfoScore = await s.rejected(
    U.cfo,
    `insert into attention_scores (exception_id, business_id, unknown_axes)
     values (${vanaId}, 'biz_vana', 6)`,
  )
  assert.ok(
    cfoScore !== null,
    '그룹 CFO가 점수를 매겼다 — can_score_attention()은 Chairman·AIAgent뿐이다(원문: "쓰기는 규칙 엔진과 Chairman"). 예외를 올리는 것과 «회장이 무엇을 볼지» 정하는 것은 다른 일이다',
  )

  /* ---- AI는 만들기만 한다 ---- */

  if (broke('ai-closed-insert-open')) {
    await db.exec(`drop policy ai_agent_no_closed_insert on exceptions`)
  }

  /**
   * ⑭ **AIAgent가 넣는 예외는 `status='open'`이어야 한다.** 닫힌 채로 들어오는 예외는
   *    "만들되 닫지 않는다"를 글자로만 지킨 것이고, `monitoring`으로 들어오는 것은
   *    '언제까지 두고 볼지'를 AI가 정한 것이 된다. 둘 다 결정이고, 결정은 AI가 하지 않는다.
   *    **restrictive는 AIAgent에게만 걸린다** — 회장은 닫힌 예외를 넣을 수 있다(마지막 줄).
   */
  for (const status of ['closed', 'monitoring']) {
    const msg = await s.rejected(
      U.agent,
      `insert into exceptions (business_id, rule_key, period, severity, status, monitor_until)
       values ('biz_dy', 'legal_issue', null, 'RED', '${status}',
               ${status === 'monitoring' ? `now() + interval '14 days'` : 'null'})`,
    )
    assert.ok(
      msg !== null,
      `AIAgent가 status='${status}'인 예외를 넣었다 — ai_agent_no_closed_insert가 빠졌다. 닫는 것도 관찰로 옮기는 것도 회장의 일이다(§19 "AI가 CEO를 대신하지 않는다")`,
    )
  }
  assert.equal(
    await s.rejected(
      U.chair,
      `insert into exceptions (business_id, rule_key, period, severity, status)
       values ('biz_dy', 'legal_issue', null, 'RED', 'closed')`,
    ),
    null,
    '회장이 닫힌 예외를 넣지 못한다 — restrictive는 AIAgent에게만 걸려야 한다',
  )

  if (broke('restrictive-permissive')) {
    await db.exec(`
      drop policy ai_agent_no_update on exceptions;
      create policy ai_agent_no_update on exceptions for update
        using (auth_role() is distinct from 'AIAgent')
        with check (auth_role() is distinct from 'AIAgent');
    `)
  }

  /**
   * ⑮ 정책 이름과 종류. **이것만은 행동으로 잴 수 없다** — `ai_agent_no_update`가
   *    permissive가 되어도 AIAgent는 `exceptions_triage`의 `can_approve()`에서 이미 막히므로
   *    오늘의 행동이 달라지지 않는다. 그래서 카탈로그로 잰다. `check-migrations.ts`에 같은
   *    단언 셋이 있고(B-1이 붙였다) 여기서 겹으로 두는 이유는, 그 파일은 «0035가 그렇게
   *    선언했는가»를 보고 이 파일은 «주의 엔진이 오늘도 그 겹을 갖고 있는가»를 보기 때문이다.
   *    **`ai_agent_no_insert`는 없어야 한다** — 있으면 야간 Job이 예외를 못 만들고 블록 B가
   *    통째로 막힌다. AI가 못 하는 것은 «만드는 것»이 아니라 «정하는 것»이다.
   */
  const policyKind = new Map(
    (
      await s.rows<{ policyname: string; permissive: string }>(
        null,
        `select policyname, permissive from pg_policies
          where schemaname = 'public' and tablename = 'exceptions'`,
        'app_owner',
      )
    ).map((r) => [r.policyname, r.permissive]),
  )
  for (const name of ['ai_agent_no_update', 'ai_agent_no_closed_insert']) {
    assert.equal(
      policyKind.get(name),
      'RESTRICTIVE',
      `0035: exceptions의 ${name}가 restrictive가 아니다(${policyKind.get(name) ?? '없다'}) — permissive면 그것은 «막는 겹»이 아니라 «또 하나의 허용»이고, 그 길이 열릴 날(규칙 자동 종결) 아무것도 막지 않는다`,
    )
  }
  assert.equal(
    policyKind.get('ai_agent_no_insert'),
    undefined,
    '0035: exceptions에 ai_agent_no_insert가 생겼다 — 야간 Job이 예외를 만들지 못하면 블록 B의 규칙 엔진이 통째로 막힌다',
  )

  if (broke('ai-update-open')) {
    await db.exec(`
      drop policy ai_agent_no_update on exceptions;
      drop policy exceptions_triage on exceptions;
      create policy exceptions_triage on exceptions for update
        using (is_active()) with check (is_active());
    `)
  }

  /**
   * ⑯ **AIAgent는 예외를 고치지 못한다.** B-2의 설계 전체가 이 전제 위에 서 있다 —
   *    등급도 점수도 AI 분석도 «넣는 그 순간»에 함께 들어가는 이유가 이것이고, 0035가
   *    "B-2가 level로 severity를 갱신한다"고 적은 그 갱신이 update로는 불가능한 이유도
   *    이것이다. 두 겹이 같이 막는다(`can_approve()` · restrictive).
   */
  const agentUpdated = await s.rows<{ id: number }>(
    U.agent,
    `update exceptions set status = 'closed' where id = ${dyId} returning id`,
  )
  assert.equal(
    agentUpdated.length,
    0,
    'AIAgent가 예외를 고쳤다 — 이 표의 update는 can_approve()이고 restrictive ai_agent_no_update가 한 겹 더 막아야 한다. 이 전제가 무너지면 B-2가 «insert 하나로 끝낸다»고 택한 설계의 근거가 사라진다',
  )

  if (broke('triage-open')) {
    await db.exec(`
      drop policy exceptions_triage on exceptions;
      create policy exceptions_triage on exceptions for update
        using (is_active()) with check (is_active());
    `)
  }

  /**
   * ⑰ **처리(status · monitor_until)는 승인권자만이고 자기 회사 안에서만이다.**
   *    회장의 '관찰 14일'이 실제로 걸리고, 그 회사 CEO도 처리하지만, 다른 회사의 CEO와
   *    GroupCFO는 못 닫는다 — GroupCFO는 예외를 **올릴** 수는 있지만 닫지는 못한다.
   *    그것이 `can_approve()`가 정의하는 경계이고, 0035는 여기서 새 역할 목록을 만들지 않았다.
   */
  const monitored = await s.rows<{ id: number }>(
    U.chair,
    `update exceptions set status = 'monitoring', monitor_until = now() + interval '14 days'
      where id = ${dyId} returning id`,
  )
  assert.equal(monitored.length, 1, "회장이 예외를 '관찰 14일'로 옮기지 못한다 — 원문의 회장 액션 셋 중 하나다")
  assert.equal(
    (await s.rows<{ id: number }>(U.dyCeo, `update exceptions set status = 'closed' where id = ${dyId} returning id`))
      .length,
    1,
    '자기 회사 CEO가 자기 회사의 예외를 닫지 못한다 — can_approve()는 Chairman·BusinessCEO다',
  )
  assert.equal(
    (await s.rows<{ id: number }>(U.vanaCeo, `update exceptions set status = 'closed' where id = ${dyId} returning id`))
      .length,
    0,
    'VANA 대표가 DY의 예외를 닫았다 — 회사 판정(has_business)이 update 쪽에 빠졌다',
  )
  assert.equal(
    (await s.rows<{ id: number }>(U.cfo, `update exceptions set status = 'closed' where id = ${dyId} returning id`))
      .length,
    0,
    '그룹 CFO가 예외를 닫았다 — 올리는 것과 닫는 것은 다른 문이고, 닫는 문은 can_approve()다',
  )

  /* ---- 규칙 표: 읽기는 넓고 쓰기는 회장뿐 ---- */

  if (broke('rules-read-narrow')) {
    await db.exec(`
      drop policy exception_rules_read on exception_rules;
      create policy exception_rules_read on exception_rules
        for select using (is_active() and can_read_restricted());
    `)
  }

  /**
   * ⑱ **규칙은 활성 사용자 전부가 읽는다.** 임계를 아는 것이 위험하지 않다 —
   *    화면이 "왜 DY가 yellow인가"를 설명하려면 그 회사 사람도 규칙을 봐야 하고,
   *    "매출 ±20%가 임계다"를 아는 것은 그 회사의 매출을 아는 것이 아니다.
   *    그래서 그 표의 `threshold`에는 `[제한]` 꼬리표가 붙지 않았다.
   */
  assert.ok(
    (await s.count(U.member, `select count(*)::int from exception_rules`)) === 13,
    '직원이 규칙 사전을 읽지 못한다 — 임계는 회사 데이터가 아니라 그룹의 정책 상수다(0035 7절)',
  )

  if (broke('rules-write-open')) {
    await db.exec(`
      create policy break_rules_write on exception_rules for update
        using (is_active()) with check (is_active());
    `)
  }

  /**
   * ⑲ **규칙을 고치는 것은 회장뿐이다.** BusinessCEO는 자기 회사 예외를 닫을 수는 있지만
   *    규칙은 못 고친다 — 규칙은 그룹의 기준이고, **잴 대상이 잣대를 고치면 지표가 지표가
   *    아니게 된다.**
   */
  assert.equal(
    (
      await s.rows<{ rule_key: string }>(
        U.chair,
        `update exception_rules set threshold = 25 where rule_key = 'revenue_variance' returning rule_key`,
      )
    ).length,
    1,
    '회장이 규칙 임계를 고치지 못한다 — 원문이 "규칙 임계값은 /attention/rules에서 회장 편집"이라고 적었다',
  )
  for (const [who, uid] of [['DY 대표', U.dyCeo], ['직원', U.member]] as const) {
    assert.equal(
      (
        await s.rows<{ rule_key: string }>(
          uid,
          `update exception_rules set threshold = 5 where rule_key = 'revenue_variance' returning rule_key`,
        )
      ).length,
      0,
      `${who}가 규칙 임계를 고쳤다 — 규칙은 그룹의 잣대이고, 잴 대상이 잣대를 고치면 지표가 지표가 아니게 된다`,
    )
  }

  return { dyId, vanaId }
}

/* =====================================================================
 * A-3. check 제약 열둘 — **공허하게 통과하지 않는가**
 * ===================================================================== */

/**
 * 제약은 «있는가»가 아니라 «막는가»로 잰다. 목록만 있고 제약이 없으면 화면이 아무 값이나
 * 넣고, 저장을 누르는 순간에야 23514다 — 그런데 이 표들에서는 저장하는 쪽이 야간 Job이라
 * 그 순간을 보는 사람이 없다.
 *
 * 전부 **회장 세션**으로 시도한다. 거부가 정책 때문이 아니라 **제약 때문**임을 분명히
 * 하려는 것이다 — 회장은 이 표에 쓸 수 있고, 그러므로 여기서 거부되면 그것은 제약이다.
 */
async function constraints(db: PGlite, s: Session, ids: { vanaId: number }) {
  const drop = async (key: BreakKey, table: string, name: string) => {
    if (broke(key)) await db.exec(`alter table ${table} drop constraint ${name}`)
  }
  await drop('drop-rule-shape', 'exception_rules', 'exception_rules_kind_shape_check')
  await drop('drop-comparator-check', 'exception_rules', 'exception_rules_comparator_check')
  await drop('drop-status-check', 'exceptions', 'exceptions_status_check')
  await drop('drop-monitor-until', 'exceptions', 'exceptions_monitor_until_check')
  await drop('drop-period-shape', 'exceptions', 'exceptions_period_shape_check')
  await drop('drop-dedupe', 'exceptions', 'exceptions_dedupe_unique')
  await drop('drop-rule-fk', 'exceptions', 'exceptions_rule_key_fkey')
  await drop('drop-axis-source', 'attention_scores', 'attention_axes_source_check')
  await drop('drop-unknown-axes', 'attention_scores', 'attention_unknown_axes_check')
  await drop('drop-axis-range', 'attention_scores', 'attention_axes_range_check')
  await drop('drop-score-level', 'attention_scores', 'attention_score_level_check')
  await drop('drop-score-biz-fk', 'attention_scores', 'attention_scores_business_fk')

  /** 거부되어야 한다. 통과하면 그 제약은 공허하다. */
  const mustReject = async (why: string, sql: string, needle: RegExp) => {
    const msg = await s.rejected(U.chair, sql)
    assert.ok(msg !== null, `${why} — 제약이 그 행을 받아 버렸다`)
    assert.ok(needle.test(msg), `${why} — 거부는 됐지만 다른 이유였다(${msg})`)
  }

  /* ---- ㉑ 규칙 표: 수치 규칙과 수동 규칙의 «모양» ---- */

  /**
   * 이 한 줄이 «없는 것»과 «0인 것»을 가른다. 수동 규칙에 임계가 들어오면
   * /attention/rules가 열 개의 규칙 옆에 빈 칸을 그려 놓고 회장에게 채우라고 말하게 되고,
   * 반대로 수치 규칙에 임계가 없으면 그 규칙은 «설정이 덜 된 규칙»인지 «원래 수동»인지
   * 구분되지 않는다.
   */
  await mustReject(
    '수동 규칙에 임계를 넣었는데 통과했다(exception_rules_kind_shape_check)',
    `insert into exception_rules (rule_key, name, kind, threshold, severity_base)
     values ('t_manual_thr', '수동인데 임계', 'manual', 10, 'RED')`,
    /kind_shape|violates check/,
  )
  await mustReject(
    '수치 규칙에 비교자·임계가 없는데 통과했다(exception_rules_kind_shape_check)',
    `insert into exception_rules (rule_key, name, kind, metric, severity_base)
     values ('t_metric_empty', '수치인데 비어 있다', 'metric', 'Revenue', 'RED')`,
    /kind_shape|violates check/,
  )
  await mustReject(
    "모르는 비교자('like')가 통과했다(exception_rules_comparator_check)",
    `insert into exception_rules (rule_key, name, kind, metric, comparator, threshold, severity_base)
     values ('t_cmp', '모르는 비교자', 'metric', 'Revenue', 'like', 10, 'RED')`,
    /comparator|violates check/,
  )

  /* ---- ㉒ 예외 표 ---- */

  /**
   * '언제까지'가 없는 관찰은 관찰이 아니라 **조용히 잊는 것**이다. 원문의 회장 액션이
   * "관찰 **14일**"이었고, 그 14일이 칸에 없으면 그 건은 아무 날에도 다시 서지 않는다.
   */
  await mustReject(
    "status='monitoring'인데 monitor_until이 없는 행이 통과했다(exceptions_monitor_until_check)",
    `insert into exceptions (business_id, rule_key, severity, status)
     values ('biz_dy', 'quality_issue', 'GREEN', 'monitoring')`,
    /monitor_until|violates check/,
  )
  await mustReject(
    '모르는 status가 통과했다(exceptions_status_check)',
    `insert into exceptions (business_id, rule_key, severity, status)
     values ('biz_dy', 'quality_issue', 'GREEN', 'maybe')`,
    /status|violates check/,
  )
  await mustReject(
    '없는 규칙을 가리키는 예외가 통과했다(rule_key FK) — "왜 yellow인가"에 답할 수 없는 행이다',
    `insert into exceptions (business_id, rule_key, severity)
     values ('biz_dy', 'no_such_rule', 'GREEN')`,
    /foreign key|rule_key/,
  )
  await mustReject(
    "period가 'YYYY-MM' 모양이 아닌데 통과했다(exceptions_period_shape_check)",
    `insert into exceptions (business_id, rule_key, period, severity)
     values ('biz_dy', 'quality_issue', '2026-13', 'GREEN')`,
    /period_shape|violates check/,
  )

  /**
   * ㉓ **같은 회사·같은 규칙·같은 기간은 한 건이다.** 야간 Job은 하루 한 번이 아니라 틱으로
   *    여러 번 돌고(0029), 앱에서만 막으면 조회와 insert 사이에서 두 틱이 겹친다.
   *    여기서는 그 제약이 **DB에** 있는지만 본다 — 겹치는 두 틱이 실제로 이 제약에 걸리는가는
   *    D절이 야간 Job의 코드로 잰다.
   */
  await mustReject(
    '같은 (회사·규칙·기간) 예외가 두 건 들어갔다(exceptions_dedupe_unique) — 화면이 "현금 부족"을 두 줄로 그린다',
    `insert into exceptions (business_id, rule_key, period, value, threshold, severity)
     values ('biz_dy', 'revenue_variance', '2026-08', 45, 20, 'YELLOW')`,
    /dedupe_unique|duplicate key/,
  )
  /** 반대쪽: **기간이 다르면 새 예외가 선다.** 제약이 너무 넓으면 다음 달 수치가 막힌다. */
  assert.equal(
    await s.rejected(
      U.chair,
      `insert into exceptions (business_id, rule_key, period, value, threshold, severity)
       values ('biz_dy', 'revenue_variance', '2026-09', 30, 20, 'YELLOW')`,
    ),
    null,
    '같은 규칙의 다음 달 예외가 막혔다 — 중복 방지의 키는 (회사·규칙·기간)이고, 기간이 다르면 그것은 다른 사실이다',
  )
  /**
   * 그리고 **수동 규칙은 이 제약에 걸리지 않는다**(period가 null이고 Postgres의 unique는
   * null을 서로 다른 값으로 본다). 같은 달에 거래처가 둘 이탈하면 그것은 예외 **두 건**이다.
   * 이 둘은 **커밋해서** 넣는다 — 롤백하면 «두 번째»가 두 번째가 아니게 되고, 그러면 이
   * 단언은 아무것도 재지 않는다.
   */
  for (const i of [1, 2]) {
    try {
      await s.write(
        U.chair,
        `insert into exceptions (business_id, rule_key, period, severity)
         values ('biz_dy', 'major_customer_loss', null, 'RED')`,
      )
    } catch (e) {
      assert.fail(
        `수동 규칙의 ${i}번째 예외가 막혔다(${e instanceof Error ? e.message : String(e)}) — 같은 달에 거래처가 둘 이탈하면 그것은 두 건이고, period가 null이라 unique가 그 둘을 서로 다르게 본다`,
      )
    }
  }
  assert.equal(
    await s.count(
      U.chair,
      `select count(*)::int from exceptions where rule_key = 'major_customer_loss'`,
    ),
    2,
    '수동 규칙의 예외 두 건이 표에 남지 않았다 — 위 두 insert 중 하나가 조용히 사라졌다',
  )

  /* ---- ㉔ 점수 표: 축과 출처, 그리고 «몇 개를 모르는가» ---- */

  const scoreRow = (cols: string, vals: string) =>
    `insert into attention_scores (exception_id, business_id, ${cols})
     values (${ids.vanaId}, 'biz_vana', ${vals})`

  /**
   * **출처 없는 축이 이 표에서 가장 위험한 행이다.** AI가 축을 지어내서 RED를 만들면
   * 회장이 없는 근거로 회사를 흔들게 된다. 출처 칸이 그것을 막는 유일한 자리다.
   */
  await mustReject(
    '축만 있고 출처가 없는 행이 통과했다(attention_axes_source_check)',
    scoreRow('financial_impact, unknown_axes', '7, 5'),
    /axes_source|violates check/,
  )
  await mustReject(
    '출처가 공백뿐인 행이 통과했다(attention_axes_source_check의 btrim) — 빈 글자는 출처가 아니다',
    scoreRow('financial_impact, financial_impact_source, unknown_axes', `7, '   ', 5`),
    /axes_source|violates check/,
  )
  await mustReject(
    'unknown_axes가 실제 null 개수와 다른 행이 통과했다(attention_unknown_axes_check) — 틀리는 방향은 늘 «적게 적는 쪽»이고, 그러면 축이 다 있는 것처럼 보인다',
    scoreRow('financial_impact, financial_impact_source, unknown_axes', `7, '검사', 2`),
    /unknown_axes|violates check/,
  )
  await mustReject(
    '축 범위 0~10 밖의 값이 통과했다(attention_axes_range_check) — "AI가 87을 넣었다"가 조용히 들어온다',
    scoreRow('financial_impact, financial_impact_source, unknown_axes', `87, '검사', 5`),
    /axes_range|violates check/,
  )
  await mustReject(
    'score만 있고 level이 없는 행이 통과했다(attention_score_level_check) — 화면이 그릴 수 없는 행이다',
    scoreRow('score, unknown_axes', '55.0, 6'),
    /score_level|violates check/,
  )
  await mustReject(
    '점수의 회사 칸이 예외의 회사와 어긋난 행이 통과했다(attention_scores_business_fk) — 복사한 칸이 원본과 다르면 읽기 범위가 두 벌이 된다',
    `insert into attention_scores (exception_id, business_id, unknown_axes)
     values (${ids.vanaId}, 'biz_dy', 6)`,
    /business_fk|foreign key/,
  )
}

/* =====================================================================
 * B. 0035가 0034의 트리거를 다시 쓴 자리
 * ===================================================================== */

/** 주석을 걷고 **문장만** 남긴다. 걷지 않으면 검사가 문장을 세지 않고 글자를 센다. */
function statementsOf(sql: string): string {
  return sql
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')
}

async function inherited(db: PGlite, s: Session) {
  if (broke('bump-no-monitor')) {
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
          raise warning 'bump 실패 % %', sqlstate, sqlerrm;
        end;
        return null;
      end;
      $fn$;
      alter function public.interventions_bump() owner to app_owner;
    `)
  }

  /**
   * ㉕ **관찰(monitor)도 개입이다.** 회장이 예외를 보고 "지금은 두고 본다"고 **정한** 것이라
   *    손댄 것이 맞고, 빼면 개입이 실제보다 적어 보인다 — 지표를 좋아 보이게 만드는 방향의
   *    누락이 이 저장소에서 가장 조심하는 것이다.
   *    `check:dependency`의 ㉙가 같은 사실을 재고 **그것을 깨뜨리지 않는다** — 여기서 다시
   *    재는 이유는 이 파일이 재는 다섯 유형이 **주의 화면에서 회장이 누르는 버튼**이기
   *    때문이고, 아래 ㉖이 그 다섯을 화면의 목록과 맞추는 데 이 목록을 쓴다.
   */
  await db.exec(`
    insert into audit_log (actor_user_id, actor_role, action, entity_table, entity_id, business_id) values
      ('${U.chair}', 'Chairman', 'monitor',  'exceptions', 'att_1', 'biz_dy'),
      ('${U.chair}', 'Chairman', 'approve',  'exceptions', 'att_2', 'biz_dy'),
      ('${U.chair}', 'Chairman', 'delegate', 'exceptions', 'att_3', 'biz_dy');
  `)
  assert.equal(
    await s.count(
      U.chair,
      `select coalesce(sum(count), 0)::int from interventions
        where business_id = 'biz_dy' and kind = 'monitor'`,
    ),
    1,
    '회장의 관찰(monitor) 한 줄이 개입으로 세어지지 않는다 — 0035 8절이 interventions_bump()를 다시 써서 다섯을 센다. 관찰은 회장이 그 건을 손댄 것이고, 빼면 개입이 실제보다 적어 보인다',
  )

  /**
   * ㉖ **화면의 유형별 막대 합이 월 합계와 맞는다.** `/dependency/[id]`는 월 합계를
   *    **모든 줄**에서 내고 막대는 **유형별로** 낸다. 0035가 `monitor`를 더한 순간 그 둘이
   *    어긋날 뻔했고(라벨 표에 없는 유형은 막대에서 사라지는데 합계에는 남는다),
   *    B-1이 `INTERVENTION_KINDS`를 라벨 표에서 파생시켜 막았다. **오늘 그 재현을 재는 단언이
   *    이 저장소 어디에도 없었다** — 줄이 런타임에 풀리므로 typecheck가 이 부류를 못 잡는다.
   *
   *    유형 목록을 손으로 적지 않는다. **DB에 올라간 트리거 정의에서 뽑는다** — 그것이
   *    «이 표에 실제로 들어올 수 있는 유형»의 유일한 원천이고, 손으로 적으면 이 단언이
   *    화면과 같은 방식으로 낡는다.
   */
  const bumpDef =
    (await s.val<string>(null, `select pg_get_functiondef('interventions_bump()'::regprocedure)`, 'app_owner')) ?? ''
  const counted = [...(bumpDef.match(/action::text\s+in\s*\(([^)]*)\)/) ?? [])[1]?.matchAll(/'([a-z_]+)'/g) ?? []].map(
    (m) => m[1],
  )
  assert.ok(
    counted.length >= 4,
    `트리거 정의에서 세는 유형 목록을 못 읽었다(${counted.join(',')}) — 이 단언의 전제가 깨졌다`,
  )
  /** 화면이 도는 목록. 돌연변이는 «라벨을 빠뜨린 날»을 만든다. */
  const screenKinds = (broke('kinds-drop-monitor')
    ? INTERVENTION_KINDS.filter((k) => k !== 'monitor')
    : INTERVENTION_KINDS) as InterventionRow['kind'][]
  /** 화면과 같은 두 줄. 한쪽은 모든 줄을 더하고, 다른 쪽은 유형별로 더한다. */
  const months = ['2026-08', '2026-09']
  const fixture: InterventionRow[] = counted.flatMap((kind, i) =>
    months.map((period, j) => ({
      business_id: 'biz_dy',
      period,
      kind: kind as InterventionRow['kind'],
      count: i + j + 1,
    })),
  )
  const byMonthTotal = months
    .map((m) => fixture.filter((r) => r.period === m).reduce((a, r) => a + Number(r.count), 0))
    .reduce((a, n) => a + n, 0)
  const byKindTotal = screenKinds
    .map((k) => fixture.filter((r) => r.kind === k).reduce((a, r) => a + Number(r.count), 0))
    .reduce((a, n) => a + n, 0)
  assert.equal(
    byKindTotal,
    byMonthTotal,
    `화면의 유형별 막대 합(${byKindTotal})이 월 합계(${byMonthTotal})와 다르다 — 트리거가 세는 유형은 [${counted.join(',')}]이고 화면이 도는 목록은 [${screenKinds.join(',')}]이다. 월 합계는 모든 줄을 더하므로 목록에서 빠진 유형은 "이번 달 개입 N건" 아래에 합이 N보다 작은 막대를 세운다`,
  )

  /* ---- 0035가 건드리지 않았어야 하는 것 ---- */

  if (broke('audit-no-force')) {
    await db.exec(`alter table public.audit_log no force row level security`)
  }
  if (broke('decisions-force')) {
    await db.exec(`alter table public.decisions force row level security`)
  }

  /**
   * ㉗ **`audit_log`의 FORCE가 그대로 걸려 있다.** 0034 6절이 backfill을 위해 같은 트랜잭션
   *    안에서 잠깐 열었다 닫았고, **0035는 그 창을 아예 열지 않는다**(`monitor` 줄은 0035
   *    이전에 존재할 수 없어 backfill이 필요 없다). 그 표에는 열람 기록(read·login)이 쌓이고,
   *    0031 2절이 지키려던 것이 이 한 줄이다.
   */
  assert.equal(
    await s.val<boolean>(
      null,
      `select relforcerowsecurity from pg_class where relname = 'audit_log'`,
      'app_owner',
    ),
    true,
    'audit_log에 force row level security가 없다 — 0035 8절은 그 창을 열지 않는다고 적었다. 그 표에는 누가 언제 무엇을 열어 봤나가 쌓인다',
  )
  /** ㉗-a **`decisions`의 force는 그대로 내려가 있다.** 되살아나면 §7 의존도가 계정마다 다른 %가 된다. */
  assert.equal(
    await s.val<boolean>(
      null,
      `select relforcerowsecurity from pg_class where relname = 'decisions'`,
      'app_owner',
    ),
    false,
    'decisions에 force row level security가 되살아났다 — 0034 2절이 내린 것이고, 0035는 그 표를 건드리지 않는다',
  )

  /**
   * ㉘ **0035 파일이 손대지 않았어야 할 것에 손대지 않았다.** 위 둘은 «지금 상태»를 재지만
   *    이 단언은 «이 파일이 그것에 손을 댔는가»를 잰다 — 열었다가 닫는 식의 변경은 상태로는
   *    안 보인다(check-dependency ㊺-a와 같은 자리, 같은 이유).
   */
  const raw0035 = readFileSync(join(MIGRATIONS, '0035_attention.sql'), 'utf8')
  const stmt0035 = broke('sql-window')
    ? `${statementsOf(raw0035)}\nalter table public.audit_log no force row level security;`
    : statementsOf(raw0035)
  assert.ok(
    !/alter\s+table\s+public\.audit_log/i.test(stmt0035),
    '0035가 audit_log에 손을 댔다 — 8절이 "그 표의 force는 여기서 한 글자도 건드리지 않는다"고 적었고, 창을 열었다 닫는 변경은 상태로는 보이지 않는다',
  )
  assert.ok(
    !/force\s+row\s+level\s+security/i.test(stmt0035),
    '0035가 force row level security를 건다 — 이 저장소가 네 번 밟은 함정이다(자물쇠는 revoke다)',
  )
  assert.ok(
    !/audit_log_read/i.test(stmt0035),
    '0035가 audit_log_read에 손을 댔다 — 블록 7이 지킨 하드 경계다',
  )
  assert.ok(
    !/current_date/i.test(stmt0035) && !/service_role/i.test(stmt0035),
    '0035에 current_date나 service_role이 들어왔다 — 이 저장소의 «오늘»은 at time zone Asia/Seoul이고 service_role은 없다(CLAUDE.md)',
  )

  if (broke('enum-new-action')) {
    await db.exec(`alter type audit_action add value if not exists 'attention_created'`)
  }

  /**
   * ㉙ **감사 유형을 새로 만들지 않았다.** 0035가 더한 값은 `monitor` 하나이고, 예외 생성은
   *    야간 Job의 `night_job_completed` 줄의 **숫자**로 남는다(`after.attention`).
   *    새 enum 값은 0022가 production에서 55P04를 밟은 자리라 값 하나가 비싸다.
   */
  const actions = (
    await s.rows<{ n: string }>(
      null,
      `select enumlabel as n from pg_enum e join pg_type t on t.oid = e.enumtypid
        where t.typname = 'audit_action' order by e.enumsortorder`,
      'app_owner',
    )
  ).map((r) => r.n)
  assert.ok(actions.includes('monitor'), "audit_action에 'monitor'가 없다 — 0035 1절이 그 값을 만든다")
  assert.ok(
    actions.includes('night_job_completed'),
    "audit_action에 'night_job_completed'가 없다 — 주의 단계의 숫자가 실릴 자리다",
  )
  assert.ok(
    !actions.some((n) => n.startsWith('attention') || n.startsWith('exception')),
    `audit_action에 주의 전용 값이 생겼다(${actions.join(',')}) — 0035는 monitor 하나만 더했고, 예외 생성은 night_job_completed의 숫자로 남는다(0022가 production에서 55P04를 밟은 자리다)`,
  )
}

/* =====================================================================
 * C. 순수 함수 — lib/attention/{rules,score,brief}.ts
 *
 * **여기서는 소스를 고치지 않고 고정 입력을 깨뜨린다**(check-dependency의 `ts-null-as-ceo`와
 * 같은 자리). 그 돌연변이가 증명하는 것은 «이 단언이 살아 있고 그 값을 실제로 읽는다»까지다 —
 * 정책·제약·문장을 깨뜨리는 A·B·D·E의 돌연변이보다 한 겹 약하고, 그 차이를 숨기지 않는다.
 * 대신 이 절의 가장 중요한 단언 하나는 시스템 돌연변이를 갖는다: **0035 5절의 눈금·가중치·
 * 경계를 SQL에서 읽어 TS 상수와 맞추는 것**(⑦). 구현이 둘이라 한쪽만 고쳐지는 날이 온다.
 * ===================================================================== */

const RULE_BASE: ExceptionRule = {
  rule_key: 'revenue_variance',
  name: '매출 변동',
  scope: 'company',
  kind: 'metric',
  metric: 'Revenue',
  comparator: 'abs>',
  threshold: 20,
  window_days: 30,
  severity_base: 'YELLOW',
  enabled: true,
  sort_order: 1,
}
const rule = (over: Partial<ExceptionRule>): ExceptionRule => ({ ...RULE_BASE, ...over })

const NO_RUNWAY: RunwayReading = { months: null, status: 'unknown', period: null }
const kpi = (period: string, metric: MetricPoint['metric'], value: number): MetricPoint => ({
  period,
  metric,
  value,
})
const measured = (kpis: MetricPoint[], runway: RunwayReading = NO_RUNWAY): CompanyMeasurements => ({
  business_id: 'biz_dy',
  kpis,
  runway,
})

/** 결과 한 줄을 사람이 읽는 글자로. **«clear»와 «unmeasured»가 같은 글자가 되지 않게** 쓴다. */
const show = (o: RuleOutcome): string =>
  o.kind === 'triggered' || o.kind === 'clear'
    ? `${o.kind} ${o.value === null ? 'null' : o.value}`
    : `${o.kind}/${o.reason}`

function pureRules() {
  /**
   * ① **평가 대상이 아닌 여섯을 건너뛰고, 건너뛴 이유를 돌려준다.**
   *    가장 중요한 줄은 첫 줄이다 — `manual` 규칙 열 개는 **절대 감지되지 않는다.**
   *    수치가 없는데 걸렸다고 말하는 것이 이 블록에서 가장 나쁜 거짓말이고, 마지막 줄이
   *    그 반대쪽을 막는다: 잴 식이 없는 규칙은 «안 걸렸다»가 아니라 «잴 식이 없다»다.
   */
  const manualRule = broke('rule-manual-as-metric')
    ? rule({ rule_key: 'debt_covenant', kind: 'metric', metric: 'Cash', comparator: '<', threshold: 1 })
    : rule({ rule_key: 'debt_covenant', kind: 'manual', metric: null, comparator: null, threshold: null, window_days: null })
  const skips = [
    ['수동 규칙', manualRule],
    ['꺼진 규칙', rule({ enabled: false })],
    ['그룹 범위', rule({ scope: 'group' })],
    ['모르는 비교자', rule({ comparator: 'like' })],
    ['임계가 빈 수치 규칙', rule({ threshold: null })],
    ['잴 식이 없는 수치 규칙', rule({ rule_key: 'debt_ratio_new' })],
  ] as const
  assert.deepEqual(
    skips.map(([label, r]) => [label, show(evaluateRule(r, measured([])))]),
    [
      ['수동 규칙', 'skipped/manual'],
      ['꺼진 규칙', 'skipped/disabled'],
      ['그룹 범위', 'skipped/group_scope'],
      ['모르는 비교자', 'skipped/unknown_comparator'],
      ['임계가 빈 수치 규칙', 'skipped/incomplete_rule'],
      ['잴 식이 없는 수치 규칙', 'skipped/no_measurement'],
    ],
    '규칙 평가가 «건너뛴 이유»를 제대로 돌려주지 않는다 — 수동 규칙이 감지되거나(가장 나쁜 거짓말), 잴 식이 없는 규칙이 «안 걸렸다»로 접히거나, 임계가 빈 규칙을 0으로 읽는다',
  )

  /**
   * ② **모르는 비교자에는 null을 돌려준다 — `>`로 추측하지 않는다.**
   *    `abs>`가 임계에도 절댓값을 씌우는 이유: 회장이 /attention/rules에서 `-20`을 넣어도
   *    "±20%를 넘으면"이라는 뜻이 뒤집히지 않아야 한다.
   */
  assert.equal(
    compare(25, broke('comparator-known') ? '>' : 'like', 20),
    null,
    "모르는 비교자에 compare()가 답을 냈다 — 추측해서 '>'로 읽으면 회장이 정하지 않은 판정이 지표가 된다",
  )
  assert.deepEqual(
    [
      compare(broke('abs-inside-threshold') ? 15 : 25, 'abs>', -20),
      compare(-25, 'abs>', 20),
      compare(15, 'abs>', -20),
      compare(2, '<', 6),
      compare(6, '<', 6),
      compare(6, '<=', 6),
      compare(-8, '<=', -5),
      compare(25, '>', 20),
      compare(20, '>=', 20),
    ],
    [true, true, false, true, false, true, true, true, true],
    '비교자 다섯이 0035 2절의 뜻대로 동작하지 않는다 — abs>는 임계에도 절댓값을 씌워야 하고(그러지 않으면 음수 임계에서 «±20%»가 뒤집힌다), 경계값(6 < 6 · 6 <= 6)이 한 칸 밀리면 회장이 보는 건수가 달라진다',
  )

  /**
   * ③ **창은 달로 옮긴다.** `finance_kpis`의 눈금이 달이라 30일은 한 달, 90일은 분기다.
   *    칸이 비어 있으면 한 달 — «창을 안 정했다»를 0달로 읽으면 아무것도 못 잰다.
   */
  const [w30, w90] = broke('window-days-swap') ? [90, 30] : [30, 90]
  assert.deepEqual(
    [windowMonths(w30), windowMonths(w90), windowMonths(null)],
    [1, 3, 1],
    '창(window_days)이 달로 옮겨지지 않는다 — 30일은 한 달, 90일은 분기, 빈 칸은 한 달이다',
  )

  /**
   * ④ **«못 쟀다»의 네 가지 이유가 각각 그 이유로 나온다. «정상»이 아니다.**
   *    이 표가 이 파일에서 가장 중요하다. 수치가 끊긴 회사를 `clear`로 접으면 그 회사는
   *    화면에서 초록이 되고, 회장은 그것을 "이상 없다"로 읽는다.
   *    **창 가운데 한 달이 비면 합을 내지 않는다** — 있는 달만 더하면 빠진 달이 «매출이
   *    줄었다»로 읽히고, 그 거짓은 정확히 예외를 만들어 내는 방향이다.
   */
  // 직전 창(04~06)은 다 있고 **재는 창(07~09)의 가운데 한 달이 비어 있다.**
  // 있는 달만 더하면 240이 아니라 120이 되어 «매출이 반으로 줄었다»는 예외가 선다.
  const gapKpis = [
    kpi('2026-04', 'Revenue', 100),
    kpi('2026-05', 'Revenue', 100),
    kpi('2026-06', 'Revenue', 100),
    kpi('2026-07', 'Revenue', 60),
    ...(broke('kpi-fill-gap') ? [kpi('2026-08', 'Revenue', 60)] : []),
    kpi('2026-09', 'Revenue', 60),
  ]
  const noKpis = broke('kpi-supply-missing')
    ? [kpi('2026-08', 'Revenue', 100), kpi('2026-09', 'Revenue', 101)]
    : []
  assert.deepEqual(
    [
      ['수치가 아예 없다', show(evaluateRule(rule({}), measured(noKpis)))],
      [
        '직전 창이 없다',
        show(evaluateRule(rule({}), measured([kpi('2026-09', 'Revenue', 100)]))),
      ],
      [
        '직전 창의 합이 0이다',
        show(
          evaluateRule(
            rule({}),
            measured([kpi('2026-08', 'Revenue', 0), kpi('2026-09', 'Revenue', 100)]),
          ),
        ),
      ],
      [
        '창 가운데 한 달이 비었다',
        show(evaluateRule(rule({ window_days: 90 }), measured(gapKpis))),
      ],
      ['원장이 런웨이를 못 냈다', show(evaluateRule(rule({ rule_key: 'cash_runway', metric: 'Cash', comparator: '<', threshold: 6, window_days: 90 }), measured([])))],
    ],
    [
      ['수치가 아예 없다', 'unmeasured/no_kpi'],
      ['직전 창이 없다', 'unmeasured/no_baseline'],
      ['직전 창의 합이 0이다', 'unmeasured/zero_baseline'],
      ['창 가운데 한 달이 비었다', 'unmeasured/no_kpi'],
      ['원장이 런웨이를 못 냈다', 'unmeasured/ledger_unknown'],
    ],
    '«못 쟀다»가 «이상 없다»로 접혔다 — 수치가 끊긴 회사가 화면에서 초록이 되고, 창 가운데 빠진 달은 «매출이 줄었다»로 읽힌다(그 거짓은 정확히 예외를 만드는 방향이다)',
  )

  /**
   * ⑤ **쟀을 때의 답.** 세 규칙의 `value`가 각각 다른 것을 뜻한다(변동률 % · 마진 변화 %p ·
   *    개월 수) — 0035 3절이 규칙마다 그 뜻을 따로 적어 두었고, 그래서 식이 `rule_key`에 걸려 있다.
   *    · **내리는 것도 오르는 것도 예외다**(`abs>`).
   *    · **마진이 오르면 예외가 아니다**(임계 -5 · `<=`) — `abs>`로 두면 좋아진 분기에도 회장을 부른다.
   *    · **런웨이는 비교 전에 반올림한다** — 화면에 남는 값이 곧 비교한 값이어야 한다.
   *    · **소진이 없으면 `clear`이고 `value`는 null이다.** 그것은 «잰 사실»이지 «못 쟀다»가 아니다.
   */
  const months = broke('runway-months-shift') ? 2.94 : 2.14
  const runwayStatus: RunwayReading['status'] = broke('runway-unknown-as-clear')
    ? 'not_burning'
    : 'unknown'
  const cashRule = rule({
    rule_key: 'cash_runway',
    name: '현금 부족',
    metric: 'Cash',
    comparator: '<',
    threshold: 6,
    window_days: 90,
  })
  const marginRule = rule({
    rule_key: 'ebitda_margin_drop',
    name: 'EBITDA 마진 하락',
    metric: 'EBITDA',
    comparator: '<=',
    threshold: -5,
    window_days: 90,
  })
  const marginKpis = (cur: number, prev: number) => [
    ...['2026-04', '2026-05', '2026-06'].flatMap((p) => [kpi(p, 'Revenue', 100), kpi(p, 'EBITDA', prev)]),
    ...['2026-07', '2026-08', '2026-09'].flatMap((p) => [kpi(p, 'Revenue', 100), kpi(p, 'EBITDA', cur)]),
  ]
  assert.deepEqual(
    [
      ['매출 +45%', show(evaluateRule(rule({}), measured([kpi('2026-08', 'Revenue', 100), kpi('2026-09', 'Revenue', 145)])))],
      ['매출 -45%', show(evaluateRule(rule({}), measured([kpi('2026-08', 'Revenue', 100), kpi('2026-09', 'Revenue', 55)])))],
      ['매출 +10%', show(evaluateRule(rule({}), measured([kpi('2026-08', 'Revenue', 100), kpi('2026-09', 'Revenue', 110)])))],
      ['마진 20%→12%', show(evaluateRule(marginRule, measured(marginKpis(12, 20))))],
      ['마진 12%→20%', show(evaluateRule(marginRule, measured(marginKpis(20, 12))))],
      ['런웨이 2.14개월', show(evaluateRule(cashRule, measured([], { months, status: 'burning', period: '2026-09' })))],
      ['소진 없음', show(evaluateRule(cashRule, measured([], { months: null, status: 'not_burning', period: '2026-09' })))],
      ['원장 못 읽음', show(evaluateRule(cashRule, measured([], { months: null, status: runwayStatus, period: '2026-09' })))],
    ],
    [
      ['매출 +45%', 'triggered 45'],
      ['매출 -45%', 'triggered -45'],
      ['매출 +10%', 'clear 10'],
      ['마진 20%→12%', 'triggered -8'],
      ['마진 12%→20%', 'clear 8'],
      ['런웨이 2.14개월', 'triggered 2.1'],
      ['소진 없음', 'clear null'],
      ['원장 못 읽음', 'unmeasured/ledger_unknown'],
    ],
    '규칙 셋의 잰 값이 0035 3절의 뜻과 다르다 — 오르는 것도 예외이고(abs>), 마진이 오르는 것은 예외가 아니며(<= -5), 런웨이는 비교 전에 반올림하고, 소진이 없는 것은 «못 쟀다»가 아니라 «재고 나온 사실»이다',
  )

  /**
   * ⑥ **`sort_order` 순서로 돌려준다**(§18 목록 순서). 화면과 브리핑이 이 순서를 그대로 쓰고,
   *    순서가 실행마다 달라지면 «맨 위»가 매일 흔들린다.
   */
  const ordered = evaluateRules(
    [
      rule({ rule_key: 'cash_runway', sort_order: broke('rules-order-input') ? 1 : 3 }),
      rule({ rule_key: 'revenue_variance', sort_order: broke('rules-order-input') ? 3 : 1 }),
      rule({ rule_key: 'ebitda_margin_drop', sort_order: 2 }),
    ],
    measured([]),
  )
  assert.deepEqual(
    ordered.map((e) => e.rule.rule_key),
    ['revenue_variance', 'ebitda_margin_drop', 'cash_runway'],
    'evaluateRules()가 sort_order 순서로 돌려주지 않는다 — §18의 13개는 순서가 있는 목록이고, 그 순서가 흔들리면 브리핑의 «맨 위»도 흔들린다',
  )
}

/** 축 한 벌. 출처가 없으면 DB가 받지 않으므로 값과 출처를 늘 같이 만든다. */
const axis = (value: number): Axis => ({ value, source: '검사가 심은 축' })

function pureScore() {
  /**
   * ⑦ **0035 5절의 눈금·가중치·경계를 SQL에서 읽어 TS 상수와 맞춘다.**
   *    0033의 §7 식이 SQL 뷰와 TS 함수 두 벌이 되었을 때 검사가 **같은 고정 입력**으로 둘을
   *    맞춘 것이 선례다. 여기서는 식이 TS에만 있고 **숫자는 마이그레이션 주석에 글로 있다** —
   *    그 글이 스키마 주석으로 DB에 실려 다음 사람이 읽는 값이라, 둘이 갈라지면 어느 쪽이
   *    맞는지 알 수 없게 된다. 0035는 경계를 check 제약으로 묶지 **않았다**(화면에서 고칠 수
   *    있어야 하는지는 B-3이 정한다) — 그래서 그 자리를 지키는 것이 이 단언뿐이다.
   */
  const sql0035 = readFileSync(join(MIGRATIONS, '0035_attention.sql'), 'utf8')
    .replace(/^\s*--/gm, ' ')
    .replace(/\s+/g, ' ')
  const weightText = sql0035.match(
    /재무 (\d+) · 전략 (\d+) · 긴급도 (\d+) · 확률 (\d+) · CEO 해결 능력 (\d+) · 자본 필요 (\d+)/,
  )
  assert.ok(weightText, '0035 5절에서 가중치 여섯을 읽지 못했다 — 이 단언의 전제가 깨졌다')
  const shift = broke('weights-from-sql') ? 1 : 0
  const fromSql = {
    financial_impact: Number(weightText![1]) + shift,
    strategic_impact: Number(weightText![2]),
    urgency: Number(weightText![3]),
    probability: Number(weightText![4]),
    ceo_ability: Number(weightText![5]),
    capital_requirement: Number(weightText![6]),
  }
  assert.deepEqual(
    AXIS_WEIGHT,
    fromSql,
    `lib/attention/score.ts의 가중치가 0035 5절의 숫자와 다르다(TS ${JSON.stringify(AXIS_WEIGHT)} / SQL ${JSON.stringify(fromSql)}) — 구현이 둘이면 한쪽만 고쳐지는 날이 오고, 그때 DB에 실린 주석과 화면의 점수가 다른 말을 한다`,
  )
  assert.equal(
    Object.values(AXIS_WEIGHT).reduce((a, n) => a + n, 0),
    100,
    '가중치 합이 100이 아니다 — 0035 5절이 합 100으로 적었고, 없는 축을 «있는 축의 가중치 합으로 나눈다»는 식이 그 합을 전제한다',
  )
  const redText = sql0035.match(/score >= (\d+) → RED/)
  const yellowText = sql0035.match(/(\d+) <= score < \d+ → YELLOW/)
  const scaleText = sql0035.match(/축마다 0~(\d+) 정수/)
  assert.ok(redText && yellowText && scaleText, '0035 5절에서 경계와 눈금을 읽지 못했다 — 전제가 깨졌다')
  assert.deepEqual(
    [LEVEL_BOUNDARY.red, LEVEL_BOUNDARY.yellow, AXIS_MAX],
    [Number(redText![1]), Number(yellowText![1]), Number(scaleText![1])],
    `경계·눈금이 0035 5절과 다르다(TS ${LEVEL_BOUNDARY.red}/${LEVEL_BOUNDARY.yellow}/${AXIS_MAX}) — RED는 "회장이 결정한다"라서 아껴 쓰는 값이고, 그 경계가 조용히 내려가면 전부 빨개져서 어디가 급한지 안 보인다`,
  )

  /**
   * ⑧ **등급을 내는 조건과 경계 둘.** 이 절의 핵심은 점수가 아니라 «언제 등급을 내지
   *    않는가»다. 오늘 잴 수 있는 축은 하나뿐이고, 축 하나로 낸 점수를 여섯 축을 다 잰
   *    점수인 양 내놓으면 **재무 영향이 낮은 현금 위기가 GREEN으로 내려간다**(가리는 방향).
   *
   *    그리고 **바닥은 로드맵이 닿는 축 수를 넘을 수 없다**(`MIN_AXES_FOR_LEVEL <=
   *    AXES_WITH_PLANNED_SOURCE`). 넘으면 `attentionScore()`는 **영원히** null을 돌려주고,
   *    그것은 B-2가 «영원히 등급이 없다»는 이유로 버린 선택지 ②의 결과와 같다. 그 상수가
   *    출하 트리에서 소비자를 갖지 못해 지금까지 «관계를 값으로 남겼다»는 주장이 커밋되지
   *    않은 스모크에만 걸려 있었다 — 이 단언이 그 소비자다.
   */
  assert.ok(
    MIN_AXES_FOR_LEVEL <= AXES_WITH_PLANNED_SOURCE,
    `등급의 바닥(${MIN_AXES_FOR_LEVEL})이 로드맵이 출처를 약속한 축 수(${AXES_WITH_PLANNED_SOURCE})보다 크다 — 계획이 전부 이행돼도 등급이 영원히 나오지 않는다`,
  )
  /** 로드맵이 닿는 축 셋(재무 · CEO 능력 ← 블록 D · 자본 ← 블록 C)이 다 오면 등급이 **나온다.** */
  const roadmap = attentionScore({
    financial_impact: axis(8),
    ceo_ability: broke('axes-one-less') ? null : axis(8),
    capital_requirement: axis(8),
  })
  assert.ok(
    roadmap.level !== null && roadmap.score !== null,
    `로드맵이 닿는 축 수(${AXES_WITH_PLANNED_SOURCE})를 다 채워도 등급이 나오지 않는다(${roadmap.no_level_reason}) — 바닥이 로드맵보다 높으면 이 식은 영원히 돌지 않는다`,
  )
  assert.equal(
    roadmap.unknown_axes,
    ATTENTION_AXES.length - AXES_WITH_PLANNED_SOURCE,
    '로드맵이 다 와도 비는 축 수가 맞지 않는다 — 이 등급은 여섯 축을 다 잰 등급이 아니고(가중치 100 중 45), unknown_axes를 떼면 45의 근거가 100의 근거인 척한다',
  )
  /** 경계 셋. 축 셋이 각각 7 · 4 · 3이면 70 · 40 · 30이고, 그것이 RED · YELLOW · GREEN이다. */
  const atLevel = (v: number) =>
    attentionScore({ financial_impact: axis(v), strategic_impact: axis(v), urgency: axis(v) })
  const redValue = broke('boundary-shift') ? 6 : 7
  assert.deepEqual(
    [atLevel(redValue), atLevel(4), atLevel(3)].map((r) => [r.score, r.level]),
    [
      [70, 'RED'],
      [40, 'YELLOW'],
      [30, 'GREEN'],
    ],
    '경계 70/40이 0035 5절대로 동작하지 않는다 — 70은 RED(회장이 결정한다)의 문턱이고, 한 칸 밀리면 회장이 결정할 건수가 달라진다',
  )
  /** 축이 바닥보다 적으면 **점수도 등급도 없고 그 이유가 있다.** 오늘 만들어지는 모든 예외의 모양이다. */
  const tooFew = attentionScore({ financial_impact: axis(10), strategic_impact: axis(10) })
  assert.deepEqual(
    [tooFew.score, tooFew.level, tooFew.unknown_axes, tooFew.no_level_reason === null],
    [null, null, 4, false],
    '축이 바닥보다 적은데 등급이 나왔다 — 축 하나로 낸 점수를 여섯 축을 다 잰 점수인 양 내놓으면 재무 영향이 낮은 현금 위기가 GREEN으로 내려간다',
  )
  assert.equal(
    attentionScore({ financial_impact: axis(10) }).unknown_axes,
    5,
    '축 하나(오늘의 모양)에서 unknown_axes가 5가 아니다 — 화면이 "여섯 축 중 N개가 비었습니다"를 이 숫자로 적는다',
  )

  /**
   * ⑨ **`ceo_ability`는 역방향이다.** 문서의 이름은 "CEO Ability to Resolve"이고, 그 축이
   *    높으면 회장이 볼 이유가 **줄어든다**(§19의 GREEN=CEO handles). 이름을 뒤집지 않고
   *    방향만 글로 적은 자리라, 방향이 조용히 뒤집히면 아무 글자도 안 바뀐다.
   */
  const [low, high] = broke('ceo-ability-forward') ? [10, 0] : [0, 10]
  const withAbility = (v: number) =>
    attentionScore({ financial_impact: axis(5), strategic_impact: axis(5), ceo_ability: axis(v) })
      .score ?? 0
  assert.ok(
    withAbility(low) > withAbility(high),
    `ceo_ability가 역방향이 아니다(능력 ${low} → ${withAbility(low)}점 · 능력 ${high} → ${withAbility(high)}점) — CEO가 해결할 수 있는 건은 회장이 볼 이유가 줄어든다(§19)`,
  )

  /**
   * ⑩ **없는 축을 0으로 채우지 않는다.** 채우면 축 넷이 빈 행이 조용히 낮은 점수를 받아
   *    GREEN으로 내려가고, 회장은 그것을 "정상"으로 읽는다. 대가는 반대쪽이다 — 축 하나만
   *    있는 행도 100점이 될 수 있어서 `unknown_axes`를 같이 낸다.
   */
  const threeEights = {
    financial_impact: axis(8),
    strategic_impact: axis(8),
    urgency: axis(8),
    ...(broke('fill-missing-with-zero')
      ? { probability: axis(0), ceo_ability: axis(0), capital_requirement: axis(0) }
      : {}),
  }
  assert.equal(
    attentionScore(threeEights).score,
    80,
    '없는 축이 0으로 채워졌다 — 있는 축의 가중치 합으로 나누지 않으면 축이 빈 행이 조용히 GREEN으로 내려간다(0035 5절)',
  )

  /**
   * ⑪ **오늘 출처가 있는 유일한 축.** 눈금 잡는 방법이 판단이고, 그중 한 줄이 가장 중요하다 —
   *    **임계에 막 올라선 것은 0이 아니라 1이다.** 0이면 걸린 예외가 «재무 영향 없음»이 되고,
   *    그 방향의 거짓이 이 저장소가 가장 나쁘다고 거듭 못 박은 «적게 세는 쪽»이다.
   *    비율은 **비교자의 방향을 따른다** — 방향을 무시하면 런웨이 2개월이 «임계보다 4 작다»가
   *    아니라 «임계를 4 넘었다»로 읽힌다.
   */
  const fi = (over: { comparator?: string; value?: number; threshold?: number }) =>
    financialImpactAxis({
      rule_key: 'cash_runway',
      rule_name: '현금 부족',
      comparator: over.comparator ?? '<',
      value: over.value ?? 6,
      threshold: over.threshold ?? 6,
    })
  assert.deepEqual(
    [
      ['임계에 막 올라섬', fi({ value: broke('axis-beyond-threshold') ? 0 : 6 })?.value ?? null],
      ['런웨이 2 / 임계 6', fi({ value: 2, comparator: broke('axis-direction-flip') ? '>' : '<' })?.value ?? null],
      ['런웨이 0 / 임계 6', fi({ value: 0 })?.value ?? null],
      ['매출 45 / 임계 20', financialImpactAxis({ rule_key: 'revenue_variance', rule_name: '매출 변동', comparator: 'abs>', value: 45, threshold: 20 })?.value ?? null],
      ['매출 -45 / 임계 20', financialImpactAxis({ rule_key: 'revenue_variance', rule_name: '매출 변동', comparator: 'abs>', value: -45, threshold: 20 })?.value ?? null],
      ['임계 0', fi({ threshold: broke('threshold-zero-as-axis') ? 6 : 0, value: 2 })?.value ?? null],
    ],
    [
      ['임계에 막 올라섬', 1],
      ['런웨이 2 / 임계 6', 7],
      ['런웨이 0 / 임계 6', 10],
      ['매출 45 / 임계 20', 10],
      ['매출 -45 / 임계 20', 10],
      ['임계 0', null],
    ],
    '재무 영향 축의 눈금이 0035 5절과 다르다 — 임계에 막 올라선 것은 1이지 0이 아니고(0이면 «재무 영향 없음»이 된다), 비율은 비교자의 방향을 따르며, 임계가 0이면 «넘어섰다»가 뜻을 잃으므로 축은 null이다',
  )
  /** 출처가 **공백이 아니다**(0035의 `attention_axes_source_check`가 공백뿐인 출처를 거절한다). */
  const source = fi({ value: 2 })?.source ?? ''
  assert.ok(
    source.trim() !== '' && source.includes('cash_runway'),
    `재무 영향 축의 출처가 비어 있거나 규칙을 가리키지 않는다("${source}") — 출처 없는 축은 DB가 받지 않고(0035 5절), 받아 준다 해도 «AI가 지어낸 축»과 구별되지 않는다`,
  )
  /**
   * ⑪-a **셋은 상한이지 보장이 아니다.** 임계가 0인 규칙에서는 재무 영향이 null이고,
   *    그런 예외는 **블록 C·D가 둘 다 온 뒤에도 축이 둘**이라 등급이 없다. 0035가 임계에
   *    범위 제약을 걸지 않았으므로(걸면 회장의 편집을 스키마가 막는다) 그 길은 열려 있다.
   */
  const zeroThreshold = attentionScore({
    financial_impact: fi({ threshold: broke('planned-axes-nonzero') ? 6 : 0, value: 2 }),
    ceo_ability: axis(5),
    capital_requirement: axis(5),
  })
  assert.equal(
    attentionScore({
      financial_impact: fi({ threshold: broke('planned-axes-nonzero') ? 6 : 0, value: 2 }),
    }).unknown_axes,
    6,
    '임계가 0인 규칙의 예외에서 빈 축이 여섯으로 세어지지 않는다 — 재무 영향까지 null이면 이 행은 축을 하나도 갖지 못한 행이다',
  )
  assert.deepEqual(
    [zeroThreshold.level, zeroThreshold.unknown_axes],
    [null, 4],
    '임계가 0인 규칙의 예외가 블록 C·D 뒤에 등급을 받았다 — 재무 영향이 null이면 축은 둘이고, 뜻이 없는 값으로 등급을 만드는 것이 이 파일이 막는 그 일이다',
  )
}

/* ------------------------------------------------------------------ 맨 위 3~5건 */

let nextExcId = 1
const exc = (over: Partial<ExceptionRecord>): ExceptionRecord => ({
  id: nextExcId++,
  business_id: 'biz_dy',
  rule_key: 'revenue_variance',
  detected_at: '2026-09-20T01:00:00Z',
  period: '2026-08',
  value: 45,
  threshold: 20,
  severity: 'YELLOW',
  ai_analysis: null,
  ceo_handling: false,
  chairman_action_required: false,
  status: 'open',
  monitor_until: null,
  ...over,
})

function pureBrief() {
  const names = new Map([
    ['biz_dy', 'DY'],
    ['biz_vana', 'VANA'],
  ])
  const rules: ExceptionRule[] = [
    rule({ rule_key: 'revenue_variance', name: '매출 변동' }),
    rule({ rule_key: 'cash_runway', name: '현금 부족' }),
    rule({ rule_key: 'quality_issue', name: '품질 이슈' }),
    rule({ rule_key: 'legal_issue', name: '법적 이슈' }),
  ]
  const pool: ExceptionRecord[] = [
    exc({ rule_key: 'quality_issue', severity: 'GREEN' }),
    exc({ rule_key: 'revenue_variance', severity: broke('brief-flip-severity') ? 'RED' : 'YELLOW' }),
    exc({ rule_key: 'legal_issue', severity: 'YELLOW', chairman_action_required: true }),
    exc({ rule_key: 'cash_runway', severity: 'RED', detected_at: '2026-09-19T01:00:00Z' }),
    exc({ rule_key: 'cash_runway', severity: 'RED', business_id: 'biz_vana' }),
    exc({ rule_key: 'quality_issue', severity: 'GREEN', business_id: 'biz_vana' }),
    // 올라오면 안 되는 둘. 회장이 «지금은 두고 본다»고 **정한** 건과 이미 닫은 건이다.
    exc({
      rule_key: 'legal_issue',
      severity: 'RED',
      status: broke('brief-open-monitoring') ? 'open' : 'monitoring',
      monitor_until: '2026-10-04T00:00:00Z',
    }),
    exc({ rule_key: 'legal_issue', severity: 'RED', status: 'closed', business_id: 'biz_vana' }),
  ]
  const top = selectAttentions({
    exceptions: pool,
    rules,
    businessNames: names,
    limit: broke('brief-limit-off') ? 6 : undefined,
  })

  /**
   * ⑫ **«있으면 3~5»이고 3은 하한이 아니다.** 열린 예외가 둘뿐인 날 셋째 줄을 채우려고
   *    GREEN을 끌어올리거나 지난 건을 다시 올리지 않는다 — 없는 것을 채우는 순간 회장은
   *    그 자리를 안 믿게 된다.
   */
  assert.equal(
    top.length,
    ATTENTION_BRIEF_MAX,
    `열린 예외 여섯에서 맨 위 목록이 ${top.length}건이다 — 상한은 ${ATTENTION_BRIEF_MAX}이다`,
  )
  const two = selectAttentions({
    exceptions: pool.slice(0, 2),
    rules,
    businessNames: names,
  })
  assert.equal(
    two.length,
    2,
    `열린 예외가 둘인데 맨 위 목록이 ${two.length}건이다 — 3은 하한이 아니다. 셋째 줄을 채우려고 지난 건을 다시 올리면 그 자리를 아무도 안 믿는다`,
  )

  /**
   * ⑬ **'관찰 중'과 'closed'는 올라오지 않는다.** 회장이 그 건을 보고 "지금은 두고 본다"고
   *    **정한** 것이고, 다음 날 아침 맨 위에 다시 세우면 그 결정이 되돌려진다.
   *    (둘 다 /attention 목록에는 그대로 있다 — 올라오지 않는 것은 브리핑의 맨 위다.)
   */
  assert.deepEqual(
    top
      .filter((h) => h.rule_key === 'legal_issue' && h.business_name === 'DY')
      .map((h) => `${h.rule_name}/${h.severity}`),
    ['법적 이슈/YELLOW'],
    '관찰 중이거나 닫힌 예외가 브리핑 맨 위에 올라왔다 — 회장이 «지금은 두고 본다»고 정한 것을 다음 아침에 다시 세우면 그 결정이 되돌려진다',
  )

  /**
   * ⑭ **순서: RED → YELLOW → GREEN → «회장 액션 필요» → 최근 감지순 → 회사·규칙 이름.**
   *    마지막 두 칸이 못 박는 것이 있다 — 같은 초에 들어온 두 건의 순서가 실행마다 달라지면
   *    «맨 위»가 매일 흔들리고, 그러면 그것은 맨 위가 아니다.
   */
  assert.deepEqual(
    top.map((h) => `${h.business_name} ${h.rule_name} ${h.severity}`),
    [
      'VANA 현금 부족 RED',
      'DY 현금 부족 RED',
      'DY 법적 이슈 YELLOW',
      'DY 매출 변동 YELLOW',
      'DY 품질 이슈 GREEN',
    ],
    '맨 위 목록의 순서가 규칙과 다르다 — RED가 먼저, 같은 등급이면 «회장 액션 필요»가 먼저, 그다음 최근 감지순, 마지막이 이름이다',
  )

  /**
   * ⑮ **`detected_on`은 KST다.** `detected_at`은 timestamptz라 연결 시간대(Supabase는 UTC)로
   *    실려 오고, 앞 열 글자를 자르면 그것은 **UTC 날짜**다. 이 Job은 회장 현지 06:00을
   *    맞추려고 매시 깨어나고(0029) **KST 00:00~09:00에 도는 회차가 예외가 아니라 보통**이라,
   *    자른 값은 그 창의 예외를 전부 하루 전으로 찍는다. 그 값은 화면에 그대로 그려지고
   *    같은 등급끼리의 **정렬 키**이기도 해서 «맨 위»의 순서까지 흔든다.
   */
  const kst = selectAttentions({
    exceptions: [
      exc({ detected_at: broke('detected-on-utc') ? '2026-09-20T13:00:00Z' : '2026-09-20T23:00:00Z' }),
    ],
    rules,
    businessNames: names,
  })
  assert.equal(
    kst[0].detected_on,
    '2026-09-21',
    `감지 날짜가 KST가 아니다(${kst[0].detected_on}) — UTC 23:00은 KST로 다음 날 08:00이고, 이 저장소의 «오늘»은 KST 하나다(0019 3절)`,
  )

  /**
   * ⑯ **수동 규칙의 «잰 값»은 null이다 — 0으로 적지 않는다.** 그리고 브리핑 항목의 detail에는
   *    등급이 **글자로도** 적힌다: `AiBriefItem.severity`는 0001의 '얼마나 나쁜가'이고
   *    `attention_level`은 '누가 손대는가'다. 색 셋에 두 축을 섞으면서 글자를 안 적으면
   *    두 뜻이 구별되지 않는다.
   */
  assert.equal(
    describeMeasured({
      rule_key: 'legal_issue',
      value: broke('measured-manual-value') ? 0 : null,
      threshold: broke('measured-manual-value') ? 0 : null,
    }),
    null,
    '수동 규칙에 «잰 값»이 적혔다 — 그 칸은 없는 것이지 0이 아니고, 0으로 적으면 "임계 0을 넘겼다"는 없는 사실이 브리핑에 실린다',
  )
  assert.equal(
    describeMeasured({ rule_key: 'revenue_variance', value: 45, threshold: 20 }),
    '잰 값 45% · 임계 20%',
    '수치 규칙의 한 줄에 단위가 빠졌다 — 표에 단위 칸이 없어서 이 꼬리표가 유일한 자리다',
  )
  const items = attentionItems(
    selectAttentions({
      exceptions: [
        exc({
          rule_key: 'cash_runway',
          severity: broke('items-level-word') ? 'YELLOW' : 'RED',
          chairman_action_required: true,
          value: 2.1,
          threshold: 6,
          detected_at: '2026-09-20T23:00:00Z',
        }),
      ],
      rules,
      businessNames: names,
    }),
  )
  assert.equal(items.length, 1, '맨 위 항목이 만들어지지 않았다')
  assert.equal(items[0].title, '[주의] DY 현금 부족', `맨 위 항목의 제목이 다르다(${items[0].title})`)
  for (const needle of ['회장 결정(RED)', '잰 값 2.1개월', '기간 2026-08', '회장 액션 필요', '감지 2026-09-21']) {
    assert.ok(
      items[0].detail.includes(needle),
      `맨 위 항목의 detail에 '${needle}'이 없다(${items[0].detail}) — 등급을 색으로만 옮기면 '얼마나 나쁜가'와 '누가 손대는가'가 한 칸에서 섞인다`,
    )
  }
  assert.equal(items[0].severity, 'critical', 'RED가 브리핑 항목의 critical로 옮겨지지 않았다')
}

/* ------------------------------------------------------------------ AI가 닿지 못하는 세 칸 */

function aiContainment() {
  /**
   * ⑰ **`ai_analysis`는 정확히 세 줄이다.** 원문이 지시한 셋(원인 분해 · CEO 대응 여부 ·
   *    권고 "관찰 N일")이고 그 이상이 아니다. «결정 아님» 라벨은 여기 쓰지 않는다 —
   *    그것은 화면이 이 칸 **옆에** 붙이는 말이고, 글 안에 넣으면 회장이 읽는 문장 셋이 넷이 된다.
   */
  const analysis = formatExceptionAnalysis({
    cause: '8월 매출이 직전 창 대비 45% 늘었다',
    ceo_response: 'CEO가 재고 발주를 이미 늘렸다',
    monitor_days: 14,
  })
  const lines = broke('analysis-four-lines') ? `${analysis}\n결정: 승인 권고` : analysis
  assert.equal(
    lines.split('\n').length,
    3,
    `ai_analysis가 세 줄이 아니다(${lines.split('\n').length}줄) — 원문이 준 것은 셋이고, 넷째 줄이 붙는 순간 그것은 분석이 아니라 결정이 된다`,
  )
  assert.ok(
    lines.includes('권고: 관찰 14일'),
    'ai_analysis에 «권고: 관찰 N일»이 없다 — 원문의 회장 액션 셋 중 하나를 모델이 제안하는 자리다',
  )

  /**
   * ⑱ **모델이 `severity`·`status`·`chairman_action_required`를 돌려줄 칸이 없다.**
   *    프롬프트가 금지하는 것과 **구조에 아예 없는 것**은 다르다 — 앞의 것은 문장이고
   *    뒤의 것은 구조다. 파서가 셋으로 **새 객체를 만들기** 때문에, 모델이 덧붙인 칸은
   *    통과하지 못하고 사라진다.
   */
  const raw = {
    cause: '원인',
    ceo_response: '대응',
    monitor_days: 14,
    severity: 'RED',
    status: 'closed',
    chairman_action_required: true,
  }
  const parsed = parseExceptionAnalysis(raw)
  const keys = Object.keys(broke('parser-passthrough') ? { ...raw, ...parsed } : parsed).sort()
  assert.deepEqual(
    keys,
    ['cause', 'ceo_response', 'monitor_days'],
    `파서가 모델의 칸을 그대로 통과시켰다(${keys.join(',')}) — 등급·상태·회장 액션은 코드가 계산하는 값이고, 모델이 그 칸을 채우면 §19의 "AI가 CEO를 대신하지 않는다"가 한 줄로 무너진다`,
  )

  /**
   * ⑱-a **범위 밖의 `monitor_days`는 자르지 않고 거절한다.** 999를 90으로 자르면 모델의
   *    권고가 아니라 이 코드가 지어낸 권고가 회장에게 간다. 반쪽 분석도 남기지 않는다 —
   *    빈 «CEO 대응» 칸은 읽는 사람에게 «CEO가 대응하지 않는다»로 읽힌다.
   */
  const refuses = (v: unknown) => {
    try {
      parseExceptionAnalysis(v)
      return false
    } catch {
      return true
    }
  }
  assert.deepEqual(
    [
      refuses({ cause: '원인', ceo_response: '대응', monitor_days: broke('monitor-days-in-range') ? 30 : 999 }),
      refuses({ cause: '원인', ceo_response: '대응', monitor_days: 0 }),
      refuses({ cause: '원인', monitor_days: 14 }),
      refuses({ cause: '원인', ceo_response: '   ', monitor_days: 14 }),
    ],
    [true, true, true, true],
    'monitor_days가 범위 밖인데 통과하거나, 반쪽 분석이 통과했다 — 999를 90으로 자르면 이 코드가 지어낸 권고가 회장에게 가고, 빈 «CEO 대응»은 «CEO가 대응하지 않는다»로 읽힌다',
  )

  /** ⑱-b **출력 스키마가 닫혀 있다.** 모델 쪽 구조 강제와 파서가 같은 말을 해야 한다. */
  const schema = broke('schema-open')
    ? { ...EXCEPTION_ANALYSIS_JSON_SCHEMA, additionalProperties: true }
    : EXCEPTION_ANALYSIS_JSON_SCHEMA
  assert.equal(
    schema.additionalProperties,
    false,
    '예외 분석 출력 스키마가 열려 있다(additionalProperties) — 모델이 severity를 덧붙여 보낼 칸이 생기고, 그 칸은 프롬프트 문장 하나에만 막혀 있게 된다',
  )
  assert.deepEqual(
    Object.keys(EXCEPTION_ANALYSIS_JSON_SCHEMA.properties).sort(),
    ['cause', 'ceo_response', 'monitor_days'],
    '예외 분석 스키마의 칸이 셋이 아니다 — 원문이 준 것은 원인·CEO 대응·권고 셋이다',
  )
  assert.deepEqual(
    [...EXCEPTION_ANALYSIS_JSON_SCHEMA.required].sort(),
    ['cause', 'ceo_response', 'monitor_days'],
    '예외 분석 스키마의 required가 셋이 아니다',
  )
}

/* =====================================================================
 * D. 배선 — lib/attention/stage.ts를 **실제 RLS 아래에서** 돌린다
 *
 * 야간 Job의 코드는 supabase-js를 통해 PostgREST에 말을 건다. 그 코드를 그대로 돌리려면
 * 그 말을 받는 쪽이 있어야 하고, **그 쪽이 PGlite여야 RLS가 진짜로 걸린다.** 그래서 fetch를
 * 바꿔 끼운다(`check-data-boundaries.ts`가 페이지네이션을 재려고 같은 자리를 바꿔 끼운다 —
 * 그쪽은 응답을 지어내고 이쪽은 **DB에 물어본다**).
 *
 * 세션은 AIAgent다. 그러므로 여기서 도는 모든 select·insert가 0035 7절의 정책을 탄다 —
 * `insert … returning`이 SELECT 정책을 타는 자리까지 포함해서.
 * ===================================================================== */

/** numeric은 문자열로, timestamptz는 Date로 오는 PGlite의 결과를 PostgREST의 JSON 모양으로. */
const PG_NUMERIC = 1700
const PG_TIMESTAMPTZ = 1184
const PG_TIMESTAMP = 1114

function asJsonRows(
  rows: Record<string, unknown>[],
  fields: { name: string; dataTypeID: number }[],
): Record<string, unknown>[] {
  const kind = new Map(fields.map((f) => [f.name, f.dataTypeID]))
  return rows.map((row) => {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(row)) {
      if (v === null || v === undefined) out[k] = null
      else if (kind.get(k) === PG_NUMERIC) out[k] = Number(v)
      else if (kind.get(k) === PG_TIMESTAMPTZ || kind.get(k) === PG_TIMESTAMP) {
        out[k] = v instanceof Date ? v.toISOString() : v
      } else if (typeof v === 'bigint') out[k] = Number(v)
      else out[k] = v
    }
    return out
  })
}

interface ShimOptions {
  uid: string
  /**
   * `exceptions`를 읽은 **직후** 한 번 끼어드는 «다른 틱». 조회와 insert 사이가 비어 있다는
   * 사실을 그대로 재현하는 자리다 — 두 틱이 겹치는 날 앞의 것이 커밋되는 순간이 정확히 여기다.
   */
  interleave?: () => Promise<void>
}

function postgrestOverPglite(db: PGlite, opts: ShimOptions): SupabaseClient {
  let interleaved = false
  /** PGlite는 연결 하나다. 야간 Job이 Promise.all로 동시에 부르므로 요청을 줄로 세운다. */
  let lock: Promise<unknown> = Promise.resolve()
  const serialize = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = lock.then(fn, fn)
    lock = next.then(
      () => undefined,
      () => undefined,
    )
    return next
  }

  /** 한 요청 = 한 트랜잭션. 그 안에서 세션이 AIAgent가 된다. */
  const run = async (sql: string, params: unknown[]) => {
    await db.exec('begin')
    await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [opts.uid])
    await db.exec('set local role authenticated')
    try {
      const r = await db.query<Record<string, unknown>>(sql, params)
      await db.exec('commit')
      return r
    } catch (e) {
      await db.exec('rollback')
      throw e
    }
  }

  const errorResponse = (e: unknown): Response => {
    const pg = e as { code?: string; message?: string; detail?: string; hint?: string }
    const code = pg.code ?? 'XX000'
    const status = code === '23505' ? 409 : code === '42501' ? 403 : 400
    return new Response(
      JSON.stringify({
        code,
        message: pg.message ?? String(e),
        details: pg.detail ?? null,
        hint: pg.hint ?? null,
      }),
      { status, headers: { 'content-type': 'application/json' } },
    )
  }

  const handle = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input))
    const table = url.pathname.split('/').filter(Boolean).at(-1) ?? ''
    const headers = new Headers(init?.headers)
    const prefer = headers.get('prefer') ?? ''
    const wantsObject = (headers.get('accept') ?? '').includes('vnd.pgrst.object')
    const select = url.searchParams.get('select') ?? '*'
    const method = (init?.method ?? 'GET').toUpperCase()
    const params: unknown[] = []
    const where: string[] = []
    for (const [k, v] of url.searchParams) {
      if (['select', 'order', 'offset', 'limit'].includes(k)) continue
      if (!v.startsWith('eq.')) throw new Error(`이 하네스가 모르는 필터다: ${k}=${v}`)
      params.push(v.slice(3))
      where.push(`${k} = $${params.length}`)
    }
    const filter = where.length ? ` where ${where.join(' and ')}` : ''

    try {
      if (method === 'GET') {
        const order = (url.searchParams.get('order') ?? '')
          .split(',')
          .filter(Boolean)
          .map((o) => {
            const [col, dir] = o.split('.')
            return `${col} ${dir === 'desc' ? 'desc' : 'asc'}`
          })
        const limit = url.searchParams.get('limit')
        const offset = url.searchParams.get('offset')
        const from = Number(offset ?? 0)
        const r = await run(
          `select ${select} from ${table}${filter}` +
            `${order.length ? ` order by ${order.join(', ')}` : ''}` +
            `${limit ? ` limit ${Number(limit)}` : ''}${offset ? ` offset ${from}` : ''}`,
          params,
        )
        let total = '*'
        if (prefer.includes('count=exact')) {
          const c = await run(`select count(*)::int as n from ${table}${filter}`, params)
          total = String((c.rows[0] as { n: number }).n)
        }
        const rows = asJsonRows(r.rows, r.fields)
        if (table === 'exceptions' && opts.interleave && !interleaved) {
          interleaved = true
          await opts.interleave()
        }
        return new Response(JSON.stringify(wantsObject ? (rows[0] ?? null) : rows), {
          status: 200,
          headers: {
            'content-type': 'application/json',
            'content-range': `${from}-${from + rows.length - 1}/${total}`,
          },
        })
      }

      if (method === 'POST') {
        const body: unknown = JSON.parse(String(init?.body ?? 'null'))
        const records = (Array.isArray(body) ? body : [body]) as Record<string, unknown>[]
        const cols = Object.keys(records[0])
        const values = records
          .map(
            (rec) =>
              `(${cols
                .map((c) => {
                  params.push(rec[c])
                  return `$${params.length}`
                })
                .join(', ')})`,
          )
          .join(', ')
        const returning = prefer.includes('return=representation') ? ` returning ${select}` : ''
        const r = await run(
          `insert into ${table} (${cols.join(', ')}) values ${values}${returning}`,
          params,
        )
        const rows = asJsonRows(r.rows, r.fields)
        if (wantsObject && rows.length !== 1) {
          return new Response(
            JSON.stringify({
              code: 'PGRST116',
              message: `JSON object requested, multiple (or no) rows returned`,
              details: `Results contain ${rows.length} rows`,
              hint: null,
            }),
            { status: 406, headers: { 'content-type': 'application/json' } },
          )
        }
        return new Response(JSON.stringify(wantsObject ? rows[0] : rows), {
          status: 201,
          headers: { 'content-type': 'application/json' },
        })
      }

      throw new Error(`이 하네스는 ${method}를 흉내 내지 않는다`)
    } catch (e) {
      return errorResponse(e)
    }
  }

  return createClient('https://pglite.invalid', 'offline-anon-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input, init) => serialize(() => handle(input, init)) },
  }) as SupabaseClient
}

/**
 * 야간 Job의 단계는 `console.warn`으로 회차 로그를 낸다(같은 사실이 감사 줄에도 실린다).
 * 검사의 출력은 PASS 한 줄이어야 하므로 그 줄들을 **모아 둔다** — 버리지 않는 이유는
 * 아래 «회차 로그가 비어 있지 않다» 단언이 그것을 읽기 때문이다.
 */
async function quietly<T>(fn: () => Promise<T>): Promise<{ value: T; logs: string[] }> {
  const logs: string[] = []
  const keep = { warn: console.warn, error: console.error, log: console.log }
  const sink = (...args: unknown[]) => void logs.push(args.map(String).join(' '))
  console.warn = sink
  console.error = sink
  try {
    return { value: await fn(), logs }
  } finally {
    console.warn = keep.warn
    console.error = keep.error
    console.log = keep.log
  }
}

const BIZ: Business[] = [
  {
    business_id: 'biz_dy',
    name: 'DY',
    status: 'Active',
    industry: '제조',
    owner_user_id: U.dyCeo,
    visible: true,
    sort_order: 1,
  },
  {
    business_id: 'biz_vana',
    name: 'VANA',
    status: 'Active',
    industry: '식품',
    owner_user_id: U.vanaCeo,
    visible: true,
    sort_order: 2,
  },
]

const fk = (
  business_id: string,
  period: string,
  metric: FinanceKpi['metric'],
  value: number,
): FinanceKpi => ({
  period,
  business_id,
  metric,
  value,
  currency: 'KRW',
  source: 'manual',
  fetched_at: '2026-09-20T00:00:00Z',
  closed: false,
  basis: 'manual',
})

/** 분석을 돌려주는 어댑터. 넘어온 입력을 그대로 적어 둔다 — 아래 ⑳이 그 입력을 읽는다. */
function spyAdapter(mode: 'ok' | 'throw'): AiAdapter & { seen: ExceptionContext[] } {
  const seen: ExceptionContext[] = []
  return {
    seen,
    model: 'test-model',
    summarizeCompany: () => {
      throw new Error('이 검사는 회사 요약을 부르지 않는다')
    },
    generateDailyBrief: () => {
      throw new Error('이 검사는 그룹 브리핑을 부르지 않는다')
    },
    analyzeException: async (input) => {
      seen.push(input)
      if (mode === 'throw') throw new Error('모델 호출 실패(검사가 일부러 터뜨린다)')
      return { cause: '원인 한 줄', ceo_response: 'CEO 대응 한 줄', monitor_days: 14 }
    },
  }
}

/** 이 회차가 만든 예외를 회장 세션으로 읽는다. */
async function exceptionsInDb(s: Session, period: string) {
  // numeric은 PGlite에서 문자열로 온다. 화면·Job이 보는 값은 숫자이므로 여기서 숫자로 읽는다.
  return s.rows<{ rule_key: string; status: string; severity: string; value: number | null }>(
    U.chair,
    `select rule_key, status, severity, value::float8 as value from exceptions
      where period = '${period}' order by rule_key`,
  )
}

async function stageWiring(db: PGlite) {
  await ownedByNonBypassRole(db)
  await seedPeople(db)
  const s = sessionRunner(db)
  const sb = postgrestOverPglite(db, { uid: U.agent })

  if (broke('drop-dedupe-tick')) {
    await db.exec(`alter table exceptions drop constraint exceptions_dedupe_unique`)
  }
  if (broke('unknown-axes-expects-six')) {
    await db.exec(`
      alter table attention_scores drop constraint attention_unknown_axes_check;
      alter table attention_scores add constraint attention_unknown_axes_check check (unknown_axes = 6);
    `)
  }

  /* ---------------------------------------------------------------- 1. 한 회차 */

  /**
   * DY는 매출이 +45% 흔들렸고(규칙이 걸린다), EBITDA는 아예 없고(못 쟀다), 원장이 없다
   * (런웨이를 못 쟀다). VANA는 수치가 하나도 없다 — **셋 다 «이상 없다»가 아니다.**
   */
  const run1 = await quietly(() =>
    runAttentionStage({
      sb,
      adapter: null,
      adapterError: '검사가 어댑터를 주지 않았다',
      businesses: BIZ,
      financeKpis: [fk('biz_dy', '2026-08', 'Revenue', 100), fk('biz_dy', '2026-09', 'Revenue', 145)],
      ledger: null,
      runDate: '2026-09-21',
    }),
  )
  const r1 = run1.value
  assert.equal(
    r1.error,
    undefined,
    `주의 단계가 통째로 실패했다(${r1.error}) — AIAgent 세션이 0035의 정책을 통과하지 못했다`,
  )

  /**
   * ㉚ **AIAgent 세션이 예외를 만든다.** 이 한 줄이 0035 7절 전체를 실제로 통과한다 —
   *    `exceptions_create`(`can_write_attention`) · `ai_agent_no_closed_insert`(status='open') ·
   *    `exceptions_read`의 둘째 갈래(`returning`) 셋이 한 번에 걸린다.
   *    그리고 **등급이 규칙의 `severity_base`에 머문다**(축이 하나라 점수가 없다) —
   *    0035가 그 칸을 «출발점»이라 부른 이유가 이것이다.
   */
  assert.equal(r1.created, 1, `첫 회차가 만든 예외가 1건이 아니다(${r1.created}건) — 회차 로그: ${run1.logs.join(' / ')}`)
  const made = await exceptionsInDb(s, '2026-09')
  assert.deepEqual(
    made.map((e) => [e.rule_key, e.status, e.severity, e.value]),
    [['revenue_variance', 'open', 'YELLOW', 45]],
    `야간 Job이 만든 예외의 모양이 다르다(${JSON.stringify(made)}) — status는 언제나 'open'이고(닫는 것은 회장의 일이다), 등급은 축이 모자라 규칙의 severity_base에 머문다`,
  )
  const madeFlags = await s.rows<{ ai_analysis: string | null; ceo_handling: boolean; chairman_action_required: boolean }>(
    U.chair,
    `select ai_analysis, ceo_handling, chairman_action_required from exceptions where period = '2026-09'`,
  )
  assert.deepEqual(
    madeFlags,
    [{ ai_analysis: null, ceo_handling: false, chairman_action_required: false }],
    '어댑터가 없는데 ai_analysis가 채워졌거나, 두 판정 칸이 등급과 어긋난다 — YELLOW는 «회장 인지»이고 «회장 액션 필요»가 아니다(§19)',
  )
  assert.equal(
    r1.withoutAnalysis,
    1,
    '어댑터가 없는데 «분석 없이 만든 예외»가 세어지지 않았다 — 규칙이 먼저고 AI는 그 위에 얹히는 층이지만, 얹히지 않은 사실은 숫자로 남아야 한다',
  )

  /**
   * ㉛ **점수 한 줄이 같이 생기고, 그 줄의 `unknown_axes`를 DB가 받는다.**
   *    0035의 `attention_unknown_axes_check`가 그 숫자를 **실제 null 개수**에 묶으므로,
   *    이 단언은 TS가 낸 수와 DB가 세는 수가 같다는 것을 재는 것이다(0033의 §7 식 선례와
   *    같은 모양 — 구현이 둘이면 한쪽만 고쳐지는 날이 온다). 틀리면 점수가 아예 기록되지
   *    않고, 그 예외는 «왜 그 색인가»를 설명하지 못하는 예외가 된다.
   */
  const scores = await s.rows<{
    unknown_axes: number
    score: number | null
    level: string | null
    financial_impact: number | null
    financial_impact_source: string | null
  }>(
    U.chair,
    `select unknown_axes, score, level, financial_impact, financial_impact_source
       from attention_scores order by exception_id`,
  )
  assert.equal(
    scores.length,
    1,
    `점수가 기록되지 않았다(${scores.length}줄) — 경고: ${JSON.stringify([...r1.warnings])}`,
  )
  assert.deepEqual(
    [scores[0].unknown_axes, scores[0].score, scores[0].level, scores[0].financial_impact],
    [5, null, null, 10],
    `점수 줄의 모양이 오늘의 모양이 아니다(${JSON.stringify(scores[0])}) — 축은 하나이고 등급은 나오지 않으며, 그 사실이 unknown_axes=5로 남는다`,
  )
  assert.ok(
    (scores[0].financial_impact_source ?? '').includes('revenue_variance'),
    '재무 영향 축의 출처가 규칙을 가리키지 않는다 — 출처 없는 축은 «AI가 지어낸 축»과 구별되지 않는다',
  )

  /**
   * ㉜ **«못 쟀다»가 `evaluated`가 아니라 `unmeasured`로 세어지고, 이유별로 갈린다.**
   *    「그 기간의 수치가 없다」와 「원장을 못 읽었다」는 다른 고장이다.
   */
  assert.deepEqual(
    [r1.evaluated, r1.unmeasured, r1.unmeasuredReasons],
    [1, 5, { no_kpi: 3, ledger_unknown: 2 }],
    `잰 것과 못 잰 것의 수가 다르다(잰 것 ${r1.evaluated} · 못 잰 것 ${r1.unmeasured} · 이유 ${JSON.stringify(r1.unmeasuredReasons)}) — 수동 규칙 열은 건너뛴 것이라 어느 쪽도 아니고, 못 잰 것은 «이상 없다»가 아니다`,
  )

  /**
   * ㉝ **못 잰 회사는 `warnings`에 오르고 `failures`에는 오르지 않는다.** 둘은 다른 사실이다 —
   *    그 회사의 브리핑은 KPI가 비어 있어도 **성공**하고 예외가 0건이니 맨 위에도 안 오른다.
   *    경고로 올리지 않으면 **데이터가 끊긴 회사가 그냥 조용한 회사로 읽힌다.**
   *    그리고 `kind`가 «어디까지 가는가»를 정한다(그룹 요약에 가는 것은 `unmeasured`뿐이다).
   */
  const warned = broke('stage-warn-as-failure')
    ? { warnings: [] as string[], failures: [...r1.warnings.keys()].sort() }
    : {
        warnings: [...r1.warnings.keys()].sort(),
        failures: [...r1.failures.keys()].sort(),
      }
  assert.deepEqual(
    warned,
    { warnings: ['biz_dy', 'biz_vana'], failures: [] },
    `«재지 못했다»가 실패와 같은 칸으로 접혔다(${JSON.stringify(warned)}) — 실패는 «평가가 터졌거나 예외를 못 적었다»이고 경고는 «재지 못했다»다. 한 칸으로 접으면 어느 쪽이 고장인지 읽을 수 없다`,
  )
  assert.ok(
    (r1.warnings.get('biz_vana') ?? []).every((w) => w.kind === 'unmeasured'),
    '못 잰 회사의 경고에 «점수 미기록»이 섞였다 — 그룹 요약(=회장의 06:00 카톡)에 가는 것은 unmeasured뿐이고, 그 가름을 StageWarning.kind가 한다',
  )
  assert.ok(
    r1.notes.length > 0 && run1.logs.some((l) => l.includes('[attention]')),
    '회차 로그가 비어 있다 — 같은 사실이 감사 줄과 회사 행에도 실리지만, 조용히 넘어가는 경로를 남기지 않는다',
  )
  /** ㉝-a 맨 위 목록은 **열린 예외 전부**에서 고른다 — 오늘 만든 것만이 아니다. */
  assert.deepEqual(
    r1.headlines.map((h) => `${h.business_name} ${h.rule_name}`),
    ['DY 매출 변동'],
    `맨 위 목록이 오늘 만든 예외를 담지 못했다(${JSON.stringify(r1.headlines)})`,
  )

  /* ---------------------------------------------------------------- 2. 두 밤은 다르다 */

  /**
   * ㉞ **«다섯 회사가 전부 못 쟀다»는 밤과 «다 재어 보니 멀쩡하다»는 밤의 결과가 다르다.**
   *    예외가 0건인 것은 두 밤이 같지만 **그 0은 전혀 다른 0**이고, 나중에 "그날 밤 왜
   *    아무것도 안 올라왔나"에 답할 자리가 감사 줄 하나뿐이다. `evaluated`가 «못 쟀다»까지
   *    세면 두 밤이 **똑같은 감사 줄**을 남긴다 — B-2 수정 전이 그 상태였다.
   */
  const flat = ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09'].flatMap((p) =>
    BIZ.flatMap((b) => [fk(b.business_id, p, 'Revenue', 100), fk(b.business_id, p, 'EBITDA', 20)]),
  )
  const nightMeasured = (await quietly(() =>
    runAttentionStage({
      sb,
      adapter: null,
      businesses: BIZ,
      financeKpis: flat,
      ledger: null,
      runDate: '2026-09-22',
    }),
  )).value
  const nightBlind = (await quietly(() =>
    runAttentionStage({
      sb,
      adapter: null,
      businesses: BIZ,
      financeKpis: [],
      ledger: null,
      runDate: '2026-09-23',
    }),
  )).value
  const shape = (r: { evaluated: number; unmeasured: number }) =>
    broke('stage-merge-unmeasured')
      ? { evaluated: r.evaluated + r.unmeasured }
      : { evaluated: r.evaluated, unmeasured: r.unmeasured }
  assert.notDeepEqual(
    shape(nightMeasured),
    shape(nightBlind),
    `«전부 재어 보니 멀쩡한 밤»과 «전부 못 잰 밤»이 같은 감사 줄을 남긴다(${JSON.stringify(shape(nightMeasured))}) — 그 둘은 이 블록이 처음부터 가르려고 한 두 사실이고, 예외 0건이라는 결과만 같다`,
  )
  assert.deepEqual(
    [nightMeasured.evaluated, nightMeasured.unmeasured, nightBlind.evaluated, nightBlind.unmeasured],
    [4, 2, 0, 6],
    `두 밤의 숫자가 예상과 다르다(멀쩡한 밤 ${nightMeasured.evaluated}/${nightMeasured.unmeasured} · 못 잰 밤 ${nightBlind.evaluated}/${nightBlind.unmeasured})`,
  )
  assert.equal(
    nightMeasured.created + nightBlind.created,
    0,
    '흔들리지 않은 밤에 예외가 생겼다 — 규칙이 걸리지 않았는데 예외를 만들면 화면이 없는 위험을 그린다',
  )

  /* ---------------------------------------------------------------- 3. 같은 회차 두 번 */

  if (broke('wipe-existing-before-rerun')) {
    await db.exec(`delete from attention_scores; delete from exceptions where period = '2026-09'`)
  }

  /**
   * ㉟ **같은 회차를 두 번 돌리면 예외가 늘지 않는다.** 앱의 조회가 흔한 길을 조용하게 만든다 —
   *    그리고 23505는 실패가 아니라 «다른 틱이 먼저 넣었다»로 세어진다(아래 ㊱).
   */
  const rerun = (await quietly(() =>
    runAttentionStage({
      sb,
      adapter: null,
      businesses: BIZ,
      financeKpis: [fk('biz_dy', '2026-08', 'Revenue', 100), fk('biz_dy', '2026-09', 'Revenue', 145)],
      ledger: null,
      runDate: '2026-09-24',
    }),
  )).value
  assert.deepEqual(
    [rerun.created, rerun.deduped],
    [0, 1],
    `같은 회차를 두 번 돌렸는데 예외가 늘었다(만든 것 ${rerun.created} · 건너뛴 것 ${rerun.deduped}) — 야간 Job은 틱으로 여러 번 돌고(0029), 같은 사실이 두 줄이 되면 화면이 "매출 변동"을 두 번 그린다`,
  )

  /* ---------------------------------------------------------------- 4. 두 틱이 겹친다 */

  /**
   * ㊱ **중복 방지가 틱 겹침에서도 버틴다 — 막는 것은 앱이 아니라 DB다.**
   *
   *    앱의 `seen` 집합은 «조회 → insert» 사이가 비어 있어서 두 틱이 겹치는 날 뚫린다.
   *    그래서 여기서 그 틈을 **실제로 만든다**: 야간 Job이 `exceptions`를 읽은 **직후**
   *    다른 틱이 같은 (회사 · 규칙 · 기간)을 넣고 커밋한다. 그 시점에 Job의 `seen`에는
   *    그 줄이 없고, 그러므로 Job은 insert를 시도한다 — 그때 23505를 받는 것이,
   *    그리고 그것을 «실패»가 아니라 «다른 틱이 이겼다»로 세는 것이 이 단언이 재는 것이다.
   *    (앱 층만 재면 두 프로세스가 겹치는 날을 재지 못한다.)
   */
  const tickSb = postgrestOverPglite(db, {
    uid: U.agent,
    interleave: async () => {
      await s.write(
        U.chair,
        `insert into exceptions (business_id, rule_key, period, value, threshold, severity, status)
         values ('biz_dy', 'revenue_variance', '2026-10', 45, 20, 'YELLOW', 'open')`,
      )
    },
  })
  const tick = (await quietly(() =>
    runAttentionStage({
      sb: tickSb,
      adapter: null,
      businesses: [BIZ[0]],
      financeKpis: [fk('biz_dy', '2026-09', 'Revenue', 100), fk('biz_dy', '2026-10', 'Revenue', 145)],
      ledger: null,
      runDate: '2026-10-01',
    }),
  )).value
  assert.equal(
    await s.count(
      U.chair,
      `select count(*)::int from exceptions where rule_key = 'revenue_variance' and period = '2026-10'`,
    ),
    1,
    '두 틱이 같은 (회사·규칙·기간)을 넣어 예외가 두 줄이 됐다 — 앱의 조회와 insert 사이가 비어 있고, 그 틈을 막는 것은 0035의 exceptions_dedupe_unique 하나다',
  )
  assert.deepEqual(
    [tick.created, tick.deduped, [...tick.failures.keys()]],
    [0, 1, []],
    `틱 겹침에서 23505가 «중복»으로 세어지지 않았다(만든 것 ${tick.created} · 건너뛴 것 ${tick.deduped} · 실패 ${[...tick.failures.keys()].join(',')}) — 다른 틱이 먼저 넣은 것은 실패가 아니고, 실패로 세면 회장의 행에 없는 고장이 선다`,
  )

  /* ---------------------------------------------------------------- 5. 어댑터 */

  /**
   * ㊲ **분석이 없어도 예외는 만들어진다.** 규칙이 먼저고 AI는 그 위에 얹히는 층이다.
   *    모델이 던지든 키가 없든 `ai_analysis`는 null이고, 그 사실이 숫자로 남는다.
   */
  const throwing = spyAdapter(broke('adapter-returns-analysis') ? 'ok' : 'throw')
  const failedAi = (await quietly(() =>
    runAttentionStage({
      sb,
      adapter: throwing,
      businesses: [BIZ[0]],
      financeKpis: [fk('biz_dy', '2026-10', 'Revenue', 100), fk('biz_dy', '2026-11', 'Revenue', 145)],
      ledger: null,
      runDate: '2026-11-01',
    }),
  )).value
  const afterThrow = await s.rows<{ ai_analysis: string | null }>(
    U.chair,
    `select ai_analysis from exceptions where period = '2026-11'`,
  )
  assert.deepEqual(
    [failedAi.created, failedAi.withoutAnalysis, afterThrow.map((r) => r.ai_analysis)],
    [1, 1, [null]],
    `모델이 던졌는데 예외가 사라졌거나 분석이 채워졌다(만든 것 ${failedAi.created} · 분석 없음 ${failedAi.withoutAnalysis} · ${JSON.stringify(afterThrow)}) — 분석이 없다고 감지를 버리지 않고, 없는 분석을 지어내지도 않는다`,
  )

  /**
   * ㊳ **모델에게 넘어가는 입력에 등급이 없다.** 프롬프트가 금지하는 것과 **입력에 아예 없는
   *    것**은 다르다 — 앞의 것은 문장이고 뒤의 것은 구조다. 모델이 판정에 의견을 낼 입력을
   *    애초에 주지 않는 것이 「AI는 결정하지 않는다」를 코드로 지키는 가장 싼 방법이다.
   */
  assert.equal(throwing.seen.length, 1, '모델이 한 번도 불리지 않았다 — 이 단언이 재려는 입력이 없다')
  const flatKeys = (v: unknown, acc: string[] = []): string[] => {
    if (Array.isArray(v)) {
      for (const x of v) flatKeys(x, acc)
      return acc
    }
    if (v !== null && typeof v === 'object') {
      for (const [k, val] of Object.entries(v)) {
        acc.push(k)
        flatKeys(val, acc)
      }
    }
    return acc
  }
  const ctxKeys = flatKeys(
    broke('ctx-severity') ? { ...throwing.seen[0], severity: 'YELLOW' } : throwing.seen[0],
  )
  for (const forbidden of ['severity', 'level', 'status', 'chairman_action_required', 'ceo_handling']) {
    assert.ok(
      !ctxKeys.includes(forbidden),
      `모델에 넘긴 입력에 '${forbidden}'이 있다(${[...new Set(ctxKeys)].join(',')}) — 등급을 넘기면 모델이 «이 정도면 YELLOW다»라고 쓸 근거를 우리가 준 것이 된다(§19)`,
    )
  }

  /** ㊳-a 분석을 받으면 `ai_analysis`는 **정확히 세 줄**로 들어간다. */
  const ok = spyAdapter('ok')
  await quietly(() =>
    runAttentionStage({
      sb,
      adapter: ok,
      businesses: [BIZ[0]],
      financeKpis: [fk('biz_dy', '2026-11', 'Revenue', 100), fk('biz_dy', '2026-12', 'Revenue', 145)],
      ledger: null,
      runDate: '2026-12-01',
    }),
  )
  const analysed = await s.rows<{ ai_analysis: string | null }>(
    U.chair,
    `select ai_analysis from exceptions where period = '2026-12'`,
  )
  assert.equal(
    (analysed[0]?.ai_analysis ?? '').split('\n').length,
    3,
    `ai_analysis가 세 줄로 들어가지 않았다(${JSON.stringify(analysed)}) — 원문이 준 것은 원인·CEO 대응·권고 셋이다`,
  )

  /* ---------------------------------------------------------------- 6. 한 건의 실패를 가둔다 */

  /**
   * ㊴ **규칙 하나의 기록이 실패해도 그 회사의 다음 규칙은 돈다.** 이 격리가 없으면 현금
   *    규칙의 insert가 실패한 회사에서 매출·마진 규칙이 **아예 평가되지 않고**, 그 회사 행에는
   *    "규칙 평가 실패"라고만 남아 **평가 자체가 고장 난 것처럼** 읽힌다 — 실제로 고장 난 것은
   *    기록 한 건이다.
   *
   *    § 실패 경로를 이 검사가 직접 만든다 § 제약 하나를 심어 **첫 규칙의 기록만** 터뜨린다.
   *    (check-dependency ㉔-a가 같은 방법을 쓴다 — 스키마의 우연한 제약에 기대지 않는다.)
   */
  await db.exec(
    broke('plant-every-company')
      ? // DY는 그대로 두고 **다른 회사**의 기록만 같이 터뜨린다 — 그러면 아래 ㊴는
        // 통과하고 ㊴-a(다른 회사의 예외가 생긴다)만 빨개진다.
        `alter table exceptions add constraint att_plant
           check (not (business_id = 'biz_dy' and rule_key = 'revenue_variance'
                       and period = '2027-01')
                  and not (business_id = 'biz_vana' and period = '2027-01'))`
      : broke('plant-all-rules')
        ? `alter table exceptions add constraint att_plant
             check (business_id <> 'biz_dy' or period <> '2027-01')`
        : `alter table exceptions add constraint att_plant
             check (not (business_id = 'biz_dy' and rule_key = 'revenue_variance'
                         and period = '2027-01'))`,
  )
  const twoRules = [
    ...['2026-08', '2026-09', '2026-10'].flatMap((p) => [
      fk('biz_dy', p, 'Revenue', 100),
      fk('biz_dy', p, 'EBITDA', 20),
    ]),
    ...['2026-11', '2026-12'].flatMap((p) => [fk('biz_dy', p, 'Revenue', 100), fk('biz_dy', p, 'EBITDA', 5)]),
    fk('biz_dy', '2027-01', 'Revenue', 177),
    fk('biz_dy', '2027-01', 'EBITDA', 5),
    // 같은 회차의 **다른 회사**. 심어 둔 실패는 DY의 규칙 하나에만 걸린다.
    fk('biz_vana', '2026-12', 'Revenue', 100),
    fk('biz_vana', '2027-01', 'Revenue', 200),
  ]
  const isolated = (await quietly(() =>
    runAttentionStage({
      sb,
      adapter: null,
      businesses: BIZ,
      financeKpis: twoRules,
      ledger: null,
      runDate: '2027-01-15',
    }),
  )).value
  /** 전제 확인 — 심어 둔 제약이 **실제로** 첫 규칙을 터뜨렸는가. 안 터졌으면 아무것도 재지 않았다. */
  assert.equal(
    await s.count(
      U.chair,
      `select count(*)::int from exceptions
        where business_id = 'biz_dy' and rule_key = 'revenue_variance' and period = '2027-01'`,
    ),
    0,
    '이 실험의 전제가 깨졌다 — 심어 둔 제약을 뚫고 첫 규칙의 예외가 들어갔다면 아래 단언은 «격리»를 재고 있지 않다',
  )
  assert.equal(
    await s.count(
      U.chair,
      `select count(*)::int from exceptions
        where business_id = 'biz_dy' and rule_key = 'ebitda_margin_drop' and period = '2027-01'`,
    ),
    1,
    '앞 규칙의 기록이 실패한 뒤 그 회사의 다음 규칙이 돌지 않았다 — 고장 난 것은 기록 한 건인데 회사 행에는 "규칙 평가 실패"만 남아 평가 자체가 죽은 것처럼 읽힌다',
  )
  assert.deepEqual(
    (isolated.failures.get('biz_dy') ?? []).length,
    1,
    `실패가 규칙 하나에 갇히지 않았다(${JSON.stringify(isolated.failures.get('biz_dy'))})`,
  )
  /**
   * ㊴-a **한 회사가 터져도 다음 회사의 예외는 생긴다.** 실패는 그 회사에만 남는다 —
   *    회사 하나의 기록 실패가 다른 회사의 감지를 삼키면, 그 밤에 회장은 나머지 회사에
   *    대해서도 아무것도 못 본다.
   */
  assert.equal(
    await s.count(
      U.chair,
      `select count(*)::int from exceptions where business_id = 'biz_vana' and period = '2027-01'`,
    ),
    1,
    'DY의 기록이 실패한 회차에서 VANA의 예외가 생기지 않았다 — 회사마다 try로 가두는 것이 이 단계의 규율이고, 한 회사의 실패가 다른 회사의 감지를 삼키면 그 밤은 통째로 조용해진다',
  )
  assert.deepEqual(
    [...isolated.failures.keys()],
    ['biz_dy'],
    `실패가 한 회사에 갇히지 않았다(${[...isolated.failures.keys()].join(',')})`,
  )
  await db.exec(`alter table exceptions drop constraint att_plant`)

  /**
   * ㊵ **다른 제약의 23505는 «중복»으로 세지 않는다.** 이 표에는 유니크가 둘이고, 앞으로
   *    하나 더 붙는 날 «23505면 중복»이라는 읽기는 **진짜 고장을 조용히 중복으로** 세게 된다.
   *    그래서 제약 **이름**을 확인한다 — 모르는 실패를 아는 실패인 척하지 않는다.
   *    (돌연변이는 그 확인이 **부분 문자열 대조**라는 사실을 드러낸다: 이름에 중복 방지 제약
   *    이름이 들어 있는 다른 제약이 생기면 그 위반이 «중복»으로 세어진다.)
   */
  const otherName = broke('other-unique-named-like-dedupe')
    ? 'exceptions_dedupe_unique_value'
    : 'exceptions_value_unique'
  await s.write(
    U.chair,
    `insert into exceptions (business_id, rule_key, period, value, threshold, severity)
     values ('biz_vana', 'quality_issue', null, 88, 20, 'GREEN')`,
  )
  await db.exec(`create unique index ${otherName} on exceptions (value) where value = 88`)
  const otherUnique = (await quietly(() =>
    runAttentionStage({
      sb,
      adapter: null,
      businesses: [BIZ[0]],
      financeKpis: [fk('biz_dy', '2027-01', 'Revenue', 100), fk('biz_dy', '2027-02', 'Revenue', 188)],
      ledger: null,
      runDate: '2027-02-15',
    }),
  )).value
  assert.deepEqual(
    [otherUnique.created, otherUnique.deduped, (otherUnique.failures.get('biz_dy') ?? []).length],
    [0, 0, 1],
    `중복 방지가 아닌 유니크 위반이 «다른 틱이 이겼다»로 세어졌다(만든 것 ${otherUnique.created} · 건너뛴 것 ${otherUnique.deduped} · 실패 ${JSON.stringify(otherUnique.failures.get('biz_dy'))}) — 모르는 실패를 아는 실패인 척하면 그 고장은 아무 화면에도 서지 않는다`,
  )
  assert.ok(
    (otherUnique.failures.get('biz_dy') ?? []).some((t) => t.includes('23505')),
    '다른 제약의 23505가 회사 행에 그 코드와 함께 남지 않았다 — 무엇이 터졌는지 모르는 실패는 다시 볼 근거가 되지 못한다',
  )
  await db.exec(`drop index ${otherName}`)

  /* ---------------------------------------------------------------- 7. 점수만 못 붙인 회차 */

  /**
   * ㊶ **점수 insert가 실패해도 예외는 남고, 그 사실이 «경고»로 남는다.** 기록이 먼저다 —
   *    점수가 없는 예외는 «왜 그 색인가»와 «여섯 축 중 몇이 비었나»를 설명하지 못하는
   *    예외이고, 그것을 console에만 적으면 아무도 다시 붙이지 않는다.
   *    **그리고 이 경고는 그룹 요약으로 가지 않는다**(`kind`가 `score_not_recorded`다) —
   *    회장의 아침 다섯 문장에 들어갈 사실이 아니라 이 저장소가 고칠 내부 사정이다.
   */
  if (!broke('score-plant-off')) {
    // not valid — 이미 있는 행은 건드리지 않고 **다음 insert만** 터뜨린다.
    await db.exec(
      `alter table attention_scores add constraint att_score_plant
         check (unknown_axes <> 5) not valid`,
    )
  }
  const scoreFail = (await quietly(() =>
    runAttentionStage({
      sb,
      adapter: null,
      businesses: [BIZ[0]],
      financeKpis: [fk('biz_dy', '2027-03', 'Revenue', 100), fk('biz_dy', '2027-04', 'Revenue', 150)],
      ledger: null,
      runDate: '2027-04-15',
    }),
  )).value
  assert.equal(
    await s.count(U.chair, `select count(*)::int from exceptions where period = '2027-04'`),
    1,
    '점수를 못 붙인 회차에서 예외까지 사라졌다 — 기록이 먼저고 점수는 나중이다',
  )
  assert.ok(
    (scoreFail.warnings.get('biz_dy') ?? []).some((w) => w.kind === 'score_not_recorded'),
    `점수 기록 실패가 그 회사의 경고로 남지 않았다(${JSON.stringify(scoreFail.warnings.get('biz_dy'))}) — console에만 적으면 아무도 그 점수를 다시 붙이지 않는다`,
  )
  assert.deepEqual(
    [...scoreFail.failures.keys()],
    [],
    '점수 기록 실패가 «실패»로 세어졌다 — 예외는 이미 남았고, 그 회차의 브리핑은 실패한 것이 아니다',
  )
  if (!broke('score-plant-off')) {
    await db.exec(`alter table attention_scores drop constraint att_score_plant`)
  }

  /* ---------------------------------------------------------------- 8. RED이면 회장 액션 */

  /**
   * ㊷ **등급이 RED면 `chairman_action_required`가 참이다.** §19의 정의 그대로다
   *    (RED=Chairman decision · YELLOW=Chairman awareness · GREEN=CEO handles) — 새 판정을
   *    만든 것이 아니라 있는 등급을 읽은 것이고, 등급이 바뀌면 이 칸도 같이 움직인다.
   *    **이 칸은 `not null default false`라 안 넣어도 들어간다** — 그러면 화면의
   *    "회장 액션 필요" 건수가 첫날부터 실제보다 **적다.** 적게 세는 쪽의 거짓이다.
   *
   *    회장이 /attention/rules에서 등급을 올리는 것으로 이 자리를 만든다 — 그 편집이
   *    다음 밤의 예외에 실제로 닿는지까지 같이 재는 셈이다.
   */
  if (!broke('severity-base-yellow')) {
    await s.write(
      U.chair,
      `update exception_rules set severity_base = 'RED' where rule_key = 'revenue_variance'`,
    )
  }
  await quietly(() =>
    runAttentionStage({
      sb,
      adapter: null,
      businesses: [BIZ[0]],
      financeKpis: [fk('biz_dy', '2027-04', 'Revenue', 100), fk('biz_dy', '2027-05', 'Revenue', 150)],
      ledger: null,
      runDate: '2027-05-15',
    }),
  )
  const red = await s.rows<{ severity: string; chairman_action_required: boolean }>(
    U.chair,
    `select severity, chairman_action_required from exceptions where period = '2027-05'`,
  )
  assert.deepEqual(
    red,
    [{ severity: 'RED', chairman_action_required: true }],
    `RED 규칙의 예외에 «회장 액션 필요»가 서지 않았다(${JSON.stringify(red)}) — §19가 RED를 "Chairman decision"으로 정의했고, 이 칸이 비면 화면의 건수가 첫날부터 실제보다 적다`,
  )

  /* ---------------------------------------------------------------- 9. 규칙을 못 읽은 밤 */

  /**
   * ㊸ **규칙을 못 읽으면 단계가 «0건»으로 조용히 끝나지 않는다.** 그 밤의 결과는
   *    «예외가 없다»가 아니라 «규칙을 읽지 못했다»여야 하고, 그 사실이 `result.error`로
   *    올라가 그룹 행 맨 위에 선다(배선 쪽은 E절의 글자 단언이 본다).
   *    § 실패 경로를 이 검사가 직접 만든다 § 표 권한을 걷어 42501을 만든다.
   */
  if (!broke('rules-read-granted')) {
    await db.exec(`revoke select on table exception_rules from authenticated`)
  }
  const blind = (await quietly(() =>
    runAttentionStage({
      sb,
      adapter: null,
      businesses: BIZ,
      financeKpis: [fk('biz_dy', '2027-05', 'Revenue', 100), fk('biz_dy', '2027-06', 'Revenue', 150)],
      ledger: null,
      runDate: '2027-06-15',
    }),
  )).value
  assert.ok(
    (blind.error ?? '').includes('규칙·예외 읽기 실패'),
    `규칙을 못 읽은 회차가 조용히 0건으로 끝났다(error=${blind.error}) — «주의가 없다»와 «주의를 못 쟀다»는 다른 사실이고, 그 밤에 회장이 보는 화면은 전자와 구별되어야 한다`,
  )
  assert.equal(blind.created, 0, '규칙을 못 읽었는데 예외가 만들어졌다 — 그 예외는 무슨 규칙으로 걸린 것인가')
  if (!broke('rules-read-granted')) {
    await db.exec(`grant select on table exception_rules to authenticated`)
  }
}

/* =====================================================================
 * E. 글자 — 프롬프트가 모르는 키는 모델에게 없는 키다
 *
 * 이 부류는 글자로만 잴 수 있고, 그래서 이 저장소에 선례가 있다(0033의 화면 문구 단언).
 * 여기서 재는 것이 B-2의 Important 1이었다: 코드가 `attentions`를 넘겼는데 프롬프트가 그
 * 키를 몰라서, 모델은 «받은 적 없는 키»를 받았고 "회사별 요약에 없는 사실을 만들지 않는다"는
 * 줄이 그것을 **지우라는 지시**로 읽혔다. 주의 목록이 회장에게 닿지 않았다.
 * ===================================================================== */

/**
 * 프롬프트가 **한국어 이름으로만** 부르는 둘. 나머지 키는 글자가 프롬프트에 있어야 한다 —
 * 새 칸이 `DailyBriefInput`에 붙는 날 이 목록에 손을 대야 하고, 그 한 줄이 «프롬프트를
 * 갱신했는가»를 묻는 자리가 된다.
 */
const PROMPT_KEY_EXEMPT = ['date', 'companies']

function texts() {
  const nightBrief = src('lib', 'ai', 'night-brief.ts')
  const adapter = src('lib', 'ai', 'adapter.ts')
  const rawPrompt = src('lib', 'ai', 'prompts', 'daily-brief.md')
  const prompt = broke('prompt-drop-key')
    ? rawPrompt.replace(/attentions/g, '주의')
    : broke('prompt-unmeasured-optional')
      ? rawPrompt.replace('**이 순위를 빼는 것은 금지다**', '되도록 적는다')
      : rawPrompt
  const needle = (t: string) => (broke('wiring-text') ? '이 문구는 어디에도 없다' : t)
  const screenNeedle = (t: string) => (broke('screen-text') ? '이 문구는 어디에도 없다' : t)

  /**
   * ㊶ **코드가 넘기는 입력 키를 프롬프트가 전부 선언한다.** 계약(`DailyBriefInput`)에서 키를
   *    뽑아 프롬프트 파일에서 찾는다 — 한쪽만 고쳐지는 날 이 단언이 빨개진다.
   */
  const block = adapter.match(/export interface DailyBriefInput \{([\s\S]*?)\n\}/)
  assert.ok(block, 'adapter.ts에서 DailyBriefInput을 못 찾았다 — 이 단언의 전제가 깨졌다')
  const keys = [...block![1].matchAll(/^ {2}(\w+)\??:/gm)].map((m) => m[1])
  assert.ok(
    keys.includes('attentions') && keys.includes('unmeasured') && keys.includes('failed'),
    `DailyBriefInput에서 키를 제대로 못 읽었다(${keys.join(',')}) — 전제가 깨졌다`,
  )
  for (const key of keys) {
    if (PROMPT_KEY_EXEMPT.includes(key)) continue
    assert.ok(
      prompt.includes(key),
      `daily-brief.md가 입력 키 '${key}'를 선언하지 않는다 — 프롬프트가 모르는 키는 모델에게 **없는 키**이고, 그 값의 사실들은 어느 회사 요약에도 없으니 "요약에 없는 사실을 만들지 않는다"는 줄이 그것을 지우라는 지시로 읽힌다(B-2 Important 1)`,
    )
  }

  /**
   * ㊷ **«재지 못했다»가 `failed`와 같은 «필수» 등급으로 다뤄진다.** 회장이 06:00에 카톡으로
   *    받는 것은 `summary` 한 덩이뿐이라, **여기 없는 사실은 그에게 도착하지 않는다.**
   *    그리고 그 순위를 빼는 것이 금지라고 프롬프트가 **말로** 못 박아야 한다 — 상한(5문장)과
   *    요구가 부딪히면 모델이 매일 다르게 조용히 해소한다.
   */
  assert.ok(
    prompt.includes('**이 순위를 빼는 것은 금지다**'),
    'daily-brief.md의 summary 순위에서 «모르는 것»이 필수가 아니다 — failed와 unmeasured가 5문장 상한에 밀려 빠지는 날 회장은 그 밤을 "조용했다"로 읽는다',
  )
  assert.ok(
    prompt.includes('«이상 없음»으로 읽지 마라'),
    'daily-brief.md가 «재지 못한 회사»를 «이상 없음»으로 읽지 말라고 말하지 않는다 — 그 둘을 한 문장으로 접는 것이 이 브리핑이 가장 조심하는 거짓이다',
  )
  /**
   * ㊷-a **상한과 요구가 부딪히지 않는다.** summary는 5문장 상한인데 순위 넷을 다 넣어야
   *    한다 — 프롬프트가 그 산수를 **명시해야** 한다(1~3을 세 문장에 묶으면 4번에 두 문장이
   *    남는다). 모순인 지시는 모델이 매일 다르게, 조용히 해소한다. 모델의 출력을 재는 것이
   *    아니라 **지시가 모순인지**를 재는 단언이다.
   */
  assert.ok(
    prompt.includes('1~3은 합쳐서 세 문장을 넘기지 않게 묶어 쓴다'),
    'daily-brief.md가 summary 상한(5문장)과 순위 넷의 산수를 명시하지 않는다 — 상한과 요구가 부딪히면 모델이 매일 다르게 해소하고, 그때 빠지는 것은 대개 «모르는 것»이다',
  )
  assert.ok(
    /순서를 바꾸지 않는다/.test(prompt) && /level을 바꾸지 않는다/.test(prompt),
    'daily-brief.md가 주의 목록의 순서와 등급을 «바꾸지 말라»고 말하지 않는다 — 고르는 것도 순서도 코드가 하고, 등급을 정하는 것은 모델이 아니다',
  )

  /**
   * ㊸ **배선의 순서와 자리.** 주의 단계가 브리핑 **앞**에서 돌고(§18의 화살표),
   *    코드가 세운 항목이 모델의 항목 **앞**에 붙고(그것이 곧 «맨 위»다), 그룹 요약에 가는
   *    경고는 `unmeasured`뿐이고, 감사 줄에 «잰 것»과 «못 잰 것»이 **따로** 실린다.
   */
  assert.ok(
    nightBrief.indexOf(needle('runAttentionStage(')) > 0 &&
      nightBrief.indexOf(needle('runAttentionStage(')) <
        nightBrief.indexOf('adapter.generateDailyBrief('),
    '주의 단계가 그룹 브리핑 호출보다 뒤에서 돈다 — 브리핑이 주의를 맨 위에 올리려면 그때 이미 있어야 한다(§18의 화살표 순서)',
  )
  assert.ok(
    nightBrief.includes(needle('...(row.leadItems ?? []), ...(row.brief?.items ?? [])')),
    '브리핑 항목의 맨 앞이 코드가 만든 항목이 아니다 — 앞에 두는 것이 곧 «맨 위»이고, 순서를 모델에 맡기면 맨 위가 매일 달라진다',
  )
  assert.ok(
    nightBrief.includes(needle(`filter((w) => w.kind === 'unmeasured')`)),
    '그룹 요약에 넘기는 목록이 경고 전부다 — «점수 미기록»은 이 저장소가 고칠 내부 사정이고 회장의 아침 다섯 문장에 들어갈 사실이 아니다(StageWarning.kind가 그 가름을 한다)',
  )
  for (const field of ['evaluated:', 'unmeasured:', 'unmeasured_reasons:', 'warned_companies:']) {
    assert.ok(
      nightBrief.includes(needle(field)),
      `감사 줄에 ${field}가 없다 — 「다섯 회사가 전부 못 쟀다」는 밤과 「다 재어 보니 멀쩡하다」는 밤이 같은 감사 줄을 남기면, 나중에 "그날 밤 왜 아무것도 안 올라왔나"에 답할 자리가 없다`,
    )
  }
  assert.ok(
    nightBrief.includes(needle('규칙 평가 단계 실패')),
    '단계가 통째로 실패한 밤에 그 사실이 그룹 행 맨 위에 서지 않는다 — «주의가 없다»와 «주의를 못 쟀다»는 다른 사실이고, 둘을 항목 0개로 접으면 규칙 엔진이 죽은 밤이 조용한 밤처럼 보인다',
  )
  assert.ok(
    nightBrief.includes(needle('재지 못함')) && nightBrief.includes(needle('«이상 없음»이 아니라')),
    '못 잰 회사의 행 맨 위에 «재지 못함» 항목이 서지 않는다 — 그 회사의 브리핑은 KPI가 비어 있어도 성공하므로, 이 항목이 없으면 조용한 회사로 읽힌다',
  )
  /** ㊸-a 회사 행에는 **둘 다** 오른다 — 못 잰 것과 점수를 못 붙인 것은 다른 제목이다. */
  assert.ok(
    nightBrief.includes(needle('점수 미기록')),
    '«점수 미기록»이 회사 행에 서지 않는다 — 그룹 요약에는 가지 않지만 회사 행에는 남아야 한다. 점수가 없는 예외는 «왜 그 색인가»를 설명하지 못한다',
  )
  /**
   * ㊸-b **모델에 넘기는 주의 목록과 화면 맨 위의 목록이 같은 원천이다.** 둘이 갈라지면
   *    요약이 맨 위와 다른 말을 하고, 회장이 카톡으로 받는 것은 요약뿐이다.
   */
  assert.ok(
    nightBrief.includes(needle('attentions: attentionBriefLines(attention?.headlines ?? [])')) &&
      nightBrief.includes(needle('attentionItems(attention?.headlines ?? [])')),
    '모델에 넘기는 주의 목록과 브리핑 맨 위의 목록이 같은 원천에서 나오지 않는다 — 둘이 갈라지면 요약이 맨 위와 어긋나고, 회장이 받는 것은 요약 한 덩이뿐이다',
  )

  /**
   * ㊹ **화면이 도는 유형 목록이 라벨 표에서 나온다.** 배열을 따로 적어 두면 새 유형이
   *    들어온 날 한쪽만 고쳐지고, 빠진 유형은 월 합계에만 남아 막대의 합이 합계와 달라진다
   *    (0035의 `monitor`가 그 자리였다). 위 ㉖이 그 합을 숫자로 재고, 여기서는 **그 합이
   *    맞아떨어지는 구조가 그대로 있는가**를 잰다 — 구조가 사라지면 다음 유형에서 되풀이된다.
   */
  const succession = src('types', 'succession.ts')
  assert.ok(
    succession.includes(screenNeedle('Object.keys(INTERVENTION_LABEL_KO)')),
    'INTERVENTION_KINDS가 라벨 표에서 파생되지 않는다 — 배열을 따로 적으면 라벨을 빠뜨린 유형이 막대에서만 사라진다(줄이 런타임에 풀려 typecheck가 못 잡는다)',
  )
  assert.ok(
    src('app', '(dashboard)', 'dependency', '[id]', 'page.tsx').includes(
      screenNeedle('INTERVENTION_KINDS.map'),
    ),
    '/dependency/[id]가 유형별 막대를 INTERVENTION_KINDS로 돌지 않는다 — 하드코딩한 배열로 돌아가면 월 합계와 막대가 갈라진다',
  )
  assert.deepEqual(
    [...INTERVENTION_KINDS],
    Object.keys(INTERVENTION_LABEL_KO),
    '유형 목록과 라벨 표가 갈라졌다 — 라벨이 없는 유형은 화면에서 이름을 잃는다',
  )
}

/* ===================================================================== */

async function main() {
  if (BREAK) console.log(`※ 음성 대조: ATT_BREAK=${BREAK} — ${BREAKS[BREAK]}`)

  const db = new PGlite({ extensions: { pg_trgm } })
  await applyAll(db)
  const s = await policies(db)
  const ids = await policyBehaviour(db, s)
  await constraints(db, s, ids)
  await inherited(db, s)
  await db.close()

  pureRules()
  pureScore()
  pureBrief()
  aiContainment()

  // 배선은 **자기 DB**에서 돈다. 위 DB는 정책 돌연변이와 심어 둔 제약으로 흔들려 있고,
  // 야간 Job이 걷는 길은 «갓 적용된 0035»여야 한다(check-dependency의 backfill()과 같은 이유).
  const jobDb = new PGlite({ extensions: { pg_trgm } })
  await applyAll(jobDb)
  await stageWiring(jobDb)
  await jobDb.close()

  texts()

  console.log(
    'PASS: 0035 주의 — 시드(규칙 13종 §18 순서 · metric 3/manual 10 · 수동 임계 0 · 예외·점수 0행) · ' +
      '역할별 가시성(exceptions·attention_scores 독자 다섯이 같은 집합 · TeamLead·Member 0행 · 회사 격리) · ' +
      'AIAgent(insert…returning · open만 · update 0행) · 처리는 승인권자 · 규칙 쓰기는 회장뿐 · ' +
      'check 제약 열둘 · force 없음 · delete 권한 0 · 문 둘의 public execute 0 · ' +
      '0034 계승(관찰이 다섯 번째 · 막대 합 = 월 합계 · audit_log FORCE · decisions no force · 새 audit_action 없음) · ' +
      '순수 함수(건너뛴 이유 여섯 · 못 쟀다 다섯 · 잰 값 여덟 · 0035 5절 ↔ TS 가중치·경계 · 바닥 3 ≤ 로드맵 3 · ' +
      '역방향 ceo_ability · 맨 위 3~5건 · KST 감지일 · 세 줄 분석 · 닫힌 스키마) · ' +
      '배선(AIAgent 세션으로 예외·점수 생성 · 못 잰 것은 evaluated가 아니다 · 경고 ≠ 실패 · ' +
      '틱 겹침을 DB가 막는다 · 규칙별·회사별 격리 · 다른 유니크는 중복이 아니다 · ' +
      '점수만 못 붙인 회차 · RED면 회장 액션 · 규칙을 못 읽은 밤) · ' +
      '프롬프트 입력 키와 필수 순위 · 배선 문구',
  )
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

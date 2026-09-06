/**
 * src/data/*.json → supabase/migrations/0003_seed.sql 생성기.
 *
 * 왜 스크립트가 아니라 마이그레이션 파일인가.
 *   시드를 넣는 스크립트를 따로 두면 "DB에 뭐가 들어 있나"의 답이 두 군데로 갈라진다.
 *   0003_seed.sql 하나만 보면 되게 하고, 이 파일은 그 SQL을 손으로 쓰지 않기 위한 도구다.
 *   생성 결과도 같이 커밋한다 — 리뷰는 SQL을 읽고 하지 생성기를 읽고 하지 않는다.
 *
 * 실행:  npm run gen:seed
 *        고친 뒤 결과 SQL의 diff를 확인하고 함께 커밋한다.
 *
 * JSON과 DB가 다른 지점(전부 이 파일 안에서 흡수한다)
 *   1) business_id 'group'  → NULL          (0001의 그룹 행 규약)
 *   2) owner / owner_user_id 'user_001' → uuid   (컬럼 타입이 uuid다. 아래 userUuid 참고)
 *   3) ai-night-output.json에는 PK가 없다   → completed_at 순서로 ain_001.. 부여
 *   4) monthly_priorities.period            → priority_id의 YYYY_MM에서 뽑는다
 *   5) mes/rnd/bom.json                     → 0001에 테이블이 없다(Layer 2 · Vault). 내보내지 않는다
 *   6) strategy.json의 business_coordinates → 0008_business_strategy.sql이 표와 시드를 같이 갖는다.
 *      여기서도 내보내면 새 DB에 같은 5행이 두 번 들어간다. 왜 0003이 아니라 0008인지는 그 파일 머리에.
 */

import { createHash } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import aiNightOutputJson from '../src/data/ai-night-output.json'
import alertsJson from '../src/data/alerts.json'
import businessesJson from '../src/data/businesses.json'
import decisionsJson from '../src/data/decisions.json'
import financeKpiJson from '../src/data/finance-kpi.json'
import projectsJson from '../src/data/projects.json'
import strategyJson from '../src/data/strategy.json'
import tasksJson from '../src/data/tasks.json'

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'supabase', 'migrations', '0003_seed.sql')

// ---------------------------------------------------------------------------
// 값 변환
// ---------------------------------------------------------------------------

type Sql = string

/** SQL 리터럴. 문자열은 작은따옴표만 이스케이프하면 된다(standard_conforming_strings 기본 on). */
function lit(value: string | number | boolean | null | undefined): Sql {
  if (value === null || value === undefined) return 'null'
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`숫자가 아닌 값: ${String(value)}`)
    return String(value)
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  return `'${value.replace(/'/g, "''")}'`
}

/** text[] 리터럴. decisions.options 한 곳에서만 쓴다. */
function textArray(values: string[]): Sql {
  return `array[${values.map((v) => lit(v)).join(', ')}]::text[]`
}

/**
 * 시드의 'user_001' 같은 표시용 ID를 uuid로 접는다.
 *
 * DB의 owner_user_id는 uuid이고 시드에는 uuid가 없다. 그렇다고 NULL로 밀면
 * CH-017 "내 승인 대기"처럼 담당자로 거르는 화면이 시드에서 통째로 비어 버린다.
 * 그래서 이름에서 결정적으로 만든 uuid를 쓴다 — 같은 입력이면 항상 같은 값이라
 * 다시 생성해도 diff가 나지 않는다.
 *
 * auth.users에 실재하는 계정이 아니다. 0001의 owner_user_id 컬럼들은 FK가 없어서 들어간다.
 * 실제 사용자가 생기면 이 매핑을 버리고 진짜 uuid로 갈아탄다.
 */
function userUuid(displayId: string): string {
  const h = createHash('sha1').update(`chairman-os/seed/${displayId}`).digest('hex')
  // uuid v5 모양으로 맞춘다. 버전 5, variant 10xx.
  const v = h.slice(0, 32).split('')
  v[12] = '5'
  v[16] = ((parseInt(v[16], 16) & 0x3) | 0x8).toString(16)
  const s = v.join('')
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20, 32)}`
}

function owner(displayId: string | null | undefined): Sql {
  if (!displayId) return 'null'
  return lit(userUuid(displayId))
}

/** 앱의 'group' 센티널 → DB의 NULL. */
function scope(businessId: string): Sql {
  return businessId === 'group' ? 'null' : lit(businessId)
}

/** 'prio_2026_09_dy' → '2026-09'. 못 읽으면 던진다 — 조용히 엉뚱한 달로 넣는 쪽이 더 나쁘다. */
function periodFromId(id: string): string {
  const m = /(\d{4})_(\d{2})/.exec(id)
  if (!m) throw new Error(`priority_id에서 대상 월을 못 읽었다: ${id}`)
  return `${m[1]}-${m[2]}`
}

/** '2026-09-01T06:00' 처럼 타임존이 없는 값이 온다. KST로 못 박는다. */
function timestamptz(value: string): Sql {
  return lit(/[+-]\d{2}:?\d{2}$|Z$/.test(value) ? value : `${value}+09:00`)
}

// ---------------------------------------------------------------------------
// INSERT 생성
// ---------------------------------------------------------------------------

interface Table {
  name: string
  columns: string[]
  rows: Sql[][]
  note: string
}

function renderTable(t: Table): string {
  const head = [
    `-- ${t.name} (${t.rows.length}행) — ${t.note}`,
    `insert into ${t.name} (${t.columns.join(', ')}) values`,
  ]
  const body = t.rows.map((r) => `  (${r.join(', ')})`).join(',\n')
  return `${head.join('\n')}\n${body};\n`
}

const tables: Table[] = [
  {
    name: 'businesses',
    note: 'CH-001~005. 5개사',
    columns: [
      'business_id',
      'name',
      'status',
      'industry',
      'owner_user_id',
      'visible',
      'sort_order',
      'pinned',
    ],
    rows: businessesJson.map((b) => [
      lit(b.business_id),
      lit(b.name),
      lit(b.status),
      lit(b.industry),
      owner(b.owner_user_id),
      lit(b.visible),
      lit(b.sort_order),
      lit(b.pinned),
    ]),
  },
  {
    name: 'finance_kpis',
    note: '06_Dummy_Data Finance_KPI. 12개월 × 5개사 × 8지표',
    columns: ['period', 'business_id', 'metric', 'value', 'target', 'currency'],
    rows: financeKpiJson.map((k) => [
      lit(k.period),
      lit(k.business_id),
      lit(k.metric),
      lit(k.value),
      // target은 시드에 없다(DEFERRED D-04). 컬럼은 두고 값은 비운다.
      'null',
      lit(k.currency),
    ]),
  },
  {
    name: 'goals',
    note: 'CH-011. business_id null = 그룹 목표',
    columns: [
      'goal_id',
      'business_id',
      'title',
      'target_value',
      'current_value',
      'progress_pct',
      'due',
    ],
    rows: strategyJson.top_goals.map((g) => [
      lit(g.goal_id),
      scope(g.business_id),
      lit(g.title),
      lit(g.target_value),
      lit(g.current_value),
      lit(g.progress_pct),
      lit(g.due),
    ]),
  },
  {
    name: 'monthly_priorities',
    note: 'CH-012. period는 priority_id에서 뽑았다',
    columns: ['priority_id', 'business_id', 'title', 'detail', 'owner_user_id', 'weight', 'period'],
    rows: strategyJson.monthly_priorities.map((p) => [
      lit(p.priority_id),
      scope(p.business_id),
      lit(p.title),
      lit(p.detail),
      owner(p.owner),
      lit(p.weight),
      lit(periodFromId(p.priority_id)),
    ]),
  },
  {
    name: 'critical_risks',
    note: 'CH-013. source는 전부 Rule로 둔다 — 시드에 판별 근거가 없다',
    columns: ['risk_id', 'business_id', 'title', 'detail', 'impact', 'urgency', 'source'],
    rows: strategyJson.critical_risks.map((r) => [
      lit(r.risk_id),
      scope(r.business_id),
      lit(r.title),
      lit(r.detail),
      lit(r.impact),
      lit(r.urgency),
      `'Rule'`,
    ]),
  },
  {
    name: 'milestones',
    note: 'CH-014. project_id는 시드에 연결 정보가 없어 비운다',
    columns: ['milestone_id', 'business_id', 'project_id', 'title', 'owner_user_id', 'deadline'],
    rows: strategyJson.next_milestones.map((m) => [
      lit(m.milestone_id),
      scope(m.business_id),
      'null',
      lit(m.title),
      owner(m.owner),
      lit(m.deadline),
    ]),
  },
  {
    name: 'projects',
    note: 'CH-020',
    columns: [
      'project_id',
      'business_id',
      'name',
      'owner_user_id',
      'priority',
      'status',
      'progress_pct',
      'deadline',
    ],
    rows: projectsJson.map((p) => [
      lit(p.project_id),
      lit(p.business_id),
      lit(p.name),
      owner(p.owner),
      lit(p.priority),
      lit(p.status),
      lit(p.progress_pct),
      lit(p.deadline),
    ]),
  },
  {
    name: 'tasks',
    note: 'CH-040 / CH-017. blocked_since는 DEFERRED D-02 결정 A로 들어온 열이다',
    columns: [
      'task_id',
      'project_id',
      'title',
      'owner_user_id',
      'priority',
      'status',
      'blocked_since',
      'deadline',
      'chairman_needed',
    ],
    rows: tasksJson.map((t) => [
      lit(t.task_id),
      lit(t.project_id),
      lit(t.title),
      owner(t.owner),
      lit(t.priority),
      lit(t.status),
      lit(t.blocked_since),
      lit(t.deadline),
      lit(t.chairman_needed),
    ]),
  },
  {
    name: 'decisions',
    note: 'CH-015/016. ai_confidence는 시드에 없다',
    columns: [
      'decision_id',
      'business_id',
      'title',
      'options',
      'ai_recommendation',
      'ai_confidence',
      'impact',
      'deadline',
      'status',
    ],
    rows: decisionsJson.map((d) => [
      lit(d.decision_id),
      lit(d.business_id),
      lit(d.title),
      textArray(d.options),
      lit(d.ai_recommendation),
      'null',
      lit(d.impact),
      lit(d.deadline),
      lit(d.status),
    ]),
  },
  {
    name: 'alerts',
    note: 'CH-018. related_decision_id는 시드에 연결 정보가 없어 비운다',
    columns: [
      'alert_id',
      'business_id',
      'category',
      'message',
      'severity',
      'source',
      'status',
      'related_decision_id',
    ],
    rows: alertsJson.map((a) => [
      lit(a.alert_id),
      lit(a.business_id),
      lit(a.category),
      lit(a.message),
      lit(a.severity),
      lit(a.source),
      lit(a.status),
      'null',
    ]),
  },
  {
    name: 'ai_night_outputs',
    note: 'CH-019. output_id는 시드에 없어 completed_at 순으로 부여했다',
    columns: [
      'output_id',
      'business_id',
      'job_type',
      'result_summary',
      'status',
      'artifact_link',
      'confidence',
      'completed_at',
    ],
    rows: [...aiNightOutputJson]
      .sort((a, b) => a.completed_at.localeCompare(b.completed_at))
      .map((o, i) => [
        lit(`ain_${String(i + 1).padStart(3, '0')}`),
        lit(o.business_id),
        lit(o.job_type),
        lit(o.result_summary),
        lit(o.status),
        lit(o.artifact_link),
        lit(o.confidence),
        timestamptz(o.completed_at),
      ]),
  },
]

// ---------------------------------------------------------------------------
// 파일 조립
// ---------------------------------------------------------------------------

const seeded = tables.map((t) => t.name)
const rowTotal = tables.reduce((n, t) => n + t.rows.length, 0)

const header = `-- =====================================================================
-- Chairman OS — 0003_seed
--
-- 생성 파일이다. 손으로 고치지 않는다.
--   원천: src/data/*.json (06_Dummy_Data_v1.0.xlsx에서 내린 시드)
--   생성: scripts/gen-seed-sql.ts  —  npm run gen:seed
--   값을 바꾸려면 JSON을 고치고 다시 생성한 뒤 둘을 같이 커밋한다.
--
-- 전부 Dummy다. 실적이 아니다(src/data/README.md).
-- ${seeded.length}개 테이블 / ${rowTotal}행.
--
-- 넣지 않는 테이블
--   documents      시드 JSON이 없다. Vault 판정이 걸린 표라 임의 행을 만들지 않는다.
--   audit_log      기록은 행위에서만 생긴다. 시드로 만들면 그 순간 감사 기록이 아니다(CH-051).
--   user_settings  auth.users에 실재하는 계정이 있어야 넣을 수 있다.
--   mes/rnd/bom    0001에 테이블 자체가 없다(Layer 2 · Vault. supabase/vault_columns.md).
--
-- RLS를 잠깐 여는 이유
--   0002가 전 테이블에 FORCE ROW LEVEL SECURITY를 걸었다. FORCE는 테이블 소유자까지 정책에 넣으므로,
--   마이그레이션 세션(auth.uid()가 null이라 auth_role()도 null)은 businesses_write 같은 정책을 통과하지 못한다.
--   그래서 넣는 동안만 NO FORCE로 내렸다가 파일 끝에서 되돌린다.
--   마이그레이션은 한 트랜잭션이라 중간에 실패하면 FORCE가 풀린 상태로 남지 않는다.
-- =====================================================================

${seeded.map((t) => `alter table ${t} no force row level security;`).join('\n')}

`

const footer = `
${seeded.map((t) => `alter table ${t} force row level security;`).join('\n')}

-- 확인: 위 ${seeded.length}개 테이블이 모두 FORCE로 돌아왔는지. 하나라도 빠지면 소유자가 RLS를 우회한다.
--   select relname, relrowsecurity, relforcerowsecurity from pg_class
--    where relname in (${seeded.map((t) => `'${t}'`).join(', ')});
`

const sql = header + tables.map(renderTable).join('\n') + footer

writeFileSync(OUT, sql, 'utf8')
console.log(`0003_seed.sql 생성 — ${seeded.length}개 테이블 / ${rowTotal}행`)
for (const t of tables) console.log(`  ${t.name.padEnd(20)} ${String(t.rows.length).padStart(4)}행`)

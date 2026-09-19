import type { SupabaseClient } from '@supabase/supabase-js'

import { orderProjects, projectClock } from '@/lib/chairman-project'
import { formatEok } from '@/lib/format'
import { initiativeClock, orderInitiatives, stalenessDays } from '@/lib/initiative'
import { financeBriefContext } from '@/lib/ledger/brief-context'
import { createSupabaseRepository } from '@/lib/repository/supabase'
import { signInServiceAccount } from '@/lib/supabase/service-account'
import type { AiBriefItem, Business, FinanceLedger, IsoDate, NightJobType } from '@/types'

import type { AiAdapter, AiBrief, ChairmanContext, CompanyContext } from './adapter'

/**
 * 야간 브리핑 Job (Phase 3-A, CH-019 / CH-045~048).
 *
 *   AI Agent로 로그인 → 회사별 KPI·결정·알림·업무·원장(0015) 읽기(RLS 통과)
 *   → 회사별 summarizeCompany → generateDailyBrief로 압축 (회장 루틴 0014을 기준으로 함께 넘긴다)
 *   → ai_night_outputs INSERT (회사별 N건 + 그룹 1건) → audit_log(night_job_completed)
 *
 * 세 가지를 지킨다.
 *
 * ① 요청한 사람의 세션으로 돌지 않는다. Cron이든 회장의 '수동 실행'이든, 데이터는 늘 Agent 계정으로
 *   읽고 쓴다. 회장 세션으로 돌리면 수동 실행 때만 Vault까지 보이는 요약이 생긴다 —
 *   같은 Job이 누가 눌렀느냐에 따라 다른 등급의 결과를 내면 안 된다.
 *
 * ② 던지지 않는다. 한 회사가 실패하면 그 회사 행을 status='Failed'로 남기고 다음 회사로 간다.
 *   '어젯밤 무엇이 안 됐나'도 회장이 아침에 봐야 할 정보다. 조용히 빠진 회사는 정상처럼 보인다.
 *
 * ③ 행마다 바로 쓴다. 다섯 회사를 다 돌고 한 번에 쓰면 마지막에 죽을 때 앞의 결과까지 잃는다.
 */

export type NightBriefTrigger = 'cron' | 'manual'

export interface NightBriefReport {
  ok: boolean
  run_id: string
  run_date: IsoDate
  model: string | null
  inserted: number
  done: number
  failed: number
  rows: { output_id: string; business_id: string | null; status: 'Done' | 'Failed'; error?: string }[]
  /** Job 자체가 시작도 못 했을 때(로그인 실패 등). 회사별 실패는 rows에 있다. */
  error?: string
}

const GROUP_KEY = 'group'

/** 23:00 KST에 돌아 '그날'을 요약한다. UTC 날짜를 쓰면 09:00 전 수동 실행이 어제로 찍힌다. */
export function kstDate(now = new Date()): IsoDate {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(now)
}

function newRunId(now: Date): string {
  const stamp = now.toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)
  return `${stamp}_${crypto.randomUUID().slice(0, 6)}`
}

function errorText(e: unknown): string {
  return (e instanceof Error ? e.message : String(e)).slice(0, 500)
}

/** Agent 전용 클라이언트. 역할 확인까지 한다(lib/supabase/service-account.ts). */
function signInAgent() {
  return signInServiceAccount({ emailEnv: 'AI_AGENT_EMAIL', passwordEnv: 'AI_AGENT_PASSWORD', role: 'AIAgent' })
}

export async function runNightBrief(opts: {
  adapter: AiAdapter | null
  /** 어댑터를 만들다 실패한 경우(키 없음 등). 회사마다 Failed로 남긴다. */
  adapterError?: string
  trigger: NightBriefTrigger
  requestedBy?: string
  now?: Date
}): Promise<NightBriefReport> {
  const now = opts.now ?? new Date()
  const run_id = newRunId(now)
  const run_date = kstDate(now)
  const model = opts.adapter?.model ?? null
  const report: NightBriefReport = {
    ok: false, run_id, run_date, model, inserted: 0, done: 0, failed: 0, rows: [],
  }

  let sb: SupabaseClient
  let agentId: string
  try {
    ;({ sb, userId: agentId } = await signInAgent())
  } catch (e) {
    // 로그인이 안 되면 RLS가 INSERT를 막으므로 기록할 자리조차 없다. 응답과 서버 로그가 전부다.
    report.error = errorText(e)
    console.error('[night-brief] sign-in', report.error)
    return report
  }

  const artifact = (key: string) => `/ai?date=${run_date}#${key}`

  async function write(row: {
    business_id: string | null
    job_type: NightJobType
    status: 'Done' | 'Failed'
    brief: AiBrief | null
    error?: string
  }) {
    const key = row.business_id ?? GROUP_KEY
    const output_id = `nb_${run_id}_${key}`
    const { error } = await sb.from('ai_night_outputs').insert({
      output_id,
      business_id: row.business_id,
      job_type: row.job_type,
      result_summary: row.brief?.summary ?? `요약 실패 — ${row.error ?? '원인 미상'}`,
      status: row.status,
      artifact_link: artifact(key),
      confidence: row.brief?.confidence ?? null,
      items: row.brief?.items ?? ([] as AiBriefItem[]),
      project_notes: row.brief?.project_notes ?? [],
      agent_name: 'AI Night Agent',
      completed_at: new Date().toISOString(),
      run_id,
      run_date,
      model,
    })
    if (error) {
      console.error('[night-brief] insert', output_id, error.code, error.message)
      report.rows.push({ output_id, business_id: row.business_id, status: 'Failed', error: `INSERT ${error.code}: ${error.message}` })
      report.failed += 1
      return
    }
    report.inserted += 1
    report.rows.push({ output_id, business_id: row.business_id, status: row.status, error: row.error })
    if (row.status === 'Done') report.done += 1
    else report.failed += 1
  }

  try {
    // 화면과 같은 repository로 읽는다. 무엇이 보이는지는 Agent 세션의 RLS가 정한다.
    const repo = createSupabaseRepository(sb)
    let businesses: Business[] = []
    let snapshot: Awaited<ReturnType<typeof readAll>> | null = null
    let readError: string | undefined
    try {
      snapshot = await readAll(repo)
      businesses = snapshot.businesses.filter((b) => b.status !== 'Archived')
    } catch (e) {
      readError = `데이터 읽기 실패: ${errorText(e)}`
      console.error('[night-brief] read', readError)
    }

    const briefs: { business_id: string; name: string; brief: AiBrief }[] = []
    const failed: { business_id: string; name: string }[] = []

    // 회사끼리는 서로 기다릴 이유가 없다. 동시에 부르고, 각자 끝나는 대로 쓴다.
    await Promise.all(
      businesses.map(async (b) => {
        try {
          if (!opts.adapter) throw new Error(opts.adapterError ?? 'AI 어댑터 없음')
          const brief = await opts.adapter.summarizeCompany(companyContext(b, snapshot!, run_date))
          briefs.push({ business_id: b.business_id, name: b.name, brief })
          await write({ business_id: b.business_id, job_type: 'Company Brief', status: 'Done', brief })
        } catch (e) {
          const msg = errorText(e)
          console.error('[night-brief] company', b.business_id, msg)
          failed.push({ business_id: b.business_id, name: b.name })
          await write({ business_id: b.business_id, job_type: 'Company Brief', status: 'Failed', brief: null, error: msg })
        }
      }),
    )

    // 그룹 1건. 회사 요약이 하나도 없으면 모델을 부르지 않는다 — 빈 입력으로 쓴 브리핑은 지어낸 글이다.
    try {
      if (readError) throw new Error(readError)
      if (!opts.adapter) throw new Error(opts.adapterError ?? 'AI 어댑터 없음')
      if (briefs.length === 0) throw new Error('요약에 성공한 회사가 없다.')
      const order = new Map(businesses.map((b, i) => [b.business_id, i]))
      briefs.sort((a, b) => (order.get(a.business_id) ?? 0) - (order.get(b.business_id) ?? 0))
      const chairman = await readChairmanContext(repo, run_date)
      const finance = snapshot?.ledger
        ? financeBriefContext(snapshot.ledger, businesses.map((b) => b.business_id))
        : null
      const brief = await opts.adapter.generateDailyBrief({ date: run_date, companies: briefs, failed, chairman, finance })
      await write({ business_id: null, job_type: 'Daily Brief', status: 'Done', brief })
    } catch (e) {
      const msg = errorText(e)
      console.error('[night-brief] group', msg)
      await write({ business_id: null, job_type: 'Daily Brief', status: 'Failed', brief: null, error: msg })
    }

    report.ok = report.failed === 0 && report.inserted > 0

    const { error: auditError } = await sb.from('audit_log').insert({
      actor_user_id: agentId,
      actor_role: 'AIAgent',
      action: 'night_job_completed',
      entity_table: 'ai_night_outputs',
      entity_id: run_id,
      after: {
        run_date,
        trigger: opts.trigger,
        model,
        inserted: report.inserted,
        done: report.done,
        failed: report.failed,
      },
      note: `야간 브리핑 ${opts.trigger === 'manual' ? '수동 실행' : 'Cron'}${
        opts.requestedBy ? ` (요청: ${opts.requestedBy})` : ''
      } — 완료 ${report.done} / 실패 ${report.failed}`,
      request_id: run_id,
    })
    if (auditError) {
      console.error('[night-brief] audit', auditError.code, auditError.message)
      report.ok = false
      report.error = `audit_log 기록 실패: ${auditError.message}`
    }
  } catch (e) {
    report.error = errorText(e)
    console.error('[night-brief] unexpected', report.error)
  } finally {
    await sb.auth.signOut().catch(() => {})
  }

  return report
}

/**
 * 회장 루틴(0014) + 이니셔티브(0017) + 체크인(0019, P5-5d). 앞의 둘은 RLS가 AIAgent에게도
 * 읽기를 준다. 못 읽어도 그룹 브리핑은 쓴다 — 기준이 빠진 브리핑이 브리핑이 없는 것보다 낫다.
 * 대신 null로 넘겨 모델이 project_notes를 지어내지 않게 한다. 진행 중인 프로젝트만 넘긴다.
 *
 * 이니셔티브 읽기는 따로 감싼다 — 원장(loadFinanceLedger)과 같은 이유다. 이니셔티브를 못 읽었다고
 * 장기 프로젝트·선언문까지 통째로 null로 떨구면 project_notes가 사라진다. 이니셔티브만
 * initiatives: []로 비우고 나머지는 그대로 간다.
 *
 * 체크인(0019)은 0014/0017과 달리 AIAgent에게 표 자체를 읽는 권한을 주지 않는다 — Chairman
 * 전용 RLS다. 이 repo는 AIAgent 세션으로 만들어지고(runNightBrief의 signInAgent) 이 Job의
 * 기본 경로(cron, 23:00 KST)에는 애초에 빌려 올 회장 세션이 없으므로, 화면(/ai)의 getCheckin처럼
 * 표를 직접 읽는 메서드는 여기서 못 쓴다(1라운드 수정 전에는 이 자리에서 표를 직접 읽는
 * listRecentCheckins를 불러 늘 빈 배열을 받고 있었다 — 배선은 됐지만 실제로는 한 번도 안
 * 켜지는 죽은 코드였다. 2라운드에서 아무도 안 쓰는 그 메서드 자체를 지웠다). 대신
 * getTodayCondition()으로 0019 chairman_today_condition() RPC(security definer, 표 대신 하나의
 * keyhole)를 부른다 — 이 함수는 세션이 아니라 함수 안의 역할 판정으로 AIAgent를 통과시킨다.
 */
async function readChairmanContext(
  repo: ReturnType<typeof createSupabaseRepository>,
  date: IsoDate,
): Promise<ChairmanContext | null> {
  let projects: Awaited<ReturnType<typeof repo.listChairmanProjects>>
  let manifesto: Awaited<ReturnType<typeof repo.getChairmanManifesto>>
  try {
    ;[projects, manifesto] = await Promise.all([repo.listChairmanProjects(), repo.getChairmanManifesto()])
  } catch (e) {
    console.error('[night-brief] chairman context', errorText(e))
    return null
  }

  let initiatives: Awaited<ReturnType<typeof repo.listInitiatives>> = []
  try {
    initiatives = await repo.listInitiatives()
  } catch (e) {
    console.error('[night-brief] initiatives', errorText(e))
    initiatives = []
  }

  // 체크인(0019)도 이니셔티브와 같은 이유로 따로 감싼다 — 못 읽었다고 나머지 chairman 칸까지
  // null로 떨구지 않는다. getTodayCondition()은 condition 하나만 돌려준다(0019
  // chairman_today_condition() RPC) — sleep_hours·weight_kg·meal_note는 그 함수의 반환값에
  // 아예 없어서 여기서도 고를 것이 없다. 애초에 반환하지 않은 값은 모델 프롬프트로 새어 나갈
  // 수 없다.
  let checkin: ChairmanContext['checkin'] = null
  try {
    const condition = await repo.getTodayCondition()
    checkin = condition ? { condition } : null
  } catch (e) {
    console.error('[night-brief] checkin', errorText(e))
    checkin = null
  }

  return {
    projects: orderProjects(projects)
      .filter((p) => p.status === 'Active')
      .map((p) => {
        const c = projectClock(p, date)
        return {
          title: p.title,
          start_date: p.start_date,
          target_date: p.target_date,
          d_day: c.label,
          elapsed_days: c.elapsed,
          total_days: c.total,
          progress_pct: c.pct,
          note: p.note,
          this_month_action: p.this_month_action,
        }
      }),
    initiatives: orderInitiatives(initiatives)
      .filter((i) => i.status === 'Active')
      .map((i) => {
        const clock = initiativeClock(i, date)
        return {
          initiative_id: i.initiative_id,
          title: i.title,
          kind: i.kind,
          stage: i.stage,
          business_id: i.business_id,
          next_action: i.next_action,
          next_action_date: i.next_action_date,
          d_day: clock ? clock.label : null,
          stale_days: stalenessDays(i, date),
          blocker: i.blocker,
        }
      }),
    manifesto: manifesto.body || null,
    checkin,
  }
}

async function readAll(repo: ReturnType<typeof createSupabaseRepository>) {
  const [businesses, financeKpis, projects, tasks, decisions, alerts] = await Promise.all([
    repo.listBusinesses(),
    repo.listFinanceKpis(),
    repo.listProjects(),
    repo.listTasks(),
    repo.listDecisions(),
    repo.listAlerts(),
  ])
  // 원장은 따로 읽는다. 0015가 아직 적용되지 않았거나 읽기가 실패해도 나머지 브리핑은 돈다 —
  // 재무 해석이 빠진 브리핑이 브리핑이 없는 것보다 낫다. 대신 null로 넘겨 모델이 지어내지 않게 한다.
  let ledger: FinanceLedger | null = null
  try {
    ledger = await repo.loadFinanceLedger()
  } catch (e) {
    console.error('[night-brief] ledger', errorText(e))
  }
  return { businesses, financeKpis, projects, tasks, decisions, alerts, ledger }
}

/** 모델에 넘길 한 회사치. 끝난 것은 뺀다 — 회장이 아침에 볼 것은 열려 있는 것이다. */
function companyContext(
  b: Business,
  s: Awaited<ReturnType<typeof readAll>>,
  date: IsoDate,
): CompanyContext {
  const id = b.business_id
  // 최근 두 달치만. 전기 대비를 말할 수 있을 만큼이면 된다.
  const periods = [...new Set(s.financeKpis.filter((k) => k.business_id === id).map((k) => k.period))]
    .sort()
    .slice(-2)
  const projects = s.projects.filter((p) => p.business_id === id)
  const projectIds = new Set(projects.map((p) => p.project_id))

  return {
    date,
    business: { business_id: id, name: b.name, industry: b.industry, status: b.status },
    kpis: s.financeKpis
      .filter((k) => k.business_id === id && periods.includes(k.period))
      .map((k) => ({
        metric: k.metric,
        period: k.period,
        // 금액은 여기서 억 단위 문자열로 만든다. 모델이 원 단위를 나누다 틀리는 일을 없앤다.
        value: formatEok(k.value),
        target: k.target === undefined ? null : formatEok(k.target),
      })),
    decisions: s.decisions
      .filter((d) => d.business_id === id && d.status === 'Open')
      .map((d) => ({ decision_id: d.decision_id, title: d.title, impact: d.impact, deadline: d.deadline, status: d.status })),
    alerts: s.alerts
      .filter((a) => a.business_id === id && a.status !== 'Resolved')
      .map((a) => ({ alert_id: a.alert_id, category: a.category, severity: a.severity, status: a.status, message: a.message })),
    tasks: s.tasks
      .filter((t) => projectIds.has(t.project_id) && t.status !== 'Done')
      .map((t) => ({
        task_id: t.task_id,
        title: t.title,
        status: t.status,
        priority: t.priority,
        deadline: t.deadline,
        blocked_since: t.blocked_since,
        chairman_needed: t.chairman_needed,
      })),
    projects: projects
      .filter((p) => p.status !== 'Done')
      .map((p) => ({ project_id: p.project_id, name: p.name, status: p.status, progress_pct: p.progress_pct, deadline: p.deadline })),
    finance: s.ledger ? financeBriefContext(s.ledger, [id]) : null,
  }
}

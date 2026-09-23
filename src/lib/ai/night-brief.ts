import type { SupabaseClient } from '@supabase/supabase-js'

import { attentionBriefLines, attentionItems } from '@/lib/attention/brief'
import { runAttentionStage, type AttentionStageResult } from '@/lib/attention/stage'
import { orderProjects, projectClock } from '@/lib/chairman-project'
import { formatEok } from '@/lib/format'
import { initiativeClock, orderInitiatives, stalenessDays } from '@/lib/initiative'
import { sendKakaoBrief } from '@/lib/kakao/send-brief'
import { financeBriefContext } from '@/lib/ledger/brief-context'
import { createSupabaseRepository } from '@/lib/repository/supabase'
import { signInServiceAccount } from '@/lib/supabase/service-account'
import type { AiBriefItem, Business, FinanceLedger, IsoDate, NightJobType } from '@/types'

import type { AiAdapter, AiBrief, ChairmanContext, CompanyContext } from './adapter'

/**
 * 야간 브리핑 Job (Phase 3-A, CH-019 / CH-045~048).
 *
 *   AI Agent로 로그인 → 회사별 KPI·결정·알림·업무·원장(0015) 읽기(RLS 통과)
 *   → **주의(ATTENTION) 단계**(Phase 7 블록 B-2, 0035): 규칙 평가 → 점수 → AI 분석 → 예외 생성
 *   → 회사별 summarizeCompany → generateDailyBrief로 압축 (회장 루틴 0014을 기준으로 함께 넘긴다)
 *   → ai_night_outputs INSERT (회사별 N건 + 그룹 1건) → audit_log(night_job_completed)
 *   → 카카오 발송(Phase 3-C)
 *
 * 네 가지를 지킨다.
 *
 * ① 요청한 사람의 세션으로 돌지 않는다. Cron이든 회장의 '수동 실행'이든, 데이터는 늘 Agent 계정으로
 *   읽고 쓴다. 회장 세션으로 돌리면 수동 실행 때만 Vault까지 보이는 요약이 생긴다 —
 *   같은 Job이 누가 눌렀느냐에 따라 다른 등급의 결과를 내면 안 된다.
 *
 * ② 던지지 않는다. 한 회사가 실패하면 그 회사 행을 status='Failed'로 남기고 다음 회사로 간다.
 *   '어젯밤 무엇이 안 됐나'도 회장이 아침에 봐야 할 정보다. 조용히 빠진 회사는 정상처럼 보인다.
 *
 * ③ 행마다 바로 쓴다. 다섯 회사를 다 돌고 한 번에 쓰면 마지막에 죽을 때 앞의 결과까지 잃는다.
 *
 * ⑤ 주의 단계는 브리핑보다 **먼저**다 (§18의 화살표 순서). 브리핑이 주의 3~5건을 맨 위에
 *   올리려면 그때 이미 있어야 한다. 그 단계가 통째로 실패해도 브리핑은 돈다 — 대신
 *   그 사실이 그룹 행의 맨 위 항목으로 남는다. **"주의가 없다"와 "주의를 못 쟀다"는 다르다.**
 *   새 `audit_action`을 만들지 않는다 — 예외 생성은 기존 `night_job_completed` 줄의
 *   `after`에 숫자로 남는다.
 *
 * ④ 카카오 발송은 맨 마지막이고, 실패해도 Job은 성공이다 (Phase 3-C). 카톡이 안 갔다고
 *   브리핑 행까지 Failed가 되면 아침에 /ai를 열어도 '어젯밤 실패'만 보인다 —
 *   발송은 브리핑의 배달 수단이지 브리핑 자체가 아니다. 성패는 audit_log에 남는다.
 *   cron으로 돌 때만 보낸다. 수동 실행은 하루에 몇 번이고 누를 수 있는 버튼이라
 *   누를 때마다 카톡이 가면 알림이 아니라 소음이 된다 — 테스트 발송 버튼이 따로 있다.
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
  /**
   * Job 진입 단계(로그인 등)에서 던진 예외가 여기 실린다. 회사별 실패는 rows에 있다.
   * 오늘은 이 값이 로그인 실패로만 채워지지만, 바깥 catch가 있는 한 이후 단계의 예상 못한
   * throw도 이론적으로는 여기로 온다 — "Job이 시작도 못 했다"는 보증까지는 아니다.
   */
  error?: string
}

const GROUP_KEY = 'group'

/**
 * 브리핑 행의 날짜. **KST 그대로 둔다** (Phase 3-C 현지 시간에서 한 번 다시 판단한 자리다).
 *
 * 발송 시각은 회장 현지 06:00으로 옮겼지만 이 값은 옮기지 않았다. ai_night_outputs.run_date는
 * /ai의 날짜 축이고 artifact_link(`/ai?date=`)의 키이며, 회계·마감이 쓰는 '오늘'(kstToday)과
 * 같은 눈금 위에 있어야 하는 값이다. 그 눈금은 그룹의 장부가 도는 서울 시간이고, 회장이
 * 어디 있느냐로 장부 날짜가 흔들리면 지난 브리핑 이력이 어느 날 하루씩 어긋난다.
 *
 * 현지 날짜가 필요한 곳은 셋이고 전부 따로 받는다 — 발송 판정(틱), 중복 방지(0029
 * chairman_brief_sends), 카톡 메시지의 월요일 줄(lib/kakao/message.ts localDate).
 *
 * UTC 날짜를 쓰지 않는 이유는 그대로다. 09:00 KST 전에 도는 회차가 늘 어제로 찍힌다 —
 * 회장이 서울 바깥에 있으면 이 Job은 KST 새벽에도 돈다(뉴욕 06:00 = 19:00 KST, 시드니
 * 06:00 = 04:00 KST)라 옮긴 뒤로 이 함수가 더 중요해졌다.
 */
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
  /**
   * Phase 3-C 현지 시간. 틱이 판정한 회장의 시간대와 그곳의 오늘 날짜다.
   * cron 틱으로 들어올 때만 온다 — /ai의 '수동 실행'(POST)에는 없다.
   *
   * 이 값이 있으면 Job은 마지막에 0029 chairman_brief_send_record()로 **그 현지 날짜를
   * 장부에 적는다.** 그 행의 존재가 다음 틱의 '오늘은 이미 끝났다'이고, 곧 중복 발송을
   * 막는 유일한 장치다. 없으면 적지 않는다 — 수동 실행이 장부를 건드리면 회장이 낮에
   * 버튼 한 번 누른 것으로 다음 날 아침이 조용히 사라진다.
   */
  local?: { timezone: string; localDate: IsoDate }
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
    /**
     * 브리핑 **앞**에 붙는 항목들. 두 곳에서 온다.
     *   · 그룹 행 — 주의 3~5건(§18 원문: "기존 브리핑은 attention 3~5건을 맨 위에"),
     *     또는 규칙 평가 단계가 통째로 실패한 사실.
     *   · 회사 행 — 그 회사의 주의 단계가 남긴 **실패와 경고 둘 다.**
     *     실패는 «평가가 터졌거나 예외를 못 적었다»(critical)이고,
     *     경고는 «재지 못했다 · 점수를 못 붙였다»(warning)다. **둘을 가르는 것이 요점이다** —
     *     경고를 빼면 데이터가 끊긴 회사가 조용한 회사로 읽힌다.
     * 전부 코드가 만든 항목이고 모델이 만든 것이 아니다. 앞에 두는 것이 곧 «맨 위»다.
     */
    leadItems?: AiBriefItem[]
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
      items: [...(row.leadItems ?? []), ...(row.brief?.items ?? [])] as AiBriefItem[],
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

    /**
     * 블록 B-2 — 주의(ATTENTION) 단계. **브리핑보다 먼저 돈다**(§18의 화살표 순서이고,
     * 브리핑이 주의를 맨 위에 올리려면 그때 이미 있어야 한다).
     *
     * 판단은 전부 `lib/attention/*`의 순수 함수에 있고 여기 있는 것은 배선뿐이다.
     * 이 단계가 통째로 실패해도 브리핑은 돈다 — 규칙 평가를 못 했다고 아침 브리핑까지
     * 없어지면 회장은 어제 무슨 일이 있었는지도 못 본다. 대신 **조용히 넘어가지 않는다**:
     * 단계 실패는 그룹 행의 맨 위 항목으로, 회사별 실패는 그 회사 행의 맨 위 항목으로 남는다.
     */
    let attention: AttentionStageResult | null = null
    let attentionStageError: string | undefined
    if (snapshot) {
      try {
        attention = await runAttentionStage({
          sb,
          adapter: opts.adapter,
          adapterError: opts.adapterError,
          businesses,
          financeKpis: snapshot.financeKpis,
          ledger: snapshot.ledger,
          runDate: run_date,
        })
      } catch (e) {
        const msg = errorText(e)
        console.error('[night-brief] attention', msg)
        attention = null
        attentionStageError = msg
      }
    }
    if (attention?.error) attentionStageError = attention.error

    /**
     * 그룹 브리핑의 **맨 위**. 주의 3~5건을 코드가 세운다 — 순서를 모델에 맡기면 «맨 위»가
     * 매일 달라지고, 그러면 그것은 맨 위가 아니다. 모델에게는 같은 목록을 입력으로도 넘겨
     * 요약이 이 줄들과 어긋나지 않게 한다.
     *
     * 단계가 통째로 실패한 날은 그 사실이 맨 위에 선다. **"오늘 주의가 없다"와
     * "오늘 주의를 못 쟀다"는 다른 사실이고**, 둘을 같은 화면(항목 0개)으로 접으면
     * 규칙 엔진이 죽은 밤이 조용한 밤처럼 보인다.
     */
    function groupLeadItems(): AiBriefItem[] {
      if (attentionStageError) {
        return [
          {
            title: '[주의] 규칙 평가 단계 실패',
            detail: `${attentionStageError} — 오늘 브리핑의 주의 목록은 비어 있지만 «주의가 없다»는 뜻이 아니다.`,
            severity: 'critical',
          },
        ]
      }
      return attentionItems(attention?.headlines ?? [])
    }

    /**
     * 그룹 요약에 넘길 «재지 못한 회사» 목록. `warnings`에서 `unmeasured`만 걸러 낸다 —
     * 목록을 따로 들고 있지 않는 이유는 `StageWarning`의 주석에 있다(두 벌이 되면 언젠가
     * 한쪽만 채워진다).
     */
    function unmeasuredCompanies() {
      const out: { business_id: string; name: string; facts: string[] }[] = []
      for (const b of businesses) {
        const facts = (attention?.warnings.get(b.business_id) ?? [])
          .filter((w) => w.kind === 'unmeasured')
          .map((w) => w.text)
        if (facts.length > 0) out.push({ business_id: b.business_id, name: b.name, facts })
      }
      return out
    }

    /**
     * 감사 줄에 실을 숫자들. 단계가 못 돌았으면 그 사실이 `error`로 실린다(0건이 아니다).
     *
     * **`unmeasured`가 `evaluated`와 따로 실리는 것이 이 객체의 요점이다.**
     * 둘을 합치면 «다섯 회사가 전부 수치가 없어 못 쟀다»는 밤과 «다섯 회사를 다 재어 보니
     * 멀쩡하다»는 밤이 **똑같은 감사 줄**을 남긴다. 예외가 0건인 것은 두 밤이 같지만
     * 그 0은 전혀 다른 0이고, 나중에 "그날 밤 왜 아무것도 안 올라왔나"에 답할 자리가
     * 이 줄 하나뿐이다. `notes`까지 싣는 이유도 같다 — 서버 로그는 지워지고 감사 줄은 남는다.
     */
    const attentionAudit = attentionStageError
      ? { error: attentionStageError }
      : {
          evaluated: attention?.evaluated ?? 0,
          unmeasured: attention?.unmeasured ?? 0,
          unmeasured_reasons: attention?.unmeasuredReasons ?? {},
          created: attention?.created ?? 0,
          deduped: attention?.deduped ?? 0,
          without_analysis: attention?.withoutAnalysis ?? 0,
          failed_companies: attention ? [...attention.failures.keys()] : [],
          warned_companies: attention ? [...attention.warnings.keys()] : [],
          // 줄 수를 자른다 — 감사 줄 하나가 수백 줄짜리 JSON이 되면 아무도 안 읽는다.
          notes: (attention?.notes ?? []).slice(0, 50),
        }

    const briefs: { business_id: string; name: string; brief: AiBrief }[] = []
    const failed: { business_id: string; name: string }[] = []

    // 회사끼리는 서로 기다릴 이유가 없다. 동시에 부르고, 각자 끝나는 대로 쓴다.
    await Promise.all(
      businesses.map(async (b) => {
        /**
         * 그 회사의 주의 단계가 남긴 것을 그 회사 행 **맨 위**에 올린다.
         *
         * **실패와 경고를 가른다.** 앞의 것은 «평가가 터졌거나 예외를 못 적었다»이고,
         * 뒤의 것은 «못 쟀다 · 점수를 못 붙였다»다. 뒤의 것을 안 올리면 **데이터가 끊긴
         * 회사가 조용한 회사로 읽힌다** — 그 회사의 브리핑은 KPI가 비어 있어도 성공하고
         * 예외가 0건이니 맨 위 목록에도 안 오른다. «주의가 없다»와 «주의를 못 쟀다»를
         * 가르는 것이 이 블록의 규율이고, 그 규율이 회사 단위에서도 지켜져야 한다.
         *
         * 브리핑 자체는 성공했을 수 있으므로 status를 Failed로 내리지 않는다 —
         * 두 개의 다른 사실을 한 칸으로 접으면 어느 쪽이 실패한 것인지 읽을 수 없다.
         */
        const leadItems: AiBriefItem[] = [
          ...(attention?.failures.get(b.business_id) ?? []).map((detail) => ({
            title: `[주의] ${b.name} 규칙 엔진 실패`,
            detail,
            severity: 'critical' as const,
          })),
          ...(attention?.warnings.get(b.business_id) ?? []).map((w) => ({
            title:
              w.kind === 'unmeasured'
                ? `[주의] ${b.name} 재지 못함`
                : `[주의] ${b.name} 점수 미기록`,
            detail:
              w.kind === 'unmeasured'
                ? `${w.text} — «이상 없음»이 아니라 «재지 못했다»이다.`
                : w.text,
            severity: 'warning' as const,
          })),
        ]
        try {
          if (!opts.adapter) throw new Error(opts.adapterError ?? 'AI 어댑터 없음')
          const brief = await opts.adapter.summarizeCompany(companyContext(b, snapshot!, run_date))
          briefs.push({ business_id: b.business_id, name: b.name, brief })
          await write({ business_id: b.business_id, job_type: 'Company Brief', status: 'Done', brief, leadItems })
        } catch (e) {
          const msg = errorText(e)
          console.error('[night-brief] company', b.business_id, msg)
          failed.push({ business_id: b.business_id, name: b.name })
          await write({ business_id: b.business_id, job_type: 'Company Brief', status: 'Failed', brief: null, error: msg, leadItems })
        }
      }),
    )

    // 그룹 1건. 회사 요약이 하나도 없으면 모델을 부르지 않는다 — 빈 입력으로 쓴 브리핑은 지어낸 글이다.
    // chairman·groupBrief를 try 밖에 두는 것은 Phase 3-C 때문이다. 카카오 발송이 이 둘을
    // 다시 읽지 않고 그대로 쓴다 — 같은 브리핑을 두 번 읽으면 화면과 카톡이 다른 말을 할 수 있다.
    let chairman: ChairmanContext | null = null
    let groupBrief: AiBrief | null = null
    try {
      if (readError) throw new Error(readError)
      if (!opts.adapter) throw new Error(opts.adapterError ?? 'AI 어댑터 없음')
      if (briefs.length === 0) throw new Error('요약에 성공한 회사가 없다.')
      const order = new Map(businesses.map((b, i) => [b.business_id, i]))
      briefs.sort((a, b) => (order.get(a.business_id) ?? 0) - (order.get(b.business_id) ?? 0))
      chairman = await readChairmanContext(repo, run_date)
      const finance = snapshot?.ledger
        ? financeBriefContext(snapshot.ledger, businesses.map((b) => b.business_id))
        : null
      groupBrief = await opts.adapter.generateDailyBrief({
        date: run_date,
        companies: briefs,
        failed,
        /**
         * **«재지 못했다»를 회장이 읽는 자리까지 밀어 넣는다.**
         *
         * 이 줄이 없으면 이 블록이 지킨 구분이 마지막 한 걸음에서 끝난다 — 요약이 실패한
         * 회사는 06:00 메시지에 한 문장으로 반드시 들어가는데, **재지 못한 회사는 아무
         * 말도 없이 조용한 회사와 같아 보인다.** `items`는 카톡에 실리지 않고 회장이
         * 받는 것은 `summary` 한 덩이뿐이라, 회사 행에 항목을 세운 것만으로는 그에게
         * 닿지 않는다.
         *
         * **점수 미기록 경고는 넘기지 않는다** — 그것은 이 저장소가 고칠 내부 사정이고,
         * 회장의 아침 다섯 문장에 들어갈 사실이 아니다. 그 가름을 `StageWarning.kind`가 한다.
         */
        unmeasured: unmeasuredCompanies(),
        chairman,
        finance,
        attentions: attentionBriefLines(attention?.headlines ?? []),
      })
      await write({ business_id: null, job_type: 'Daily Brief', status: 'Done', brief: groupBrief, leadItems: groupLeadItems() })
    } catch (e) {
      const msg = errorText(e)
      console.error('[night-brief] group', msg)
      await write({ business_id: null, job_type: 'Daily Brief', status: 'Failed', brief: null, error: msg, leadItems: groupLeadItems() })
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
        /**
         * 블록 B-2. **새 감사 유형을 만들지 않는다** — 예외 생성은 이 줄의 숫자로 남는다.
         * 개별 예외의 «누가 무엇을»은 `exceptions` 행 자체가 갖고 있고, 회장의 처리만
         * `audit_log`에 따로 줄이 선다(그것이 0034의 개입 집계로 간다).
         */
        attention: attentionAudit,
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

    /**
     * Phase 3-C — 마지막 단계. audit_log 뒤에 두는 것은 순서에 뜻이 있다.
     * 'Job이 끝났다'가 먼저 기록되고, 그 배달 결과가 뒤따른다. 발송을 앞에 두면
     * 카톡은 갔는데 Job 완료 기록이 없는 상태가 생길 수 있다.
     *
     * report에 싣지 않는 이유: report는 브리핑이 몇 건 남았나를 말하는 값이다.
     * 카톡 성패는 audit_log(kakao_sent / kakao_failed)에서 본다.
     *
     * groupBrief가 null이어도(그룹 브리핑 생성 실패) cron이면 그대로 부른다 — sendKakaoBrief가
     * summary === null을 '그룹 브리핑이 없다'는 skipped로 audit_log에 남긴다. 여기서 안 부르고
     * 조용히 넘어가면 카톡도 안 오고 감사 행도 안 남아서, 최악의 아침에 "왜 카톡이 안 왔지"에
     * 답할 자리가 없어진다.
     */
    if (opts.trigger === 'cron') {
      // 화면과 같은 고르기다 — orderProjects가 목표일이 가까운 Active를 맨 앞에 둔다.
      const lead = chairman?.projects[0] ?? null
      // local이 없는 회차(옛 경로)는 KST 날짜를 현지 날짜로 쓴다. 두 값이 다를 수 있다는
      // 것을 아는 자리가 여기 하나뿐이라, 그 사실을 이 줄이 드러내 둔다.
      const localDate = opts.local?.localDate ?? run_date
      const sendResult = await sendKakaoBrief({
        sb,
        actorUserId: agentId,
        actorRole: 'AIAgent',
        runDate: run_date,
        localDate,
        summary: groupBrief?.summary ?? null,
        dDay: lead?.d_day ?? null,
        projectTitle: lead?.title ?? null,
        trigger: 'cron',
      })

      /**
       * 장부에 그 현지 날짜를 적는다 (Phase 3-C 현지 시간, 0029).
       *
       * **발송 성공 여부와 무관하게 적는다.** 카카오가 연결되지 않은 날도 그날 아침 Job은
       * 끝난 날이다 — 안 적으면 06~10시의 틱이 매시 회사 다섯 곳 + 그룹 = 여섯 번의
       * 모델 호출을 다시 돌린다. 가장 조용하고 가장 비싼 실패다.
       *
       * 실패해도 던지지 않는다(sendKakaoBrief와 같은 절제다). 대신 서버 로그에 남긴다 —
       * 이 기록이 안 되면 다음 틱이 같은 날 것을 한 번 더 보낼 수 있고, 그 중복은
       * 아무것도 안 오는 것보다는 낫다.
       */
      if (opts.local) {
        const { error: ledgerError } = await sb.rpc('chairman_brief_send_record', {
          p_local_date: opts.local.localDate,
          p_timezone: opts.local.timezone,
          p_sent: sendResult.sent,
          p_reason: sendResult.sent ? '' : (sendResult.skipped ?? sendResult.error ?? '원인 미상'),
        })
        if (ledgerError) {
          console.error('[night-brief] brief-send ledger', ledgerError.code, ledgerError.message)
        }
      }
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
 * 기본 경로(cron, 07:00 KST)에는 애초에 빌려 올 회장 세션이 없으므로, 화면(/ai)의 getCheckin처럼
 * 표를 직접 읽는 메서드는 여기서 못 쓴다(1라운드 수정 전에는 이 자리에서 표를 직접 읽는
 * listRecentCheckins를 불러 늘 빈 배열을 받고 있었다 — 배선은 됐지만 실제로는 한 번도 안
 * 켜지는 죽은 코드였다. 2라운드에서 아무도 안 쓰는 그 메서드 자체를 지웠다). 대신
 * getRecentCondition()으로 0023 chairman_recent_condition() RPC(security definer, 표 대신 하나의
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

  // 체크인(0023 chairman_recent_condition())도 이니셔티브와 같은 이유로 따로 감싼다 —
  // 못 읽었다고 나머지 chairman 칸까지 null로 떨구지 않는다. 오늘 행이 없으면 어제 것이
  // 오고, 어느 날 값인지 as_of로 같이 온다. 07:00 KST에 도는 이 Job은 회장의 아침 체크인보다
  // 먼저 도는 것이 기본이라, 여기서 오는 값은 대개 어제 것이다.
  // sleep_hours·weight_kg·meal_note는 그 함수의 반환값에 아예 없어서 여기서도 고를 것이 없다.
  let checkin: ChairmanContext['checkin'] = null
  try {
    const recent = await repo.getRecentCondition()
    checkin = recent ? { condition: recent.condition, as_of: recent.checkin_date } : null
  } catch (e) {
    console.error('[night-brief] checkin', errorText(e))
    checkin = null
  }

  /**
   * 블록 7. 이번 주 접속 기록의 한 줄(0031 activity_digest).
   *
   * 다른 칸과 같은 이유로 따로 감싼다 — 못 읽었다고 나머지 chairman 칸까지 null로
   * 떨구지 않는다. **숫자만 읽는다.** 이 Job은 audit_log의 개별 줄을 못 읽고(FORCE RLS),
   * 못 읽는 것이 맞다. 그래서 여기서 만들 수 있는 문장이 이 한 줄뿐이다.
   */
  let activity: string | null = null
  try {
    const week = await repo.getActivityWeek()
    activity = week
      ? `이번 주(${week.week_start}~) 접속 기록 ${week.events}건 · 문서 열람 ${week.doc_reads}건 · ` +
        `활동한 사람 ${week.people}명. 사람별 내역과 이상 징후는 회장 전용 화면(/settings/activity)에만 있다.`
      : null
  } catch (e) {
    console.error('[night-brief] activity', errorText(e))
    activity = null
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
    activity,
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

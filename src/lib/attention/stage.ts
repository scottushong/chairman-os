import type { SupabaseClient } from '@supabase/supabase-js'

import type { AiAdapter } from '@/lib/ai/adapter'
import { formatEok } from '@/lib/format'
import { runway } from '@/lib/ledger/analysis'
import { financeBriefContext, type FinanceBriefContext } from '@/lib/ledger/brief-context'
import { ledgerScope } from '@/lib/ledger/scope'
import type {
  AttentionHeadline,
  Business,
  ExceptionRecord,
  ExceptionRule,
  FinanceKpi,
  FinanceLedger,
  IsoDate,
} from '@/types'

import { formatExceptionAnalysis, selectAttentions } from './brief'
import {
  evaluateRules,
  SKIP_REASON_KO,
  UNMEASURED_REASON_KO,
  type CompanyMeasurements,
  type RunwayReading,
} from './rules'
import { attentionScore, financialImpactAxis } from './score'

/**
 * 야간 Job의 주의(ATTENTION) 단계 — Phase 7 블록 B-2. §18의 파이프라인이 도는 자리다.
 *
 *   규칙 평가 → (걸린 건마다) 점수 → AI 분석 → exceptions insert → attention_scores insert
 *
 * **브리핑보다 먼저 돈다.** §18의 화살표가 그 순서이고, 브리핑이 주의를 맨 위에 올리려면
 * 그때 이미 있어야 한다.
 *
 * `lib/kakao/send-brief.ts`와 같은 모양으로 `sb`를 받아 이 파일에 둔다 —
 * night-brief.ts의 배선은 얇게 두고, **판단은 전부 순수 함수**(rules.ts · score.ts ·
 * brief.ts)에 있다. 이 파일이 하는 일은 읽고·쓰고·실패를 회사마다 가두는 것뿐이다.
 *
 * ■ 이 단계가 지키는 것 넷 ■
 *
 * ① **AI는 결정하지 않는다.** `status`는 언제나 `'open'`이고, `severity`는 규칙과 점수가
 *   정하며, `chairman_action_required`는 §19의 정의에서 나온다. 모델이 그 값들을 돌려줄
 *   칸 자체가 없다(`ExceptionAnalysis`). DB의 restrictive 정책 둘이 같은 것을 막지만,
 *   **42501에 기대지 않는다** — 그 거절이 언제 어디서 삼켜지는지에 안전이 걸리게 된다.
 *
 * ② **분석이 없어도 예외는 만든다.** 키가 없거나 모델이 실패하면 `ai_analysis`는 null이다.
 *   규칙이 먼저고 AI는 그 위에 얹히는 층이다.
 *
 * ③ **한 회사가 실패해도 다음 회사는 돈다.** 회사마다 try로 가두고, 실패는 삼키지 않고
 *   회사별 문구로 돌려준다 — 야간 Job이 그것을 그 회사의 행에 남긴다.
 *
 * ④ **중복은 두 겹으로 막는다.** 조회로 한 번(같은 회사·규칙·기간이 이미 있으면 건너뛴다),
 *   0035의 유니크 제약으로 또 한 번. 앞의 것만으로는 두 틱이 겹치는 날 뚫린다 —
 *   조회와 insert 사이가 비어 있고, 이 Job은 회사들을 동시에 돈다.
 */

export interface AttentionStageResult {
  /** 평가한 (회사 × 규칙) 수. */
  evaluated: number
  /** 이번 회차가 실제로 만든 예외 수. */
  created: number
  /** 이미 있어서 건너뛴 수(조회 + 유니크 제약에 걸린 것). */
  deduped: number
  /** 분석을 못 받아 `ai_analysis`가 null로 들어간 수. */
  withoutAnalysis: number
  /** 브리핑 맨 위에 설 3~5건. 열린 예외 **전부**에서 고른다 — 오늘 만든 것만이 아니다. */
  headlines: AttentionHeadline[]
  /** 회사별 실패 문구. 야간 Job이 그 회사의 행에 남긴다. */
  failures: Map<string, string>
  /** 단계 전체가 못 돈 이유(규칙을 못 읽었다 등). 회사별 실패와 다르다. */
  error?: string
  /** 건너뛴 규칙·못 잰 회사처럼 «조용히 넘어가면 안 되는» 사실들. 서버 로그로 나간다. */
  notes: string[]
}

function errorText(e: unknown): string {
  return (e instanceof Error ? e.message : String(e)).slice(0, 500)
}

/**
 * 그 회사의 런웨이. **정의는 `lib/ledger/analysis.ts`의 `runway()` 하나뿐이다** —
 * 화면·브리핑·예외가 같은 함수를 부른다. 원장이 없으면 `unknown`이고, 그것은
 * «소진이 없다»가 아니라 «못 쟀다»다.
 *
 * **규칙의 `window_days`가 이 창을 바꾸지 못한다.** `runway()`의 창은 3개월 고정이고,
 * 시드의 `cash_runway`가 90일이라 오늘은 둘이 같다. 회장이 그 값을 60일로 고치면
 * 임계는 바뀌지만 평균을 내는 창은 그대로다 — DEFERRED에 적었다.
 */
function readRunway(ledger: FinanceLedger | null, businessId: string): RunwayReading {
  if (!ledger) return { months: null, status: 'unknown', period: null }
  const scope = ledgerScope(ledger, [businessId])
  const period = scope.periods.at(-1) ?? null
  if (!period) return { months: null, status: 'unknown', period: null }
  const r = runway(scope, period)
  return { months: r.months?.value ?? null, status: r.status, period }
}

export async function runAttentionStage(input: {
  sb: SupabaseClient
  adapter: AiAdapter | null
  /** 어댑터가 없는 이유. 분석 없이 예외를 만들고 이 문구를 로그에 남긴다. */
  adapterError?: string
  businesses: Business[]
  financeKpis: FinanceKpi[]
  ledger: FinanceLedger | null
  runDate: IsoDate
}): Promise<AttentionStageResult> {
  const result: AttentionStageResult = {
    evaluated: 0,
    created: 0,
    deduped: 0,
    withoutAnalysis: 0,
    headlines: [],
    failures: new Map(),
    notes: [],
  }

  // 규칙 사전. 못 읽으면 단계 전체가 못 돈다 — 조용히 0건으로 끝내지 않는다.
  const { data: ruleRows, error: ruleError } = await input.sb
    .from('exception_rules')
    .select(
      'rule_key,name,scope,kind,metric,comparator,threshold,window_days,severity_base,enabled,sort_order',
    )
    .order('sort_order')
    .returns<ExceptionRule[]>()
  if (ruleError) {
    result.error = `exception_rules 읽기 실패 ${ruleError.code ?? '?'}: ${ruleError.message}`
    return result
  }
  const rules = ruleRows ?? []

  // 이미 있는 예외. 중복 방지 조회이자 «맨 위 3~5건»의 원천이다.
  const { data: existingRows, error: existingError } = await input.sb
    .from('exceptions')
    .select(
      'id,business_id,rule_key,detected_at,period,value,threshold,severity,ai_analysis,ceo_handling,chairman_action_required,status,monitor_until',
    )
    .returns<ExceptionRecord[]>()
  if (existingError) {
    result.error = `exceptions 읽기 실패 ${existingError.code ?? '?'}: ${existingError.message}`
    return result
  }
  const existing = existingRows ?? []
  const seen = new Set(existing.map((e) => `${e.business_id}\u0000${e.rule_key}\u0000${e.period ?? ''}`))

  const created: ExceptionRecord[] = []

  await Promise.all(
    input.businesses.map(async (b) => {
      try {
        const m: CompanyMeasurements = {
          business_id: b.business_id,
          kpis: input.financeKpis
            .filter((k) => k.business_id === b.business_id)
            .map((k) => ({ metric: k.metric, period: k.period, value: k.value })),
          runway: readRunway(input.ledger, b.business_id),
        }
        // 회사 요약이 쓰는 것과 **같은 함수**로 만든 재무 해석. 원인 분해의 재료이고,
        // 원장을 못 읽었으면 null이다 — 그때 모델은 재무 해석을 지어내지 않는다.
        const finance: FinanceBriefContext | null = input.ledger
          ? financeBriefContext(input.ledger, [b.business_id])
          : null

        for (const { rule, outcome } of evaluateRules(rules, m)) {
          if (outcome.kind === 'skipped') {
            // 수동 규칙은 열 개라 매일 열 줄이 쌓인다. 그것은 설계이지 사건이 아니다.
            if (outcome.reason !== 'manual') {
              result.notes.push(`${b.business_id} ${rule.rule_key}: ${SKIP_REASON_KO[outcome.reason]}`)
            }
            continue
          }
          result.evaluated += 1
          if (outcome.kind === 'unmeasured') {
            // **«정상»이 아니라 «못 쟀다»다.** 이 줄이 없으면 데이터가 끊긴 회사가 조용히 초록이 된다.
            result.notes.push(
              `${b.business_id} ${rule.rule_key}: ${UNMEASURED_REASON_KO[outcome.reason]}`,
            )
            continue
          }
          if (outcome.kind === 'clear') continue

          const key = `${b.business_id}\u0000${rule.rule_key}\u0000${outcome.period}`
          if (seen.has(key)) {
            result.deduped += 1
            continue
          }
          seen.add(key)

          const row = await createException({
            sb: input.sb,
            adapter: input.adapter,
            adapterError: input.adapterError,
            business: b,
            rule,
            period: outcome.period,
            value: outcome.value,
            threshold: outcome.threshold,
            kpis: input.financeKpis,
            finance,
            runDate: input.runDate,
            result,
          })
          if (row) created.push(row)
        }
      } catch (e) {
        const msg = errorText(e)
        console.error('[attention] company', b.business_id, msg)
        result.failures.set(b.business_id, `규칙 평가 실패: ${msg}`)
      }
    }),
  )

  result.headlines = selectAttentions({
    exceptions: [...existing, ...created],
    rules,
    businessNames: new Map(input.businesses.map((b) => [b.business_id, b.name])),
  })
  for (const note of result.notes) console.warn('[attention]', note)
  return result
}

/**
 * 예외 한 건을 만든다. **순서에 뜻이 있다** — 점수와 분석이 insert **앞**이다.
 *
 * `exceptions`의 update는 `can_approve()`(Chairman·BusinessCEO)이고 restrictive
 * `ai_agent_no_update`가 한 겹 더 막는다. 즉 **야간 Job은 자기가 넣은 줄을 나중에 고칠 수
 * 없다.** 그래서 등급도 분석도 넣는 그 순간에 함께 들어가야 한다. 0035가 "B-2가 level로
 * severity를 갱신한다"고 적은 그 갱신은 **update가 아니라 이 insert**다.
 */
async function createException(a: {
  sb: SupabaseClient
  adapter: AiAdapter | null
  adapterError?: string
  business: Business
  rule: ExceptionRule
  period: string
  value: number
  threshold: number
  kpis: FinanceKpi[]
  finance: FinanceBriefContext | null
  runDate: IsoDate
  result: AttentionStageResult
}): Promise<ExceptionRecord | null> {
  /**
   * 축 여섯 중 **오늘 출처가 있는 것은 하나뿐이다.** 나머지 다섯은 null이고
   * `unknown_axes`가 그 수를 센다 — 그럴듯한 값을 넣지 않고, **AI에게 물어서 채우지도
   * 않는다**(그것이 «지어낸 축이 RED를 만든다»는 바로 그 경로다).
   */
  const financial = financialImpactAxis({
    rule_key: a.rule.rule_key,
    rule_name: a.rule.name,
    comparator: a.rule.comparator ?? '',
    value: a.value,
    threshold: a.threshold,
  })
  const scored = attentionScore({ financial_impact: financial })

  /**
   * **등급이 없으면 규칙의 `severity_base`에 머문다.** 축이 모자라 점수를 못 낸 행을
   * 억지로 색칠하지 않는다 — 0035가 그 칸을 «출발점»이라 부른 이유가 이것이다.
   */
  const severity = scored.level ?? a.rule.severity_base

  /**
   * 두 칸을 **명시적으로** 넣는다. `not null default false`라 안 넣어도 들어가지만,
   * 그러면 "회장 액션 필요" 건수가 첫날부터 실제보다 **적다** — 이 저장소가 가장 나쁘다고
   * 거듭 못 박은 방향이다.
   *
   * · `chairman_action_required` = 등급이 RED인가. **§19의 정의 그대로다**
   *   (RED=Chairman decision · YELLOW=Chairman awareness · GREEN=CEO handles).
   *   새 판정을 만든 것이 아니라 이미 있는 등급을 읽은 것이고, 등급이 바뀌면 이 칸도 같이
   *   움직인다.
   * · `ceo_handling` = false. **출처가 없다.** 이 Job은 CEO가 대응 중인지 알 수 있는 표를
   *   하나도 읽지 못한다. false는 «CEO가 손 놓고 있다»가 아니라 «이 Job이 대응의 근거를
   *   찾지 못했다»이고, 그 차이는 화면이 적는다(B-3). 모델의 `ceo_response` 문장을 이 칸에
   *   옮기지 않는다 — 그것은 서술이지 판정이 아니고, 옮기는 순간 AI가 표의 값을 정하게 된다.
   */
  const chairman_action_required = severity === 'RED'
  const ceo_handling = false

  let ai_analysis: string | null = null
  if (a.adapter) {
    try {
      const analysis = await a.adapter.analyzeException({
        date: a.runDate,
        business: { business_id: a.business.business_id, name: a.business.name },
        rule: {
          rule_key: a.rule.rule_key,
          name: a.rule.name,
          comparator: a.rule.comparator ?? '',
          threshold: a.threshold,
          window_days: a.rule.window_days,
          value_means: VALUE_MEANS[a.rule.rule_key] ?? '규칙이 잰 값',
        },
        measured: { period: a.period, value: a.value },
        kpis: companyKpiLines(a.kpis, a.business.business_id),
        finance: a.finance,
      })
      ai_analysis = formatExceptionAnalysis(analysis)
    } catch (e) {
      // 분석이 없다고 감지를 버리지 않는다. 조용히 넘어가지도 않는다.
      console.error('[attention] analyze', a.business.business_id, a.rule.rule_key, errorText(e))
    }
  } else {
    console.warn('[attention] analyze skipped —', a.adapterError ?? 'AI 어댑터 없음')
  }
  if (ai_analysis === null) a.result.withoutAnalysis += 1

  const { data, error } = await a.sb
    .from('exceptions')
    .insert({
      business_id: a.business.business_id,
      rule_key: a.rule.rule_key,
      period: a.period,
      value: a.value,
      threshold: a.threshold,
      severity,
      ai_analysis,
      ceo_handling,
      chairman_action_required,
      // AIAgent가 넣는 줄은 언제나 'open'이다. 닫는 것도 관찰로 옮기는 것도 회장의 일이다.
      status: 'open',
    })
    .select(
      'id,business_id,rule_key,detected_at,period,value,threshold,severity,ai_analysis,ceo_handling,chairman_action_required,status,monitor_until',
    )
    .single<ExceptionRecord>()

  if (error) {
    // 23505 = 유니크 위반. **다른 틱이 먼저 넣은 것이고, 그것은 실패가 아니다.**
    if (error.code === '23505') {
      a.result.deduped += 1
      return null
    }
    throw new Error(`exceptions insert ${error.code ?? '?'}: ${error.message}`)
  }
  a.result.created += 1

  const { error: scoreError } = await a.sb.from('attention_scores').insert({
    exception_id: data.id,
    business_id: a.business.business_id,
    financial_impact: financial?.value ?? null,
    financial_impact_source: financial?.source ?? null,
    strategic_impact: null,
    strategic_impact_source: null,
    urgency: null,
    urgency_source: null,
    probability: null,
    probability_source: null,
    ceo_ability: null,
    ceo_ability_source: null,
    capital_requirement: null,
    capital_requirement_source: null,
    score: scored.score,
    level: scored.level,
    unknown_axes: scored.unknown_axes,
  })
  if (scoreError) {
    // 예외는 이미 남았다(기록이 먼저). 점수를 못 붙인 사실은 로그와 회사 행에 남긴다 —
    // 점수가 없는 예외는 «왜 그 색인가»를 설명하지 못할 뿐, 없던 일이 되지는 않는다.
    a.result.notes.push(
      `${a.business.business_id} ${a.rule.rule_key}: 점수 기록 실패 ${scoreError.code ?? '?'} — ${scoreError.message}`,
    )
  }
  return data
}

/**
 * 규칙마다 `value`가 무엇인지 한 줄. **표에 단위 칸이 없어서**(0035 2절) 모델에게 이것을
 * 말로 준다. 여기 없는 규칙은 «규칙이 잰 값»으로 나가고, 모델은 단위를 지어내지 않는다.
 */
const VALUE_MEANS: Record<string, string> = {
  revenue_variance: '직전 창 대비 매출 변동률(%). 오르는 것도 예외다',
  ebitda_margin_drop: '직전 창 대비 EBITDA 마진 변화(%p). 음수가 하락이다',
  cash_runway: '현금 런웨이(개월). 현금 ÷ 최근 3개월 평균 순소진',
}

/**
 * 모델에 넘길 그 회사의 최근 두 달치. `CompanyContext.kpis`와 **같은 모양이고 같은 변환**이다 —
 * 금액은 여기서 억 단위 문자열로 만든다(night-brief.ts와 같은 이유: 모델이 원 단위를
 * 나누다 틀리는 일을 없앤다).
 */
function companyKpiLines(kpis: FinanceKpi[], businessId: string) {
  const periods = [...new Set(kpis.filter((k) => k.business_id === businessId).map((k) => k.period))]
    .sort()
    .slice(-2)
  return kpis
    .filter((k) => k.business_id === businessId && periods.includes(k.period))
    .map((k) => ({
      metric: k.metric,
      period: k.period,
      value: formatEok(k.value),
      target: k.target === undefined ? null : formatEok(k.target),
    }))
}


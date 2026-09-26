import type { SupabaseClient } from '@supabase/supabase-js'

import type { AiAdapter } from '@/lib/ai/adapter'
import { formatEok } from '@/lib/format'
import { financeBriefContext, type FinanceBriefContext } from '@/lib/ledger/brief-context'
import { createSupabaseRepository, EXCEPTION_COLUMNS } from '@/lib/repository/supabase'
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
  readRunway,
  SKIP_REASON_KO,
  UNMEASURED_REASON_KO,
  type CompanyMeasurements,
  type UnmeasuredReason,
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
 *
 * ⑤ **규칙을 0행 받은 회차는 «조용한 밤»이 아니다.** 읽기가 42501로 터지는 길만 막으면
 *   부족하다 — `exception_rules_read`가 `is_active()`라서 **회수된 계정은 0행으로
 *   «성공»한다.** 그 회차를 그냥 돌게 두면 `evaluated = 0`으로 깨끗하게 끝나고, 그것은
 *   「13종이 전부 안 걸린 밤」과 **글자 하나 다르지 않은** 기록이 된다(규칙 읽기 아래의
 *   긴 주석이 그 자리다 — B-4가 찾았다).
 */

export interface AttentionStageResult {
  /**
   * **실제로 잰** (회사 × 규칙) 수 — `triggered` + `clear`.
   * **`unmeasured`를 여기 더하지 않는다.** 더하면 다섯 회사가 전부 «수치가 없어 못 쟀다»인
   * 밤과 다섯 회사가 전부 «재어 보니 멀쩡하다»인 밤이 **같은 숫자**로 기록되고, 그 둘은
   * 이 블록이 처음부터 가르려고 한 바로 그 두 사실이다.
   */
  evaluated: number
  /** **못 잰** (회사 × 규칙) 수. «정상»이 아니다. */
  unmeasured: number
  /** 못 잰 이유별 건수. 「수치가 없다」와 「원장을 못 읽었다」는 다른 고장이다. */
  unmeasuredReasons: Partial<Record<UnmeasuredReason, number>>
  /** 이번 회차가 실제로 만든 예외 수. */
  created: number
  /** 이미 있어서 건너뛴 수(조회 + 유니크 제약에 걸린 것). */
  deduped: number
  /** 분석을 못 받아 `ai_analysis`가 null로 들어간 수. */
  withoutAnalysis: number
  /** 브리핑 맨 위에 설 3~5건. 열린 예외 **전부**에서 고른다 — 오늘 만든 것만이 아니다. */
  headlines: AttentionHeadline[]
  /**
   * 회사별 **실패** — 평가가 터졌거나 예외를 기록하지 못했다. 야간 Job이 그 회사의 행
   * 맨 위에 남긴다. 규칙 하나가 터져도 그 회사의 나머지 규칙은 계속 돈다.
   */
  failures: Map<string, string[]>
  /**
   * 회사별 **경고** — 실패는 아니지만 «조용히 넘어가면 그 회사가 멀쩡해 보이는» 것들.
   * 이것이 없으면 데이터가 끊긴 회사가 그냥 조용한 회사로 읽힌다 — 그 회사의 브리핑은
   * KPI가 비어 있어도 성공하기 때문이다.
   *
   * **`kind`가 있는 이유**: 회사 행에는 둘 다 올라가지만 **그룹 요약에 가는 것은
   * `unmeasured`뿐**이다. «재지 못했다»는 회장이 06:00에 알아야 하는 사실이고,
   * «점수를 못 붙였다»는 이 저장소가 고칠 내부 사정이다. 목록을 두 벌로 두는 대신
   * 한 벌에 꼬리표를 붙였다 — 두 벌이 되면 언젠가 한쪽만 채워진다.
   */
  warnings: Map<string, StageWarning[]>
  /** 단계 전체가 못 돈 이유(규칙을 못 읽었다 등). 회사별 실패와 다르다. */
  error?: string
  /** 위의 것들을 사람이 읽는 한 줄로 모은 것. 감사 줄과 서버 로그가 같이 쓴다. */
  notes: string[]
}

/**
 * 경고 한 줄. `kind`가 «어디까지 가는가»를 정한다 —
 * `unmeasured`는 회사 행 **과** 그룹 요약(=회장의 06:00 카톡)까지,
 * `score_not_recorded`는 회사 행까지.
 */
export interface StageWarning {
  kind: 'unmeasured' | 'score_not_recorded'
  text: string
}

function errorText(e: unknown): string {
  return (e instanceof Error ? e.message : String(e)).slice(0, 500)
}

/**
 * 0035 4절의 중복 방지 제약 이름. **이 글자가 0035와 같아야 한다** —
 * 달라지면 아래의 23505 판정이 «모르는 실패»로 떨어지고, 그것은 시끄러운 쪽이라 맞다
 * (반대로 이름 없이 23505만 보면 다른 제약의 위반이 조용히 «중복»이 된다).
 */
const DEDUPE_CONSTRAINT = 'exceptions_dedupe_unique'

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
    unmeasured: 0,
    unmeasuredReasons: {},
    created: 0,
    deduped: 0,
    withoutAnalysis: 0,
    headlines: [],
    failures: new Map(),
    warnings: new Map(),
    notes: [],
  }
  const fail = (businessId: string, text: string) => {
    result.failures.set(businessId, [...(result.failures.get(businessId) ?? []), text])
    result.notes.push(`${businessId}: ${text}`)
  }
  const warn = (businessId: string, w: StageWarning) => {
    result.warnings.set(businessId, [...(result.warnings.get(businessId) ?? []), w])
    result.notes.push(`${businessId}: ${w.text}`)
  }

  /**
   * 읽기는 **화면과 같은 repository**로 한다(night-brief.ts와 같은 규율). 그 어댑터의
   * `listExceptions()`가 `fetchAll`로 끝까지 읽는다 — 한 번의 select는 서버 상한에서
   * 조용히 잘리고, 잘린 쪽에 있는 예외는 중복 방지 조회에서 «없는 것»이 되어 같은 사실이
   * 두 번 올라간다. 쓰기만 `sb`로 한다(계약에 쓰기 함수가 없다 — 예외를 만드는 것은
   * 화면이 아니라 이 Job이다).
   *
   * 못 읽으면 단계 전체가 못 돈다 — **조용히 0건으로 끝내지 않는다.**
   */
  const repo = createSupabaseRepository(input.sb)

  let rules: ExceptionRule[]
  let existing: ExceptionRecord[]
  try {
    ;[rules, existing] = await Promise.all([repo.listExceptionRules(), repo.listExceptions()])
  } catch (e) {
    result.error = `규칙·예외 읽기 실패: ${errorText(e)}`
    return result
  }
  /**
   * ■ 규칙을 **0행** 받은 회차 — 42501이 아니라 «조용한 0» ■ (B-4가 찾은 결함)
   *
   * `exception_rules_read`는 `is_active()`다. 그래서 야간 Job 계정에 `revoked_at`이 찍히면
   * 읽기는 **거부되지 않고 0행으로 성공한다** — 위의 try는 통과하고, 아래 루프는 규칙이
   * 없어 아무것도 돌지 않고, 단계는 `error` 없이 `evaluated = 0`으로 깨끗하게 끝난다.
   * 그 결과 **「규칙 13종이 전부 안 걸린 조용한 밤」과 「아무것도 읽지 못한 밤」이 같은
   * 브리핑·같은 감사 줄**이 된다. 이 저장소가 가장 나쁘다고 못 박은 방향의 거짓이고
   * (B-2의 Important 2와 같은 부류), 조용하기 때문에 아무도 다시 세지 않는다.
   *
   * **구분할 수 있는 만큼만 구분한다.** 이 자리에서 쓸 수 있는 신호가 하나 있다 —
   * `input.businesses`는 `businesses_read`(= `has_business()`, 0002:226)를 통과해서 온
   * 목록이고 그 함수는 `is_active()`를 **먼저** 본다. 즉 회사가 한 곳이라도 실려 왔다면
   * 이 세션은 **활성이다**(회수된 계정은 회사도 0행이다). 그러면 규칙 0행은 «못 읽었다»가
   * 아니라 **규칙 표가 실제로 비어 있다**(0035 미적용 등)는 뜻이다. 회사까지 0행이면
   * 둘을 가를 신호가 없고, 그때는 **모르는 것을 아는 것처럼 적지 않는다** —
   * «읽지 못했을 수 있다»고 말한다.
   *
   * 남기는 자리도 둘이다. `error`는 감사 줄과 그룹 행 맨 위로 가고(night-brief.ts),
   * 회사마다 `unmeasured` 경고를 하나 남겨 **그 회사 행과 06:00 요약**까지 닿게 한다 —
   * `error`만 두면 회사 행에는 아무 흔적이 없어 회사별 브리핑이 여전히 «조용한 밤»이다.
   */
  if (rules.length === 0) {
    const sessionProvenActive = input.businesses.length > 0
    const why = sessionProvenActive
      ? '회사 목록은 읽혔으므로 이 세션은 활성이다 — 규칙 표가 실제로 비어 있다(0035 미적용일 수 있다)'
      : '회사 목록도 0행이라 «표가 비었다»와 «이 계정이 회수되어 읽지 못했다»를 가를 수 없다 — 규칙을 읽지 못했을 수 있다'
    result.error = `규칙을 0행 받았다: ${why}. 이 회차는 규칙을 하나도 재지 못했다 — «예외 없음»이 아니다`
    for (const b of input.businesses) {
      warn(b.business_id, {
        kind: 'unmeasured',
        text: `규칙을 0행 받아 이 회사의 규칙을 하나도 재지 못했다 — ${why}`,
      })
    }
    return result
  }

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
          if (outcome.kind === 'unmeasured') {
            /**
             * **«정상»이 아니라 «못 쟀다»다 — 그리고 그 사실이 여기서 끝나면 안 된다.**
             * 이 회사의 브리핑은 KPI가 비어 있어도 성공하고, 예외가 0건이니 맨 위에도 안
             * 오른다. 경고로 올리지 않으면 데이터가 끊긴 회사가 **그냥 조용한 회사**로 읽힌다.
             */
            result.unmeasured += 1
            result.unmeasuredReasons[outcome.reason] =
              (result.unmeasuredReasons[outcome.reason] ?? 0) + 1
            warn(b.business_id, {
              kind: 'unmeasured',
              text: `${rule.name}(${rule.rule_key}) — ${UNMEASURED_REASON_KO[outcome.reason]}`,
            })
            continue
          }
          result.evaluated += 1
          if (outcome.kind === 'clear') continue

          const key = `${b.business_id}\u0000${rule.rule_key}\u0000${outcome.period}`
          if (seen.has(key)) {
            result.deduped += 1
            continue
          }
          seen.add(key)

          /**
           * **규칙 하나가 터져도 그 회사의 다음 규칙은 돈다.** 이 try가 없으면 현금 규칙의
           * insert가 실패한 회사에서 매출·마진 규칙이 아예 평가되지 않고, 그 회사 행에는
           * "규칙 평가 실패"라고만 남아 **평가 자체가 고장 난 것처럼** 읽힌다 — 실제로 고장
           * 난 것은 기록 한 건이다. 회사 격리와 같은 이유를 한 겹 안쪽에 둔 것이다.
           */
          try {
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
              warn,
            })
            if (row) created.push(row)
          } catch (e) {
            const msg = errorText(e)
            console.error('[attention] exception', b.business_id, rule.rule_key, msg)
            fail(b.business_id, `${rule.name}(${rule.rule_key}) 예외 기록 실패 — ${msg}`)
          }
        }
      } catch (e) {
        // 여기까지 오는 것은 «그 회사를 평가하는 일» 자체가 터진 것이다(수치 읽기·원장 해석).
        const msg = errorText(e)
        console.error('[attention] company', b.business_id, msg)
        fail(b.business_id, `규칙 평가 실패 — ${msg}`)
      }
    }),
  )

  result.headlines = selectAttentions({
    exceptions: [...existing, ...created],
    rules,
    businessNames: new Map(input.businesses.map((b) => [b.business_id, b.name])),
  })
  // 로그에도 남긴다 — 다만 **이제 로그가 유일한 자리가 아니다.** 같은 사실이
  // `failures`/`warnings`로 회사 행에, 건수로 감사 줄에 올라간다.
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
  /** 그 회사의 «경고»에 한 줄 남긴다. 단계가 회사별로 모아 야간 Job에 돌려준다. */
  warn: (businessId: string, w: StageWarning) => void
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
    // 칸 목록이 두 벌이 되지 않게 어댑터의 것을 가져다 쓴다.
    // `returning`에도 SELECT 정책이 걸리고, 그 갈래를 0035 7절이 열어 두었다.
    .select(EXCEPTION_COLUMNS)
    .single<ExceptionRecord>()

  if (error) {
    /**
     * 23505 = 유니크 위반. **다른 틱이 먼저 넣은 것이고, 그것은 실패가 아니다.**
     *
     * 다만 «23505면 중복»이라고 읽지 않는다 — 이 표에는 유니크가 **둘**이고
     * (`exceptions_dedupe_unique`와 `exceptions_id_business_unique`), 뒤의 것은 identity
     * `id` 위에 있어 오늘은 사람 손으로도 부딪히기 어렵다. 그 «어렵다»에 기대면, 앞으로
     * 유니크가 하나 더 붙는 날 **진짜 고장이 조용히 «중복»으로 세어진다.**
     * 그래서 제약 이름을 확인한다. 이름이 안 실려 오거나 다른 제약이면 그대로 올린다 —
     * 모르는 실패를 아는 실패인 척하지 않는다.
     */
    const detail = `${error.message} ${error.details ?? ''}`
    if (error.code === '23505' && detail.includes(DEDUPE_CONSTRAINT)) {
      a.result.deduped += 1
      return null
    }
    throw new Error(`exceptions insert ${error.code ?? '?'}: ${error.message}`)
  }
  a.result.created += 1
  // **만들어진** 예외 가운데 분석이 없는 것을 센다(중복으로 건너뛴 건은 세지 않는다).
  if (ai_analysis === null) a.result.withoutAnalysis += 1

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
    // 예외는 이미 남았다(기록이 먼저). 점수를 못 붙인 사실은 **그 회사의 행에** 남긴다 —
    // 점수가 없는 예외는 «왜 그 색인가»와 «여섯 축 중 몇이 비었나»를 설명하지 못하는
    // 예외이고, 그것을 console에만 적으면 아무도 다시 붙이지 않는다.
    a.warn(a.business.business_id, {
      // **그룹 요약에는 가지 않는다.** 이것은 회장이 아침에 알아야 할 사실이 아니라
      // 이 저장소가 고칠 내부 사정이다 — 예외 자체는 이미 남았다.
      kind: 'score_not_recorded',
      text: `${a.rule.name}(${a.rule.rule_key}) 점수 기록 실패 ${scoreError.code ?? '?'} — ${scoreError.message}`,
    })
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


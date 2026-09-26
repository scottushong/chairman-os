/**
 * 주의(ATTENTION) 화면이 읽을 한 벌로 접는 곳 — Phase 7 블록 B-3.
 *
 * **화면은 숫자를 읽는 자리에서 계산하지 않는다**(HANDOVER §1). 대시보드 카드와
 * `/attention`이 각자 접으면 같은 회사가 한 화면에서는 «정상»이고 다른 화면에서는
 * «재지 못함»이 되고, 그러면 회장은 둘 다 안 믿는다. 그래서 접는 자리는 이 파일 하나다
 * (`lib/dependency.ts`의 `summarizeDependency()`가 블록 A에서 같은 자리였다).
 *
 * ■ 이 파일이 막는 거짓 셋 ■ 세 가지가 전부 «없는 것»과 «모르는 것»을 가르는 일이다.
 *
 *   ① **못 보는 것을 없는 것으로 그리지 않는다.** `exceptions_read`가
 *      `has_business() and (can_read_restricted() or 쓰는 사람)`이라 **TeamLead·Member에게는
 *      0행**이다(0035 7절). 그들에게 «주의 0건»·«전 회사 정상»이라고 적으면 화면이 거짓을
 *      말한다. `readable`이 그 갈림이고, false면 이 파일은 **건수를 하나도 내지 않는다** —
 *      정상도 재지 못함도 셀 수 없다(그 판정의 재료인 `finance_kpis`도 같은 등급 뒤에 있다).
 *
 *   ② **재지 못한 회사를 «정상»에 넣지 않는다.** §4의 `"N companies operating normally"`
 *      한 줄이 정확히 이 함정 위에 서 있다. B-2가 `unmeasured`를 `failed`와 별개 칸으로
 *      만들어 06:00 브리핑까지 밀어 넣었고, 화면에서 그것을 다시 뭉개면 그 작업이 무의미해진다.
 *      **판정은 야간 Job과 같은 함수로 한다** — `evaluateRules()`에 그 회사의 수치를 넣어
 *      «쟀나 / 못 쟀나»를 되묻는다. 새 식을 만들지 않았고, 만들면 화면의 M과 브리핑의 M이
 *      달라진다.
 *
 *   ③ **등급 옆에는 언제나 `unknown_axes`가 있다.** `MIN_AXES_FOR_LEVEL = 3`이고 축 셋이
 *      닿는 가중치는 100 중 45다. 그 둘을 떼면 45의 근거가 100의 근거인 척한다
 *      (`score.ts`가 B-3에게 남긴 요구). 이 파일의 `scoreNote()`가 **그 둘을 한 문자열로
 *      묶어** 돌려준다 — 화면이 등급만 꺼내 쓸 수 있는 칸을 주지 않는 것이 그 방법이다.
 *      `level`이 null이면 «등급 미산출»이다. **«GREEN»이 아니다.**
 *
 * ■ 이 파일이 하지 않는 것 ■ 점수·등급·축 수를 **다시 계산하지 않는다.** `attention_scores`가
 *   들고 있는 값을 읽어 문장으로 만들 뿐이고, 색은 `exceptions.severity` 하나에서 온다
 *   (0035가 그 순서를 못 박았다). «맨 위 몇 건»의 순서도 새로 정하지 않고 브리핑이 쓰는
 *   `selectAttentions()`를 그대로 부른다 — 회장이 06:00 카톡에서 본 순서와 화면의 순서가
 *   같아야 한다.
 */
import type {
  AttentionScore,
  Business,
  ExceptionRecord,
  ExceptionRule,
  ExceptionStatus,
  FinanceKpi,
  FinanceLedger,
  Role,
} from '@/types'
import { ATTENTION_LEVEL_LABEL_KO, LEVEL_EMPTY_KO } from '@/types'

import { describeMeasured, selectAttentions, ATTENTION_BRIEF_MAX } from './brief'
import {
  evaluateRules,
  readRunway,
  SKIP_REASON_KO,
  UNMEASURED_REASON_KO,
  type CompanyMeasurements,
} from './rules'

/* ------------------------------------------------------------------ 누가 예외를 볼 수 있나 */

/**
 * 0035 `exceptions_read`가 실제로 통과시키는 역할 다섯. **이것은 권한 판정이 아니다** —
 * 판정은 DB가 하고 못 보는 사람에게는 0행이 온다. 화면이 이 목록을 읽는 이유는 단 하나,
 * **«왜 0행인가»를 적기 위해서**다. 0행에 «주의 없음»이라고 쓸지 «권한 밖이라 집계되지
 * 않는다»라고 쓸지가 그 차이고, 블록 A가 `interventions`에서 같은 이유로 같은 일을 한다
 * (`/dependency`의 `canSeeInterventions`).
 *
 * 여기서 거르면 안 되는 것: 화면은 이 값으로 목록을 **필터하지 않는다.** 필터는 RLS다.
 */
export const EXCEPTION_READER_ROLES: readonly Role[] = [
  'Chairman',
  'GroupCFO',
  'BusinessCEO',
  'Executive',
  'AIAgent',
]

export function canReadExceptions(role: Role | null | undefined): boolean {
  return role !== null && role !== undefined && EXCEPTION_READER_ROLES.includes(role)
}

/* ------------------------------------------------------------------ 한 줄 */

/** 목록·카드가 그리는 예외 한 줄. **여기 있는 것 말고는 화면이 더 계산하지 않는다.** */
export interface AttentionRow {
  exception: ExceptionRecord
  business_name: string
  /** 규칙 사전의 그 줄. 못 찾으면 null — 그때 화면은 `rule_key`를 그대로 적는다. */
  rule: ExceptionRule | null
  rule_name: string
  /** 잰 값과 임계를 사람이 읽는 한 줄. 수동 규칙이면 null이다(0으로 적지 않는다). */
  measured: string | null
  /** 점수 한 줄. **없을 수 있다**(0035: 예외 하나에 한 줄이고 아직 안 매겨진 예외에는 없다). */
  score: AttentionScore | null
  /**
   * 등급과 빈 축을 **한 문자열로** 묶은 것. 화면이 등급만 꺼내 쓸 수 없게 하는 장치다.
   * 이 칸이 이 파일의 ③이고, `null`이 될 수 없다 — 언제나 무슨 말이든 한다.
   */
  scoreNote: string
  /** 같은 회사·같은 규칙의 **지난** 건(기간이 다른 것). 최신순. 0건일 수 있다. */
  history: ExceptionRecord[]
}

/** 재지 못한 회사 한 곳과 **그 이유**. 이유 없이는 세지 않는다. */
export interface UnmeasuredCompany {
  business_id: string
  name: string
  reasons: string[]
}

export interface AttentionView {
  /**
   * 이 계정이 예외를 읽을 수 있는 집합 안인가. **false면 아래 건수는 전부 비어 있고,
   * 화면은 건수 대신 «열람 권한이 있는 계정에서만 집계됩니다»를 적는다.**
   */
  readable: boolean
  /** 카드 맨 위의 RED/YELLOW 최대 다섯 건. GREEN은 §4대로 숨긴다. */
  top: AttentionRow[]
  /** 열린 예외 전부(등급 무관). 카드가 «다섯 건만 보이고 있다»를 말할 때 쓴다. */
  openCount: number
  /** §4대로 **숨긴** GREEN 열린 건수. 숨긴 것을 «없는 것»으로 그리지 않는다. */
  hiddenGreen: number
  /** 지금 주의가 걸린 회사 수(열린 RED/YELLOW가 있는 회사). */
  attentionCompanies: string[]
  /** **정상** — 재어 봤고 열린 RED/YELLOW가 없는 회사. */
  normal: { business_id: string; name: string }[]
  /** **재지 못한** 회사. «정상»과 한 칸에 담지 않는다. */
  unmeasured: UnmeasuredCompany[]
}

/* ------------------------------------------------------------------ 등급 한 줄 (③) */

/**
 * **등급과 빈 축을 떼어 놓을 수 없게 만드는 함수.** 화면의 어느 자리에서도 이 문장을 통해서만
 * 등급이 나온다.
 *
 * 세 갈래다:
 *   · 점수 줄이 없다      → «점수 기록 없음» (GREEN이 아니다)
 *   · `level`이 null      → «등급 미산출 — 여섯 축 중 N개 없음» (GREEN이 아니다)
 *   · `level`이 있다      → «RED 74.5점 · 여섯 축 중 3개 없음»
 *
 * `score`와 `level`은 0035의 check가 «둘 다 있거나 둘 다 없다»로 묶어 두었으므로
 * 여기서 한쪽만 있는 경우를 상상하지 않는다.
 */
export function scoreNote(score: AttentionScore | null): string {
  if (!score) {
    return `점수 기록 없음 — 여섯 축을 아직 아무것도 재지 않았습니다 (${LEVEL_EMPTY_KO})`
  }
  const axes = `여섯 축 중 ${score.unknown_axes}개 없음`
  if (score.level === null) return `등급 미산출 — ${axes}`
  return `${score.level}(${ATTENTION_LEVEL_LABEL_KO[score.level]}) ${score.score}점 · ${axes}`
}

/* ------------------------------------------------------------------ 접기 */

export function summarizeAttention(input: {
  businesses: Business[]
  exceptions: ExceptionRecord[]
  rules: ExceptionRule[]
  scores: AttentionScore[]
  financeKpis: FinanceKpi[]
  ledger: FinanceLedger | null
  /** 세션의 역할. 없으면(로그인 전) 읽기 집합 밖으로 본다. */
  role: Role | null | undefined
  /** 카드가 세울 최대 건수. 기본은 브리핑과 **같은 다섯**이다. */
  limit?: number
}): AttentionView {
  const readable = canReadExceptions(input.role)
  const nameOf = new Map(input.businesses.map((b) => [b.business_id, b.name]))
  const ruleOf = new Map(input.rules.map((r) => [r.rule_key, r]))
  const scoreOf = new Map(input.scores.map((s) => [s.exception_id, s]))

  const row = (e: ExceptionRecord): AttentionRow =>
    buildRow(e, { exceptions: input.exceptions, nameOf, ruleOf, scoreOf })

  const open = input.exceptions.filter((e) => e.status === 'open')
  const attention = open.filter((e) => e.severity !== 'GREEN')

  /**
   * 맨 위 다섯. **고르는 규칙을 새로 만들지 않는다** — 브리핑이 쓰는 `selectAttentions()`를
   * 그대로 부른다(RED → YELLOW → 회장 액션 필요 → 최근 감지 → 이름). 회장이 06:00 카톡에서
   * 본 순서와 이 카드의 순서가 어긋나면 «맨 위»가 두 뜻을 갖는다.
   *
   * 그 함수는 화면용 한 줄(`AttentionHeadline`)을 돌려주고 예외의 `id`를 들고 있지 않다 —
   * 그래서 (회사·규칙·기간)으로 되찾는다. **그 셋이 0035의 unique라 정확히 한 건**이고,
   * 되찾는 대신 정렬을 이 파일에 한 번 더 쓰는 쪽이 두 벌을 만드는 길이다.
   */
  const ordered = selectAttentions({
    exceptions: attention,
    rules: input.rules,
    businessNames: nameOf,
    limit: input.limit ?? ATTENTION_BRIEF_MAX,
  })
  const top = ordered
    .map((h) =>
      attention.find(
        (e) =>
          e.business_id === h.business_id &&
          e.rule_key === h.rule_key &&
          (e.period ?? null) === (h.period ?? null),
      ),
    )
    .filter((e): e is ExceptionRecord => e !== undefined)
    .map(row)

  const attentionCompanies = [...new Set(attention.map((e) => e.business_id))]

  /**
   * ② **정상과 «재지 못함»을 가른다.** 판정은 야간 Job과 같은 `evaluateRules()`로 한다.
   *
   * · 열린 RED/YELLOW가 있으면 주의 목록에 있는 회사다 — 어느 칸에도 세지 않는다.
   * · 하나라도 «못 쟀다»가 있으면 **재지 못한 회사**다. B-2의 그룹 요약이 같은 기준이고
   *   (경고 하나라도 있으면 그 회사를 06:00 요약에 올린다), 여기서 기준을 바꾸면 화면과
   *   카톡이 다른 숫자를 말한다.
   * · 잰 것이 하나도 없으면(수동 규칙만 켜져 있는 회사) 그것도 «정상»이 아니다 —
   *   잰 것이 없는데 멀쩡하다고 말할 근거가 없다.
   *
   * **`readable`이 false면 여기에 들어오지 않는다.** 그 계정은 `finance_kpis`도 못 읽어서
   * 모든 회사가 «재지 못함»으로 나오고, 그 M은 회사의 사실이 아니라 권한의 그림자다.
   */
  const normal: { business_id: string; name: string }[] = []
  const unmeasured: UnmeasuredCompany[] = []
  if (readable) {
    for (const b of input.businesses) {
      if (attentionCompanies.includes(b.business_id)) continue
      const name = b.name
      const m: CompanyMeasurements = {
        business_id: b.business_id,
        kpis: input.financeKpis
          .filter((k) => k.business_id === b.business_id)
          .map((k) => ({ metric: k.metric, period: k.period, value: k.value })),
        runway: readRunway(input.ledger, b.business_id),
      }
      const outcomes = evaluateRules(input.rules, m)
      const reasons = outcomes
        .filter((o) => o.outcome.kind === 'unmeasured')
        .map(
          (o) =>
            `${o.rule.name} — ${
              UNMEASURED_REASON_KO[
                (o.outcome as { kind: 'unmeasured'; reason: keyof typeof UNMEASURED_REASON_KO })
                  .reason
              ]
            }`,
        )
      const measured = outcomes.filter(
        (o) => o.outcome.kind === 'triggered' || o.outcome.kind === 'clear',
      ).length
      if (reasons.length > 0) {
        unmeasured.push({ business_id: b.business_id, name, reasons })
      } else if (measured === 0) {
        unmeasured.push({
          business_id: b.business_id,
          name,
          reasons: [
            `이 회사에 잴 수 있는 규칙이 하나도 없습니다 — ${SKIP_REASON_KO.no_measurement}`,
          ],
        })
      } else {
        normal.push({ business_id: b.business_id, name })
      }
    }
  }

  return {
    readable,
    top,
    openCount: open.length,
    hiddenGreen: open.filter((e) => e.severity === 'GREEN').length,
    attentionCompanies,
    normal,
    unmeasured,
  }
}

/* ------------------------------------------------------------------ 목록 필터 (URL) */

/** `/attention`의 탭. 0035의 `status` 셋 그대로다. */
export interface AttentionFilter {
  status?: ExceptionStatus
  rule?: string
  biz?: string
}

/**
 * 목록을 거른다. **순서는 최신순 하나다** — 카드의 «맨 위 다섯»은 등급 순이고 이 목록은
 * 감지 순이다. 두 화면이 답하는 질문이 다르다(«오늘 무엇을 볼 것인가» ↔ «무엇이 있었나»).
 */
export function filterExceptions(rows: AttentionRow[], f: AttentionFilter): AttentionRow[] {
  return rows
    .filter((r) => (f.status ? r.exception.status === f.status : true))
    .filter((r) => (f.rule ? r.exception.rule_key === f.rule : true))
    .filter((r) => (f.biz ? r.exception.business_id === f.biz : true))
    .sort((a, b) => b.exception.detected_at.localeCompare(a.exception.detected_at))
}

/**
 * 목록 화면이 그릴 모든 줄. **줄을 만드는 코드는 카드와 한 벌이다**(`buildRow`) —
 * 두 벌이 되면 같은 예외가 카드에서는 «등급 미산출»이고 목록에서는 «GREEN»이 되는 날이 온다.
 */
export function attentionRows(input: {
  businesses: Business[]
  exceptions: ExceptionRecord[]
  rules: ExceptionRule[]
  scores: AttentionScore[]
}): AttentionRow[] {
  const nameOf = new Map(input.businesses.map((b) => [b.business_id, b.name]))
  const ruleOf = new Map(input.rules.map((r) => [r.rule_key, r]))
  const scoreOf = new Map(input.scores.map((sc) => [sc.exception_id, sc]))
  return input.exceptions.map((e) =>
    buildRow(e, { exceptions: input.exceptions, nameOf, ruleOf, scoreOf }),
  )
}

/** 줄 하나. 카드와 목록이 **이 함수 하나**를 쓴다. */
function buildRow(
  e: ExceptionRecord,
  ctx: {
    exceptions: ExceptionRecord[]
    nameOf: Map<string, string>
    ruleOf: Map<string, ExceptionRule>
    scoreOf: Map<number, AttentionScore>
  },
): AttentionRow {
  const rule = ctx.ruleOf.get(e.rule_key) ?? null
  const score = ctx.scoreOf.get(e.id) ?? null
  return {
    exception: e,
    business_name: ctx.nameOf.get(e.business_id) ?? e.business_id,
    rule,
    rule_name: rule?.name ?? e.rule_key,
    measured: describeMeasured(e),
    score,
    scoreNote: scoreNote(score),
    // **지난 건**이다 — 같은 회사·같은 규칙이고 자기 자신은 아니다. (회사·규칙·기간)이
    // 유일하므로(0035) «지난 건»은 곧 «다른 기간의 건»이다.
    history: ctx.exceptions
      .filter((h) => h.business_id === e.business_id && h.rule_key === e.rule_key && h.id !== e.id)
      .sort((a, b) => b.detected_at.localeCompare(a.detected_at)),
  }
}

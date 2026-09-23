/**
 * 예외를 «보여 주는» 쪽 — Phase 7 블록 B-2. 브리핑 맨 위의 주의 3~5건과
 * `exceptions.ai_analysis`에 들어갈 문장이 여기서 만들어진다.
 *
 * 여기도 순수 함수만 있다. 고르는 규칙이 DB 안에 있으면 "왜 이 다섯이 뽑혔나"를
 * 검사가 잴 수 없다.
 */
import type { AttentionBriefLine, ExceptionAnalysis } from '@/lib/ai/adapter'
// KST 날짜는 이 저장소에 이미 한 벌 있다(`night-brief.ts`의 `kstDate`가 같은 두 줄이다).
// 저쪽을 부르면 `night-brief → brief → night-brief`로 도는 import가 되어 이쪽을 쓴다.
import { kstToday } from '@/lib/chairman-project'
import {
  levelRank,
  type AiBriefItem,
  type AttentionHeadline,
  type AttentionLevel,
  type ExceptionRecord,
  type ExceptionRule,
} from '@/types'

/* ------------------------------------------------------------------ 단위 */

/**
 * 규칙별 단위. **`exception_rules`에 단위 칸이 없다**(0035 2절이 그 이유와 대가를 적었고,
 * 칸을 더할지는 B-3에 남겼다). 화면 라벨이 아니라 브리핑 문장에 쓸 최소한의 꼬리표라
 * 여기 둔다 — 여기 없는 규칙은 단위 없이 숫자만 적는다. **지어낸 단위를 붙이지 않는다.**
 */
export const RULE_UNIT: Record<string, string> = {
  revenue_variance: '%',
  ebitda_margin_drop: '%p',
  cash_runway: '개월',
}

/** 잰 값과 임계를 사람이 읽는 한 줄. 잰 값이 없으면(수동 규칙) null이다 — 0으로 적지 않는다. */
export function describeMeasured(e: {
  rule_key: string
  value: number | null
  threshold: number | null
}): string | null {
  if (e.value === null || e.threshold === null) return null
  const unit = RULE_UNIT[e.rule_key] ?? ''
  return `잰 값 ${e.value}${unit} · 임계 ${e.threshold}${unit}`
}

/* ------------------------------------------------------------------ 3~5건 고르기 */

/**
 * 브리핑 맨 위에 올릴 최대 건수. 원문: "기존 브리핑은 attention 3~5건을 맨 위에".
 *
 * **3은 하한이 아니라 «있으면 3~5»다.** 열린 예외가 둘뿐인 날 셋째 줄을 채우려고 GREEN을
 * 끌어올리거나 지난 건을 다시 올리지 않는다 — 없는 것을 채우는 순간 회장은 그 자리를
 * 안 믿게 되고, 그것이 요구사항서 2번이 막는 모양이다.
 */
export const ATTENTION_BRIEF_MAX = 5

/**
 * 고르는 규칙 — **이 셋이고 순서도 이 순서다.**
 *
 * ① `status='open'`만 본다. **'관찰 중'은 올리지 않는다** — 회장이 그 건을 보고 "지금은
 *    두고 본다"고 **정한** 것이고, 다음 날 아침 맨 위에 다시 세우면 그 결정이 되돌려진다.
 *    'closed'도 마찬가지다. 둘 다 /attention 목록에는 그대로 있다.
 * ② RED → YELLOW → GREEN(§19의 «누가 손대는가»). 같은 등급이면 «회장 액션 필요»가 먼저다.
 * ③ 그래도 같으면 **최근에 감지된 것**부터. 마지막으로 회사·규칙 이름으로 못을 박는다 —
 *    같은 초에 들어온 두 건의 순서가 실행마다 달라지면 «맨 위»가 매일 흔들린다.
 */
export function selectAttentions(input: {
  exceptions: ExceptionRecord[]
  rules: ExceptionRule[]
  businessNames: Map<string, string>
  limit?: number
}): AttentionHeadline[] {
  const ruleName = new Map(input.rules.map((r) => [r.rule_key, r.name]))
  return input.exceptions
    .filter((e) => e.status === 'open')
    .map((e) => ({
      business_id: e.business_id,
      business_name: input.businessNames.get(e.business_id) ?? e.business_id,
      rule_key: e.rule_key,
      rule_name: ruleName.get(e.rule_key) ?? e.rule_key,
      severity: e.severity,
      chairman_action_required: e.chairman_action_required,
      value: e.value,
      threshold: e.threshold,
      period: e.period,
      // **KST로 접는다.** `detected_at`은 timestamptz라 연결 시간대(Supabase에서는 UTC)로
      // 실려 오고, 앞 열 글자를 자르면 그것은 **UTC 날짜**다. 이 Job은 회장 현지 06:00을
      // 맞추려고 매시 깨어나고(0029) KST 00:00~09:00에 도는 회차가 예외가 아니라 보통이라,
      // 자른 값은 그 창에서 **하루 전**으로 찍힌다. 이 값은 회장에게 그대로 그려지고
      // (attentionItems) 같은 등급끼리의 **정렬 키**이기도 해서 순서까지 흔든다.
      // 이 저장소의 '오늘'은 KST 하나다(0019 3절 · night-brief.ts kstDate).
      detected_on: kstToday(new Date(e.detected_at)),
    }))
    .sort(
      (a, b) =>
        levelRank(b.severity) - levelRank(a.severity) ||
        Number(b.chairman_action_required) - Number(a.chairman_action_required) ||
        b.detected_on.localeCompare(a.detected_on) ||
        a.business_name.localeCompare(b.business_name) ||
        a.rule_key.localeCompare(b.rule_key),
    )
    .slice(0, input.limit ?? ATTENTION_BRIEF_MAX)
}

/** 모델에 넘길 모양. 요약이 맨 위의 목록과 어긋나지 않게 같이 넘긴다. */
export function attentionBriefLines(headlines: AttentionHeadline[]): AttentionBriefLine[] {
  return headlines.map((h) => ({
    business_name: h.business_name,
    rule_name: h.rule_name,
    level: h.severity,
    measured: describeMeasured(h),
    chairman_action_required: h.chairman_action_required,
  }))
}

/**
 * §19의 등급을 브리핑 항목의 severity로 옮긴다. **두 축이 다르다는 것을 알고 옮기는 것이다** —
 * `AiBriefItem.severity`는 0001의 '얼마나 나쁜가'이고 `attention_level`은 '누가 손대는가'다.
 * 브리핑 항목에는 색이 셋뿐이라 옮길 자리가 여기밖에 없고, 그래서 **글자로도 같이 적는다**
 * (detail의 «회장 결정/회장 인지/CEO 처리»). 옮기기만 하고 적지 않으면 두 뜻이 섞인다.
 */
const ITEM_SEVERITY: Record<AttentionLevel, AiBriefItem['severity']> = {
  RED: 'critical',
  YELLOW: 'warning',
  GREEN: 'info',
}

const LEVEL_KO: Record<AttentionLevel, string> = {
  RED: '회장 결정',
  YELLOW: '회장 인지',
  GREEN: 'CEO 처리',
}

/**
 * 브리핑 맨 위에 **코드가** 세우는 항목들. 모델에게 순서를 맡기지 않는 이유는
 * `AttentionBriefLine`의 주석에 있다 — 맡기면 «맨 위»가 매일 달라지고, 그러면 맨 위가 아니다.
 */
export function attentionItems(headlines: AttentionHeadline[]): AiBriefItem[] {
  return headlines.map((h) => {
    const measured = describeMeasured(h)
    const parts = [
      `${LEVEL_KO[h.severity]}(${h.severity})`,
      measured,
      h.period ? `기간 ${h.period}` : null,
      h.chairman_action_required ? '회장 액션 필요' : null,
    ].filter((p): p is string => p !== null)
    return {
      title: `[주의] ${h.business_name} ${h.rule_name}`,
      detail: `${parts.join(' · ')}. 감지 ${h.detected_on}.`,
      severity: ITEM_SEVERITY[h.severity],
    }
  })
}

/* ------------------------------------------------------------------ ai_analysis 한 벌 */

/**
 * `exceptions.ai_analysis`에 들어갈 글. **원문의 셋을 세 줄로 적고 그 이상을 적지 않는다** —
 * 원인 분해 · CEO 대응 여부 · 권고 "관찰 N일".
 *
 * «결정 아님» 라벨은 여기 쓰지 않는다. 그것은 화면이 이 칸 옆에 붙이는 말이고(0035 4절),
 * 글 안에 넣으면 회장이 읽는 문장 셋이 넷이 된다.
 */
export function formatExceptionAnalysis(a: ExceptionAnalysis): string {
  return [`원인: ${a.cause}`, `CEO 대응: ${a.ceo_response}`, `권고: 관찰 ${a.monitor_days}일`].join(
    '\n',
  )
}

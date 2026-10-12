import { detectMixRatio } from '@/lib/intake/mix-ratio'
import type { FeedbackExcludeReason } from '@/types'

/**
 * 0069 «AI 정리 제외» 판정 — 보완 의견 · 함께 저장되는 질문 · 답에 배합비 · Vault 등급 · 원가 엔진 숫자가 보이면
 * 저장은 하되 AI로 보내지 않는다(대표에게만 «AI 정리 제외»로 보인다).
 *
 * 세 겹(0069 머리 주석):
 *   ⓐ 서버 액션이 이 함수로 판정해 넘긴다(배합비는 입구와 같은 감지 — lib/intake/mix-ratio.ts).
 *   ⓑ DB ai_feedback_sensitive()가 SQL 낱말 규칙으로 한 번 더 켠다(KEYWORD_RULES와 같은 식 — 켜기만).
 *   ⓒ AI 정리(lib/feedback/triage.ts)가 보내기 직전에 이 함수를 다시 부른다 — 제외면 보내지 않는다.
 * 감지는 안전망이지 보증이 아니다(MIX_RATIO_LIMITS와 같은 한계).
 */

/** DB ai_feedback_sensitive()와 같은 식. 바꾸면 0069의 함수도 같이(검사 check:ask가 둘을 대조한다). */
export const KEYWORD_RULES: { reason: FeedbackExcludeReason; test: (t: string) => boolean }[] = [
  {
    reason: 'mix_ratio',
    test: (t) => /(배합|처방|레시피|recipe|formula|\bbom\b|투입\s*비율?|함량비|w\/w|wt\s*%|\bphr\b)/i.test(t),
  },
  { reason: 'vault', test: (t) => /(\bvault\b|금고\s*등급|\[금고\])/i.test(t) },
  { reason: 'cost_number', test: (t) => /(원가|단가|시장가|시세|구매가|매입가|마진|원\s*\/\s*kg)/i.test(t) && /[0-9]/.test(t) },
]

export function keywordReasons(text: string): FeedbackExcludeReason[] {
  return KEYWORD_RULES.filter((r) => r.test(text)).map((r) => r.reason)
}

export interface Sensitivity {
  excluded: boolean
  reasons: FeedbackExcludeReason[]
}

/** 의견 · 질문 · 답을 함께 잰다. 배합비는 표 모양(퍼센트 합 100 등)까지 보는 입구 감지를 함께 쓴다. */
export function feedbackSensitivity(parts: { body: string; question: string; answer: string }): Sensitivity {
  const all = [parts.body, parts.question, parts.answer]
  const reasons = new Set<FeedbackExcludeReason>()
  for (const t of all) for (const r of keywordReasons(t)) reasons.add(r)
  if (detectMixRatio(all).hit) reasons.add('mix_ratio')
  const list = [...reasons].sort()
  return { excluded: list.length > 0, reasons: list }
}

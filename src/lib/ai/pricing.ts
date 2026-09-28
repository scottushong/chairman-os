/**
 * AI 호출 한 번의 추정 비용(USD). 0045 ai_usage_log.estimated_cost_usd에 적는다.
 *
 * **추정이다.** 청구서가 아니라 «대략 얼마 드는가»를 회장이 보게 하려는 값이다(Phase 11 일별 비용).
 * 단가는 모델 이름의 앞머리로 찾는다(날짜 접미사가 붙어도 같은 줄). 표에 없는 모델은 Sonnet 단가로 적는다 —
 * 0으로 두면 «공짜»로 읽힌다. 캐시 할인은 반영하지 않는다(이 기능은 캐시를 쓰지 않는다).
 */

/** 100만 토큰당 USD — [입력, 출력]. 2026-09 공개 단가. */
const PRICE_PER_MTOK: [prefix: string, input: number, output: number][] = [
  ['claude-fable-5', 10, 50],
  ['claude-opus-5-5', 4, 20],
  ['claude-opus-5', 5, 25],
  ['claude-opus-4', 5, 25],
  ['claude-sonnet-5', 2, 10],
  ['claude-sonnet-4', 3, 15],
  ['claude-haiku-4', 1, 5],
]

const FALLBACK: [number, number] = [3, 15]

export function priceOf(model: string): [input: number, output: number] {
  const hit = PRICE_PER_MTOK.find(([prefix]) => model.startsWith(prefix))
  return hit ? [hit[1], hit[2]] : FALLBACK
}

export function estimateCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const [i, o] = priceOf(model)
  // numeric(12,6)에 맞춰 여섯 자리에서 자른다.
  return Math.round(((inputTokens * i + outputTokens * o) / 1_000_000) * 1e6) / 1e6
}

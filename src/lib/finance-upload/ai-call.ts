import 'server-only'

import Anthropic from '@anthropic-ai/sdk'

/**
 * 자료 올리기의 AI 호출 공통부(분류 ai.ts · 읽기 ai-doc.ts — 2026-10-16 업로드 단단히).
 *
 *   1. 구조 강제(output_config json_schema)로 한 번.
 *   2. 400(BadRequestError)이 구조 강제 때문이면(output_config · format · schema 낱말) 강제 없이 한 번 더 —
 *      스키마는 system 글로 싣는다(lib/ai/anthropic.ts · intake/read.ts와 같은 물러서기). 다른 400은 그대로 올린다.
 *   3. 답이 JSON이 아니면 AiShapeError(«AI 실패») — 호출한 쪽이 코드 해석 · 미리보기로 간다(숫자를 지어내지 않는다).
 *
 * 쓴 토큰은 호출마다 onUsage로 알린다(물러선 호출도 돈이 든다 — 둘 다 ai_usage_log).
 */

export class AiShapeError extends Error {}

export interface JsonCall {
  model: string
  maxTokens: number
  system: Anthropic.TextBlockParam[]
  content: string | Anthropic.ContentBlockParam[]
  schema: Record<string, unknown>
  /** 요청 하나의 시간 한도(ms) — 정해 두면 SDK가 큰 max_tokens에 스트리밍을 요구하지 않는다 */
  timeout: number
}

export interface JsonResult {
  json: unknown
  stop: Anthropic.Message['stop_reason']
  /** 구조 강제 없이 물러서서 받았나 */
  fallback: boolean
}

export const CREDIT_MSG = 'AI 사용료 잔액 부족(Anthropic 크레딧) — 대표가 충전하면 «AI로 다시 해석»으로 다시 읽습니다'

export function isCreditError(e: unknown): boolean {
  return e instanceof Anthropic.APIError && /credit balance/i.test(e.message)
}

export function isSchemaRejection(e: unknown): boolean {
  return e instanceof Anthropic.BadRequestError && /output_config|json_schema/i.test(e.message)
}

/** 글에서 JSON 객체 하나 — 코드블록 표시 · 앞뒤 말을 걷는다. 없거나 깨졌으면 AiShapeError. */
export function parseJsonObject(text: string): unknown {
  const t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  const a = t.indexOf('{')
  const b = t.lastIndexOf('}')
  if (a < 0 || b <= a) throw new AiShapeError(`AI 실패 — 답이 JSON이 아닙니다(${t.slice(0, 60)})`)
  try {
    return JSON.parse(t.slice(a, b + 1))
  } catch {
    throw new AiShapeError(`AI 실패 — 답이 JSON이 아닙니다(${t.slice(0, 60)})`)
  }
}

export async function callJson(client: Anthropic, c: JsonCall, onUsage: (u: Anthropic.Usage) => Promise<void> | void): Promise<JsonResult> {
  const base = { model: c.model, max_tokens: c.maxTokens, messages: [{ role: 'user' as const, content: c.content }] }
  let res: Anthropic.Message
  let fallback = false
  try {
    res = await client.messages.create(
      { ...base, system: c.system, output_config: { format: { type: 'json_schema', schema: c.schema } } } as Anthropic.MessageCreateParamsNonStreaming,
      { timeout: c.timeout },
    )
  } catch (e) {
    // 2026-10-16 확인: 크레딧 부족도 400(invalid_request_error)이다 — 물러서지 않고 사람이 알아볼 말로(카드 · 미리보기 이유에 남는다).
    if (isCreditError(e)) throw new AiShapeError(CREDIT_MSG)
    if (!isSchemaRejection(e)) throw e
    fallback = true
    const rule: Anthropic.TextBlockParam = { type: 'text', text: `반드시 다음 JSON 스키마에 맞는 JSON 객체 하나만 출력한다. 코드블록 표시 · 설명 없이.\n${JSON.stringify(c.schema)}` }
    res = await client.messages.create({ ...base, system: [...c.system, rule] } as Anthropic.MessageCreateParamsNonStreaming, { timeout: c.timeout })
  }
  await onUsage(res.usage)
  if (res.stop_reason === 'refusal') throw new AiShapeError('AI가 답하지 않았습니다(refusal)')
  if (res.stop_reason === 'max_tokens') return { json: null, stop: 'max_tokens', fallback }
  const text = res.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('')
  return { json: parseJsonObject(text), stop: res.stop_reason, fallback }
}

import 'server-only'

import Anthropic from '@anthropic-ai/sdk'
import type { SupabaseClient } from '@supabase/supabase-js'

import { estimateCostUsd, priceOf } from '@/lib/ai/pricing'
import { isCreditError, isSchemaRejection, parseJsonObject } from '@/lib/finance-upload/ai-call'

/**
 * Investment Intelligence LLM 호출(0095) — 설명 · 브리핑 요약 · CONFIRMED/INFERRED 분류만. 점수 · 가치평가 · 변화 판정은 AI 없이(결정론).
 *
 *   1. 호출 전 예상 비용(입력 상한 + 출력 상한 × 단가)을 계산해 DB 함수 investment_ai_reserve로 원자적 예약 —
 *      하루 호출 수(ai_daily_calls, 기본 20) · 이번 달 비용(ai_monthly_usd, 기본 $30)을 서버가 막는다(동시 호출 · 재시도 포함).
 *   2. 구조 강제(json_schema)로 한 번. 400이 구조 강제 때문이면(0073 방식 — finance-upload/ai-call.ts) 다시 예약하고 강제 없이 한 번 더.
 *   3. investment_ai_finish로 실제 사용량 · ai_usage_log(feature 'investment_ai')에 기록.
 * 한도 · 스위치 꺼짐 · 키 없음이면 LLM만 DISABLED — 계산기 · 공시 · 주가 · 점수는 그대로 돈다.
 * 월 비용은 이 기능의 기록으로 센다(같은 키를 다른 기능도 쓰므로 Anthropic 청구액과 다를 수 있음 — 화면에 적는다).
 */

export type AiFail = 'DISABLED' | 'LIMIT_DAY' | 'LIMIT_MONTH' | 'NO_KEY' | 'ERROR'
export type AiOutcome<T> = { ok: true; json: T; model: string; usd: number } | { ok: false; reason: AiFail; message: string }

export const investmentAiModel = () => process.env.INVESTMENT_AI_MODEL?.trim() || process.env.AI_MODEL?.trim() || 'claude-sonnet-5'

/** 예상 비용 — 글자 2개 = 토큰 1개로 넉넉히(한글) + 출력 상한 전부. */
export function estimateUsd(model: string, inputChars: number, maxTokens: number): number {
  const [pin, pout] = priceOf(model)
  const inTok = Math.ceil(inputChars / 2) + 300
  return Math.max(0.000001, Math.round(((inTok * pin + maxTokens * pout) / 1_000_000) * 1e6) / 1e6)
}

function failOf(message: string): AiFail {
  if (/investment_ai_limit_day/.test(message)) return 'LIMIT_DAY'
  if (/investment_ai_limit_month/.test(message)) return 'LIMIT_MONTH'
  if (/investment_ai_off|investment_ai_denied|PGRST202|42883/.test(message)) return 'DISABLED'
  return 'ERROR'
}

export const FAIL_LABEL: Record<AiFail, string> = {
  DISABLED: 'AI DISABLED — 스위치 꺼짐 또는 0095 전',
  LIMIT_DAY: 'AI DISABLED — 오늘 호출 한도 도달',
  LIMIT_MONTH: 'AI DISABLED — 이번 달 비용 한도 도달',
  NO_KEY: 'AI DISABLED — ANTHROPIC_API_KEY 없음',
  ERROR: 'AI 실패',
}

export interface AiCall {
  /** 이 세션(AIAgent 또는 대표)으로 예약 · 기록한다 */
  sb: SupabaseClient
  kind: string
  system: string
  payload: unknown
  schema: Record<string, unknown>
  maxTokens: number
  /** 시험용 — 실제 Anthropic 대신 */
  client?: Pick<Anthropic, 'messages'>
}

export async function investmentAi<T>(c: AiCall): Promise<AiOutcome<T>> {
  const key = process.env.ANTHROPIC_API_KEY?.trim()
  if (!key && !c.client) return { ok: false, reason: 'NO_KEY', message: FAIL_LABEL.NO_KEY }
  const model = investmentAiModel()
  const content = JSON.stringify(c.payload)
  const est = estimateUsd(model, c.system.length + content.length, c.maxTokens)
  const client = c.client ?? new Anthropic({ apiKey: key, timeout: 60_000, maxRetries: 0 })

  const reserve = async () => {
    const { data, error } = await c.sb.rpc('investment_ai_reserve', { p_kind: c.kind, p_est_usd: est })
    if (error) throw new ReserveError(error.message)
    return Number(data)
  }
  const finish = async (res: number, status: 'done' | 'failed', usage: Anthropic.Usage | null) => {
    const usd = usage ? estimateCostUsd(model, usage.input_tokens, usage.output_tokens) : 0
    await c.sb.rpc('investment_ai_finish', {
      p_res: res,
      p_status: status,
      p_actual_usd: usd,
      p_model: model,
      p_in: usage?.input_tokens ?? 0,
      p_out: usage?.output_tokens ?? 0,
    })
    if (usage) {
      await c.sb
        .from('ai_usage_log')
        .insert({ feature: 'investment_ai', model, input_tokens: usage.input_tokens, output_tokens: usage.output_tokens, estimated_cost_usd: usd, entity_table: 'investment', entity_id: c.kind })
        .then(({ error }) => error && console.error('[investment ai] ai_usage_log', error.message))
    }
    return usd
  }

  const base = { model, max_tokens: c.maxTokens, messages: [{ role: 'user' as const, content }] }
  let res = 0
  try {
    res = await reserve()
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e)
    return { ok: false, reason: failOf(m), message: FAIL_LABEL[failOf(m)] }
  }
  let msg: Anthropic.Message
  try {
    msg = await client.messages.create({ ...base, system: c.system, output_config: { format: { type: 'json_schema', schema: c.schema } } } as Anthropic.MessageCreateParamsNonStreaming)
  } catch (e) {
    await finish(res, 'failed', null)
    if (isCreditError(e)) return { ok: false, reason: 'ERROR', message: 'AI 실패 — Anthropic 크레딧 부족' }
    if (!isSchemaRejection(e)) return { ok: false, reason: 'ERROR', message: `AI 실패 — ${e instanceof Error ? e.message.slice(0, 120) : '알 수 없음'}` }
    // 구조 강제를 모르는 모델 — 한 번만 물러선다. 두 번째 호출도 돈이 드니 다시 예약한다.
    try {
      res = await reserve()
    } catch (e2) {
      const m = e2 instanceof Error ? e2.message : String(e2)
      return { ok: false, reason: failOf(m), message: FAIL_LABEL[failOf(m)] }
    }
    try {
      msg = await client.messages.create({ ...base, system: `${c.system}\n\n반드시 다음 JSON 스키마에 맞는 JSON 객체 하나만 출력한다. 코드블록 표시 · 설명 없이.\n${JSON.stringify(c.schema)}` } as Anthropic.MessageCreateParamsNonStreaming)
    } catch (e3) {
      await finish(res, 'failed', null)
      return { ok: false, reason: 'ERROR', message: `AI 실패 — ${e3 instanceof Error ? e3.message.slice(0, 120) : '알 수 없음'}` }
    }
  }
  const usd = await finish(res, msg.stop_reason === 'refusal' || msg.stop_reason === 'max_tokens' ? 'failed' : 'done', msg.usage)
  if (msg.stop_reason === 'refusal' || msg.stop_reason === 'max_tokens') return { ok: false, reason: 'ERROR', message: `AI 실패 — ${msg.stop_reason}` }
  try {
    const text = msg.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('')
    return { ok: true, json: parseJsonObject(text) as T, model, usd }
  } catch (e) {
    return { ok: false, reason: 'ERROR', message: e instanceof Error ? e.message : 'AI 실패' }
  }
}

class ReserveError extends Error {}

// ── 스키마(check:ai-schemas가 검사한다 — additionalProperties false · 길이 제한 키워드 없음) ──

const S = { type: 'string' } as const

export const EXPLAIN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['why_company', 'why_market', 'why_now', 'buy_price', 'what_could_go_wrong', 'invalidation'],
  properties: { why_company: S, why_market: S, why_now: S, buy_price: S, what_could_go_wrong: S, invalidation: S },
} as const

export const REASONS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['reasons'],
  properties: {
    reasons: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['statement', 'classification'],
        properties: { statement: S, classification: { type: 'string', enum: ['INFERRED', 'HYPOTHESIS', 'UNKNOWN'] } },
      },
    },
  },
} as const

export const BRIEF_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary'],
  properties: { summary: S },
} as const

export const EXPLAIN_SYSTEM =
  '너는 대양산업 법인의 장기투자 분석 보조다. 주어진 JSON의 숫자 · 출처만 근거로 한국어로 쓴다. 숫자를 새로 만들지 않는다. ' +
  '투자 권유 · 매수 지시를 하지 않는다(BUY 판정은 시스템 규칙이 이미 정했다 — 바꾸거나 덧붙이지 않는다). ' +
  '각 칸 2~3문장. why_company(왜 이 회사) · why_market(왜 이 시장) · why_now(왜 지금 — 가격 · 기준가 대비) · buy_price(매수 기준가와 계산 근거) · ' +
  'what_could_go_wrong(틀릴 수 있는 것) · invalidation(가설을 무너뜨릴 조건). 자료가 없으면 «자료 없음»이라고 쓴다.'

export const REASONS_SYSTEM =
  '너는 투자기관이 어떤 기업을 보유한 이유를 «추론»한다. 공식 문서를 보지 않았으므로 CONFIRMED를 쓰지 않는다. ' +
  '기관의 공개 투자철학과 기업 재무 숫자가 맞물리면 INFERRED, 더 검증이 필요하면 HYPOTHESIS, 근거가 없으면 UNKNOWN. 한국어 한 문장씩, 최대 3개.'

export const BRIEF_SYSTEM =
  '너는 아침 투자 브리핑을 3~5문장 한국어로 요약한다. 주어진 항목의 숫자 · 날짜만 쓴다. 매수 · 매도 권유를 하지 않는다. 자료 기준일을 밝힌다.'

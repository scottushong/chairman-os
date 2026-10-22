import 'server-only'

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import Anthropic from '@anthropic-ai/sdk'

import { estimateCostUsd } from '@/lib/ai/pricing'
import { AiShapeError, callJson } from '@/lib/finance-upload/ai-call'

import { MEMORY_SCHEMA, MemoryShapeError, parseExtraction } from './schema'
import { ruleExtract, type ExtractResult } from './rules'

/**
 * 기억 엔진 — AI 공급자 어댑터(지시문 11절 «AI Provider Interface»). 지금 구현은 기존 Anthropic 경로(callJson — 구조 강제 →
 * 400이면 형식 없이 한 번 더 · 크레딧 부족은 사람이 읽을 말). 공급자를 바꾸려면 MemoryExtractor를 하나 더 만든다.
 *
 * 비용: 호출마다 ai_usage_log(feature 'memory_extract'). 하루 한도는 env MEMORY_AI_PER_DAY(기본 0 = AI 안 씀 — 대표가 값을 넣는다).
 * MEMORY_AI_MOCK=1이면 진짜 호출 없이 규칙 뽑기를 «mock»으로 돌려준다(시험 · dummy).
 */

export const MEMORY_PROMPT_VERSION = 'memory-extract-v1'
export const DEFAULT_MEMORY_MODEL = 'claude-sonnet-5-5'
/** 원문을 AI에 보낼 때 자르는 길이(약 12k 토큰) */
export const MEMORY_AI_MAX_CHARS = 24000

export interface ExtractorUsage {
  model: string
  input_tokens: number
  output_tokens: number
  estimated_cost_usd: number
}

export interface MemoryExtractor {
  engine: 'ai' | 'mock'
  model: string
  extract(text: string, ctx: { capturedAt: string; type: string }, onUsage: (u: ExtractorUsage) => Promise<void>): Promise<ExtractResult>
}

export function memoryModel(): string {
  return process.env.MEMORY_AI_MODEL?.trim() || DEFAULT_MEMORY_MODEL
}

/** 하루(서울) AI 처리 한도. 0 = AI 안 씀. 천장 500. */
export function memoryAiPerDay(): number {
  const n = Number(process.env.MEMORY_AI_PER_DAY ?? '0')
  return Number.isFinite(n) ? Math.max(0, Math.min(500, Math.floor(n))) : 0
}

const PROMPT_FILE = join(process.cwd(), 'src', 'lib', 'ai', 'prompts', 'memory-extract.md')
let promptCache: Promise<string> | null = null

/** 원문을 «자료»로 싼다 — 안의 태그 흉내(</record>)는 깨 둔다(프롬프트 주입 차단). */
export function fenceRecord(text: string, ctx: { capturedAt: string; type: string }): string {
  const safe = text.slice(0, MEMORY_AI_MAX_CHARS).replace(/<\/?\s*record[^>]*>/gi, '[record]')
  return `기록 종류: ${ctx.type}\n기록 시각(서울): ${new Date(ctx.capturedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}\n<record>\n${safe}\n</record>`
}

export function anthropicExtractor(): MemoryExtractor | null {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return null
  const client = new Anthropic({ apiKey, maxRetries: 1 })
  const model = memoryModel()
  return {
    engine: 'ai',
    model,
    async extract(text, ctx, onUsage) {
      promptCache ??= readFile(PROMPT_FILE, 'utf8')
      const system = await promptCache
      const res = await callJson(
        client,
        { model, maxTokens: 4000, system: [{ type: 'text', text: system }], content: fenceRecord(text, ctx), schema: MEMORY_SCHEMA as unknown as Record<string, unknown>, timeout: 90_000 },
        async (u) => {
          await onUsage({ model, input_tokens: u.input_tokens, output_tokens: u.output_tokens, estimated_cost_usd: estimateCostUsd(model, u.input_tokens, u.output_tokens) })
        },
      )
      if (res.json === null) throw new MemoryShapeError('AI 답이 길이 한도에서 끊겼습니다')
      return parseExtraction(res.json)
    },
  }
}

/** 시험 · dummy — 진짜 호출 없이 규칙 뽑기를 mock으로. MEMORY_AI_MOCK=fail이면 실패를 흉내 낸다(Case G). */
export function mockExtractor(): MemoryExtractor {
  return {
    engine: 'mock',
    model: 'mock',
    async extract(text) {
      if (process.env.MEMORY_AI_MOCK === 'fail') throw new AiShapeError('mock: AI 분석 서비스 실패')
      return ruleExtract(text)
    },
  }
}

/** 지금 쓸 뽑기 — mock이 켜져 있으면 mock, 키가 없으면 null(규칙만). */
export function currentExtractor(): MemoryExtractor | null {
  if (process.env.MEMORY_AI_MOCK === '1' || process.env.MEMORY_AI_MOCK === 'fail') return mockExtractor()
  return anthropicExtractor()
}

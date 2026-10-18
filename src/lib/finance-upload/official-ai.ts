import 'server-only'

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import Anthropic from '@anthropic-ai/sdk'

import { DEFAULT_AI_MODEL } from '@/lib/ai/anthropic'
import { estimateCostUsd } from '@/lib/ai/pricing'
import type { ChairmanRepository } from '@/lib/repository'

import { AiShapeError, callJson } from './ai-call'
import { mockOfficialSuggester, type OfficialSuggester } from './official-suggest'

/**
 * 공식 결산 계정 맞추기 2차(AI) — 코드(학습 표 · 이름 · 이름 바꿈 표)가 못 맞춘 줄만, 줄 이름 + 묶음과 회사 계정과목표 목록을 보내
 * «가장 맞는 계정 + 믿음»을 JSON으로 받는다. **숫자는 보내지 않는다.** 받은 코드는 applyOfficialSuggestions(doc-read.ts)가
 * 계정과목표 · 묶음 안인지 다시 보고, 화면은 «제안»으로 미리 골라 둘 뿐이다(사람이 승인해야 저장).
 * 한 파일 = 한 번(자료 올리기 AI 한도에 센다). FINANCE_UPLOAD_AI_MOCK=1이면 가짜(official-suggest.ts).
 */

export const OFFICIAL_MATCH_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          line: { type: 'integer' },
          account_code: { anyOf: [{ type: 'string' }, { type: 'null' }] },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
        },
        required: ['line', 'account_code', 'confidence'],
        additionalProperties: false,
      },
    },
  },
  required: ['items'],
  additionalProperties: false,
} as const

let promptCache: Promise<string> | null = null

function readPrompt(): Promise<string> {
  promptCache ??= readFile(join(process.cwd(), 'src', 'lib', 'ai', 'prompts', 'finance-upload-official-match.md'), 'utf8').catch((e) => {
    promptCache = null
    throw e
  })
  return promptCache
}

/** 진짜 맞춤 도구(키 없으면 null). MOCK이면 가짜. */
export function realOfficialSuggester(repo: ChairmanRepository, businessId: string): OfficialSuggester | null {
  if (process.env.FINANCE_UPLOAD_AI_MOCK === '1') return mockOfficialSuggester
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return null
  return async ({ lines, accounts, deadline }) => {
    if (!lines.length || !accounts.length) return { items: [], calls: 0 }
    const left = (deadline ?? Date.now() + 120_000) - Date.now()
    if (left < 30_000) throw new AiShapeError('AI 실패 — 시간 한도 안에 계정 제안을 받지 못했습니다')
    const model = process.env.AI_MODEL?.trim() || DEFAULT_AI_MODEL
    const client = new Anthropic({ apiKey: key, timeout: 90_000, maxRetries: 0 })
    const system: Anthropic.TextBlockParam[] = [{ type: 'text', text: await readPrompt(), cache_control: { type: 'ephemeral' } }]
    const body = `<lines>\n${JSON.stringify(lines)}\n</lines>\n<accounts>\n${JSON.stringify(accounts.map((a) => ({ code: a.account_code, name: a.name, section: a.section })))}\n</accounts>`
    const r = await callJson(client, { model, maxTokens: 8_000, timeout: Math.min(90_000, left - 15_000), system, content: body, schema: OFFICIAL_MATCH_SCHEMA }, async (u) => {
      const read = u.cache_read_input_tokens ?? 0
      const written = u.cache_creation_input_tokens ?? 0
      const inputTokens = u.input_tokens + read + written
      await repo
        .logAiUsage({ feature: 'finance_upload_official_match', model, input_tokens: inputTokens, output_tokens: u.output_tokens, estimated_cost_usd: estimateCostUsd(model, inputTokens, u.output_tokens, { read, write: written }), entity_table: 'fin_uploads', entity_id: businessId })
        .catch((e) => console.error('[finance-upload] ai_usage_log', e))
    })
    const o = r.json as { items?: unknown } | null
    if (!o || !Array.isArray(o.items)) throw new AiShapeError('AI 실패 — 계정 제안 모양이 아닙니다')
    const items = o.items
      .filter((x): x is { line: number; account_code: string | null; confidence: 'high' | 'medium' | 'low' } => {
        const v = x as Record<string, unknown>
        return Number.isInteger(v?.line) && (typeof v.account_code === 'string' || v.account_code === null) && ['high', 'medium', 'low'].includes(String(v.confidence))
      })
    return { items, calls: 1 }
  }
}

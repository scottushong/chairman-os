import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

import { BRIEF_SCHEMA, BRIEF_SYSTEM, EXPLAIN_SCHEMA, EXPLAIN_SYSTEM, investmentAi, REASONS_SCHEMA, REASONS_SYSTEM } from './ai'
import type { BriefSummarizer, Explainer } from './analyze'
import type { RecExplanation } from './types'

/**
 * 분석 실행기에 끼우는 AI 조각 — 이 세션(sb)으로 예약 · 기록한다. 실패 · 한도면 null(실행기는 결정론 템플릿으로 간다).
 * notes에 이유를 남겨 화면 · 수집 기록이 «AI DISABLED — 오늘 호출 한도 도달» 같은 문장을 그대로 보이게 한다.
 */
export function aiRunners(sb: SupabaseClient, notes: string[]): { explain: Explainer; summarize: BriefSummarizer } {
  return {
    explain: async (input) => {
      const r = await investmentAi<Omit<RecExplanation, 'source'>>({ sb, kind: 'explain', system: EXPLAIN_SYSTEM, payload: input, schema: EXPLAIN_SCHEMA as unknown as Record<string, unknown>, maxTokens: 1200 })
      if (!r.ok) {
        notes.push(r.message)
        return null
      }
      return { text: r.json, model: r.model }
    },
    summarize: async (content) => {
      const r = await investmentAi<{ summary: string }>({ sb, kind: 'brief', system: BRIEF_SYSTEM, payload: content, schema: BRIEF_SCHEMA as unknown as Record<string, unknown>, maxTokens: 600 })
      if (!r.ok) {
        notes.push(r.message)
        return null
      }
      return { summary: r.json.summary, model: r.model }
    },
  }
}

/** 기관이 이 종목을 보유한 이유 — AI 추론(INFERRED · HYPOTHESIS · UNKNOWN만, CONFIRMED는 대표가 공식 문서로). */
export async function aiReasons(sb: SupabaseClient, payload: Record<string, unknown>) {
  return investmentAi<{ reasons: { statement: string; classification: 'INFERRED' | 'HYPOTHESIS' | 'UNKNOWN' }[] }>({
    sb,
    kind: 'reasons',
    system: REASONS_SYSTEM,
    payload,
    schema: REASONS_SCHEMA as unknown as Record<string, unknown>,
    maxTokens: 800,
  })
}

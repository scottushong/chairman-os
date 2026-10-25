import 'server-only'

import { createSupabaseRepository } from '@/lib/repository/supabase'
import { signInServiceAccount } from '@/lib/supabase/service-account'

import { aiRunners } from '../ai-runners'
import { runAnalysis, type AnalyzeResult } from '../analyze'

import { runCollect, type CollectResult } from './run'
import { supabaseSink } from './sink-supabase'

/**
 * 수집 프로세스 = Integration 계정(INTEGRATION_EMAIL · INTEGRATION_PASSWORD). 0094 RLS가 이 계정에 원천 표 insert/update만 연다 —
 * 추천 · 승인 · 포트폴리오 · 거래 표에는 0행 · 쓰기 거부(0095 · 0096). AI 분석 프로세스(AIAgent)와 계정이 다르다. service_role 없음.
 * cron(/api/cron/investment-collect)과 대표 «지금 수집»(actions/investment.ts)이 같은 길을 쓴다.
 */
export async function collectAsIntegration(trigger: 'cron' | 'manual', budgetMs = 240_000): Promise<CollectResult> {
  const { sb } = await signInServiceAccount({ emailEnv: 'INTEGRATION_EMAIL', passwordEnv: 'INTEGRATION_PASSWORD', role: 'Integration' })
  try {
    return await runCollect(supabaseSink(sb), { trigger, budgetMs })
  } finally {
    await sb.auth.signOut().catch(() => undefined)
  }
}

/**
 * AI 분석 프로세스 = AIAgent 계정(AI_AGENT_EMAIL · AI_AGENT_PASSWORD) — 수집 계정과 따로. 0095 RLS가 이 계정에 원천 읽기 +
 * 분석 이력 표 INSERT만 연다(UPDATE · DELETE 없음 · 포트폴리오 · 승인 · 거래 표 0행). 판정은 결정론, AI는 설명 글 · 요약만(한도 안).
 */
export async function analyzeAsAgent(today: string): Promise<AnalyzeResult> {
  const { sb } = await signInServiceAccount({ emailEnv: 'AI_AGENT_EMAIL', passwordEnv: 'AI_AGENT_PASSWORD', role: 'AIAgent' })
  try {
    const notes: string[] = []
    const ai = aiRunners(sb, notes)
    const out = await runAnalysis(createSupabaseRepository(sb), { today, nowIso: new Date().toISOString(), explain: ai.explain, summarize: ai.summarize, maxExplain: 5 })
    return { ...out, notes: [...out.notes, ...new Set(notes)] }
  } finally {
    await sb.auth.signOut().catch(() => undefined)
  }
}

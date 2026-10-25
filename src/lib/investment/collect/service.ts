import 'server-only'

import { signInServiceAccount } from '@/lib/supabase/service-account'

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

import type { SupabaseClient } from '@supabase/supabase-js'

import { FEATURE_AUDIENCES, type FeatureAudience, type FeatureSwitchRow } from '@/lib/features'

import type { ChairmanRepository } from './types'

/**
 * 0073 기능 스위치의 live 어댑터 조각. supabase.ts가 펼쳐 넣는다.
 * **0073이 없는 DB를 견딘다**(master push = 앱이 먼저 나갈 수 있다): 읽기는 null(→ lib/features.ts 기본값), 바꾸기는 'feature_switch_unavailable'.
 * 판정은 DB다(0073 feature_switch_set — 대표만 · 이유 · 감사).
 */

const MISSING = new Set(['PGRST202', '42883', 'PGRST205', '42P01'])

type Methods = Pick<ChairmanRepository, 'listFeatureSwitches' | 'setFeatureSwitch'>

export function featureMethods(sb: SupabaseClient): Methods {
  return {
    async listFeatureSwitches() {
      const { data, error } = await sb
        .from('feature_switches')
        .select('business_id,feature_key,enabled,audience,reason,updated_by,updated_at')
      if (error) {
        if (MISSING.has(error.code ?? '')) return null
        throw new Error(`Supabase feature_switches ${error.code ?? '?'}: ${error.message}`)
      }
      return (data ?? []).map((r) => ({
        ...(r as FeatureSwitchRow),
        audience: (FEATURE_AUDIENCES.includes(r.audience as FeatureAudience) ? r.audience : 'chairman') as FeatureAudience,
      }))
    },
    async setFeatureSwitch(input) {
      const { error } = await sb.rpc('feature_switch_set', {
        p_feature: input.feature_key,
        p_business: input.business_id,
        p_enabled: input.enabled,
        p_audience: input.audience,
        p_reason: input.reason,
      })
      if (error) {
        if (MISSING.has(error.code ?? '')) throw new Error('feature_switch_unavailable')
        throw new Error(/feature_switch_[a-z_]+/.exec(error.message)?.[0] ?? `Supabase feature_switch_set ${error.code ?? '?'}: ${error.message}`)
      }
    },
  }
}

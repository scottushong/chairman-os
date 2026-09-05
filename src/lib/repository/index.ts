import { DATA_MODE } from '@/lib/env'
import { supabaseConfig, type RequestContext } from '@/lib/supabase/client'

import { dummyRepository } from './dummy'
import { createSupabaseRepository } from './supabase'
import type { ChairmanRepository } from './types'

export type { ChairmanRepository, DashboardSnapshot, DecisionAuditEntry } from './types'
export { loadDashboard } from './types'

/**
 * 어느 어댑터를 쓸지 정하는 유일한 자리.
 *
 * NEXT_PUBLIC_DATA_MODE=live 인데 Supabase 키가 없으면 던진다.
 * 조용히 dummy로 떨어지면 화면에 시드 숫자가 뜨는데 뱃지는 사라져서,
 * Chairman이 그걸 실적으로 읽는다. 그 사고를 막는 게 이 세 줄이다.
 */
export function getRepository(ctx: RequestContext = {}): ChairmanRepository {
  if (DATA_MODE === 'dummy') return dummyRepository

  if (!supabaseConfig()) {
    throw new Error(
      'NEXT_PUBLIC_DATA_MODE=live 인데 Supabase 키가 없다. ' +
        '.env.local의 NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY를 채우거나 dummy로 되돌린다.',
    )
  }
  return createSupabaseRepository(ctx)
}

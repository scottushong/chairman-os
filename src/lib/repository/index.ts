import { DATA_MODE } from '@/lib/env'
import { supabaseConfig } from '@/lib/supabase/config'
import { createSupabaseServerClient } from '@/lib/supabase/server'

import { dummyRepository } from './dummy'
import { createSupabaseRepository } from './supabase'
import type { ChairmanRepository } from './types'

export type {
  AuditActor,
  ChairmanRepository,
  DashboardSnapshot,
  DecisionAuditEntry,
  NewBusiness,
  UserSettings,
} from './types'
export { DUPLICATE_BUSINESS_ID, loadDashboard } from './types'

/**
 * 어느 어댑터를 쓸지 정하는 유일한 자리. 서버에서만 부른다.
 *
 * NEXT_PUBLIC_DATA_MODE=live 인데 Supabase 키가 없으면 던진다.
 * 조용히 dummy로 떨어지면 화면에 시드 숫자가 뜨는데 뱃지는 사라져서,
 * Chairman이 그걸 실적으로 읽는다. 그 사고를 막는 게 아래 다섯 줄이다.
 *
 * async인 이유는 서버 클라이언트가 요청 쿠키(await cookies())를 읽기 때문이다.
 * dummy 모드는 쿠키를 건드리지 않는다.
 */
export async function getRepository(): Promise<ChairmanRepository> {
  if (DATA_MODE === 'dummy') return dummyRepository

  if (!supabaseConfig()) {
    throw new Error(
      'NEXT_PUBLIC_DATA_MODE=live 인데 Supabase 키가 없다. ' +
        '.env.local의 NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY를 채우거나 dummy로 되돌린다.',
    )
  }
  return createSupabaseRepository(await createSupabaseServerClient())
}

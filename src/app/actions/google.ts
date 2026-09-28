'use server'

import { revalidatePath } from 'next/cache'

import { currentUser } from '@/lib/auth/session'
import { createSupabaseServerClient } from '@/lib/supabase/server'

/**
 * Gmail 연결 해제 (Phase 9 블록 4). 우리가 가진 토큰만 버린다(0039 google_token_clear).
 * Google 쪽 권한 취소는 회장의 Google 계정 › 보안 › 타사 앱에서 한다 — 화면이 그 사실을 적는다.
 */
export async function disconnectGmail(): Promise<{ error?: string }> {
  const user = await currentUser()
  if (!user || user.role !== 'Chairman') return { error: 'Gmail 연결은 회장님만 관리합니다.' }
  const sb = await createSupabaseServerClient()
  const { data, error } = await sb.rpc('google_token_clear')
  if (error || data !== true) {
    console.error('[disconnectGmail]', error?.code)
    return { error: '연결을 해제하지 못했습니다.' }
  }
  revalidatePath('/mail')
  return {}
}

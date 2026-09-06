import { createServerClient } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'

import { requireSupabaseConfig } from './config'

/**
 * 서버용 Supabase 클라이언트.
 *
 * 두 가지를 구분한다.
 *
 *   createSupabaseServerClient()  요청 쿠키에서 세션을 읽는다. 로그인한 사람으로 붙는다.
 *                                 화면(RSC)·Route Handler에서 데이터를 읽을 때 이걸 쓴다.
 *   createSupabaseAnonClient()    세션 없이 publishable key로만 붙는다.
 *                                 헬스체크처럼 "누구로도 로그인하지 않은 상태"가 정답인 곳에만 쓴다.
 *
 * service_role 클라이언트는 없다. 이 프로젝트에 service_role 키 자체가 없고,
 * 야간 AI Job도 권한 매트릭스의 AI Agent 역할로 로그인해서 RLS 안에서 돈다(CLAUDE.md 데이터 원칙).
 */

export async function createSupabaseServerClient(): Promise<SupabaseClient> {
  const { url, publishableKey } = requireSupabaseConfig()
  const cookieStore = await cookies()

  return createServerClient(url, publishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(items) {
        try {
          items.forEach(({ name, value, options }) => cookieStore.set(name, value, options))
        } catch {
          // 서버 컴포넌트에서는 쿠키를 쓸 수 없다. 세션 갱신은 미들웨어/Route Handler가 맡는다.
          // 여기서 던지면 읽기 전용 화면이 통째로 죽는다.
        }
      },
    },
  })
}

export function createSupabaseAnonClient(): SupabaseClient {
  const { url, publishableKey } = requireSupabaseConfig()
  return createServerClient(url, publishableKey, {
    // 쿠키를 아예 주지 않는다. 세션이 실리면 헬스체크 결과가 보는 사람에 따라 달라진다.
    cookies: { getAll: () => [], setAll: () => {} },
  })
}

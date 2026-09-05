'use client'

import { createBrowserClient } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'

import { requireSupabaseConfig } from './config'

/**
 * 브라우저용 Supabase 클라이언트.
 *
 * 세션은 쿠키에 실린다(@supabase/ssr). 그래야 같은 로그인 상태를 서버 컴포넌트·Route Handler가
 * 그대로 읽는다 — localStorage에 두면 서버 쪽에서 보이지 않아 화면마다 권한이 달라진다.
 *
 * publishable key는 브라우저에 노출돼도 되는 값이다. 행 단위 판정은 전부
 * RLS(supabase/migrations/0002_rls.sql)가 하고, 로그인하지 않으면 Default Deny로 아무것도 안 나온다.
 *
 * 서버에서는 이 파일이 아니라 server.ts를 쓴다.
 */

let cached: SupabaseClient | null = null

export function createSupabaseBrowserClient(): SupabaseClient {
  // 컴포넌트마다 새로 만들면 세션 갱신 타이머가 그만큼 늘어난다. 탭당 하나면 충분하다.
  if (cached) return cached
  const { url, publishableKey } = requireSupabaseConfig()
  cached = createBrowserClient(url, publishableKey)
  return cached
}

export { supabaseConfig, requireSupabaseConfig, type SupabaseConfig } from './config'

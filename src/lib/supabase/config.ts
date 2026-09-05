/**
 * Supabase 접속값 한 곳.
 *
 * 브라우저 클라이언트(client.ts)와 서버 클라이언트(server.ts)가 같은 값을 봐야 한다.
 * SDK를 import 하지 않는 파일로 따로 둔 이유는, 서버 코드가 "키가 있나" 하나 물어보려고
 * 브라우저용 번들을 끌고 들어오는 걸 막기 위해서다.
 */

export interface SupabaseConfig {
  url: string
  /** publishable key(sb_publishable_...). 구형 프로젝트는 anon key(JWT)가 같은 자리에 들어간다. */
  publishableKey: string
}

/**
 * 키가 없으면 null. 없다고 앱이 죽으면 dummy 모드로 개발을 못 한다.
 * live 모드에서 null이면 repository/index.ts가 그때 던진다.
 */
export function supabaseConfig(): SupabaseConfig | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !publishableKey) return null

  // 끝의 슬래시와 /rest/v1 을 걷어낸다. SDK는 프로젝트 루트 URL을 받아 스스로 /rest/v1 을 붙이므로,
  // Dashboard에서 REST 엔드포인트를 그대로 복사해 붙이면 /rest/v1/rest/v1 로 나간다.
  const normalized = url.trim().replace(/\/+$/, '').replace(/\/rest\/v1$/, '')
  return { url: normalized, publishableKey: publishableKey.trim() }
}

/** 없으면 던지는 쪽. 클라이언트를 실제로 만들 때만 쓴다. */
export function requireSupabaseConfig(): SupabaseConfig {
  const config = supabaseConfig()
  if (!config) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY 가 없다. .env.local을 확인한다.',
    )
  }
  return config
}

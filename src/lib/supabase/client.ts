/**
 * Supabase(PostgREST) 최소 클라이언트.
 *
 * `@supabase/supabase-js`를 넣지 않았다. Phase 1-A에서 필요한 건 select/insert 두 가지뿐이고,
 * 아직 프로젝트도 키도 없는 상태에서 의존성을 먼저 박으면 되돌리기가 더 비싸다.
 * 나중에 Auth·Realtime·Storage가 필요해지면 이 파일 하나만 공식 SDK로 갈아 끼우면 된다 —
 * 바깥(repository)은 여기서 나가는 함수 두 개만 본다.
 *
 * 이 파일은 서버에서만 호출한다. anon key는 공개돼도 되는 값이지만,
 * 행 단위 판정은 전부 RLS(0002_rls.sql)가 하므로 토큰 없이 부르면 아무것도 나오지 않는 게 정상이다.
 */

export interface SupabaseConfig {
  url: string
  anonKey: string
}

/** 키가 없으면 null. 없다고 앱이 죽으면 dummy 모드로 개발을 못 한다. */
export function supabaseConfig(): SupabaseConfig | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anonKey) return null
  return { url: url.replace(/\/$/, ''), anonKey }
}

export interface SelectQuery {
  /** 가져올 컬럼. 생략하면 전부. 필요한 것만 적는 편이 RLS 실수도 빨리 드러난다. */
  select?: string
  eq?: Record<string, string | number | boolean>
  in?: Record<string, (string | number)[]>
  order?: { column: string; ascending?: boolean }
  limit?: number
}

/** 로그인 사용자의 access token. 없으면 anon으로 나가고 RLS가 대부분을 막는다. */
export interface RequestContext {
  accessToken?: string
}

function buildQuery(query: SelectQuery): string {
  const params = new URLSearchParams()
  params.set('select', query.select ?? '*')

  Object.entries(query.eq ?? {}).forEach(([column, value]) => {
    params.append(column, `eq.${value}`)
  })
  Object.entries(query.in ?? {}).forEach(([column, values]) => {
    params.append(column, `in.(${values.join(',')})`)
  })
  if (query.order) {
    params.set('order', `${query.order.column}.${query.order.ascending === false ? 'desc' : 'asc'}`)
  }
  if (query.limit !== undefined) params.set('limit', String(query.limit))

  return params.toString()
}

function headers(config: SupabaseConfig, ctx: RequestContext): HeadersInit {
  return {
    apikey: config.anonKey,
    Authorization: `Bearer ${ctx.accessToken ?? config.anonKey}`,
    'Content-Type': 'application/json',
  }
}

async function failed(response: Response, table: string): Promise<never> {
  const body = await response.text()
  // 상태코드만 던지면 RLS 거부(401/403)와 스키마 오류(400)를 구분하지 못한다.
  throw new Error(`Supabase ${table} ${response.status}: ${body.slice(0, 300)}`)
}

export async function selectRows<T>(
  table: string,
  query: SelectQuery = {},
  ctx: RequestContext = {},
): Promise<T[]> {
  const config = supabaseConfig()
  if (!config) throw new Error('NEXT_PUBLIC_SUPABASE_URL / ANON_KEY 가 없다. .env.local을 확인한다.')

  const response = await fetch(`${config.url}/rest/v1/${table}?${buildQuery(query)}`, {
    headers: headers(config, ctx),
    // 관제 화면이라 캐시된 숫자를 보여 주면 안 된다.
    cache: 'no-store',
  })
  if (!response.ok) await failed(response, table)
  return (await response.json()) as T[]
}

export async function insertRows<T extends object>(
  table: string,
  rows: T[],
  ctx: RequestContext = {},
): Promise<void> {
  const config = supabaseConfig()
  if (!config) throw new Error('NEXT_PUBLIC_SUPABASE_URL / ANON_KEY 가 없다. .env.local을 확인한다.')

  const response = await fetch(`${config.url}/rest/v1/${table}`, {
    method: 'POST',
    headers: { ...headers(config, ctx), Prefer: 'return=minimal' },
    body: JSON.stringify(rows),
  })
  if (!response.ok) await failed(response, table)
}

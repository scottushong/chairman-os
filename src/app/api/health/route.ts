import { NextResponse } from 'next/server'

import { DATA_MODE } from '@/lib/env'
import { supabaseConfig } from '@/lib/supabase/config'
import { createSupabaseAnonClient } from '@/lib/supabase/server'

/**
 * GET /api/health — Supabase가 붙었는지, 0001의 테이블 14개가 다 서 있는지 한 번에 본다.
 *
 * 읽는 법이 하나 있다. **rows는 "이 요청이 볼 수 있는 행 수"지 테이블의 전체 행 수가 아니다.**
 * 이 라우트는 로그인하지 않은 상태(publishable key만)로 붙고, 0002가 Default Deny라
 * 시드가 519행 들어가 있어도 여기서는 전부 0으로 나온다. 그게 정상이고, 오히려 0이 아니면
 * 그 테이블의 RLS 정책이 익명에게 열려 있다는 뜻이라 그쪽을 봐야 한다.
 *
 * 전체 행 수를 세려면 RLS를 우회해야 하는데, 이 프로젝트에는 그 경로(service_role)가 없다.
 * 우회 경로를 만들지 않는 것이 CH-051·05_Architecture 6번의 요지라 여기서도 만들지 않는다.
 */

// 관제용이라 캐시된 상태를 보여 주면 안 된다.
export const dynamic = 'force-dynamic'
export const revalidate = 0

/** 0001_init.sql이 만드는 물리 테이블 전부. 순서는 0001의 정의 순서다. */
const TABLES = [
  'businesses',
  'finance_kpis',
  'goals',
  'monthly_priorities',
  'critical_risks',
  'milestones',
  'projects',
  'tasks',
  'decisions',
  'alerts',
  'ai_night_outputs',
  'documents',
  'audit_log',
  'user_settings',
] as const

/** PostgREST가 "그런 테이블 없다"고 말하는 두 가지 방식. 나머지 오류와 구분해야 한다. */
const MISSING_TABLE_CODES = new Set(['PGRST205', '42P01'])

interface TableReport {
  table: string
  exists: boolean
  /** 이 요청(익명)이 볼 수 있는 행 수. RLS가 가린 행은 세지 않는다. */
  rows: number | null
  /** PostgREST가 뭐라도 답했는가. false면 네트워크·URL 문제지 스키마 문제가 아니다. */
  reachable: boolean
  error?: string
}

export async function GET() {
  const startedAt = Date.now()
  const config = supabaseConfig()

  if (!config) {
    return NextResponse.json(
      {
        ok: false,
        connected: false,
        data_mode: DATA_MODE,
        reason:
          'NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY 가 없다. .env.local을 확인한다.',
        checked_at: new Date().toISOString(),
      },
      { status: 503 },
    )
  }

  const sb = createSupabaseAnonClient()

  const tables: TableReport[] = await Promise.all(
    TABLES.map(async (table): Promise<TableReport> => {
      // limit(0) — 본문은 빈 배열로 받고 개수만 Content-Range로 받는다.
      // head: true 를 쓰면 안 된다. PostgREST가 HEAD에는 본문 없이 204로 답하는 탓에
      // 없는 테이블도 오류 없이 통과해 "다 있다"는 거짓 초록불이 나온다.
      try {
        const { count, error } = await sb.from(table).select('*', { count: 'exact' }).limit(0)

        if (error) {
          if (MISSING_TABLE_CODES.has(error.code ?? '')) {
            return { table, exists: false, rows: null, reachable: true, error: error.message }
          }
          // 테이블은 있는데 다른 이유로 실패했다. 없는 것과 같이 묶으면 원인을 놓친다.
          return {
            table,
            exists: true,
            rows: null,
            reachable: true,
            error: `${error.code ?? '?'}: ${error.message}`,
          }
        }
        return { table, exists: true, rows: count ?? 0, reachable: true }
      } catch (e) {
        // 여기까지 오면 DB가 아니라 네트워크·URL이 문제다.
        return {
          table,
          exists: false,
          rows: null,
          reachable: false,
          error: e instanceof Error ? e.message : String(e),
        }
      }
    }),
  )

  const missing = tables.filter((t) => !t.exists).map((t) => t.table)
  const errored = tables.filter((t) => t.exists && t.error).map((t) => t.table)

  // 하나라도 PostgREST가 답했으면 연결 자체는 된 것이다.
  // "테이블이 없다"는 답도 답이다 — 연결 실패와 스키마 미적용을 같은 빨간불로 묶으면 원인을 못 찾는다.
  const connected = tables.some((t) => t.reachable)
  const ok = connected && missing.length === 0 && errored.length === 0

  return NextResponse.json(
    {
      ok,
      connected,
      project_url: config.url,
      data_mode: DATA_MODE,
      auth: 'anon (publishable key, 세션 없음)',
      tables_expected: TABLES.length,
      tables_present: tables.filter((t) => t.exists).length,
      missing,
      errored,
      tables,
      note: 'rows는 RLS를 통과해 익명에게 보이는 행 수다. 테이블 전체 행 수가 아니다.',
      elapsed_ms: Date.now() - startedAt,
      checked_at: new Date().toISOString(),
    },
    { status: ok ? 200 : 503 },
  )
}

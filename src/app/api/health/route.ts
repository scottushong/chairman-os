import type { SupabaseClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

import { currentUser } from '@/lib/auth/session'
import { DATA_MODE } from '@/lib/env'
import { supabaseConfig } from '@/lib/supabase/config'
import { createSupabaseAnonClient, createSupabaseServerClient } from '@/lib/supabase/server'

/**
 * GET /api/health — Supabase가 붙었는지, 스키마의 테이블이 다 서 있는지,
 * 그리고 RLS가 양쪽 방향으로 제대로 도는지 한 번에 본다.
 *
 * 두 번 센다. 한 번으로는 답이 안 나오기 때문이다.
 *
 *   anon     세션 없이 publishable key로만 붙는다. 0002가 Default Deny라 전부 0이어야 한다.
 *            여기서 0이 아니면 그 테이블 정책이 익명에게 열려 있다는 뜻이다.
 *   session  이 요청을 보낸 사람의 쿠키로 붙는다. Chairman으로 로그인했다면
 *            0003이 넣은 519행이 그대로 보여야 한다.
 *
 * anon만 재면 "다 0이다"가 RLS가 잘 막은 건지 데이터가 아예 없는 건지 구분되지 않는다.
 * session만 재면 반대로 "다 보인다"가 RLS가 없는 건지 권한이 맞는 건지 구분되지 않는다.
 * 둘을 같이 봐야 각각이 무슨 뜻인지 정해진다.
 *
 * 이 라우트는 로그인 없이도 열린다(proxy matcher에서 제외). 그래야 로그인이 깨졌을 때도
 * 무엇이 고장났는지 볼 수 있다. 세션이 없으면 session 쪽은 null로 나간다.
 */

// 관제용이라 캐시된 상태를 보여 주면 안 된다.
export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * 지금 스키마의 물리 테이블 전부. 0001의 정의 순서로 두고, 뒤에 나중 마이그레이션이 만든 표를 붙인다.
 * 이 배열이 곧 '무엇이 서 있어야 하는가'의 답이라, 표를 만들면 여기도 같이 는다.
 */
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
  // 0008_business_strategy.sql (CH-024)
  'business_strategy',
] as const

/**
 * 마이그레이션이 넣은 시드 행 수. 어긋나면 시드가 덜 들어갔거나 RLS가 가리고 있다.
 *   519  0003_seed.sql (11개 표)
 *   +5   0008_business_strategy.sql (5개사 전략 좌표)
 *
 * 화면에서 회사·문서를 추가하면(CH-002 / CH-042) 이 숫자와 어긋난다. 그건 고장이 아니다 —
 * 그래서 sees_all_seed는 참고값이고 ok 판정에는 들어가지 않는다.
 */
const SEEDED_ROWS = 524

/** 시드가 손대지 않는 표. 위 검산에서 뺀다(0003 파일 머리의 '넣지 않는 테이블'). */
const NOT_SEEDED = new Set(['documents', 'audit_log', 'user_settings'])

/** PostgREST가 "그런 테이블 없다"고 말하는 두 가지 방식. 나머지 오류와 구분해야 한다. */
const MISSING_TABLE_CODES = new Set(['PGRST205', '42P01'])

interface TableReport {
  table: string
  exists: boolean
  /** 이 클라이언트가 볼 수 있는 행 수. RLS가 가린 행은 세지 않는다. */
  rows: number | null
  /** PostgREST가 뭐라도 답했는가. false면 네트워크·URL 문제지 스키마 문제가 아니다. */
  reachable: boolean
  error?: string
}

async function countTables(sb: SupabaseClient): Promise<TableReport[]> {
  return Promise.all(
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
}

/** 0003이 넣은 표들만 더한다. 519와 바로 비교하려고 audit_log 같은 표는 뺀다. */
function seededRows(tables: TableReport[]): number {
  return tables
    .filter((t) => !NOT_SEEDED.has(t.table))
    .reduce((sum, t) => sum + (t.rows ?? 0), 0)
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

  const anonTables = await countTables(createSupabaseAnonClient())

  // 로그인한 사람이 보낸 요청이면 그 사람 눈으로도 한 번 센다.
  const user = await currentUser()
  const sessionTables = user ? await countTables(await createSupabaseServerClient()) : null

  const missing = anonTables.filter((t) => !t.exists).map((t) => t.table)
  const errored = anonTables.filter((t) => t.exists && t.error).map((t) => t.table)

  // 하나라도 PostgREST가 답했으면 연결 자체는 된 것이다.
  // "테이블이 없다"는 답도 답이다 — 연결 실패와 스키마 미적용을 같은 빨간불로 묶으면 원인을 못 찾는다.
  const connected = anonTables.some((t) => t.reachable)

  const anonVisible = seededRows(anonTables)
  const sessionVisible = sessionTables ? seededRows(sessionTables) : null

  // 익명에게 한 행이라도 보이면 그 자체가 사고다. 스키마가 멀쩡해도 초록불을 주지 않는다.
  const rlsClosed = anonVisible === 0
  const ok = connected && missing.length === 0 && errored.length === 0 && rlsClosed

  return NextResponse.json(
    {
      ok,
      connected,
      project_url: config.url,
      data_mode: DATA_MODE,
      tables_expected: TABLES.length,
      tables_present: anonTables.filter((t) => t.exists).length,
      missing,
      errored,

      anon: {
        note: '세션 없이 본 결과. 0002가 Default Deny라 전부 0이어야 정상이다.',
        rls_closed: rlsClosed,
        seeded_rows_visible: anonVisible,
        tables: anonTables,
      },

      session: user
        ? {
            note: '이 요청을 보낸 사람의 쿠키로 본 결과.',
            user: { name: user.name, role: user.role },
            seeded_rows_visible: sessionVisible,
            seeded_rows_expected: SEEDED_ROWS,
            /** Chairman이면 true여야 한다. false면 0002의 read 정책이나 시드를 본다. */
            sees_all_seed: sessionVisible === SEEDED_ROWS,
            tables: sessionTables,
          }
        : {
            note: '로그인하지 않은 요청이라 세션 쪽은 재지 않았다. 브라우저에서 로그인한 뒤 다시 연다.',
            user: null,
          },

      elapsed_ms: Date.now() - startedAt,
      checked_at: new Date().toISOString(),
    },
    { status: ok ? 200 : 503 },
  )
}

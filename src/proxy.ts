import { NextResponse, type NextRequest } from 'next/server'

import { supabaseConfig } from '@/lib/supabase/config'
import { resolveSession } from '@/lib/supabase/proxy'

/**
 * CH-049. 로그인하지 않으면 어떤 화면도 열리지 않는다.
 *
 * Next 16에서 middleware는 proxy로 이름이 바뀌었다(node_modules/next/dist/docs/.../16-proxy.md).
 * 파일은 app/과 같은 높이에 하나만 둔다.
 *
 * 여기서 하는 일은 둘이다.
 *   1) 만료가 다가온 access token 갱신 — 응답 쿠키를 쓸 수 있는 유일한 자리다.
 *   2) 미로그인 요청을 /login으로 돌리기.
 *
 * 이 리다이렉트는 '자물쇠'가 아니라 '안내판'이다. 실제 차단은 RLS가 한다 —
 * 토큰 없이 테이블을 찌르면 Default Deny로 빈 손이 돌아온다(0002_rls.sql).
 * 그래서 여기서는 화면 이동만 하고 권한 판정을 하지 않는다.
 */

/** 로그인하지 않아도 열려야 하는 경로. 늘리지 않는다. */
const PUBLIC_PATHS = ['/login']

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))
}

export async function proxy(request: NextRequest) {
  // Supabase 키가 없으면 로그인이라는 개념 자체가 성립하지 않는다(=순수 dummy 개발).
  // 이때 막아 세우면 아무도 앱을 못 연다. 대신 live 모드는 getRepository()가 따로 막는다.
  if (!supabaseConfig()) return NextResponse.next()

  const { response, user } = await resolveSession(request)
  const { pathname } = request.nextUrl

  if (!user && !isPublic(pathname)) {
    const to = request.nextUrl.clone()
    to.pathname = '/login'
    // 로그인 뒤 원래 보려던 자리로 돌려보낸다. 열린 리다이렉트가 되지 않게 경로만 싣는다.
    to.search = pathname === '/' ? '' : `?next=${encodeURIComponent(pathname)}`
    return NextResponse.redirect(to)
  }

  if (user && pathname === '/login') {
    const to = request.nextUrl.clone()
    to.pathname = '/'
    to.search = ''
    return NextResponse.redirect(to)
  }

  return response
}

export const config = {
  /**
   * 정적 자산과 헬스체크는 지나가게 둔다.
   * /api/health는 '로그인하지 않은 상태'가 정답인 엔드포인트라(route.ts 주석) 여기서 손대면 안 된다.
   */
  matcher: [
    '/((?!_next/static|_next/image|api/health|favicon.ico|.*\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?)$).*)',
  ],
}

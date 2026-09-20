import 'server-only'

/**
 * 카카오 연동 환경변수를 읽는 유일한 자리 (Phase 3-C).
 *
 * 전부 서버 전용이다 — NEXT_PUBLIC_을 붙이지 않는다. 붙이는 순간 REST API 키가
 * 빌드 산출물에 박혀 브라우저로 나간다.
 *
 * redirect_uri를 요청 호스트에서 유도하지 않고 환경변수로 박는 이유:
 * 카카오 콘솔에 등록된 리다이렉트 URI는 고정된 두 개뿐인데(production과 localhost),
 * Vercel Preview는 배포마다 호스트가 바뀐다. 유도하면 Preview에서 매번 KOE006이 난다.
 * 틀린 값으로 조용히 도는 것보다 없을 때 던지는 쪽이 낫다.
 */

export interface KakaoConfig {
  restApiKey: string
  /** 카카오 콘솔에서 Client Secret을 '사용함'으로 켰을 때만. 안 켰으면 빈 문자열. */
  clientSecret: string
  /** 카카오 콘솔에 등록된 것과 **한 글자도 다르지 않아야** 한다. */
  redirectUri: string
  /** 카톡 메시지 안의 '전문 보기'가 가리킬 곳. 끝에 / 를 붙이지 않는다. */
  appBaseUrl: string
}

/**
 * 카카오 로그인을 시작할 때 만들어 두고 돌아왔을 때 대조하는 state 쿠키의 이름.
 *
 * route 파일이 아니라 여기 두는 이유: App Router는 route.ts가 내보내는 것을 정해진 목록으로
 * 검사한다 — 핸들러와 몇몇 설정값 말고 상수를 하나 더 export 하면 타입 검사에서 걸린다.
 * /api/kakao/auth가 심고 /api/kakao/callback이 읽으므로 둘 다 아는 자리가 필요하다.
 */
export const KAKAO_STATE_COOKIE = 'kakao_oauth_state'

export function kakaoConfig(): KakaoConfig | null {
  const restApiKey = process.env.KAKAO_REST_API_KEY
  const redirectUri = process.env.KAKAO_REDIRECT_URI
  const appBaseUrl = process.env.APP_BASE_URL
  if (!restApiKey || !redirectUri || !appBaseUrl) return null
  return {
    restApiKey,
    clientSecret: process.env.KAKAO_CLIENT_SECRET ?? '',
    redirectUri,
    appBaseUrl: appBaseUrl.replace(/\/+$/, ''),
  }
}

export function requireKakaoConfig(): KakaoConfig {
  const c = kakaoConfig()
  if (!c) {
    throw new Error(
      'KAKAO_REST_API_KEY / KAKAO_REDIRECT_URI / APP_BASE_URL 중 빠진 것이 있다. ' +
        '.env.local 또는 Vercel 환경변수를 확인한다(docs/OPERATIONS.md 1절).',
    )
  }
  return c
}

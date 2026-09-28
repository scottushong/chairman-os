import 'server-only'

/**
 * 회장 Gmail 읽기 전용 연결의 설정 (Phase 9 블록 4, 0039).
 *
 * 값은 회장이 넣는다 — 이 파일은 **이름만** 정한다:
 *   GOOGLE_CLIENT_ID        Google Cloud 콘솔 › OAuth 클라이언트 ID(웹 애플리케이션)
 *   GOOGLE_CLIENT_SECRET    같은 클라이언트의 시크릿
 *   GOOGLE_REDIRECT_URI     선택. 없으면 `${APP_BASE_URL}/api/google/callback`.
 *                           콘솔의 «승인된 리디렉션 URI»와 **한 글자도 다르지 않아야** 한다.
 *   APP_BASE_URL            이미 있다(카카오와 같이 쓴다).
 *
 * **범위는 gmail.readonly 하나다.** 보내기 · 수정 범위를 요청하지 않는다(«앱에서 보내지 않음»).
 * 연결한 계정 주소는 openid/email 범위 대신 Gmail의 users/me/profile로 읽는다 — 범위를 하나라도
 * 덜 받는다. 0039 google_token_save()가 보내기 범위가 섞인 토큰을 한 번 더 거부한다.
 */

export const GMAIL_READONLY_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly'
export const GOOGLE_STATE_COOKIE = 'google_oauth_state'

export interface GoogleConfig {
  clientId: string
  clientSecret: string
  redirectUri: string
}

export function googleConfig(): GoogleConfig | null {
  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  const base = process.env.APP_BASE_URL?.replace(/\/+$/, '')
  const redirectUri = process.env.GOOGLE_REDIRECT_URI ?? (base ? `${base}/api/google/callback` : undefined)
  if (!clientId || !clientSecret || !redirectUri) return null
  return { clientId, clientSecret, redirectUri }
}

export function requireGoogleConfig(): GoogleConfig {
  const c = googleConfig()
  if (!c) {
    throw new Error(
      'GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / (GOOGLE_REDIRECT_URI 또는 APP_BASE_URL) 중 빠진 것이 있다. ' +
        '.env.local 또는 Vercel 환경변수를 확인한다.',
    )
  }
  return c
}

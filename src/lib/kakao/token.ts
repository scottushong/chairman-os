import 'server-only'

import { requireKakaoConfig } from './config'

/**
 * 카카오 OAuth 토큰 교환 (Phase 3-C).
 *
 * 이 파일은 Supabase를 모른다. 카카오와 HTTP로 말하는 일만 한다 —
 * 저장은 lib/kakao/send-brief.ts와 /api/kakao/callback이 0023의 함수로 한다.
 * 둘을 갈라 둔 덕에 '카카오가 뭘 돌려주나'와 '우리가 그걸 어디에 넣나'를 따로 고칠 수 있다.
 *
 * 카카오 문서: https://developers.kakao.com/docs/latest/ko/kakaologin/rest-api
 */

const AUTHORIZE = 'https://kauth.kakao.com/oauth/authorize'
const TOKEN = 'https://kauth.kakao.com/oauth/token'

/** 선택 동의항목. 이것이 없으면 로그인은 되고 발송만 -402로 거절된다. */
export const TALK_MESSAGE_SCOPE = 'talk_message'

export interface KakaoTokenSet {
  accessToken: string
  refreshToken: string
  /** ISO 8601 */
  expiresAt: string
  refreshExpiresAt: string
  /** 카카오가 실제로 준 동의항목. 공백 구분. */
  scopes: string
}

export interface KakaoRefreshResult {
  accessToken: string
  expiresAt: string
  /** 카카오는 만료가 한 달 미만일 때만 새 refresh_token을 준다. 안 준 회차는 null이다. */
  refreshToken: string | null
  refreshExpiresAt: string | null
}

interface KakaoTokenResponse {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  refresh_token_expires_in?: number
  scope?: string
  error?: string
  error_description?: string
}

function at(seconds: number | undefined, fallbackSeconds: number): string {
  return new Date(Date.now() + (seconds ?? fallbackSeconds) * 1000).toISOString()
}

/** 카카오 로그인 화면 주소. state는 호출부가 만들어 쿠키에도 심는다(CSRF). */
export function authorizeUrl(state: string): string {
  const c = requireKakaoConfig()
  const q = new URLSearchParams({
    response_type: 'code',
    client_id: c.restApiKey,
    redirect_uri: c.redirectUri,
    scope: TALK_MESSAGE_SCOPE,
    state,
  })
  return `${AUTHORIZE}?${q}`
}

async function postToken(body: URLSearchParams): Promise<KakaoTokenResponse> {
  const res = await fetch(TOKEN, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded;charset=utf-8' },
    body,
    cache: 'no-store',
  })
  const json = (await res.json().catch(() => ({}))) as KakaoTokenResponse
  if (!res.ok || json.error || !json.access_token) {
    // error_description에 우리가 보낸 redirect_uri가 그대로 들어오는 경우가 있다.
    // 비밀은 아니지만 500자로 자른다 — 감사 기록과 로그에 그대로 실릴 문장이다.
    throw new Error(
      `카카오 토큰 요청 실패 (HTTP ${res.status}) ${json.error ?? ''} ${json.error_description ?? ''}`
        .trim()
        .slice(0, 500),
    )
  }
  return json
}

/** 인가코드 → 토큰 한 벌. /api/kakao/callback이 부른다. */
export async function exchangeCode(code: string): Promise<KakaoTokenSet> {
  const c = requireKakaoConfig()
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: c.restApiKey,
    redirect_uri: c.redirectUri,
    code,
  })
  if (c.clientSecret) body.set('client_secret', c.clientSecret)

  const json = await postToken(body)
  if (!json.refresh_token) {
    throw new Error('카카오가 refresh_token을 주지 않았다. 앱의 동의항목 설정을 확인한다.')
  }
  return {
    accessToken: json.access_token!,
    refreshToken: json.refresh_token,
    // 카카오 기본값: access 6시간(21600초), refresh 60일(5184000초).
    // 응답에 값이 있으면 그것을 쓰고, 없을 때만 이 기본값으로 떨어진다.
    expiresAt: at(json.expires_in, 21_600),
    refreshExpiresAt: at(json.refresh_token_expires_in, 5_184_000),
    scopes: json.scope ?? '',
  }
}

/** refresh_token → 새 access_token. 야간 Job과 테스트 발송이 부른다. */
export async function refreshTokens(refreshToken: string): Promise<KakaoRefreshResult> {
  const c = requireKakaoConfig()
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: c.restApiKey,
    refresh_token: refreshToken,
  })
  if (c.clientSecret) body.set('client_secret', c.clientSecret)

  const json = await postToken(body)
  return {
    accessToken: json.access_token!,
    expiresAt: at(json.expires_in, 21_600),
    // 안 준 회차는 null로 넘긴다. 0023 kakao_token_refreshed()가 coalesce로 기존 값을 지킨다 —
    // 여기서 빈 문자열을 보내면 그 방어가 무력해진다.
    refreshToken: json.refresh_token ?? null,
    refreshExpiresAt: json.refresh_token ? at(json.refresh_token_expires_in, 5_184_000) : null,
  }
}

/** 동의항목에 talk_message가 있는가. 없으면 연결은 됐어도 발송이 -402로 거절된다. */
export function canSendMessage(scopes: string): boolean {
  return scopes.split(/[\s,]+/).includes(TALK_MESSAGE_SCOPE)
}

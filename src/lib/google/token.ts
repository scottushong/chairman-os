import 'server-only'

import { GMAIL_READONLY_SCOPE, requireGoogleConfig } from './config'

/**
 * Google OAuth 2.0 (웹 서버 흐름) — 인가 주소 · 코드 교환 · access token 갱신.
 * 토큰 값은 이 파일과 0039 definer 함수 사이만 오간다. 로그에 찍지 않는다.
 */

export interface GoogleTokenSet {
  accessToken: string
  /** 다시 동의할 때만 온다. 안 오면 빈 문자열 — 0039 save가 기존 값을 지킨다. */
  refreshToken: string
  expiresAt: string
  scopes: string
}

const AUTH = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN = 'https://oauth2.googleapis.com/token'

export function authorizeUrl(state: string): string {
  const c = requireGoogleConfig()
  const q = new URLSearchParams({
    client_id: c.clientId,
    redirect_uri: c.redirectUri,
    response_type: 'code',
    scope: GMAIL_READONLY_SCOPE,
    // refresh token을 받으려면 offline, 매번 받으려면 consent. 브리핑이 사람 없이 돌아야 한다.
    access_type: 'offline',
    prompt: 'consent',
    // 이미 다른 앱에 준 범위를 합쳐 받지 않는다 — 보내기 범위가 섞여 들어오는 길을 막는다.
    include_granted_scopes: 'false',
    state,
  })
  return `${AUTH}?${q.toString()}`
}

async function tokenCall(body: Record<string, string>): Promise<Record<string, unknown>> {
  const res = await fetch(TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
    cache: 'no-store',
  })
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) {
    // 오류 코드만 남긴다(invalid_grant 등). 응답 본문에 토큰이 섞일 일은 없지만 통째로 찍지 않는다.
    throw new Error(`google_token_${String(json.error ?? res.status)}`)
  }
  return json
}

export async function exchangeCode(code: string): Promise<GoogleTokenSet> {
  const c = requireGoogleConfig()
  const j = await tokenCall({
    code,
    client_id: c.clientId,
    client_secret: c.clientSecret,
    redirect_uri: c.redirectUri,
    grant_type: 'authorization_code',
  })
  return {
    accessToken: String(j.access_token ?? ''),
    refreshToken: String(j.refresh_token ?? ''),
    expiresAt: new Date(Date.now() + Number(j.expires_in ?? 3600) * 1000).toISOString(),
    scopes: String(j.scope ?? ''),
  }
}

export async function refreshAccess(refreshToken: string): Promise<{ accessToken: string; expiresAt: string }> {
  const c = requireGoogleConfig()
  const j = await tokenCall({
    refresh_token: refreshToken,
    client_id: c.clientId,
    client_secret: c.clientSecret,
    grant_type: 'refresh_token',
  })
  return {
    accessToken: String(j.access_token ?? ''),
    expiresAt: new Date(Date.now() + Number(j.expires_in ?? 3600) * 1000).toISOString(),
  }
}

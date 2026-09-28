import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

import { googleConfig } from './config'
import { refreshAccess } from './token'

/**
 * 회장의 «오늘 받은 메일» (Phase 9 블록 4).
 *
 * **제목 · 발신자 · 시각만 읽는다**(format=metadata). 본문은 요청하지도 저장하지도 않는다.
 * 이 앱은 메일을 보관하지 않는다 — 열면 Gmail 새 탭으로 간다.
 *
 * 토큰은 0039 google_token_for_read()로만 얻는다. 만료가 5분 안이면 갱신하고
 * google_token_refreshed()로 그 줄에만 되쓴다(카카오 send-brief와 같은 흐름).
 */

export interface MailItem {
  id: string
  threadId: string
  subject: string
  /** 표시 이름 (없으면 주소) */
  from: string
  /** 소문자 주소 */
  fromEmail: string
  receivedAt: string
  /** Gmail 새 탭 주소 */
  url: string
}

export type MailResult =
  | { state: 'unconfigured' }
  | { state: 'disconnected' }
  | { state: 'error'; reason: string }
  | { state: 'ok'; email: string; items: MailItem[] }

const API = 'https://gmail.googleapis.com/gmail/v1/users/me'

/** 'Kim Lee <kim.lee@x.com>' → ['Kim Lee', 'kim.lee@x.com'] */
export function parseFrom(raw: string): { name: string; email: string } {
  const m = raw.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/)
  if (m) return { name: m[1].trim() || m[2].trim(), email: m[2].trim().toLowerCase() }
  return { name: raw.trim(), email: raw.trim().toLowerCase() }
}

/** 지금 이 시간대에서 «오늘 0시»의 epoch 초. Gmail 검색어 after:는 epoch 초를 받는다. */
export function startOfTodayEpoch(tz: string, now = new Date()): number {
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(now)
  // 그 날짜의 0시를 그 시간대로 — 오프셋을 한 번 재서 맞춘다.
  const guess = new Date(`${ymd}T00:00:00Z`)
  const asTz = new Date(guess.toLocaleString('en-US', { timeZone: tz }))
  const offset = asTz.getTime() - guess.getTime()
  return Math.floor((guess.getTime() - offset) / 1000)
}

async function gmail<T>(token: string, path: string): Promise<T> {
  const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' })
  if (!res.ok) throw new Error(`gmail_${res.status}`)
  return (await res.json()) as T
}

interface TokenRow {
  user_id: string
  email: string
  access_token: string
  refresh_token: string
  expires_at: string
}

/** 쓸 수 있는 access token. 없으면 null(연결 안 됨). */
async function accessToken(sb: SupabaseClient): Promise<{ token: string; email: string } | null> {
  const { data, error } = await sb.rpc('google_token_for_read')
  if (error) throw new Error(`google_token_for_read ${error.code ?? '?'}`)
  const row = (data as TokenRow[] | null)?.[0]
  if (!row) return null
  if (new Date(row.expires_at).getTime() - Date.now() > 5 * 60_000) {
    return { token: row.access_token, email: row.email }
  }
  const fresh = await refreshAccess(row.refresh_token)
  await sb.rpc('google_token_refreshed', {
    p_user_id: row.user_id,
    p_access: fresh.accessToken,
    p_expires: fresh.expiresAt,
  })
  return { token: fresh.accessToken, email: row.email }
}

export async function todayMail(sb: SupabaseClient, tz = 'Asia/Seoul', limit = 50): Promise<MailResult> {
  if (!googleConfig()) return { state: 'unconfigured' }
  let auth: { token: string; email: string } | null
  try {
    auth = await accessToken(sb)
  } catch (e) {
    const reason = e instanceof Error ? e.message : 'unknown'
    // 회장이 Google 쪽에서 권한을 거둔 경우 — 다시 연결해야 한다.
    return reason.includes('invalid_grant') ? { state: 'disconnected' } : { state: 'error', reason }
  }
  if (!auth) return { state: 'disconnected' }

  try {
    const after = startOfTodayEpoch(tz)
    const list = await gmail<{ messages?: { id: string; threadId: string }[] }>(
      auth.token,
      `/messages?maxResults=${limit}&q=${encodeURIComponent(`after:${after} -in:sent -in:chats`)}`,
    )
    const ids = list.messages ?? []
    const account = encodeURIComponent(auth.email || '0')
    const items = await Promise.all(
      ids.map(async ({ id, threadId }) => {
        const m = await gmail<{ internalDate: string; payload?: { headers?: { name: string; value: string }[] } }>(
          auth!.token,
          `/messages/${id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From`,
        )
        const header = (n: string) => m.payload?.headers?.find((h) => h.name.toLowerCase() === n)?.value ?? ''
        const from = parseFrom(header('from'))
        return {
          id,
          threadId,
          subject: header('subject') || '(제목 없음)',
          from: from.name,
          fromEmail: from.email,
          receivedAt: new Date(Number(m.internalDate)).toISOString(),
          url: `https://mail.google.com/mail/u/${account}/#all/${threadId}`,
        }
      }),
    )
    items.sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))
    return { state: 'ok', email: auth.email, items }
  } catch (e) {
    return { state: 'error', reason: e instanceof Error ? e.message : 'unknown' }
  }
}

/** 브리핑 요약: 오늘 N통, 그중 키맨(email 일치) M통. 이름은 세지 않는다 — 주소만. */
export function summarizeMail(items: MailItem[], keymanEmails: Set<string>) {
  const fromKeymen = items.filter((i) => keymanEmails.has(i.fromEmail))
  return {
    count: items.length,
    keyman: fromKeymen.length,
    keymanFrom: [...new Set(fromKeymen.map((i) => i.from))].slice(0, 5),
  }
}

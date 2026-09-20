import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

import type { IsoDate } from '@/types'

import { kakaoConfig } from './config'
import { buildKakaoBriefText, sendKakaoMemo } from './message'
import { canSendMessage, refreshTokens } from './token'

/**
 * 브리핑 한 줄을 회장 카카오톡으로 보낸다 (Phase 3-C).
 *
 * 야간 Job의 **마지막 단계**다. 그래서 이 파일의 모든 실패 경로는 던지지 않고 돌려준다 —
 * 카카오가 죽었다고 브리핑 행까지 Failed가 되면, 아침에 /ai를 열어도 "어젯밤 실패"만 보인다.
 * 발송은 브리핑의 배달 수단이지 브리핑 자체가 아니다.
 *
 * audit_log에 남기는 것도 같은 이유다. 응답 JSON은 cron 로그에만 남고 아무도 안 본다 —
 * "지난주 화요일에 카톡이 왔던가"는 감사 기록에서만 답할 수 있다.
 *
 * 토큰을 읽고 쓰는 유일한 길은 0023의 함수 둘이다(kakao_token_for_send / kakao_token_refreshed).
 * 이 세션은 AIAgent이고, AIAgent는 chairman_kakao_token 표에 select 문 한 줄도 못 던진다.
 */

export interface KakaoSendResult {
  sent: boolean
  /** 보낼 조건이 아니어서 안 보낸 경우(연결 없음, 설정 없음 등). 실패가 아니다. */
  skipped?: string
  error?: string
}

interface TokenRow {
  user_id: string
  access_token: string
  refresh_token: string
  expires_at: string
  refresh_expires_at: string
  scopes: string
}

/** 만료 5분 전부터는 이미 만료된 것으로 본다. 발송 도중에 넘어가는 경계를 없앤다. */
const EARLY_REFRESH_MS = 5 * 60 * 1000

export async function sendKakaoBrief(opts: {
  /** AIAgent(야간 Job) 또는 Chairman(테스트 발송) 세션. */
  sb: SupabaseClient
  /** audit_log의 actor. 세션 주인의 user_id다. */
  actorUserId: string
  actorRole: 'AIAgent' | 'Chairman'
  runDate: IsoDate
  /** 그룹 브리핑 summary 전문. 앞 2~3문장만 나간다. 그룹 브리핑 자체가 없으면(생성 실패) null. */
  summary: string | null
  /** 'D-780'. 진행 중인 장기 프로젝트가 없으면 null. */
  dDay: string | null
  projectTitle: string | null
  /** 'cron' | 'manual' | 'test'. 감사 기록의 note에 그대로 들어간다. */
  trigger: string
}): Promise<KakaoSendResult> {
  const config = kakaoConfig()
  if (!config) {
    return await done(opts, { sent: false, skipped: '카카오 환경변수가 없다' })
  }

  // night-brief.ts는 그룹 브리핑이 실패해도(groupBrief === null) cron이면 이 함수를 부른다 —
  // 그래야 "왜 카톡이 안 왔지"에 audit_log가 답한다. 보낼 내용이 없으니 여기서 skipped로 끝낸다.
  if (!opts.summary || !opts.summary.trim()) {
    return await done(opts, { sent: false, skipped: '그룹 브리핑이 없다' })
  }
  const summary = opts.summary

  // ① 토큰. 0023의 keyhole 하나가 유일한 길이다.
  const { data, error } = await opts.sb.rpc('kakao_token_for_send')
  if (error) {
    return await done(opts, { sent: false, error: `kakao_token_for_send ${error.code ?? '?'}: ${error.message}` })
  }
  const token = (data as TokenRow[] | null)?.[0]
  if (!token) {
    // 연결이 없는 것과 이 세션이 못 읽는 것을 구분하지 않는다(0023의 계약).
    return await done(opts, { sent: false, skipped: '카카오가 연결되어 있지 않다' })
  }

  if (Date.parse(token.refresh_expires_at) <= Date.now()) {
    return await done(opts, { sent: false, skipped: 'refresh_token이 만료됐다 — 회장이 다시 연결해야 한다' })
  }
  if (!canSendMessage(token.scopes)) {
    // refresh로는 안 고쳐진다. 동의는 사람이 카카오 화면에서 주는 것이다.
    return await done(opts, { sent: false, skipped: '카카오톡 메시지 전송 동의가 없다 — 다시 연결해야 한다' })
  }

  // ② 만료가 가까우면 먼저 갱신한다. 갱신 자체가 실패하면 낡은 토큰으로 한 번 시도해 본다 —
  //    카카오의 만료 시각 계산과 우리 시계가 어긋났을 수 있고, 안 보내는 것보다 시도가 낫다.
  //    refreshToken도 같이 들고 다닌다 — 카카오가 이 회차에 회전시켰으면(만료 한 달 미만)
  //    ③의 재시도가 그 새 값을 써야 한다. 여기서 갱신했는데 ③에서 낡은 refresh_token으로
  //    다시 시도하면, DB에는 이미 새 토큰이 있는데도 "이미 회전되어 무효한" 값으로 실패한다.
  let accessToken = token.access_token
  let refreshToken = token.refresh_token
  if (Date.parse(token.expires_at) - Date.now() <= EARLY_REFRESH_MS) {
    const refreshed = await tryRefresh(opts.sb, refreshToken)
    if (refreshed) {
      accessToken = refreshed.accessToken
      refreshToken = refreshed.refreshToken
    }
  }

  const text = buildKakaoBriefText({
    dDay: opts.dDay,
    projectTitle: opts.projectTitle,
    summary,
  })
  const linkUrl = `${config.appBaseUrl}/ai?date=${opts.runDate}`

  // ③ 보낸다. -401이면 토큰 문제이므로 한 번만 갱신하고 다시 시도한다.
  //    refreshToken은 ②를 거쳤으면 그 회차의 최신값이다(회전이 없었으면 원래 값 그대로).
  let failure = await sendKakaoMemo({ accessToken, text, linkUrl })
  if (failure?.code === -401) {
    const refreshed = await tryRefresh(opts.sb, refreshToken)
    if (refreshed) failure = await sendKakaoMemo({ accessToken: refreshed.accessToken, text, linkUrl })
  }

  return await done(opts, failure ? { sent: false, error: failure.message } : { sent: true })
}

/**
 * refresh 한 번. 실패는 삼킨다 — 호출부가 낡은 토큰으로 계속 가거나 발송 실패로 끝낸다.
 * 성공하면 0023 kakao_token_refreshed()로 되쓴다. AIAgent에게는 그 함수가 유일한 쓰기 길이고,
 * 그 함수는 행을 만들지 못한다 — 연결이 사라진 뒤 Job이 되살리는 일은 일어나지 않는다.
 *
 * refreshToken을 accessToken과 같이 돌려준다. 카카오가 이 회차에 새 refresh_token을 줬으면
 * (만료 한 달 미만일 때만) 그 값을, 안 줬으면 넘겨받은 값을 그대로 — DB의 coalesce와 같은
 * 규칙을 호출부의 로컬 변수에도 적용해서, 다음 호출이 이미 회전되어 무효해진 값을 다시
 * 쓰는 일이 없게 한다. RPC에 보내는 p_refresh 자체는 여전히 next.refreshToken(회전 없으면
 * null)이다 — kakao_token_refreshed()의 coalesce가 그 null에 기대고 있어서 여기서 채우지 않는다.
 */
async function tryRefresh(
  sb: SupabaseClient,
  refreshToken: string,
): Promise<{ accessToken: string; refreshToken: string } | null> {
  try {
    const next = await refreshTokens(refreshToken)
    const { error } = await sb.rpc('kakao_token_refreshed', {
      p_access: next.accessToken,
      p_expires: next.expiresAt,
      p_refresh: next.refreshToken,
      p_refresh_expires: next.refreshExpiresAt,
    })
    if (error) console.error('[kakao] token write', error.code, error.message)
    return { accessToken: next.accessToken, refreshToken: next.refreshToken ?? refreshToken }
  } catch (e) {
    console.error('[kakao] refresh', e instanceof Error ? e.message : String(e))
    return null
  }
}

/**
 * 결과를 audit_log에 남기고 그대로 돌려준다. 이 기록 자체가 실패해도 발송 결과는 바꾸지 않는다 —
 * 카톡은 이미 갔거나 안 갔고, 기록을 못 남겼다고 그 사실이 달라지지는 않는다.
 *
 * action은 0023이 더한 kakao_sent / kakao_failed다. '보낼 조건이 아니어서 안 보냄'(skipped)도
 * kakao_failed로 남긴다 — 낱말은 거칠지만 note가 정확히 말한다(0022가 delete_request로
 * 실제 삭제를 적은 것과 같은 절제다). 조용히 아무 기록도 없으면 "오늘 카톡이 왜 안 왔지"에
 * 답할 자리가 없어진다.
 */
async function done(
  opts: { sb: SupabaseClient; actorUserId: string; actorRole: string; runDate: IsoDate; trigger: string },
  result: KakaoSendResult,
): Promise<KakaoSendResult> {
  const note = result.sent
    ? `카카오 아침 알림 발송 (${opts.trigger})`
    : `카카오 아침 알림 실패 (${opts.trigger}) — ${result.skipped ?? result.error ?? '원인 미상'}`

  const { error } = await opts.sb.from('audit_log').insert({
    actor_user_id: opts.actorUserId,
    actor_role: opts.actorRole,
    action: result.sent ? 'kakao_sent' : 'kakao_failed',
    entity_table: 'chairman_kakao_token',
    entity_id: opts.runDate,
    // 토큰은 여기 실리지 않는다. 실린 적 없는 값은 감사 기록을 읽는 사람에게도 새지 않는다.
    after: { run_date: opts.runDate, trigger: opts.trigger, sent: result.sent, reason: result.skipped ?? result.error ?? null },
    note,
  })
  if (error) console.error('[kakao] audit', error.code, error.message)

  if (!result.sent) console.error('[kakao]', note)
  return result
}

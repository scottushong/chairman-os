import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

import type { IsoDate } from '@/types'

import { kakaoConfig } from './config'
import { buildKakaoBriefText } from './message'
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

/**
 * 카카오톡 '나에게 보내기'. 텍스트 템플릿 하나만 쓴다.
 *
 * 문자열을 만드는 message.ts가 아니라 여기 사는 이유: message.ts는 import가 하나도 없는
 * 순수 함수 파일이라 `server-only`를 붙이지 못한다(scripts/check-kakao.ts가 별칭 해석 없이
 * 그 파일만 읽어 돌아야 한다). 그러면 client component가 실수로 이 fetch를 번들에 끌어와도
 * 막을 장치가 없다 — 그래서 네트워크를 부르는 쪽은 `server-only`가 붙은 이 파일에 둔다.
 *
 * 성공은 { result_code: 0 }이고, 실패는 HTTP 200으로도 온다 — 그래서 res.ok만 보지 않는다.
 * 자주 보게 될 코드:
 *   -401  토큰이 만료·무효 (호출부가 refresh로 한 번 되살려 본다)
 *   -402  talk_message 동의가 없다 (사람이 다시 연결해야 한다. refresh로는 안 고쳐진다)
 */
export interface KakaoSendFailure {
  /** 카카오가 준 code. HTTP 계층에서 실패하면 null. */
  code: number | null
  message: string
}

export async function sendKakaoMemo(opts: {
  accessToken: string
  text: string
  /** '전문 보기' 버튼과 텍스트 링크가 가리킬 절대 주소. */
  linkUrl: string
}): Promise<KakaoSendFailure | null> {
  const templateObject = {
    object_type: 'text',
    text: opts.text,
    link: { web_url: opts.linkUrl, mobile_web_url: opts.linkUrl },
    button_title: '전문 보기',
  }

  let res: Response
  try {
    res = await fetch('https://kapi.kakao.com/v2/api/talk/memo/default/send', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${opts.accessToken}`,
        'content-type': 'application/x-www-form-urlencoded;charset=utf-8',
      },
      body: new URLSearchParams({ template_object: JSON.stringify(templateObject) }),
      cache: 'no-store',
    })
  } catch (e) {
    return { code: null, message: `카카오 호출 실패: ${e instanceof Error ? e.message : String(e)}` }
  }

  const json = (await res.json().catch(() => ({}))) as {
    result_code?: number
    code?: number
    msg?: string
  }
  if (res.ok && json.result_code === 0) return null
  return {
    code: json.code ?? null,
    message: `카카오 발송 실패 (HTTP ${res.status}, code ${json.code ?? '?'}) ${json.msg ?? ''}`
      .trim()
      .slice(0, 500),
  }
}

export async function sendKakaoBrief(opts: {
  /** AIAgent(야간 Job) 또는 Chairman(테스트 발송) 세션. */
  sb: SupabaseClient
  /** audit_log의 actor. 세션 주인의 user_id다. */
  actorUserId: string
  actorRole: 'AIAgent' | 'Chairman'
  /**
   * 브리핑 행의 날짜(KST). 링크(/ai?date=)와 감사 기록의 entity_id가 이것이다 —
   * ai_night_outputs.run_date가 KST라서 그 축을 그대로 따라간다(0029 머리 주석).
   */
  runDate: IsoDate
  /**
   * 회장 현지 날짜 (Phase 3-C 현지 시간). 메시지의 월요일 줄이 이 값으로 판정되고,
   * 감사 기록에도 같이 남는다. 대개 runDate와 같지만 같다는 보장이 없다 —
   * 보장 없는 것을 같다고 쓰는 자리가 이 저장소에서 가장 자주 틀렸다.
   */
  localDate: IsoDate
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
    const refreshed = await tryRefresh(opts.sb, token.user_id, refreshToken)
    if (refreshed) {
      accessToken = refreshed.accessToken
      refreshToken = refreshed.refreshToken
    }
  }

  const text = buildKakaoBriefText({
    dDay: opts.dDay,
    projectTitle: opts.projectTitle,
    summary,
    // 월요일 줄은 **회장이 있는 곳의 월요일**에 붙는다. 링크는 여전히 runDate(KST)다 —
    // /ai의 날짜 축이 ai_night_outputs.run_date이기 때문이다. 두 날짜가 서로 다른 것을
    // 가리킨다는 사실을 여기서 한 번 드러내 둔다.
    localDate: opts.localDate,
  })
  const linkUrl = `${config.appBaseUrl}/ai?date=${opts.runDate}`

  // ③ 보낸다. -401이면 토큰 문제이므로 한 번만 갱신하고 다시 시도한다.
  //    refreshToken은 ②를 거쳤으면 그 회차의 최신값이다(회전이 없었으면 원래 값 그대로).
  let failure = await sendKakaoMemo({ accessToken, text, linkUrl })
  if (failure?.code === -401) {
    const refreshed = await tryRefresh(opts.sb, token.user_id, refreshToken)
    if (refreshed) failure = await sendKakaoMemo({ accessToken: refreshed.accessToken, text, linkUrl })
  }

  return await done(opts, failure ? { sent: false, error: failure.message } : { sent: true })
}

/**
 * refresh 한 번. 실패는 삼킨다 — 호출부가 낡은 토큰으로 계속 가거나 발송 실패로 끝낸다.
 * 성공하면 0023 kakao_token_refreshed()로 되쓴다. AIAgent에게는 그 함수가 유일한 쓰기 길이고,
 * 그 함수는 행을 만들지 못한다 — 연결이 사라진 뒤 Job이 되살리는 일은 일어나지 않는다.
 *
 * userId는 같은 회차의 kakao_token_for_send()가 준 값이다. 이 값을 넘겨야 갱신이 **그 행에만**
 * 닿는다 — 회장이 둘이면(승계 기간) 표 전체 update는 한 계정의 토큰으로 다른 계정 행을 덮어쓴다.
 *
 * refreshToken을 accessToken과 같이 돌려준다. 카카오가 이 회차에 새 refresh_token을 줬으면
 * (만료 한 달 미만일 때만) 그 값을, 안 줬으면 넘겨받은 값을 그대로 — DB의 coalesce와 같은
 * 규칙을 호출부의 로컬 변수에도 적용해서, 다음 호출이 이미 회전되어 무효해진 값을 다시
 * 쓰는 일이 없게 한다. RPC에 보내는 p_refresh 자체는 여전히 next.refreshToken(회전 없으면
 * null)이다 — kakao_token_refreshed()의 coalesce가 그 null에 기대고 있어서 여기서 채우지 않는다.
 */
async function tryRefresh(
  sb: SupabaseClient,
  userId: string,
  refreshToken: string,
): Promise<{ accessToken: string; refreshToken: string } | null> {
  try {
    const next = await refreshTokens(refreshToken)
    const { error } = await sb.rpc('kakao_token_refreshed', {
      p_user_id: userId,
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
  opts: {
    sb: SupabaseClient
    actorUserId: string
    actorRole: string
    runDate: IsoDate
    localDate: IsoDate
    trigger: string
  },
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
    after: {
      run_date: opts.runDate,
      // 현지 날짜를 같이 남긴다. "지난주 화요일에 카톡이 왔던가"를 회장이 있던 곳의
      // 날짜로 물을 수 있어야 한다 — 감사 기록만 KST면 그 질문에 답이 안 나온다.
      local_date: opts.localDate,
      trigger: opts.trigger,
      sent: result.sent,
      reason: result.skipped ?? result.error ?? null,
    },
    note,
  })
  if (error) console.error('[kakao] audit', error.code, error.message)

  if (!result.sent) console.error('[kakao]', note)
  return result
}

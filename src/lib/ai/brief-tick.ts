import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

import {
  decideBriefTick,
  decideChairmanTimezone,
  type TickDecision,
  type TimezoneDecision,
  type TripWindow,
} from '@/lib/chairman-timezone'
import { signInServiceAccount } from '@/lib/supabase/service-account'
import type { IsoDate } from '@/types'

/**
 * GitHub Actions 틱이 물어보는 것 (Phase 3-C 현지 시간).
 *
 * 매시 정각 UTC에 `/api/cron/night-brief?tick=1`이 불린다. 그 한 번의 호출이
 * "**지금 회장이 있는 곳이 아침인가, 그리고 오늘 것을 아직 안 했나**"를 묻는 것이고,
 * 이 파일이 DB에서 재료를 모아 순수 함수 둘(lib/chairman-timezone.ts)에 넘긴다.
 *
 * 판정 자체는 여기 없다 — 규칙은 전부 저 순수 함수에 있고 scripts/check-brief-schedule.ts가
 * DB 없이 그것을 잰다. 이 파일이 하는 일은 재료 세 가지를 읽어 오는 것뿐이다.
 *
 *   ③① user_settings.brief_tz / current_tz   0029 chairman_brief_timezone()
 *   ②  kind='Trip' + timezone이 있는 일정      events (0017 + 0029)
 *   장부 마지막 현지 날짜                        0029 chairman_brief_send_status()
 *
 * 세 가지 다 AIAgent 세션으로 읽는다. 이 저장소에 service_role은 없고, 야간 Job은
 * 늘 RLS 안에서 돈다(night-brief.ts ①).
 */

/** 출장 후보를 얼마나 거슬러 올라가 읽는가. 회장의 출장은 몇 주지 몇 달이 아니다. */
const TRIP_LOOKBACK_DAYS = 60
const DAY_MS = 86_400_000

/** UTC 기준 'YYYY-MM-DD'. 질의 범위를 넉넉히 잡는 데만 쓴다 — 정확한 창 판정은 순수 함수가 한다. */
function utcDate(ms: number): IsoDate {
  return new Date(ms).toISOString().slice(0, 10)
}

/**
 * ② 후보가 될 출장들. 범위를 UTC 날짜로 헐겁게 잡는 것이 의도다 —
 * 회장의 시간대는 아직 정해지지 않았고(그걸 정하려고 이걸 읽는 중이다), 어느 시간대에서든
 * '오늘'은 UTC 오늘의 ±1일 안에 있다. 정확한 포함 판정은 decideChairmanTimezone()이 한다.
 *
 * 읽기가 실패하면 빈 배열이다. 출장 하나를 못 읽었다고 아침 알림이 통째로 멈추면 안 된다 —
 * ②가 빠지면 ①로 내려가고, 회장이 마지막으로 앱을 연 곳이 대개 지금 있는 곳이다.
 */
async function readTrips(sb: SupabaseClient, now: Date): Promise<TripWindow[]> {
  const lo = utcDate(now.getTime() - TRIP_LOOKBACK_DAYS * DAY_MS)
  const hi = utcDate(now.getTime() + DAY_MS)
  const { data, error } = await sb
    .from('events')
    .select('title,starts_on,ends_on,timezone')
    .eq('kind', 'Trip')
    .not('timezone', 'is', null)
    .gte('starts_on', lo)
    .lte('starts_on', hi)
    .order('starts_on', { ascending: false })
    .returns<TripWindow[]>()
  if (error) {
    console.error('[brief-tick] trips', error.code, error.message)
    return []
  }
  return data ?? []
}

/**
 * 회장의 시간대 하나. Chairman 세션에서도 AIAgent 세션에서도 같은 답을 내야 한다 —
 * /api/kakao/test(회장이 누르는 테스트 발송)가 아침에 실제로 갈 메시지와 같은 날짜·같은
 * 월요일 판정을 쓰려면 이 함수를 지나야 한다.
 */
export async function resolveChairmanTimezone(sb: SupabaseClient, now: Date): Promise<TimezoneDecision> {
  let manualTz: string | null = null
  let deviceTz: string | null = null
  const { data, error } = await sb.rpc('chairman_brief_timezone')
  if (error) {
    // 0023의 계약 그대로 — '없는 것'과 '못 읽는 것'을 구분하지 않는다. 둘 다 자동 경로다.
    console.error('[brief-tick] chairman_brief_timezone', error.code, error.message)
  } else {
    const row = (data as { brief_tz: string | null; current_tz: string | null }[] | null)?.[0]
    manualTz = row?.brief_tz ?? null
    deviceTz = row?.current_tz ?? null
  }

  // ③이 이미 정해졌으면 출장을 읽을 이유가 없다. 왕복 한 번을 아끼는 것보다,
  // '수동값이 있으면 다른 것을 아예 안 본다'가 규칙과 같은 모양이라는 점이 중요하다.
  const trips = manualTz ? [] : await readTrips(sb, now)
  return decideChairmanTimezone({ manualTz, trips, deviceTz, now })
}

export interface BriefTickDecision extends TickDecision {
  timezone: string
  source: TimezoneDecision['source']
  /** source === 'trip'일 때 어느 출장인지. 204 응답 헤더와 로그에만 쓴다. */
  tripTitle: string | null
  /** 재료를 못 읽어 판정 자체가 불가능했을 때. 이때는 틱을 실패(500)로 돌려준다. */
  error?: string
}

/**
 * 이 틱에 무엇을 할지 정한다. 필요하면 '포기' 기록까지 여기서 남기고 끝낸다.
 *
 * 포기(too_late) 기록을 여기서 남기는 이유: 그 경로는 Job을 돌리지 않으므로
 * runNightBrief()를 지나지 않는다. 세션이 열려 있는 이 자리가 아니면 적을 곳이 없다.
 */
export async function decideBriefTickNow(now = new Date()): Promise<BriefTickDecision> {
  let sb: SupabaseClient
  try {
    ;({ sb } = await signInServiceAccount({
      emailEnv: 'AI_AGENT_EMAIL',
      passwordEnv: 'AI_AGENT_PASSWORD',
      role: 'AIAgent',
    }))
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.error('[brief-tick] sign-in', message)
    // 시간대를 못 정한 채 '보낸다'고 판정하면 엉뚱한 시각에 알림이 간다. 아무것도 하지 않는다.
    return {
      outcome: 'too_early',
      localDate: '' as IsoDate,
      localHour: Number.NaN,
      send: false,
      record: false,
      reason: 'AIAgent 로그인 실패',
      timezone: '',
      source: 'default',
      tripTitle: null,
      error: message,
    }
  }

  try {
    const tz = await resolveChairmanTimezone(sb, now)

    let lastRunLocalDate: IsoDate | null = null
    const { data, error } = await sb.rpc('chairman_brief_send_status', { p_local_date: null })
    if (error) {
      // 장부를 못 읽으면 '아직 안 보냈다'로 본다. 중복 한 번이 침묵 하루보다 낫다 —
      // 이 저장소가 카카오 발송에서 내내 고른 쪽이다(send-brief.ts ②).
      console.error('[brief-tick] chairman_brief_send_status', error.code, error.message)
    } else {
      lastRunLocalDate = (data as { local_date: IsoDate }[] | null)?.[0]?.local_date ?? null
    }

    const decision = decideBriefTick({ timezone: tz.timezone, now, lastRunLocalDate })

    // 현지 10시를 넘겨 포기한 날. 장부에만 남기고 끝낸다 — 아침에 카톡이 없었던 이유가
    // 어딘가에는 적혀 있어야 한다.
    if (decision.record && !decision.send) {
      const { error: ledgerError } = await sb.rpc('chairman_brief_send_record', {
        p_local_date: decision.localDate,
        p_timezone: tz.timezone,
        p_sent: false,
        p_reason: decision.reason,
      })
      if (ledgerError) console.error('[brief-tick] ledger', ledgerError.code, ledgerError.message)
    }

    return {
      ...decision,
      timezone: tz.timezone,
      source: tz.source,
      tripTitle: tz.trip?.title ?? null,
    }
  } finally {
    await sb.auth.signOut().catch(() => {})
  }
}

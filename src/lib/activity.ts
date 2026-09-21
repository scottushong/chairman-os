import { isValidTimezone, localDateIn, localHourIn } from '@/lib/chairman-timezone'

/**
 * 접속 현황의 순수 규칙 (블록 7).
 *
 * 화면·Server Action·두 어댑터·검사 스크립트가 같은 상수와 같은 판정을 봐야 한다.
 * 이 파일에는 DB도 headers()도 없다 — 그래서 scripts/check-activity.ts가 DB 없이
 * 이상 징후 다섯 종을 직접 때릴 수 있다.
 *
 * ■ 이 기능이 남기지 않는 것 ■
 *   IP 원본을 남기지 않는다. 도시까지다. 0031의 record_read()에는 p_ip 인자 자체가 없고,
 *   도시 칸에 IP가 새는 것도 DB가 한 번 더 막는다(activity_city). 이 파일에서는
 *   ActivityEvent에 ip 칸이 없는 것이 그 약속의 타입 쪽 표현이다.
 */

/** 같은 사람·같은 경로의 재진입을 한 줄로 치는 창. 억제는 DB 안에서 일어난다(0031 4절). */
export const ACTIVITY_DEDUP_MINUTES = 5

/** '현재 접속 중'의 정의. 원문 그대로 최근 5분이다. */
export const ACTIVITY_ONLINE_MINUTES = 5

/** 사용자별 타임라인이 보여 주는 기간. 원문 그대로 30일이다. */
export const ACTIVITY_TIMELINE_DAYS = 30

/**
 * 보관 기간. 이 날이 지난 열람 기록은 회장에게도 본인에게도 보이지 않는다.
 * 행을 지우지는 않는다 — audit_log는 append-only이고, 지울 수 있게 만드는 순간
 * 감사 기록이 아니게 된다. 집행은 0031 6절의 audit_log_read 정책이 한다.
 */
export const ACTIVITY_RETENTION_DAYS = 180

export type ActivityKind = 'page' | 'document' | 'finance'

export const ACTIVITY_KIND_LABEL_KO: Record<ActivityKind, string> = {
  page: '페이지 진입',
  document: '문서 열람',
  finance: '재무 화면 조회',
}

/**
 * 접속 현황 한 줄. 0031 activity_events()가 돌려주는 모양 그대로다.
 *
 * **ip 칸이 없다.** 없는 것이 이 타입의 요구다 — 칸을 만들어 두면 언젠가 누가 채운다.
 */
export interface ActivityEvent {
  occurred_at: string
  actor_user_id: string | null
  actor_role: string | null
  action: 'read' | 'login'
  /** 문서 id 등. 페이지 진입에는 없다. */
  entity_id: string | null
  /** 그 id가 어느 표의 것인가('documents'). 페이지 진입에는 없다. */
  entity_table: string | null
  business_id: string | null
  path: string | null
  kind: ActivityKind | null
  /** 'Chrome · Windows'. 원문 User-Agent가 아니다. 못 읽었으면 null. */
  device: string | null
  /** 'Seoul, KR'. Vercel 엣지 밖에서는 null이고 화면은 '—'를 그린다. */
  city: string | null
  /** user_settings.current_tz(0029). 없으면 null — 서울로 추측하지 않는다. */
  tz: string | null
  /** 로그인만 성공/실패가 있다. 열람 기록은 null. */
  ok: boolean | null
}

/** 이상 징후 판정에 필요한 사람 쪽 사실. 조직도(user_profiles)에서 온다. */
export interface ActivityPerson {
  user_id: string
  display_name: string
  /** 0025 status. 'left'면 퇴사 처리된 계정이다. */
  status: 'active' | 'left'
  left_on: string | null
  revoked_at: string | null
}

/* ------------------------------------------------------------------ 기기 요약 */

/**
 * User-Agent에서 브라우저와 OS만 대충 읽는다.
 *
 * 라이브러리를 들이지 않는다 — 이 값이 쓰이는 자리는 "무슨 기기였나" 한 줄이고,
 * 그 한 줄을 위해 UA 파서를 의존성으로 들이면 유지비가 값보다 크다.
 * 모르면 null이다. 'Unknown Browser'라고 적어 두면 그게 이름인 줄 안다.
 *
 * **원문 문자열 전체를 싣지 않는다.** 원문 UA는 글꼴·확장·빌드 번호까지 담은 지문이고,
 * 그것을 몇 달 치 쌓으면 이 표가 사람을 추적하는 표가 된다. 0031의 activity_device()가
 * DB 쪽에서 한 번 더 같은 것을 막는다 — 이 함수를 안 거친 값은 저장되지 않는다.
 *
 * lib/session-info.ts가 '지금 이 기기' 한 줄에 쓰던 것과 같은 규칙이다. 두 벌을
 * 만들지 않으려고 여기로 옮겼다 — 설정 화면과 접속 현황이 같은 기기를 다르게 부르면
 * 회장이 둘을 대조할 수 없다.
 */
export function summarizeUserAgent(ua: string | null | undefined): string | null {
  if (!ua) return null
  const browser =
    /Edg\//.test(ua) ? 'Edge'
    : /OPR\//.test(ua) ? 'Opera'
    : /Chrome\//.test(ua) ? 'Chrome'
    : /Safari\//.test(ua) && /Version\//.test(ua) ? 'Safari'
    : /Firefox\//.test(ua) ? 'Firefox'
    : null
  const os =
    /Windows NT/.test(ua) ? 'Windows'
    : /iPhone|iPad/.test(ua) ? 'iOS'
    : /Mac OS X/.test(ua) ? 'macOS'
    : /Android/.test(ua) ? 'Android'
    : /Linux/.test(ua) ? 'Linux'
    : null
  if (!browser && !os) return null
  return [browser, os].filter(Boolean).join(' · ')
}

/* ------------------------------------------------------------------ 이상 징후 */

export const ANOMALY_KIND = [
  'late_night',
  'new_origin',
  'doc_burst',
  'login_failures',
  'revoked_active',
] as const
export type AnomalyKind = (typeof ANOMALY_KIND)[number]

export const ANOMALY_LABEL_KO: Record<AnomalyKind, string> = {
  late_night: '심야 접속',
  new_origin: '새 기기 · 새 도시',
  doc_burst: '짧은 시간에 많은 문서 열람',
  login_failures: '로그인 실패 연속',
  revoked_active: '퇴사 처리된 계정의 활동',
}

/** 심야의 끝. 이 시 **미만**이 심야다(00:00~05:59). */
export const LATE_NIGHT_UNTIL_HOUR = 6

/** 문서 폭주 — 이 분 안에 이 건수 이상. */
export const DOC_BURST_WINDOW_MINUTES = 10
export const DOC_BURST_COUNT = 8

/** 로그인 실패 연속 — 이 분 안에 이 횟수 이상. */
export const LOGIN_FAIL_WINDOW_MINUTES = 5
export const LOGIN_FAIL_COUNT = 3

/**
 * **무엇을 이상으로 보는가.** 화면이 이 문장을 그대로 보여 준다.
 *
 * "수상하다"고만 말하고 근거를 안 보여 주는 태그는 만들지 않는다. 태그마다
 *   ① 무엇을 재는가(이 표)
 *   ② 이번 건의 실제 숫자(ActivityAnomaly.reason)
 * 둘이 같이 화면에 오른다. 그래야 회장이 태그를 의심할 수 있고, 의심할 수 있는
 * 태그만이 쓸모가 있다.
 */
export const ANOMALY_BASIS_KO: Record<AnomalyKind, string> = {
  late_night: `접속한 사람의 현지 시간으로 00:00~0${LATE_NIGHT_UNTIL_HOUR}:00 사이의 기록. 시간대를 모르는 기록(current_tz가 비어 있는 계정)은 판정하지 않습니다 — 서울로 가정하면 해외에 있는 사람이 매일 심야로 찍힙니다.`,
  new_origin: `앞선 ${ACTIVITY_TIMELINE_DAYS}일 기록에 한 번도 없던 기기 또는 도시. 기준선이 아예 없는 사람(첫 기록)은 판정하지 않습니다 — 처음은 늘 처음입니다.`,
  doc_burst: `${DOC_BURST_WINDOW_MINUTES}분 안에 문서 ${DOC_BURST_COUNT}건 이상 열람. 5분 중복 억제 뒤의 숫자라 새로고침은 세지 않습니다.`,
  login_failures: `${LOGIN_FAIL_WINDOW_MINUTES}분 안에 로그인 실패 ${LOGIN_FAIL_COUNT}회 이상. 실패 기록은 실재하는 활성 계정에 대해서만 남습니다.`,
  revoked_active:
    '퇴사 처리(status=left) 또는 권한 회수 시각 이후에 남은 활동. 한 건이라도 있으면 표시합니다 — 회수된 계정은 아무것도 못 해야 정상입니다.',
}

export interface ActivityAnomaly {
  kind: AnomalyKind
  user_id: string
  /** 대표 시각(가장 최근 근거). 화면이 이 순서로 줄을 세운다. */
  at: string
  /** 화면에 그대로 뿌리는 근거 한 줄. **숫자가 들어 있어야 한다.** */
  reason: string
}

const MINUTE = 60_000

function ms(iso: string): number {
  return new Date(iso).getTime()
}

/**
 * 'HH:MM'. 시간대를 알면 그 시간대로, 모르면 KST로 적는다.
 *
 * **여기서 KST로 떨어지는 것은 추측이 아니다.** 화면의 다른 모든 시각이 KST로 그려지고
 * (lib/format.ts formatDateTime이 Asia/Seoul을 못 박는다), 이 근거 문장은 그 시각들 옆에
 * 나란히 놓인다. UTC로 적으면 같은 사건이 한 줄 위에서는 07:58, 근거 문장에서는 22:58로
 * 보여 읽는 사람이 두 사건인 줄 안다 — 근거를 보여 주려다 근거를 못 읽게 만드는 셈이다.
 *
 * ① 심야 판정은 이 함수를 쓰지 않는다. 그쪽은 **그 사람의 현지 시각**이 판정의 입력이라
 * 시간대를 모르면 아예 판정하지 않는다. 이 함수가 하는 일은 표시뿐이다.
 */
function clock(iso: string, tz: string | null): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: tz && isValidTimezone(tz) ? tz : 'Asia/Seoul',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(iso))
}

/**
 * 이상 징후 다섯 종.
 *
 * 입력은 **회장이 실제로 읽은 기록 그대로**다(activity_events가 준 것). 화면에서
 * 한 번 더 거르지 않는다 — 거르면 규칙이 두 곳으로 갈라진다.
 *
 * 한 사람의 같은 종류는 하나로 묶는다. 사건마다 한 줄씩 뱉으면 폭주 한 번이 태그
 * 아홉 개가 되고, 그 순간 태그 목록이 사건 목록이 되어 아무도 안 읽는다.
 */
export function detectAnomalies(
  events: ActivityEvent[],
  people: ActivityPerson[],
): ActivityAnomaly[] {
  const out: ActivityAnomaly[] = []
  const byUser = new Map<string, ActivityEvent[]>()
  for (const e of events) {
    if (!e.actor_user_id) continue
    const list = byUser.get(e.actor_user_id)
    if (list) list.push(e)
    else byUser.set(e.actor_user_id, [e])
  }

  const personOf = new Map(people.map((p) => [p.user_id, p]))

  for (const [userId, raw] of byUser) {
    // 오래된 것부터. 아래 판정 넷이 전부 '앞선 것 대비 지금'이라 순서가 뜻을 가진다.
    const list = [...raw].sort((a, b) => ms(a.occurred_at) - ms(b.occurred_at))

    out.push(...lateNight(userId, list))
    out.push(...newOrigin(userId, list))
    out.push(...docBurst(userId, list))
    out.push(...loginFailures(userId, list))

    const person = personOf.get(userId)
    if (person) out.push(...revokedActive(userId, person, list))
  }

  // 최근 것이 위다. 같은 시각이면 종류 이름으로 고정한다 — 순서가 실행마다 달라지면
  // 화면을 두 번 열었을 때 같은 목록이 다르게 보인다.
  return out.sort(
    (a, b) => ms(b.at) - ms(a.at) || a.kind.localeCompare(b.kind) || a.user_id.localeCompare(b.user_id),
  )
}

/** ① 심야 접속. 시간대를 모르면 판정하지 않는다 — 서울로 가정하면 해외 근무가 매일 심야가 된다. */
function lateNight(userId: string, list: ActivityEvent[]): ActivityAnomaly[] {
  // 현지 날짜별로 묶는다. 하룻밤에 태그 하나다.
  const nights = new Map<string, { count: number; last: ActivityEvent }>()
  for (const e of list) {
    if (!e.tz || !isValidTimezone(e.tz)) continue
    const hour = localHourIn(e.tz, new Date(e.occurred_at))
    if (!Number.isFinite(hour) || hour >= LATE_NIGHT_UNTIL_HOUR) continue
    const key = `${localDateIn(e.tz, new Date(e.occurred_at))}|${e.tz}`
    const seen = nights.get(key)
    if (seen) {
      seen.count += 1
      seen.last = e
    } else {
      nights.set(key, { count: 1, last: e })
    }
  }

  return [...nights.entries()].map(([key, night]) => {
    const [date, tz] = key.split('|')
    return {
      kind: 'late_night' as const,
      user_id: userId,
      at: night.last.occurred_at,
      reason:
        `${date} 현지 ${clock(night.last.occurred_at, tz)} (${tz}) 접속` +
        `${night.count > 1 ? ` 외 ${night.count - 1}건` : ''}` +
        ` — 00:00~0${LATE_NIGHT_UNTIL_HOUR}:00 사이입니다.`,
    }
  })
}

/** ② 새 기기 · 새 도시. 기준선이 없으면 판정하지 않는다 — 처음은 늘 처음이다. */
function newOrigin(userId: string, list: ActivityEvent[]): ActivityAnomaly[] {
  const out: ActivityAnomaly[] = []

  for (const field of ['device', 'city'] as const) {
    const seen = new Set<string>()
    for (const e of list) {
      const value = e[field]
      if (!value) continue
      if (seen.size === 0) {
        // 첫 값은 기준선이 된다. 기준선 자체를 이상으로 부르지 않는다.
        seen.add(value)
        continue
      }
      if (seen.has(value)) continue

      const baseline = [...seen]
      out.push({
        kind: 'new_origin',
        user_id: userId,
        at: e.occurred_at,
        reason:
          `${field === 'device' ? '새 기기' : '새 도시'} '${value}' — ` +
          `앞선 ${ACTIVITY_TIMELINE_DAYS}일 기록의 ${field === 'device' ? '기기' : '도시'}는 ` +
          `${baseline.map((v) => `'${v}'`).join(' · ')} ${baseline.length}종이었습니다.`,
      })
      seen.add(value)
    }
  }

  return out
}

/** ③ 짧은 시간에 많은 문서 열람. 5분 중복 억제 뒤의 숫자라 새로고침은 안 센다. */
function docBurst(userId: string, list: ActivityEvent[]): ActivityAnomaly[] {
  const docs = list.filter((e) => e.action === 'read' && e.kind === 'document')
  if (docs.length < DOC_BURST_COUNT) return []

  let best: { from: ActivityEvent; to: ActivityEvent; count: number } | null = null
  let head = 0
  for (let tail = 0; tail < docs.length; tail += 1) {
    while (ms(docs[tail].occurred_at) - ms(docs[head].occurred_at) > DOC_BURST_WINDOW_MINUTES * MINUTE) {
      head += 1
    }
    const count = tail - head + 1
    if (count >= DOC_BURST_COUNT && (!best || count > best.count)) {
      best = { from: docs[head], to: docs[tail], count }
    }
  }
  if (!best) return []

  const tz = best.to.tz
  return [
    {
      kind: 'doc_burst',
      user_id: userId,
      at: best.to.occurred_at,
      reason:
        `${DOC_BURST_WINDOW_MINUTES}분 안에 문서 ${best.count}건 열람 ` +
        `(${clock(best.from.occurred_at, tz)}~${clock(best.to.occurred_at, tz)}).`,
    },
  ]
}

/** ④ 로그인 실패 연속. */
function loginFailures(userId: string, list: ActivityEvent[]): ActivityAnomaly[] {
  const fails = list.filter((e) => e.action === 'login' && e.ok === false)
  if (fails.length < LOGIN_FAIL_COUNT) return []

  let best: { from: ActivityEvent; to: ActivityEvent; count: number } | null = null
  let head = 0
  for (let tail = 0; tail < fails.length; tail += 1) {
    while (ms(fails[tail].occurred_at) - ms(fails[head].occurred_at) > LOGIN_FAIL_WINDOW_MINUTES * MINUTE) {
      head += 1
    }
    const count = tail - head + 1
    if (count >= LOGIN_FAIL_COUNT && (!best || count > best.count)) {
      best = { from: fails[head], to: fails[tail], count }
    }
  }
  if (!best) return []

  const tz = best.to.tz
  return [
    {
      kind: 'login_failures',
      user_id: userId,
      at: best.to.occurred_at,
      reason:
        `${LOGIN_FAIL_WINDOW_MINUTES}분 안에 로그인 실패 ${best.count}회 ` +
        `(${clock(best.from.occurred_at, tz)}~${clock(best.to.occurred_at, tz)}).`,
    },
  ]
}

/** ⑤ 퇴사 처리된 계정의 활동. 한 건이라도 있으면 말한다. */
function revokedActive(
  userId: string,
  person: ActivityPerson,
  list: ActivityEvent[],
): ActivityAnomaly[] {
  // 언제부터가 '퇴사 뒤'인가. 권한 회수 시각이 있으면 그것이 정확하고,
  // 없으면 퇴사일의 시작(00:00 KST 기준의 날짜 비교)으로 본다.
  const cutoffIso = person.revoked_at ?? (person.left_on ? `${person.left_on}T00:00:00.000Z` : null)
  if (person.status !== 'left' && !person.revoked_at) return []
  if (!cutoffIso) return []

  const cutoff = ms(cutoffIso)
  const after = list.filter((e) => ms(e.occurred_at) >= cutoff)
  if (after.length === 0) return []

  const last = after[after.length - 1]
  return [
    {
      kind: 'revoked_active',
      user_id: userId,
      at: last.occurred_at,
      reason:
        `${(person.revoked_at ?? person.left_on ?? '').slice(0, 10)} 퇴사·권한 회수 뒤의 활동 ` +
        `${after.length}건 — 가장 최근 ${last.occurred_at.slice(0, 16).replace('T', ' ')} ` +
        `${last.path ?? '경로 없음'}.`,
    },
  ]
}

/* ------------------------------------------------------------------ 화면이 쓰는 묶기 */

export interface OnlineNow {
  user_id: string
  last_seen: string
  path: string | null
  device: string | null
  city: string | null
}

/** '현재 접속 중' — 최근 5분 안에 열람 기록이 있는 사람. 사람마다 마지막 한 줄. */
export function onlineNow(events: ActivityEvent[], now: Date = new Date()): OnlineNow[] {
  const floor = now.getTime() - ACTIVITY_ONLINE_MINUTES * MINUTE
  const latest = new Map<string, ActivityEvent>()
  for (const e of events) {
    if (e.action !== 'read' || !e.actor_user_id) continue
    if (ms(e.occurred_at) < floor) continue
    const seen = latest.get(e.actor_user_id)
    if (!seen || ms(e.occurred_at) > ms(seen.occurred_at)) latest.set(e.actor_user_id, e)
  }
  return [...latest.values()]
    .sort((a, b) => ms(b.occurred_at) - ms(a.occurred_at))
    .map((e) => ({
      user_id: e.actor_user_id!,
      last_seen: e.occurred_at,
      path: e.path,
      device: e.device,
      city: e.city,
    }))
}

/** '오늘 로그인' — KST 오늘의 login 줄. 성공·실패 그대로. */
export function loginsOn(events: ActivityEvent[], kstDate: string): ActivityEvent[] {
  return events
    .filter((e) => e.action === 'login' && localDateIn('Asia/Seoul', new Date(e.occurred_at)) === kstDate)
    .sort((a, b) => ms(b.occurred_at) - ms(a.occurred_at))
}

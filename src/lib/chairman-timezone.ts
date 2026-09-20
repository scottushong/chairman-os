/**
 * 회장이 지금 어느 시간대에 있는가, 그리고 지금 아침 브리핑을 보낼 때인가 (Phase 3-C 현지 시간).
 *
 * 2026-09-21 이전까지 아침 알림은 07:00 KST 고정이었다(vercel.json의 `0 22 * * *`).
 * 이제는 **회장이 있는 곳의 06:00**에 간다. 스케줄러도 Vercel cron이 아니라
 * GitHub Actions가 매시 정각 UTC에 던지는 틱이고, '지금이 그때인가'는 이 파일이 답한다.
 *
 * **이 파일에는 순수 함수만 둔다.** 네트워크도 DB도 시계도 여기서 건드리지 않는다 —
 * `now`는 전부 인자로 받는다. lib/kakao/message.ts가 같은 이유로 import를 하나도 두지 않은 것과
 * 같은 판단이다. 이 규칙 덕분에 scripts/check-brief-schedule.ts가 DB 없이, 시계를 멈추지 않고,
 * 서울·뉴욕·런던 세 시간대에서 같은 UTC 순간이 다른 판정을 내는지까지 잴 수 있다.
 *
 * `Intl`만은 쓴다. 시간대 변환은 이 파일의 본업이고, Intl은 실행 환경의 시계가 아니라
 * IANA 데이터베이스를 읽는다 — `now`를 인자로 받는 한 같은 입력에 늘 같은 출력이다.
 */

import type { IsoDate } from '@/types'

/** 시간대를 못 정했을 때의 바닥. 회장의 집이자 그룹의 본사다. */
export const DEFAULT_TIMEZONE = 'Asia/Seoul'

/**
 * 아침 알림이 가는 현지 시각(시). 06:00~06:59가 제자리다.
 */
export const BRIEF_HOUR = 6

/**
 * 늦게 온 틱을 받아 주는 상한(현지 시각, 이 시각부터는 포기). 06:00~09:59까지는 보낸다.
 *
 * **왜 창이 필요한가.** GitHub Actions의 schedule은 정시에 오지 않는다 — 몇 분에서 수십 분,
 * 러너가 붐비는 시간대에는 그 이상 밀린다. `hour === 6`만 보면 07:04에 도착한 틱이
 * 그날을 통째로 건너뛰고, 회장은 아무 알림도 못 받은 채 하루를 시작한다.
 * 늦게라도 가는 것이 안 가는 것보다 낫다.
 *
 * **왜 상한이 있는가.** 점심에 도착하는 '아침 브리핑'은 알림이 아니라 잡음이다.
 * 10시를 넘기면 그날은 포기하고 장부에만 남긴다(chairman_brief_sends.reason) —
 * 조용히 아무것도 안 남기면 "오늘 왜 카톡이 없었지"에 답할 자리가 없어진다.
 */
export const BRIEF_GIVE_UP_HOUR = 10

/**
 * 설정 화면의 드롭다운에 세우는 목록. IANA 전체(400개 남짓)를 회장에게 내밀 이유가 없다 —
 * 그룹의 사업과 회장의 동선이 닿는 곳만 추렸다. 여기 없는 도시로 가는 날은 ①(접속 기기)이
 * 자동으로 따라온다. 목록에 없다고 그 시간대에 못 가는 것이 아니다.
 */
export const BRIEF_TIMEZONE_OPTIONS: readonly { id: string; label: string }[] = [
  { id: 'Asia/Seoul', label: '서울 (KST)' },
  { id: 'Asia/Tokyo', label: '도쿄 (JST)' },
  { id: 'Asia/Shanghai', label: '상하이 (CST)' },
  { id: 'Asia/Singapore', label: '싱가포르 (SGT)' },
  { id: 'Asia/Dubai', label: '두바이 (GST)' },
  { id: 'Europe/Frankfurt', label: '프랑크푸르트' },
  { id: 'Europe/London', label: '런던' },
  { id: 'America/New_York', label: '뉴욕' },
  { id: 'America/Los_Angeles', label: '로스앤젤레스' },
]

/**
 * Intl이 실제로 해석하는 IANA 시간대인가.
 *
 * DB의 check 제약은 모양만 본다(0029 1절) — 'Asia/Seoul'과 'Asia/Seoull'을 구분하지 못한다.
 * 실재 여부를 아는 것은 Intl뿐이고, 틀린 값은 여기서 걸러 자동 경로로 떨어뜨린다.
 * 던지지 않는 이유: 회장이 예전에 저장해 둔 시간대가 어느 tzdata 갱신에서 사라졌을 때
 * 아침 알림이 통째로 멈추는 것보다, 서울 06시로 가는 편이 낫다.
 */
export function isValidTimezone(tz: string | null | undefined): tz is string {
  if (!tz || typeof tz !== 'string') return false
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

/** 그 시간대에서의 'YYYY-MM-DD'. kstToday()가 Asia/Seoul 하나로 하던 일의 일반형이다. */
export function localDateIn(tz: string, now: Date): IsoDate {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(now) as IsoDate
}

/** 그 시간대에서의 시(0~23). hourCycle을 못 박는다 — h12/h24는 자정을 0이 아니라 12/24로 준다. */
export function localHourIn(tz: string, now: Date): number {
  const part = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: '2-digit',
    hourCycle: 'h23',
  })
    .formatToParts(now)
    .find((p) => p.type === 'hour')
  return part ? Number(part.value) : Number.NaN
}

/** 어떤 근거로 이 시간대가 뽑혔나. 화면이 회장에게 한 줄로 설명하는 데 쓴다. */
export type TimezoneSource = 'manual' | 'trip' | 'device' | 'default'

export const TIMEZONE_SOURCE_LABEL_KO: Record<TimezoneSource, string> = {
  manual: '직접 지정',
  trip: '출장 일정',
  device: '마지막 접속 기기',
  default: '기본값',
}

/** ②가 보는 일정 한 건. events(0017 + 0029 timezone)에서 kind='Trip'인 행만 온다. */
export interface TripWindow {
  title: string
  starts_on: IsoDate
  /** null = 하루짜리(0017). starts_on을 복사해 넣지 않는다. */
  ends_on: IsoDate | null
  /** 0029에서 더한 칸. null이면 이 출장은 ②에서 빠진다 — 도시 이름을 시간대로 추측하지 않는다. */
  timezone: string | null
}

export interface TimezoneInputs {
  /** ③ user_settings.brief_tz. 회장이 손으로 고른 값. null = 자동. */
  manualTz: string | null
  /** ② 출장 일정들. 필터하지 않은 채 넘겨도 된다 — 창 판정은 이 함수가 한다. */
  trips: TripWindow[]
  /** ① user_settings.current_tz. 마지막 접속 기기가 보낸 값. */
  deviceTz: string | null
  now: Date
}

export interface TimezoneDecision {
  timezone: string
  source: TimezoneSource
  /** source === 'trip'일 때만 채워진다. 화면이 "베를린 출장 중" 같은 한 줄을 만드는 데 쓴다. */
  trip: TripWindow | null
}

/**
 * 회장의 시간대를 정한다 — **③ 수동 > ② 출장 > ① 접속 > Asia/Seoul.**
 *
 * 원문 스펙이 한 번 뒤집은 자리다("우선순위 ①②③... 아니, ③수동 > ②출장 > ①접속").
 * 최종은 뒤엣것이고 이 순서가 그것이다.
 *
 * ③이 맨 위인 이유: 회장이 직접 고른 값을 시스템의 추정이 뒤집으면, 고칠 방법이 화면에
 * 없어진다. ②가 ①보다 위인 이유: 출장은 **미래에 대한 선언**이고 접속 기기는 **과거의 흔적**이다.
 * 비행기를 타고 아직 앱을 안 열었으면 ①은 어제 있던 도시를 가리킨다.
 *
 * **출장 창을 무슨 날짜로 재는가.** ②가 '오늘'을 물으려면 시간대가 이미 있어야 하는데
 * 그 시간대를 정하려고 ②를 보는 중이다. 닭과 달걀이라, 기준 날짜는 ①(없으면 Asia/Seoul)로
 * 먼저 찍는다. 출장의 시작·끝은 날짜 단위라 몇 시간의 차이로 창이 달라지는 경우는
 * 출발일 당일 밤과 귀국일 새벽뿐이고, 그 경계에서 ①과 ② 중 어느 쪽으로 기울어도
 * 회장이 실제로 있는 곳과 하루 이상 어긋나지 않는다.
 *
 * 겹치는 출장이 여럿이면 **나중에 시작한 것**이 이긴다. 큰 일정 안에 작은 일정이 든 모양
 * (유럽 2주 출장 안의 런던 3일)에서 안쪽이 실제 위치이기 때문이다.
 */
export function decideChairmanTimezone(input: TimezoneInputs): TimezoneDecision {
  // ③ 수동. 값이 Intl에 없는 문자열이면 없는 것으로 친다 — 틀린 값 때문에 알림이 멈추지 않는다.
  if (isValidTimezone(input.manualTz)) {
    return { timezone: input.manualTz, source: 'manual', trip: null }
  }

  const baseTz = isValidTimezone(input.deviceTz) ? input.deviceTz : DEFAULT_TIMEZONE
  const baseDate = localDateIn(baseTz, input.now)

  // ② 출장. timezone이 빈 행은 아예 후보가 아니다(0029 2절).
  const onTrip = input.trips
    .filter(
      (t) =>
        isValidTimezone(t.timezone) &&
        t.starts_on <= baseDate &&
        baseDate <= (t.ends_on ?? t.starts_on),
    )
    .sort((a, b) => b.starts_on.localeCompare(a.starts_on))[0]
  if (onTrip) {
    return { timezone: onTrip.timezone as string, source: 'trip', trip: onTrip }
  }

  // ① 접속 기기.
  if (isValidTimezone(input.deviceTz)) {
    return { timezone: input.deviceTz, source: 'device', trip: null }
  }

  return { timezone: DEFAULT_TIMEZONE, source: 'default', trip: null }
}

/**
 * 이 틱에 무엇을 할 것인가.
 *
 *   send        지금이 아침 창 안이고 오늘 것을 아직 안 했다 → 생성 + 발송 + 장부 기록
 *   too_early   현지 06시 전 → 아무것도 하지 않는다(204)
 *   already_ran 오늘(현지 날짜) 장부에 행이 있다 → 아무것도 하지 않는다(204)
 *   too_late    현지 10시를 넘겼고 오늘 것을 아직 안 했다 → **장부에만** 남기고 끝낸다(204)
 */
export type TickOutcome = 'send' | 'too_early' | 'already_ran' | 'too_late'

export interface TickInputs {
  timezone: string
  now: Date
  /**
   * 장부(chairman_brief_sends)의 가장 최근 현지 날짜. 없으면 null.
   *
   * '보냈는가'가 아니라 '**그날 Job이 끝났는가**'다. 카카오가 연결되지 않아 못 보낸 날도
   * 그날은 끝난 날이다 — 안 그러면 06~10시의 다섯 틱이 회사 다섯 곳 + 그룹 = 여섯 번의
   * 모델 호출을 매시 다시 돌린다(0029 4절).
   */
  lastRunLocalDate: IsoDate | null
}

export interface TickDecision {
  outcome: TickOutcome
  /** 이 틱이 판정한 회장 현지 날짜. 장부의 키이자 카톡 메시지의 월요일 판정 기준이다. */
  localDate: IsoDate
  localHour: number
  /** 생성 + 발송을 할 것인가. */
  send: boolean
  /** 장부에 행을 남길 것인가. send일 때는 Job이 끝난 뒤 남기고, too_late면 지금 남긴다. */
  record: boolean
  /** 사람이 읽는 한 줄. 204의 응답 헤더와 장부의 reason으로 나간다. */
  reason: string
}

export function decideBriefTick(input: TickInputs): TickDecision {
  const tz = isValidTimezone(input.timezone) ? input.timezone : DEFAULT_TIMEZONE
  const localDate = localDateIn(tz, input.now)
  const localHour = localHourIn(tz, input.now)
  const alreadyRan = input.lastRunLocalDate === localDate

  const base = { localDate, localHour }

  if (alreadyRan) {
    return { ...base, outcome: 'already_ran', send: false, record: false, reason: `${localDate} 아침 브리핑은 이미 끝났다` }
  }
  if (localHour < BRIEF_HOUR) {
    return { ...base, outcome: 'too_early', send: false, record: false, reason: `현지 ${localHour}시 — 아직 ${BRIEF_HOUR}시 전이다` }
  }
  if (localHour >= BRIEF_GIVE_UP_HOUR) {
    // 늦게 온 틱을 여기까지 받아 준 뒤에도 못 했으면 그날은 놓은 것이다.
    // 점심에 도착하는 '아침 브리핑'은 알림이 아니라 잡음이다 — 대신 왜 안 갔는지는 남긴다.
    return {
      ...base,
      outcome: 'too_late',
      send: false,
      record: true,
      reason: `현지 ${localHour}시 — ${BRIEF_GIVE_UP_HOUR}시를 넘겨 그날 아침 브리핑은 건너뛴다`,
    }
  }
  return { ...base, outcome: 'send', send: true, record: true, reason: `현지 ${localHour}시 — 아침 브리핑을 보낸다` }
}

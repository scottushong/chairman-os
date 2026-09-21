import type { ActivityEvent } from '@/lib/activity'
import { kstToday } from '@/lib/chairman-project'

import { DUMMY_UID } from './dummy-org'

/**
 * dummy 모드의 접속 현황 시드 — 30일 치 열람 기록과 로그인 (블록 7).
 *
 * **왜 있는가.** 이 저장소의 확인은 `NEXT_PUBLIC_DATA_MODE=dummy`로만 한다. 시드가 없으면
 * /settings/activity는 늘 빈 화면이고, 그러면 이상 징후 다섯 종이 화면에서 한 번도
 * 그려지지 않는다 — 배선은 됐는데 한 번도 안 켜지는 코드가 된다(night-brief의
 * listRecentCheckins가 그랬다).
 *
 * **여기 있는 것은 DB 흉내다. 판정이 아니다.** 이상 징후를 이 파일이 만들어 두는 것이
 * 아니라, 이 파일은 **그 조건을 만드는 입력**을 둔다. 태그는 lib/activity.ts의
 * detectAnomalies()가 이 입력을 보고 스스로 만든다 — dummy-org.ts가 subtree 판정을
 * 옮겨 적지 않고 dummy.ts에 맡긴 것과 같은 이유다.
 *
 * 다섯 종이 각각 하나씩 서 있고, **아무 태그도 안 붙는 사람**(영업 직원 2)도 하나 있다.
 * 전원에게 태그가 붙는 시드로는 "조건을 안 만드는 입력은 태그를 안 만든다"를 화면에서
 * 볼 수 없다.
 *
 *   회장          평범한 낮 접속 + 지금 접속 중
 *   DY 대표        평범한 낮 접속 + 오늘 로그인 성공
 *   영업팀장       10분 안에 문서 9건            → ③ doc_burst · 지금 접속 중
 *   영업 직원      호찌민에서 접속 + 새벽 02:40  → ② new_origin · ① late_night
 *   영업 직원 2    평범한 낮 접속 하나            → 태그 없음
 *   구매팀장       오늘 로그인 실패 3회 뒤 성공   → ④ login_failures
 *   퇴사자         회수 12일 전인데 10일 전 활동  → ⑤ revoked_active
 */

const SEOUL = 'Asia/Seoul'
const SAIGON = 'Asia/Ho_Chi_Minh'
const WIN = 'Chrome · Windows'
const MAC = 'Safari · macOS'
const PHONE = 'Safari · iOS'

/**
 * n일 전의 KST 날짜에서 hh:mm(현지)에 해당하는 실제 순간. KST는 서머타임이 없어 +09:00 고정이다.
 *
 * **미래로 넘어가면 하루 당긴다.** 새벽에 화면을 열면 at(0, '08:41')이 아직 오지 않은
 * 시각이 되는데, 그러면 '현재 접속 중'(최근 5분)에 오지도 않은 접속이 오른다.
 * 시드가 만드는 거짓말 중에 제일 눈에 안 띄는 종류다.
 */
function at(daysAgo: number, hhmm: string, tz: string = SEOUL): string {
  const date = kstToday(new Date(Date.now() - daysAgo * 86_400_000))
  const offset = tz === SAIGON ? '+07:00' : '+09:00'
  const when = new Date(`${date}T${hhmm}:00${offset}`)
  if (when.getTime() > Date.now()) when.setTime(when.getTime() - 86_400_000)
  return when.toISOString()
}

/** 지금으로부터 n분 전. '현재 접속 중'(5분)을 화면에서 실제로 보려면 상대 시각이어야 한다. */
function minutesAgo(n: number): string {
  return new Date(Date.now() - n * 60_000).toISOString()
}

function read(
  user_id: string,
  occurred_at: string,
  path: string,
  extra: Partial<ActivityEvent> = {},
): ActivityEvent {
  return {
    occurred_at,
    actor_user_id: user_id,
    actor_role: null,
    action: 'read',
    entity_id: null,
    entity_table: null,
    business_id: null,
    path,
    kind: 'page',
    device: WIN,
    city: 'Seoul, KR',
    tz: SEOUL,
    ok: null,
    ...extra,
  }
}

function doc(user_id: string, occurred_at: string, docId: string, extra: Partial<ActivityEvent> = {}): ActivityEvent {
  return read(user_id, occurred_at, `/documents/${docId}`, {
    kind: 'document',
    entity_id: docId,
    entity_table: 'documents',
    ...extra,
  })
}

function login(user_id: string, occurred_at: string, ok: boolean, extra: Partial<ActivityEvent> = {}): ActivityEvent {
  return {
    occurred_at,
    actor_user_id: user_id,
    actor_role: null,
    action: 'login',
    entity_id: user_id,
    entity_table: null,
    business_id: null,
    path: '/login',
    kind: null,
    device: WIN,
    city: 'Seoul, KR',
    tz: null,
    ok,
    ...extra,
  }
}

export function dummyActivitySeed(): ActivityEvent[] {
  const out: ActivityEvent[] = []

  // ── 회장 — 평범한 낮 접속. 지금도 보고 있다.
  for (const d of [12, 9, 6, 3, 1]) {
    out.push(read(DUMMY_UID.chair, at(d, '09:12'), '/'))
    out.push(read(DUMMY_UID.chair, at(d, '09:20'), '/finance/biz_dy', { kind: 'finance', business_id: 'biz_dy' }))
  }
  out.push(login(DUMMY_UID.chair, at(0, '08:41'), true))
  out.push(read(DUMMY_UID.chair, minutesAgo(2), '/settings/activity'))

  // ── DY 대표 — 평범한 낮 접속 + 오늘 로그인.
  out.push(login(DUMMY_UID.dyCeo, at(0, '08:05'), true, { device: MAC }))
  for (const d of [8, 5, 2]) {
    out.push(read(DUMMY_UID.dyCeo, at(d, '10:30'), '/', { device: MAC }))
    out.push(read(DUMMY_UID.dyCeo, at(d, '10:40'), '/tasks', { device: MAC }))
  }

  // ── 영업팀장 — ③ 10분 안에 문서 9건. 기준선을 먼저 깔아 둔다(새 기기·새 도시가 같이
  //    붙으면 이 사람 줄에서 ③만 재는 것이 아니게 된다).
  for (const d of [20, 14, 7]) out.push(read(DUMMY_UID.salesLead, at(d, '11:00'), '/documents'))
  const burstMinutes = ['14:02', '14:03', '14:03', '14:04', '14:05', '14:06', '14:07', '14:08', '14:09']
  burstMinutes.forEach((hhmm, i) => {
    out.push(doc(DUMMY_UID.salesLead, at(2, hhmm), `doc_${String(i + 1).padStart(3, '0')}`))
  })
  out.push(read(DUMMY_UID.salesLead, minutesAgo(4), '/tasks'))

  // ── 영업 직원 — ② 새 도시(서울 → 호찌민) · ① 새벽 02:40.
  //    기준선이 먼저 있어야 '새' 도시가 성립한다. 처음은 늘 처음이다.
  for (const d of [22, 18, 15, 11]) out.push(read(DUMMY_UID.salesStaff, at(d, '13:20'), '/tasks'))
  out.push(
    read(DUMMY_UID.salesStaff, at(3, '15:05', SAIGON), '/tasks', {
      city: 'Ho Chi Minh City, VN',
      device: PHONE,
      tz: SAIGON,
    }),
  )
  out.push(read(DUMMY_UID.salesStaff, at(1, '02:40'), '/documents'))

  // ── 영업 직원 2 — 아무 태그도 붙지 않는 사람. 같은 기기, 같은 도시, 낮 시간.
  for (const d of [10, 6, 4, 1]) out.push(read(DUMMY_UID.salesStaff2, at(d, '16:10'), '/tasks'))

  // ── 구매팀장 — ④ 오늘 아침 로그인 실패 3회 뒤 성공.
  out.push(login(DUMMY_UID.buyLead, at(0, '07:58'), false))
  out.push(login(DUMMY_UID.buyLead, at(0, '07:59'), false))
  out.push(login(DUMMY_UID.buyLead, at(0, '08:00'), false))
  out.push(login(DUMMY_UID.buyLead, at(0, '08:01'), true))
  out.push(read(DUMMY_UID.buyLead, at(0, '08:02'), '/'))

  // ── 퇴사자 — ⑤ 회수(12일 전) 뒤인 10일 전에 남은 활동 둘.
  //    dummy에서는 이것이 '있을 수 없는 일'을 일부러 심은 것이다. live에서는 is_active()가
  //    record_read()를 먼저 막으므로 이런 줄이 새로 생기지 않는다 — 다만 **회수 전에
  //    쌓인 기록**과 회수 시각이 어긋나 있으면 이 태그가 그것을 집어낸다.
  out.push(read(DUMMY_UID.leaver, at(10, '21:15'), '/documents'))
  out.push(doc(DUMMY_UID.leaver, at(10, '21:22'), 'doc_014'))

  return out.sort((a, b) => Date.parse(b.occurred_at) - Date.parse(a.occurred_at))
}

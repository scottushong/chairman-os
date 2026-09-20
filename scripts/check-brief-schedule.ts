/**
 * 아침 브리핑 스케줄 검사 — npm run check:schedule
 *
 * 재는 것은 순수 함수 둘이다. DB도 카카오도 GitHub도 부르지 않는다.
 *
 *   decideChairmanTimezone()  회장이 지금 어느 시간대에 있는가 (③ 수동 > ② 출장 > ① 접속 > 서울)
 *   decideBriefTick()         이 틱에 보낼 것인가 (현지 06:00~09:59 창 + 하루 한 번)
 *
 * 이 둘이 이 변경에서 유일하게 논리가 있는 자리다. 틀리면 회장이 새벽 세 시에 깨거나
 * 아침에 아무것도 못 받는데, 그 실패는 사람 없이 일어나고 다음 날까지 아무도 모른다.
 *
 * **시간대가 실제로 다른 곳에서 돈다는 것을 잰다.** 같은 UTC 순간 하나를 서울·뉴욕·런던에
 * 넣어 세 가지 다른 판정이 나오는지 본다 — 이 변경의 핵심이 거기고, 'Asia/Seoul' 하나로만
 * 재면 Intl을 통과시키기만 하고 시간대를 실제로 쓰지 않는 코드도 초록으로 지나간다.
 * 서머타임도 같이 잰다(런던·뉴욕의 1월과 7월).
 *
 * 카카오 메시지의 월요일 줄이 **현지 날짜**로 판정되는지도 여기서 잰다 — 같은 순간에
 * 서울은 월요일이고 뉴욕은 일요일인 자리가 있다.
 */
import assert from 'node:assert/strict'

import { isMonday } from '../src/lib/kakao/message'
import {
  BRIEF_GIVE_UP_HOUR,
  BRIEF_HOUR,
  DEFAULT_TIMEZONE,
  decideBriefTick,
  decideChairmanTimezone,
  isValidTimezone,
  localDateIn,
  localHourIn,
  type TripWindow,
} from '../src/lib/chairman-timezone'

const SEOUL = 'Asia/Seoul'
const NY = 'America/New_York'
const LONDON = 'Europe/London'

const at = (iso: string) => new Date(iso)

/** 2026-09-14(월) ~ 2026-09-25(금) 뉴욕 출장. 이 파일의 ② 후보는 전부 이 모양이다. */
const NY_TRIP: TripWindow = {
  title: '뉴욕 출장',
  starts_on: '2026-09-14',
  ends_on: '2026-09-25',
  timezone: NY,
}
/** 같은 기간 안에 든 런던 3일. '큰 일정 안의 작은 일정'에서 안쪽이 이겨야 한다. */
const LONDON_TRIP: TripWindow = {
  title: '런던 3일',
  starts_on: '2026-09-20',
  ends_on: '2026-09-22',
  timezone: LONDON,
}
/** 시간대를 안 적은 출장. ②에서 빠져야 한다 — 도시 이름을 시간대로 추측하지 않는다. */
const NO_TZ_TRIP: TripWindow = {
  title: '자카르타 출장',
  starts_on: '2026-09-14',
  ends_on: '2026-09-25',
  timezone: null,
}

// 출장 한가운데의 어느 순간. ②를 재는 모든 단언이 이 순간을 쓴다.
const DURING_TRIP = at('2026-09-21T03:00:00Z')

// =====================================================================
// 1. 시간대 결정 — ③ 수동 > ② 출장 > ① 접속 > Asia/Seoul
// =====================================================================

// 1-1. ③이 있으면 ③이 이긴다. 출장 중이고 접속 기기도 다른 곳이어도 그렇다.
{
  const d = decideChairmanTimezone({
    manualTz: 'Asia/Tokyo',
    trips: [NY_TRIP],
    deviceTz: LONDON,
    now: DURING_TRIP,
  })
  assert.equal(d.timezone, 'Asia/Tokyo', `③ 수동값이 이겨야 한다: ${JSON.stringify(d)}`)
  assert.equal(d.source, 'manual', `근거가 manual이어야 한다: ${d.source}`)
}

// 1-2. ③이 없고 출장 중이면 ②. 접속 기기가 다른 곳을 가리켜도 출장이 이긴다 —
//      비행기를 타고 아직 앱을 안 열었으면 ①은 어제 있던 도시다.
{
  const d = decideChairmanTimezone({
    manualTz: null,
    trips: [NY_TRIP],
    deviceTz: SEOUL,
    now: DURING_TRIP,
  })
  assert.equal(d.timezone, NY, `② 출장이 ①을 이겨야 한다: ${JSON.stringify(d)}`)
  assert.equal(d.source, 'trip', `근거가 trip이어야 한다: ${d.source}`)
  assert.equal(d.trip?.title, '뉴욕 출장', '어느 출장인지 같이 와야 한다 — 화면이 근거를 한 줄로 말한다')
}

// 1-3. ③도 ②도 없으면 ①.
{
  const d = decideChairmanTimezone({ manualTz: null, trips: [], deviceTz: NY, now: DURING_TRIP })
  assert.equal(d.timezone, NY, `① 접속 기기가 와야 한다: ${JSON.stringify(d)}`)
  assert.equal(d.source, 'device', `근거가 device여야 한다: ${d.source}`)
}

// 1-4. 셋 다 없으면 Asia/Seoul.
{
  const d = decideChairmanTimezone({ manualTz: null, trips: [], deviceTz: null, now: DURING_TRIP })
  assert.equal(d.timezone, DEFAULT_TIMEZONE, `아무것도 없으면 서울이어야 한다: ${JSON.stringify(d)}`)
  assert.equal(d.source, 'default', `근거가 default여야 한다: ${d.source}`)
}

// 1-5. 시간대 칸이 빈 출장은 ②에서 빠진다. 도시 이름('자카르타')을 시간대로 추측하지 않는다.
{
  const d = decideChairmanTimezone({
    manualTz: null,
    trips: [NO_TZ_TRIP],
    deviceTz: SEOUL,
    now: DURING_TRIP,
  })
  assert.equal(d.timezone, SEOUL, `시간대 없는 출장은 건너뛰고 ①로 내려가야 한다: ${JSON.stringify(d)}`)
  assert.equal(d.source, 'device', `근거가 device여야 한다: ${d.source}`)
}

// 1-6. Intl이 모르는 문자열은 없는 것으로 친다. 틀린 값 하나로 아침 알림이 멈추지 않는다.
{
  assert.equal(isValidTimezone('Asia/Seoull'), false, '오타난 시간대를 실재한다고 보면 안 된다')
  assert.equal(isValidTimezone(''), false, '빈 문자열은 시간대가 아니다')
  assert.equal(isValidTimezone(SEOUL), true, '멀쩡한 시간대를 없다고 보면 안 된다')

  const d = decideChairmanTimezone({
    manualTz: 'Mars/Olympus_Mons',
    trips: [],
    deviceTz: NY,
    now: DURING_TRIP,
  })
  assert.equal(d.timezone, NY, `없는 시간대는 ③에서 빠지고 ①로 내려가야 한다: ${JSON.stringify(d)}`)
  assert.equal(d.source, 'device', `근거가 device여야 한다: ${d.source}`)
}

// 1-7. 출장 창의 경계 — 시작일·종료일은 안이고, 종료일 다음 날은 밖이다.
//      기준 날짜는 ①(여기서는 서울)로 찍는다.
{
  const inputs = (nowIso: string) => ({
    manualTz: null,
    trips: [NY_TRIP],
    deviceTz: SEOUL,
    now: at(nowIso),
  })
  // 서울 기준 2026-09-14 = 출장 첫날
  assert.equal(decideChairmanTimezone(inputs('2026-09-14T03:00:00Z')).source, 'trip', '출장 첫날은 창 안이다')
  // 서울 기준 2026-09-25 = 출장 마지막 날
  assert.equal(decideChairmanTimezone(inputs('2026-09-25T03:00:00Z')).source, 'trip', '출장 마지막 날은 창 안이다')
  // 서울 기준 2026-09-26 = 하루 지났다
  assert.equal(decideChairmanTimezone(inputs('2026-09-26T03:00:00Z')).source, 'device', '종료일 다음 날은 창 밖이다')
  // 서울 기준 2026-09-13 = 하루 전
  assert.equal(decideChairmanTimezone(inputs('2026-09-13T03:00:00Z')).source, 'device', '시작일 전날은 창 밖이다')
}

// 1-8. ends_on이 null이면 하루짜리다(0017). starts_on 하루만 창이다.
{
  const oneDay: TripWindow = { title: '도쿄 당일', starts_on: '2026-09-21', ends_on: null, timezone: 'Asia/Tokyo' }
  const inputs = (nowIso: string) => ({ manualTz: null, trips: [oneDay], deviceTz: SEOUL, now: at(nowIso) })
  assert.equal(decideChairmanTimezone(inputs('2026-09-21T03:00:00Z')).timezone, 'Asia/Tokyo', '하루짜리 출장 당일은 창 안이다')
  assert.equal(decideChairmanTimezone(inputs('2026-09-22T03:00:00Z')).timezone, SEOUL, '하루짜리 출장 다음 날은 창 밖이다')
}

// 1-9. 겹치는 출장은 나중에 시작한 것이 이긴다 — 큰 일정 안의 작은 일정이 실제 위치다.
{
  const d = decideChairmanTimezone({
    manualTz: null,
    trips: [NY_TRIP, LONDON_TRIP],
    deviceTz: SEOUL,
    now: DURING_TRIP, // 2026-09-21, 두 출장이 겹치는 날
  })
  assert.equal(d.timezone, LONDON, `안쪽(나중에 시작한) 출장이 이겨야 한다: ${JSON.stringify(d)}`)
  assert.equal(d.trip?.title, '런던 3일', '어느 출장인지가 안쪽 것이어야 한다')
}

// =====================================================================
// 2. 틱 판정 — 현지 06:00~09:59 창, 하루 한 번
//    여기서부터는 서울 시간대로 고정하고, UTC 순간을 옮겨 현지 시각을 만든다.
//    2026-09-21T21:00:00Z = 서울 2026-09-22 06:00.
// =====================================================================

const tick = (nowIso: string, lastRun: string | null = null, timezone = SEOUL) =>
  decideBriefTick({ timezone, now: at(nowIso), lastRunLocalDate: lastRun })

// 2-1. 06:00 정각은 보낸다.
{
  const d = tick('2026-09-21T21:00:00Z')
  assert.equal(d.localHour, BRIEF_HOUR, `서울 06시여야 한다: ${JSON.stringify(d)}`)
  assert.equal(d.localDate, '2026-09-22', `현지 날짜가 22일이어야 한다: ${d.localDate}`)
  assert.equal(d.outcome, 'send', `06:00은 보내야 한다: ${JSON.stringify(d)}`)
  assert.equal(d.send, true, '06:00에 send가 true여야 한다')
}

// 2-2. 06:59도 보낸다 — 매시 정각에 불린다는 것을 전제하지 않는다.
{
  const d = tick('2026-09-21T21:59:00Z')
  assert.equal(d.localHour, 6, `서울 06시대여야 한다: ${JSON.stringify(d)}`)
  assert.equal(d.outcome, 'send', `06:59도 보내야 한다: ${JSON.stringify(d)}`)
}

// 2-3. 05:59는 안 보낸다. 아직 그때가 아니다.
{
  const d = tick('2026-09-21T20:59:00Z')
  assert.equal(d.localHour, 5, `서울 05시대여야 한다: ${JSON.stringify(d)}`)
  assert.equal(d.outcome, 'too_early', `05:59는 보내면 안 된다: ${JSON.stringify(d)}`)
  assert.equal(d.send, false, '05:59에 send가 false여야 한다')
  assert.equal(d.record, false, '보낼 때가 아직 안 됐으면 장부에도 남기지 않는다')
}

// 2-4. **지연된 틱** — 07:30에 도착했고 그날 것을 아직 안 했으면 보낸다.
//      GitHub Actions의 schedule은 정시에 오지 않는다. hour === 6만 보면 그날이 통째로 빈다.
{
  const d = tick('2026-09-21T22:30:00Z')
  assert.equal(d.localHour, 7, `서울 07시대여야 한다: ${JSON.stringify(d)}`)
  assert.equal(d.outcome, 'send', `늦게 온 첫 틱도 그날 것을 안 보냈으면 보내야 한다: ${JSON.stringify(d)}`)
}

// 2-5. 09:59까지는 받아 준다. 상한 직전이다.
{
  const d = tick('2026-09-22T00:59:00Z')
  assert.equal(d.localHour, BRIEF_GIVE_UP_HOUR - 1, `서울 09시대여야 한다: ${JSON.stringify(d)}`)
  assert.equal(d.outcome, 'send', `09:59는 아직 창 안이다: ${JSON.stringify(d)}`)
}

// 2-6. 10:01은 안 보낸다. 점심에 오는 '아침 브리핑'은 알림이 아니라 잡음이다.
//      대신 **장부에는 남긴다** — 조용히 아무것도 없으면 "왜 카톡이 없었지"에 답할 자리가 없다.
{
  const d = tick('2026-09-22T01:01:00Z')
  assert.equal(d.localHour, BRIEF_GIVE_UP_HOUR, `서울 10시대여야 한다: ${JSON.stringify(d)}`)
  assert.equal(d.outcome, 'too_late', `10:01은 보내면 안 된다: ${JSON.stringify(d)}`)
  assert.equal(d.send, false, '10:01에 send가 false여야 한다')
  assert.equal(d.record, true, '포기한 날도 장부에는 남아야 한다')
  assert.ok(d.reason.includes('건너뛴다'), `포기 사유가 사람이 읽을 말이어야 한다: ${d.reason}`)
}

// 2-7. 같은 현지 날짜에 이미 끝났으면 창 안이어도 안 보낸다. 이것이 중복 방지의 실체다.
{
  const d = tick('2026-09-21T21:00:00Z', '2026-09-22')
  assert.equal(d.outcome, 'already_ran', `같은 현지 날짜면 안 보내야 한다: ${JSON.stringify(d)}`)
  assert.equal(d.send, false, '이미 끝난 날에 send가 false여야 한다')
  assert.equal(d.record, false, '이미 있는 행을 다시 쓸 이유가 없다')
}

// 2-8. 날짜 경계를 넘으면 다시 보낸다. 어제 보냈다는 사실이 오늘을 막으면 안 된다.
{
  const d = tick('2026-09-21T21:00:00Z', '2026-09-21')
  assert.equal(d.localDate, '2026-09-22', `현지 날짜가 넘어가야 한다: ${d.localDate}`)
  assert.equal(d.outcome, 'send', `어제 기록은 오늘을 막지 않는다: ${JSON.stringify(d)}`)
}

// 2-9. 10시를 넘겨 포기한 뒤에도 그날은 다시 시도하지 않는다 —
//      포기 기록이 장부에 남았으므로 11시 틱은 already_ran으로 조용히 끝난다.
{
  const d = tick('2026-09-22T02:01:00Z', '2026-09-22')
  assert.equal(d.localHour, 11, `서울 11시대여야 한다: ${JSON.stringify(d)}`)
  assert.equal(d.outcome, 'already_ran', `포기한 날은 그날 안에 다시 시도하지 않는다: ${JSON.stringify(d)}`)
  assert.equal(d.record, false, '포기 기록을 매시 다시 쓰지 않는다')
}

// 2-10. 시간대가 Intl에 없는 값이면 서울로 떨어진다. 판정이 NaN으로 새지 않는다.
{
  const d = decideBriefTick({ timezone: 'Mars/Olympus_Mons', now: at('2026-09-21T21:00:00Z'), lastRunLocalDate: null })
  assert.equal(d.localDate, '2026-09-22', `서울로 떨어져야 한다: ${JSON.stringify(d)}`)
  assert.equal(d.outcome, 'send', `바닥값으로도 판정이 나와야 한다: ${JSON.stringify(d)}`)
}

// =====================================================================
// 3. 시간대가 실제로 다른 곳에서 돈다 — 이 변경의 유일한 어려운 자리
// =====================================================================

// 3-1. **같은 UTC 순간 하나가 세 시간대에서 세 가지 다른 판정을 낸다.**
//      2026-09-21T05:00:00Z = 런던 06:00(BST) · 서울 14:00 · 뉴욕 01:00(EDT)
{
  const moment = '2026-09-21T05:00:00Z'
  const london = tick(moment, null, LONDON)
  const seoul = tick(moment, null, SEOUL)
  const ny = tick(moment, null, NY)

  // 이 단언이 먼저다. 시간대를 아예 안 쓰는 구현은 여기서 제일 먼저 빨개져야 한다 —
  // 아래 개별 단언들은 '무엇이 틀렸나'를 말해 주지만, 이 줄은 '시간대를 쓰기는 하나'를 묻는다.
  assert.equal(
    new Set([london.outcome, seoul.outcome, ny.outcome]).size,
    3,
    `같은 순간에 세 시간대가 세 가지 다른 판정을 내야 한다 — 같으면 시간대를 안 쓰고 있는 것이다: ${JSON.stringify([london.outcome, seoul.outcome, ny.outcome])}`,
  )

  assert.equal(london.localHour, 6, `런던이 06시여야 한다: ${JSON.stringify(london)}`)
  assert.equal(seoul.localHour, 14, `서울이 14시여야 한다: ${JSON.stringify(seoul)}`)
  assert.equal(ny.localHour, 1, `뉴욕이 01시여야 한다: ${JSON.stringify(ny)}`)

  assert.equal(london.outcome, 'send', `같은 순간에 런던은 보내야 한다: ${JSON.stringify(london)}`)
  assert.equal(seoul.outcome, 'too_late', `같은 순간에 서울은 이미 늦었다: ${JSON.stringify(seoul)}`)
  assert.equal(ny.outcome, 'too_early', `같은 순간에 뉴욕은 아직 이르다: ${JSON.stringify(ny)}`)
}

// 3-2. 회장이 뉴욕에 있으면 뉴욕 06시에 간다. 서울 06시(= 뉴욕 17시 전날)에 가지 않는다.
{
  const nyMorning = '2026-09-21T10:00:00Z' // 뉴욕 06:00 EDT
  assert.equal(tick(nyMorning, null, NY).outcome, 'send', '뉴욕 06시에는 보내야 한다')
  assert.equal(tick(nyMorning, null, SEOUL).outcome, 'too_late', '같은 순간 서울은 19시라 보내면 안 된다')

  const seoulMorning = '2026-09-21T21:00:00Z' // 서울 06:00
  assert.equal(tick(seoulMorning, null, SEOUL).outcome, 'send', '서울 06시에는 보내야 한다')
  assert.equal(tick(seoulMorning, null, NY).outcome, 'too_late', '같은 순간 뉴욕은 17시라 보내면 안 된다')
}

// 3-3. 같은 순간에 **현지 날짜가 다르다.** 장부의 키가 KST였다면 이 차이가 사라진다.
{
  const moment = at('2026-09-21T21:00:00Z')
  assert.equal(localDateIn(SEOUL, moment), '2026-09-22', '서울은 벌써 22일이다')
  assert.equal(localDateIn(NY, moment), '2026-09-21', '뉴욕은 아직 21일이다')
  assert.equal(localDateIn(LONDON, moment), '2026-09-21', '런던도 아직 21일이다')
}

// 3-4. 서머타임. 같은 UTC 시각이 여름과 겨울에 다른 현지 시(hour)를 준다 —
//      고정 오프셋(UTC+9 같은 숫자)으로 계산했다면 여기서 갈라진다.
{
  assert.equal(localHourIn(LONDON, at('2026-01-15T06:00:00Z')), 6, '겨울 런던은 GMT라 06시다')
  assert.equal(localHourIn(LONDON, at('2026-07-15T06:00:00Z')), 7, '여름 런던은 BST라 07시다')
  assert.equal(localHourIn(NY, at('2026-01-15T11:00:00Z')), 6, '겨울 뉴욕은 EST라 06시다')
  assert.equal(localHourIn(NY, at('2026-07-15T11:00:00Z')), 7, '여름 뉴욕은 EDT라 07시다')
  // 서울에는 서머타임이 없다. 같은 UTC 시각이 사계절 같은 현지 시를 준다.
  assert.equal(localHourIn(SEOUL, at('2026-01-15T21:00:00Z')), 6, '겨울 서울은 06시다')
  assert.equal(localHourIn(SEOUL, at('2026-07-15T21:00:00Z')), 6, '여름 서울도 06시다')

  // 겨울 뉴욕 06시는 보내고, 같은 순간 겨울 런던은 11시라 이미 늦었다.
  assert.equal(tick('2026-01-15T11:00:00Z', null, NY).outcome, 'send', '겨울 뉴욕 06시에는 보내야 한다')
  assert.equal(tick('2026-01-15T11:00:00Z', null, LONDON).outcome, 'too_late', '같은 순간 겨울 런던은 11시다')
}

// 3-5. 자정이 0시로 온다. hourCycle을 안 박으면 24나 12로 와서 too_early 판정이 뒤집힌다.
{
  assert.equal(localHourIn(SEOUL, at('2026-09-21T15:00:00Z')), 0, '서울 자정은 0시여야 한다')
  assert.equal(tick('2026-09-21T15:00:00Z', null, SEOUL).outcome, 'too_early', '자정은 아직 이르다')
}

// =====================================================================
// 4. 카카오 메시지의 월요일 줄도 현지 날짜로 판정된다
// =====================================================================

// 4-1. 같은 순간에 서울은 월요일이고 뉴욕은 일요일이다.
//      2026-09-21T01:00:00Z = 서울 2026-09-21(월) 10:00 · 뉴욕 2026-09-20(일) 21:00
{
  const moment = at('2026-09-21T01:00:00Z')
  assert.equal(localDateIn(SEOUL, moment), '2026-09-21', '서울은 21일(월)이다')
  assert.equal(localDateIn(NY, moment), '2026-09-20', '뉴욕은 20일(일)이다')
  assert.equal(isMonday(localDateIn(SEOUL, moment)), true, '서울 기준으로는 월요일이다')
  assert.equal(isMonday(localDateIn(NY, moment)), false, '뉴욕 기준으로는 아직 일요일이다')
}

// 4-2. **틱이 준 현지 날짜**로 판정되는지를, 실제로 발송되는 순간에 잰다.
//      뉴욕·런던으로는 이것을 못 잰다 — 그 도시들의 06:00은 UTC로도 서울로도 같은 날짜라
//      KST로 재든 UTC로 재든 요일이 같게 나와서, 틀린 구현이 그대로 초록으로 지나간다.
//      날짜가 실제로 갈라지는 두 곳을 쓴다.
//
//        오클랜드 월요일 06:00 = 그 순간 UTC로는 아직 **일요일**
//        호놀룰루 월요일 06:00 = 그 순간 서울은 벌써 **화요일**
{
  const AUCKLAND = 'Pacific/Auckland'
  const HONOLULU = 'Pacific/Honolulu'

  const aucklandMonday = at('2026-09-20T18:00:00Z')
  assert.equal(
    aucklandMonday.toISOString().slice(0, 10),
    '2026-09-20',
    '이 실험의 전제가 깨졌다 — 같은 순간의 UTC 날짜가 일요일이 아니면 UTC로 재는 구현을 잡지 못한다',
  )
  const a = decideBriefTick({ timezone: AUCKLAND, now: aucklandMonday, lastRunLocalDate: null })
  assert.equal(a.localHour, 6, `오클랜드가 06시여야 한다: ${JSON.stringify(a)}`)
  assert.equal(a.outcome, 'send', `오클랜드 월요일 아침에는 보낸다: ${JSON.stringify(a)}`)
  assert.equal(a.localDate, '2026-09-21', `틱의 현지 날짜가 오클랜드 날짜여야 한다: ${a.localDate}`)
  assert.equal(isMonday(a.localDate), true, `오클랜드 월요일에 리뷰 줄이 붙어야 한다 — UTC로 재면 아직 일요일이다: ${a.localDate}`)

  const honoluluMonday = at('2026-09-21T16:00:00Z')
  assert.equal(
    localDateIn(SEOUL, honoluluMonday),
    '2026-09-22',
    '이 실험의 전제가 깨졌다 — 같은 순간 서울이 화요일이 아니면 KST로 재는 구현을 잡지 못한다',
  )
  const h = decideBriefTick({ timezone: HONOLULU, now: honoluluMonday, lastRunLocalDate: null })
  assert.equal(h.localHour, 6, `호놀룰루가 06시여야 한다: ${JSON.stringify(h)}`)
  assert.equal(h.localDate, '2026-09-21', `틱의 현지 날짜가 호놀룰루 날짜여야 한다: ${h.localDate}`)
  assert.equal(isMonday(h.localDate), true, `호놀룰루 월요일에 리뷰 줄이 붙어야 한다 — KST로 재면 벌써 화요일이다: ${h.localDate}`)

  // 일요일에는 안 붙는다. 경계가 월요일 하루인지 반대쪽에서도 확인한다.
  const aucklandSunday = at('2026-09-19T18:00:00Z')
  const s2 = decideBriefTick({ timezone: AUCKLAND, now: aucklandSunday, lastRunLocalDate: null })
  assert.equal(s2.localDate, '2026-09-20', `오클랜드 일요일이어야 한다: ${s2.localDate}`)
  assert.equal(isMonday(s2.localDate), false, `일요일에 월요일 줄이 붙으면 안 된다: ${s2.localDate}`)
}

console.log(
  'PASS: 시간대 결정(③>②>① + 경계·겹침·빈 칸·오타), 틱 판정(06:00·06:59·05:59·07:30 지연·09:59·10:01 상한·중복·날짜 경계), ' +
    '세 시간대 교차(서울·뉴욕·런던 동일 순간 3판정 + 현지 날짜 차이 + 서머타임 + 자정), 메시지 월요일의 현지 기준',
)

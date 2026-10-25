/**
 * check:investment-ai-cap — 0095 AI 한도(서버 예약) 차단 시험(PGlite). 이 검사가 통과해야 investment_ai 스위치(기본 대표 켬)를 배포한다(머리말).
 *   하루 호출 수 · 월 비용을 DB 함수가 막는다 · 진행 중 예약도 비용으로 센다 · 실패도 호출 수 · 남의 예약을 못 끝냄 ·
 *   스위치 꺼짐이면 대표 · AI 둘 다 거부 · 직원 · 수집 계정 거부 · 예약 표 직접 쓰기 없음.
 * PGlite는 연결이 하나라 «동시» 호출은 순서대로 흉내 낸다 — 실제 동시성은 함수의 pg_advisory_xact_lock이 맡는다(staging 시험 0095).
 */
import assert from 'node:assert/strict'

import { U, investmentDbSetup } from './check-investment-db'

export async function investmentAiCapDb(): Promise<string> {
  const { db, as } = await investmentDbSetup()
  const reserve = (uid: string, est = 0.01) => as<{ id: number }>(uid, `select investment_ai_reserve('explain', ${est}) as id`)
  const err = (r: { error: string | null }) => r.error ?? ''

  await db.exec(`update investment_settings set ai_daily_calls = 3, ai_monthly_usd = 1`)
  // 하루 3회
  for (let i = 0; i < 3; i++) assert.equal((await reserve(U.agent)).error, null, `하루 ${i + 1}번째는 된다`)
  assert.match(err(await reserve(U.agent)), /investment_ai_limit_day/, '4번째는 하루 한도')
  assert.match(err(await reserve(U.chair)), /investment_ai_limit_day/, '대표도 같은 한도')

  // 월 비용 — 예약 줄을 비우고(소유자) 비용만 본다
  await db.exec(`delete from investment_ai_reservations`)
  const a = await reserve(U.agent, 0.6)
  assert.equal(a.error, null)
  assert.match(err(await reserve(U.agent, 0.6)), /investment_ai_limit_month/, '진행 중 예약(0.6)도 비용으로 센다 → 0.6 + 0.6 > 1')
  // 끝 — 실제 비용이 작으면 다시 여유가 생긴다
  const id = a.rows[0].id
  assert.match(err(await as(U.chair, `select investment_ai_finish(${id}, 'done', 0.05, 'm', 10, 10)`)), /investment_ai_unknown_reservation/, '남의 예약은 못 끝낸다')
  assert.equal((await as(U.agent, `select investment_ai_finish(${id}, 'done', 0.05, 'm', 10, 10)`)).error, null)
  assert.equal((await reserve(U.agent, 0.6)).error, null, '실제 $0.05로 끝난 뒤에는 0.05 + 0.6 ≤ 1')
  assert.match(err(await as(U.agent, `select investment_ai_finish(${id}, 'done', 0.05, 'm', 10, 10)`)), /investment_ai_unknown_reservation/, '두 번 끝내지 못한다')
  // 실패도 호출 수로 센다
  await db.exec(`delete from investment_ai_reservations; update investment_settings set ai_monthly_usd = 30, ai_daily_calls = 1`)
  const f = await reserve(U.agent)
  await as(U.agent, `select investment_ai_finish(${f.rows[0].id}, 'failed', 0, 'm', 0, 0)`)
  assert.match(err(await reserve(U.agent)), /investment_ai_limit_day/, '실패한 호출도 하루 한도에 든다')

  // 권한
  await db.exec(`delete from investment_ai_reservations; update investment_settings set ai_daily_calls = 20`)
  assert.match(err(await reserve(U.member)), /investment_ai_denied/)
  assert.match(err(await reserve(U.integ)), /investment_ai_denied/)
  assert.match(err(await reserve(U.designee)), /investment_ai_denied/)
  assert.match(err(await as(U.agent, `select investment_ai_reserve('explain', 50)`)), /investment_ai_bad_estimate/, '한 번 예상 $5 초과 거부')
  assert.ok((await as(U.agent, `insert into investment_ai_reservations (kind, est_usd) values ('x', 0.1)`)).error, '표 직접 쓰기 없음')
  assert.equal((await as<{ n: number }>(U.agent, `select count(*)::int n from investment_ai_reservations`)).rows[0]?.n ?? 0, 0, 'AI 계정은 예약 표를 못 읽는다(함수로만)')
  // 스위치 꺼짐 — 대표 · AI 둘 다
  await db.exec(`update feature_switches set enabled = false where feature_key = 'investment_ai'`)
  assert.match(err(await reserve(U.chair)), /investment_ai_off/)
  assert.match(err(await reserve(U.agent)), /investment_ai_off/)
  await db.exec(`update feature_switches set enabled = true where feature_key = 'investment_ai'`)
  assert.equal((await reserve(U.chair)).error, null)
  await db.close()
  return '0095 AI 한도(하루 3 · 월 $1 시험값 — 진행 중 예약 포함 · 실제 비용으로 끝 · 남의 예약 · 두 번 끝 · 실패도 호출 · 직원/수집/지정자 거부 · 한 번 $5 상한 · 표 직접 쓰기 없음 · 스위치 꺼짐 거부)'
}

if (process.argv[1]?.endsWith('check-investment-ai-cap.ts')) {
  investmentAiCapDb()
    .then((s) => console.log(`PASS: check:investment-ai-cap — ${s}`))
    .catch((e) => {
      console.error(e)
      process.exit(1)
    })
}

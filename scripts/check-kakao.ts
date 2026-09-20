/**
 * 카카오 메시지 문자열 검사 — npm run check:kakao
 *
 * 재는 것은 buildKakaoBriefText() 하나다. 카카오도 DB도 부르지 않는다.
 * 이 함수가 이 기능에서 유일하게 논리가 있는 자리라서다 — 200자를 넘기면 카카오가
 * 통째로 거절하고, 그 실패는 아침 07:00에 사람 없이 일어난다.
 */
import assert from 'node:assert/strict'

import { buildKakaoBriefText, isMonday, KAKAO_TEXT_LIMIT, MONDAY_REVIEW_LINE } from '../src/lib/kakao/message'

const TUE = '2026-09-22' // 화요일. 리뷰 줄이 없는 평범한 날.
const MON = '2026-09-21' // 월요일.

const LONG =
  '첫 문장은 어제 마감 기준 그룹 전체 매출이 전월 대비 늘었다는 것이다. ' +
  '두 번째 문장은 VANA의 원가 드라이버가 전기료 쪽으로 옮겨 갔다는 관찰이다. ' +
  '세 번째 문장은 스티키의 결정 건이 마감을 사흘 남겼다는 사실이다. ' +
  '네 번째 문장은 보람의 알림이 아직 열려 있다는 것이고, 다섯 번째 문장은 호프의 업무가 막혀 있다는 것이다.'

function len(s: string): number {
  return [...s].length
}

// 1. 머리글 — D-day와 프로젝트 제목이 한 줄에 온다.
{
  const text = buildKakaoBriefText({
    dDay: 'D-780',
    projectTitle: '회장직 승계',
    summary: '오늘은 조용하다.',
    runDate: TUE,
  })
  assert.ok(text.startsWith('☀️ D-780 · 회장직 승계\n\n'), `머리글이 다르다: ${JSON.stringify(text)}`)
  assert.ok(text.endsWith('\n\n▶ 전문 보기'), `꼬리가 다르다: ${JSON.stringify(text)}`)
  assert.ok(text.includes('오늘은 조용하다.'), '요약이 빠졌다')
}

// 2. 진행 중인 장기 프로젝트가 없으면 D-day 자리를 비운다 — 'D-null'을 만들지 않는다.
{
  const text = buildKakaoBriefText({
    dDay: null,
    projectTitle: null,
    summary: '오늘은 조용하다.',
    runDate: TUE,
  })
  assert.ok(text.startsWith('☀️ 오늘의 브리핑\n\n'), `프로젝트 없을 때 머리글이 다르다: ${JSON.stringify(text)}`)
  assert.ok(!text.includes('null'), 'null이 문자열로 샜다')
}

// 3. 200자를 절대 넘지 않는다. 카카오 텍스트 템플릿의 한계다.
{
  const text = buildKakaoBriefText({
    dDay: 'D-780',
    projectTitle: '회장직 승계',
    summary: LONG,
    runDate: TUE,
  })
  assert.ok(len(text) <= KAKAO_TEXT_LIMIT, `${len(text)}자 — 200자를 넘었다`)
  assert.ok(text.startsWith('☀️ D-780 · 회장직 승계\n\n'), '자르다가 머리글을 잃었다')
  assert.ok(text.endsWith('\n\n▶ 전문 보기'), '자르다가 꼬리를 잃었다')
}

// 4. 예산 초과로 문장을 자른다 — MAX_SENTENCES 제한이 아니라 문자 수 예산이 결정한다.
//    S1(50) + S2(75)는 들어가지만 S1+S2+S3(60)는 예산을 초과해서 S3이 제외된다.
{
  const s1 = '가'.repeat(50) + '.'
  const s2 = '나'.repeat(75) + '.'
  const s3 = '다'.repeat(60) + '.'

  const text = buildKakaoBriefText({
    dDay: 'D-1', projectTitle: 'A',
    summary: `${s1} ${s2} ${s3}`,
    runDate: TUE,
  })
  assert.ok(text.includes('가'), 'S1이 들어가야 한다')
  assert.ok(text.includes('나'), 'S2도 들어가야 한다')
  assert.ok(!text.includes('다'), 'S3은 예산 초과로 제외되어야 한다')
  assert.ok(len(text) <= KAKAO_TEXT_LIMIT, `${len(text)}자 — 200자를 넘었다`)
}

// 5. 세 문장을 넘기지 않는다 — 짧아서 들어가더라도.
{
  const text = buildKakaoBriefText({
    dDay: 'D-1', projectTitle: 'A',
    summary: '하나. 둘. 셋. 넷.',
    runDate: TUE,
  })
  assert.ok(text.includes('셋.'), '세 문장은 들어가야 한다')
  assert.ok(!text.includes('넷.'), '네 번째 문장까지 넣었다')
}

// 6. 머리글만으로 이미 긴 제목 — 요약이 한 글자도 안 들어가도 터지지 않는다.
{
  const text = buildKakaoBriefText({
    dDay: 'D-9999', projectTitle: '가'.repeat(180), summary: LONG,
    runDate: TUE,
  })
  assert.ok(len(text) <= KAKAO_TEXT_LIMIT, `${len(text)}자 — 긴 제목에서 200자를 넘었다`)
  assert.ok(text.endsWith('\n\n▶ 전문 보기'), '긴 제목에서 꼬리를 잃었다')
}

// 7. 요약이 비어도 보낼 것이 남는다 — 링크를 여는 것이 이 메시지의 목적이다.
{
  const text = buildKakaoBriefText({ dDay: 'D-3', projectTitle: 'A', summary: '   ', runDate: TUE })
  assert.ok(text.includes('요약을 만들지 못했습니다'), `빈 요약 문구가 다르다: ${JSON.stringify(text)}`)
  assert.ok(len(text) <= KAKAO_TEXT_LIMIT)
}

// 8. 첫 문장 자체가 예산을 초과하면 부분을 잘라 타원과 함께 보낸다 — 빈 본문보다는 반 문장이 낫다.
{
  const longTitle = '가'.repeat(170)
  const summary = '첫 문장은 매우 길어서 예산을 초과합니다. 이 부분은 절대 들어갈 수 없습니다.'

  const text = buildKakaoBriefText({
    dDay: 'D-1',
    projectTitle: longTitle,
    summary,
    runDate: TUE,
  })
  assert.ok(text.includes('…'), '타원이 포함되어야 한다')
  assert.ok(text.endsWith('\n\n▶ 전문 보기'), '꼬리가 있어야 한다')
  assert.ok(len(text) <= KAKAO_TEXT_LIMIT, `${len(text)}자 — 200자를 넘었다`)
  assert.ok(text.includes('…\n\n▶'), '타원이 본문 끝에 있어야 한다')
}

// 9. 월요일이면 리뷰 줄이 맨 앞에 온다. 4-C 주간 리뷰가 들어올 자리다.
{
  const text = buildKakaoBriefText({
    dDay: 'D-780', projectTitle: '회장직 승계', summary: '오늘은 조용하다.', runDate: MON,
  })
  assert.ok(
    text.startsWith(`${MONDAY_REVIEW_LINE}\n\n☀️ D-780 · 회장직 승계\n\n`),
    `월요일 첫 줄이 다르다: ${JSON.stringify(text)}`,
  )
  assert.ok(text.endsWith('\n\n▶ 전문 보기'), '월요일에 꼬리를 잃었다')
}

// 10. 다른 요일에는 그 줄이 없다. 일요일·화요일·토요일 셋을 본다 — 경계가 월요일 하루인지 확인한다.
//     월요일의 앞뒤(일·화)와, 주 반대편의 하루(토)를 같이 본다.
{
  for (const day of ['2026-09-20', TUE, '2026-09-26']) {
    const text = buildKakaoBriefText({
      dDay: 'D-780', projectTitle: '회장직 승계', summary: '오늘은 조용하다.', runDate: day,
    })
    assert.ok(!text.includes(MONDAY_REVIEW_LINE), `${day}에 리뷰 줄이 붙었다`)
    assert.ok(text.startsWith('☀️ D-780'), `${day} 머리글이 다르다: ${JSON.stringify(text)}`)
  }
}

// 11. 월요일에도 200자를 넘지 않는다. 리뷰 줄은 본문보다 먼저 자리를 잡는다 —
//     긴 요약에 밀려 사라지지 않고, 대신 본문이 그만큼 줄어든다.
//     한 문장으로 예산을 넘겨 '문장 단위'가 아니라 '글자 단위'로 잘리게 만든다 —
//     그래야 줄어든 양을 정확히 잴 수 있다(문장 단위로 자르면 경계가 들쭉날쭉하다).
{
  const flood = '가'.repeat(300) + '.'
  const mon = buildKakaoBriefText({
    dDay: 'D-780', projectTitle: '회장직 승계', summary: flood, runDate: MON,
  })
  const tue = buildKakaoBriefText({
    dDay: 'D-780', projectTitle: '회장직 승계', summary: flood, runDate: TUE,
  })

  assert.ok(len(mon) <= KAKAO_TEXT_LIMIT, `월요일 ${len(mon)}자 — 200자를 넘었다`)
  assert.ok(mon.startsWith(`${MONDAY_REVIEW_LINE}\n\n`), '자르다가 월요일 줄을 잃었다')
  assert.ok(mon.endsWith('\n\n▶ 전문 보기'), '자르다가 꼬리를 잃었다')

  const monBody = mon.split('\n\n')[2]
  const tueBody = tue.split('\n\n')[1]
  assert.equal(
    len(tueBody) - len(monBody),
    len(MONDAY_REVIEW_LINE) + 2,
    '리뷰 줄이 차지한 만큼 본문이 줄지 않았다',
  )
}

// 12. 날짜 형식이 아니면 월요일로 보지 않는다 — 줄이 빠질 뿐 발송은 간다.
//     그리고 실행 환경의 시간대가 요일을 흔들지 못한다(Date.UTC로 읽는다).
{
  assert.equal(isMonday('2026-09-21'), true)
  assert.equal(isMonday('2026/09/21'), false)
  assert.equal(isMonday(''), false)
  assert.equal(isMonday('2026-09-21T07:00:00+09:00'), false)
}

console.log('PASS: buildKakaoBriefText — 머리글 · 200자 · 문장 자르기 · 빈 요약 · 타원 · 월요일 리뷰 줄')

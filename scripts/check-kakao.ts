/**
 * 카카오 메시지 문자열 검사 — npm run check:kakao
 *
 * 재는 것은 buildKakaoBriefText() 하나다. 카카오도 DB도 부르지 않는다.
 * 이 함수가 이 기능에서 유일하게 논리가 있는 자리라서다 — 200자를 넘기면 카카오가
 * 통째로 거절하고, 그 실패는 아침 07:00에 사람 없이 일어난다.
 */
import assert from 'node:assert/strict'

import { buildKakaoBriefText, KAKAO_TEXT_LIMIT } from '../src/lib/kakao/message'

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
  })
  assert.ok(text.startsWith('☀️ D-780 · 회장직 승계\n\n'), `머리글이 다르다: ${JSON.stringify(text)}`)
  assert.ok(text.endsWith('\n\n▶ 전문 보기'), `꼬리가 다르다: ${JSON.stringify(text)}`)
  assert.ok(text.includes('오늘은 조용하다.'), '요약이 빠졌다')
}

// 2. 진행 중인 장기 프로젝트가 없으면 D-day 자리를 비운다 — 'D-null'을 만들지 않는다.
{
  const text = buildKakaoBriefText({ dDay: null, projectTitle: null, summary: '오늘은 조용하다.' })
  assert.ok(text.startsWith('☀️ 오늘의 브리핑\n\n'), `프로젝트 없을 때 머리글이 다르다: ${JSON.stringify(text)}`)
  assert.ok(!text.includes('null'), 'null이 문자열로 샜다')
}

// 3. 200자를 절대 넘지 않는다. 카카오 텍스트 템플릿의 한계다.
{
  const text = buildKakaoBriefText({ dDay: 'D-780', projectTitle: '회장직 승계', summary: LONG })
  assert.ok(len(text) <= KAKAO_TEXT_LIMIT, `${len(text)}자 — 200자를 넘었다`)
  assert.ok(text.startsWith('☀️ D-780 · 회장직 승계\n\n'), '자르다가 머리글을 잃었다')
  assert.ok(text.endsWith('\n\n▶ 전문 보기'), '자르다가 꼬리를 잃었다')
}

// 4. 문장 단위로 자른다 — 들어갈 만큼만 넣되 최소 한 문장은 산다.
{
  const text = buildKakaoBriefText({ dDay: 'D-780', projectTitle: '회장직 승계', summary: LONG })
  assert.ok(text.includes('첫 문장은'), '첫 문장이 통째로 사라졌다')
  assert.ok(!text.includes('다섯 번째 문장은'), '200자 안에 다섯 문장이 들어갈 리 없다')
}

// 5. 세 문장을 넘기지 않는다 — 짧아서 들어가더라도.
{
  const text = buildKakaoBriefText({
    dDay: 'D-1', projectTitle: 'A',
    summary: '하나. 둘. 셋. 넷.',
  })
  assert.ok(text.includes('셋.'), '세 문장은 들어가야 한다')
  assert.ok(!text.includes('넷.'), '네 번째 문장까지 넣었다')
}

// 6. 머리글만으로 이미 긴 제목 — 요약이 한 글자도 안 들어가도 터지지 않는다.
{
  const text = buildKakaoBriefText({
    dDay: 'D-9999', projectTitle: '가'.repeat(180), summary: LONG,
  })
  assert.ok(len(text) <= KAKAO_TEXT_LIMIT, `${len(text)}자 — 긴 제목에서 200자를 넘었다`)
  assert.ok(text.endsWith('\n\n▶ 전문 보기'), '긴 제목에서 꼬리를 잃었다')
}

// 7. 요약이 비어도 보낼 것이 남는다 — 링크를 여는 것이 이 메시지의 목적이다.
{
  const text = buildKakaoBriefText({ dDay: 'D-3', projectTitle: 'A', summary: '   ' })
  assert.ok(text.includes('요약을 만들지 못했습니다'), `빈 요약 문구가 다르다: ${JSON.stringify(text)}`)
  assert.ok(len(text) <= KAKAO_TEXT_LIMIT)
}

console.log('PASS: buildKakaoBriefText — 머리글 · 200자 · 문장 자르기 · 빈 요약')

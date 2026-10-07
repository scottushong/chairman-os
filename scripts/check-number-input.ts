/**
 * 금액 · 숫자 입력칸의 순수 판정 검증 (브라우저 없음): npm run check:number-input
 *
 * 무엇을 재나 (2026-10-07 회장 지시 3단계)
 *   1) 금액 칸은 숫자만 남기고 세 자리마다 쉼표 — 1000 → 1,000 · 5000000 → 5,000,000. 한글 · 문자 · «만» · «억»은 지운다.
 *   2) 붙여넣기도 같은 정리 — «₩5,000,000원» → 5,000,000. 앞의 0은 지운다(0 하나는 남긴다).
 *   3) 정리한 값은 0054 AMOUNT_PATTERN을 늘 통과한다(빈 칸 제외) — 화면이 만든 값을 DB가 거부하면 안 된다.
 *   4) 숫자 칸은 소수점 하나 허용(기존 AI 도구 규칙과 같다), 금액 칸은 소수점 없음.
 *   5) 한글 읽기 — 5,000,000 → 오백만 원 · 123,456,789 → 일억 이천삼백사십오만 육천칠백팔십구 원.
 *   6) 커서 — 쉼표가 끼어도 커서 왼쪽 숫자 개수가 같은 자리로 돌아간다.
 */
import assert from 'node:assert/strict'

import { AMOUNT_PATTERN } from '../src/lib/approval-line'
import { caretAfterDigits, digitsBefore, groupDigits, koreanAmount, parseGrouped } from '../src/lib/number-input'

function money() {
  assert.equal(groupDigits('1000', 'money'), '1,000')
  assert.equal(groupDigits('5000000', 'money'), '5,000,000')
  assert.equal(groupDigits('500만', 'money'), '500')
  assert.equal(groupDigits('1억', 'money'), '1')
  assert.equal(groupDigits('abc', 'money'), '')
  assert.equal(groupDigits('', 'money'), '')
  assert.equal(groupDigits('₩5,000,000원', 'money'), '5,000,000')
  assert.equal(groupDigits('5.000.000', 'money'), '5,000,000')
  assert.equal(groupDigits('1234.5', 'money'), '1,234')
  assert.equal(groupDigits('1,234.50', 'money'), '1,234')
  assert.equal(groupDigits('1.500', 'money'), '1,500')
  assert.equal(groupDigits('0005000', 'money'), '5,000')
  assert.equal(groupDigits('0', 'money'), '0')
  assert.equal(groupDigits('000', 'money'), '0')
  assert.equal(groupDigits('５０００', 'money'), '5,000') // 전각 숫자(일부 한글 자판)
}

function number() {
  assert.equal(groupDigits('1234.5', 'number'), '1,234.5')
  assert.equal(groupDigits('1234.', 'number'), '1,234.')
  assert.equal(groupDigits('1.2.3', 'number'), '1.23')
  assert.equal(groupDigits('.5', 'number'), '0.5')
  assert.equal(groupDigits('12개', 'number'), '12')
}

function pattern() {
  for (const raw of ['1', '1000', '999999', '5000000', '123456789012', '0', '₩1,000원', '7만']) {
    const v = groupDigits(raw, 'money')
    if (v) assert.ok(AMOUNT_PATTERN.test(v), `${raw} → ${v}`)
  }
  assert.equal(parseGrouped('5,000,000'), 5_000_000)
  assert.equal(parseGrouped('1,234.5'), 1234.5)
  assert.equal(parseGrouped(''), null)
}

function korean() {
  assert.equal(koreanAmount(5_000_000), '오백만 원')
  assert.equal(koreanAmount(500_000), '오십만 원')
  assert.equal(koreanAmount(10_000), '만 원')
  assert.equal(koreanAmount(15_000), '만 오천 원')
  assert.equal(koreanAmount(100_000_000), '일억 원')
  assert.equal(koreanAmount(123_456_789), '일억 이천삼백사십오만 육천칠백팔십구 원')
  assert.equal(koreanAmount(1_000_000_000_000), '일조 원')
  assert.equal(koreanAmount(1_100), '천백 원')
  assert.equal(koreanAmount(0), '영 원')
}

function caret() {
  // '1,000' 에서 커서가 끝(5)이면 왼쪽 숫자 4개 → '10,000'에서 같은 숫자 4개 뒤 = 5
  assert.equal(digitsBefore('1,000', 5), 4)
  assert.equal(caretAfterDigits('10,000', 4), 5)
  assert.equal(caretAfterDigits('10,000', 0), 0)
  assert.equal(caretAfterDigits('10,000', 2), 2)
  assert.equal(caretAfterDigits('10,000', 99), 6)
}

money()
number()
pattern()
korean()
caret()
console.log('check:number-input — 금액 · 숫자 칸 정리 · 0054 모양 · 한글 읽기 · 커서 OK')

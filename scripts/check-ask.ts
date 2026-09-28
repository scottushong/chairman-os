/**
 * Phase 9 블록 6 검증 — «AI에게 재무 질문 → 직원은 권한 없음» (원문 검증 항목).
 *
 * 모델을 부르지 않는다: 재무 질문에 재무 권한이 없으면 answerQuestion()이 규칙으로 답하고,
 * 키가 없으면 «AI 연결 없음»으로 답한다. 여기서는 ANTHROPIC_API_KEY를 비운 채 돌려
 * 비용 없이 세 경로(직원 재무 → 권한 없음 / 회장 재무 → 모델 경로 / 컨텍스트에 재무 없음)를 잰다.
 *
 *   npx tsx --conditions=react-server scripts/check-ask.ts
 */
import assert from 'node:assert/strict'

import { answerQuestion, buildAskContext } from '../src/lib/ai/ask'
import { dummyRepository } from '../src/lib/repository/dummy'
import type { SessionUser } from '../src/types'

delete process.env.ANTHROPIC_API_KEY

const staff: SessionUser = { user_id: 'u-staff', name: '직원', role: 'Member', title_ko: '', display_name_en: null, language: 'ko' }
const chairman: SessionUser = { ...staff, user_id: 'u-ch', name: '회장', role: 'Chairman' }

async function main() {
  const s = await answerQuestion('이번 달 DY 매출이 얼마야?', dummyRepository, staff)
  assert.ok(s.ruled && s.answer.startsWith('권한 없음'), `직원의 재무 질문이 «권한 없음»이 아니다: ${s.answer}`)

  const sctx = await buildAskContext(dummyRepository, staff)
  assert.equal(sctx.permissions.finance, false, '직원 컨텍스트에 재무 권한이 켜져 있다')
  assert.equal(sctx.context.finance.length, 0, '직원 컨텍스트에 재무 숫자가 실린다')
  assert.ok(sctx.context.exceptions.every((e) => e.value === null && e.threshold === null), '직원 컨텍스트의 예외에 금액이 실린다')

  const c = await answerQuestion('이번 달 DY 매출이 얼마야?', dummyRepository, chairman)
  assert.ok(!c.answer.startsWith('권한 없음'), '회장의 재무 질문까지 «권한 없음»이 된다')
  const cctx = await buildAskContext(dummyRepository, chairman)
  assert.ok(cctx.permissions.finance && cctx.context.finance.length > 0, '회장 컨텍스트에 재무 숫자가 없다')

  console.log('PASS: 직원 재무 질문 → 권한 없음(모델 호출 없음) · 직원 컨텍스트에 재무/예외 금액 없음 · 회장은 재무 경로')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

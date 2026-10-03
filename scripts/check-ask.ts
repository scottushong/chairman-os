/**
 * Phase 11 AI 어시스턴트 검증(Phase 9 «AI에게 묻기» 검사를 넓힌 것) — 모델을 부르지 않는다.
 *
 * ANTHROPIC_API_KEY를 비운 채 dummy repo로 잰다: 모델 앞의 규칙(개발 세션 거절 · 직원 재무 거절),
 * 도구가 코드로 낸 숫자(재무 합 = 원장 줄을 따로 더한 값 · 기한 없는 이니셔티브 = 실제 줄),
 * 제안 → 확인의 문(pending · 주인만 한 번 · 감사 «AI 제안, 회장 확인»), 계산기의 거절, 창구별 도구.
 *
 *   npx tsx --conditions=react-server scripts/check-ask.ts
 */
import assert from 'node:assert/strict'

import { CalcError, evaluate } from '../src/lib/ai/assistant/calc'
import { ALL_TOOLS, DEV_SESSION_LINE, isAppChangeRequest, makeContext, runAssistant } from '../src/lib/ai/assistant/run'
import { dummyRepository as repo } from '../src/lib/repository/dummy'
import { dummyViewer } from '../src/lib/repository/dummy-org'
import type { SessionUser } from '../src/types'

delete process.env.ANTHROPIC_API_KEY

function sessionOf(): SessionUser {
  const v = dummyViewer()
  return { user_id: v.user_id, name: v.display_name, role: v.role, title_ko: v.title_ko, display_name_en: null, language: 'ko', finance: {} }
}
const as = (key: string) => {
  process.env.DUMMY_USER = key
  return sessionOf()
}
const tool = (name: string) => ALL_TOOLS.find((t) => t.def.name === name)!
const ask = (user: SessionUser, question: string, path = '/') => runAssistant({ question, repo, user, path, chatId: null, history: [] })

async function main() {
  const chair = as('chairman')

  // ── 1. 앱 코드 · 화면 변경 → 한 줄 거절(모델 호출 없음). 데이터 고치기는 걸리지 않는다 ──
  const dev = await ask(chair, '대시보드에 환율 그래프 추가해줘')
  assert.deepEqual([dev.ruled, dev.answer], [true, DEV_SESSION_LINE], `화면 변경 요청이 «${DEV_SESSION_LINE}»가 아니다: ${dev.answer}`)
  for (const q of ['사이드바에 메뉴 하나 만들어 줘', '홈 화면에 날씨 위젯 넣어줘']) assert.ok(isAppChangeRequest(q), `화면 변경으로 안 읽힌다: ${q}`)
  for (const q of ['VLING24 다음 행동 바꿔줘', '기한 없는 이니셔티브', '이 화면에 틀린 것 있어?', 'VANA 9월 손익 합계', '다음 주 화요일에 일정 추가해줘', '이 결재 기안 만들어줘']) {
    assert.ok(!isAppChangeRequest(q), `데이터 요청이 화면 변경으로 거절된다: ${q}`)
  }

  // ── 2. 직원 세션의 재무 질문 → 권한 없음(모델 호출 없음) · 재무 도구도 안 준다 ──
  const staff = as('sales_staff')
  const s = await ask(staff, 'VANA 9월 손익 합계')
  assert.ok(s.ruled && s.answer.startsWith('권한 없음'), `직원의 재무 질문이 «권한 없음»이 아니다: ${s.answer}`)
  const staffCtx = makeContext({ question: '', repo, user: staff, path: '/', chatId: null, history: [] })
  const staffTools = ALL_TOOLS.filter((t) => t.available(staffCtx)).map((t) => t.def.name)
  for (const n of ['finance_query', 'chairman_direction', 'list_initiatives', 'propose_checkin', 'propose_memo_tidy', 'dependency', 'attention']) {
    assert.ok(!staffTools.includes(n), `직원에게 ${n} 도구가 열린다`)
  }
  const staffAttention = (await tool('attention').run({}, staffCtx)) as { readable: boolean }
  assert.equal(staffAttention.readable, false, '직원에게 주의(예외)가 «0건»으로 읽힌다(권한 밖이라고 말해야 한다)')

  // ── 3. 계산기: 코드가 계산하고, 모르는 글자는 거절(eval 없음) ──
  assert.equal(evaluate('(252,000,000 - 204,000,000) / 204,000,000 * 100'), 23.5294117647)
  assert.equal(evaluate('sum(1, 2, 3) + avg(2, 4) * 2'), 12)
  assert.equal(evaluate('0.1 + 0.2'), 0.3)
  assert.equal(evaluate('-2^2 + round(3.14159, 2)'), -0.86)
  for (const bad of ['process.exit()', 'constructor', '1/0', 'sum(1,2', '2**3', 'alert(1)', 'x=1']) {
    assert.throws(() => evaluate(bad), CalcError, `계산기가 «${bad}»를 받는다`)
  }

  // ── 4. «VANA 9월 손익 합계» — 합은 원장 줄을 따로 더한 값과 같고, 없는 달은 없다고 한다 ──
  const chair2 = as('chairman')
  const ctx = makeContext({ question: '', repo, user: chair2, path: '/', chatId: null, history: [] })
  type Fin = { periods: string[]; missing_periods: string[]; totals: Record<string, { total: number | null }> | null; per_period?: Record<string, Record<string, { value: number }>> }
  const fin = (await tool('finance_query').run({ business: 'VANA', month: 9 }, ctx)) as Fin
  const kpis = (await repo.listFinanceKpis()).filter((k) => k.business_id === 'biz_vana' && k.period.endsWith('-09'))
  assert.ok(fin.periods.length > 1, 'VANA 9월이 여러 해가 아니다(dummy 가정이 바뀌었나)')
  assert.ok(fin.missing_periods.includes('2026-09'), '올해 9월이 없는데 missing_periods에 없다')
  assert.equal(fin.totals, null, '해 없는 «9월»에 해를 넘는 합계를 낸다')
  for (const p of fin.periods) {
    assert.equal(fin.per_period![p].OperatingProfit.value, kpis.find((k) => k.period === p && k.metric === 'OperatingProfit')!.value, `${p} 영업이익이 원장 값과 다르다`)
  }
  // 구간 합(예: 두 해의 9월을 일부러 더하라고 할 때)은 서버가 원장 줄을 더한 값과 같다.
  const span = (await tool('finance_query').run({ business: 'VANA', periods: fin.periods }, ctx)) as Fin
  for (const m of ['Revenue', 'OperatingProfit', 'NetIncome', 'EBITDA']) {
    const own = kpis.filter((k) => k.metric === m && fin.periods.includes(k.period)).reduce((a, k) => a + k.value, 0)
    assert.equal(span.totals![m].total, own, `${m} 합 ≠ 원장 줄의 합`)
  }
  const one = (await tool('finance_query').run({ business: 'biz_vana', periods: ['2025-09'], metrics: ['OperatingProfit'] }, ctx)) as { totals: Record<string, { total: number }> }
  assert.equal(one.totals.OperatingProfit.total, kpis.find((k) => k.period === '2025-09' && k.metric === 'OperatingProfit')!.value, '한 달 합이 그 달 값과 다르다')
  assert.ok(ctx.evidence.length > 0 && ctx.evidence.every((e) => e.href.startsWith('/finance/biz_vana')), '재무 근거 카드가 원장 화면을 가리키지 않는다')

  // ── 5. «기한 없는 이니셔티브» — 실제 줄에서(없으면 0건) ──
  const actor = { user_id: chair2.user_id, role: chair2.role }
  const empty = (await tool('list_initiatives').run({ filter: 'no_target_date' }, ctx)) as { count: number; total_initiatives: number }
  const before = empty.total_initiatives
  const base = { kind: 'Deal' as const, business_id: null, stage: 'Planning' as const, goal: '', next_action: '', next_action_date: null, next_action_owner: '', blocker: '', status: 'Active' as const, logo_url: null }
  const a = await repo.saveInitiative({ ...base, title: '기한 없음 A', target_date: null }, actor)
  const b = await repo.saveInitiative({ ...base, title: '기한 있음 B', target_date: '2026-12-31' }, actor)
  const nd = (await tool('list_initiatives').run({ filter: 'no_target_date' }, ctx)) as { rows: { id: string }[]; total_initiatives: number }
  assert.equal(nd.total_initiatives, before + 2)
  assert.ok(nd.rows.some((r) => r.id === a.initiative_id), '기한 없는 건이 목록에 없다')
  assert.ok(!nd.rows.some((r) => r.id === b.initiative_id), '기한 있는 건이 «기한 없는» 목록에 섞인다')

  // ── 6. «VLING24 다음 행동 바꿔줘» — 없으면 없다고, 있으면 pending 제안(아직 안 바뀜) → 주인만 한 번 확인 → 감사 ──
  const chatId = await repo.createAiChat('검증', actor, '/initiatives')
  const wctx = makeContext({ question: '', repo, user: chair2, path: '/initiatives', chatId, history: [] })
  const missing = (await tool('propose_initiative_update').run({ initiative: 'VLING24', changes: { next_action: '계약서 초안 회신' } }, wctx)) as { error?: string }
  assert.equal(missing.error, 'not_found', '없는 이니셔티브에 제안이 선다')
  assert.equal(wctx.actionIds.length, 0, '없는 건인데 제안 줄이 생겼다')

  const v = await repo.saveInitiative({ ...base, title: 'VLING24', target_date: null, next_action: '미팅 잡기' }, actor)
  const prop = (await tool('propose_initiative_update').run({ initiative: 'vling 24', changes: { next_action: '계약서 초안 회신' } }, wctx)) as { status: string; action_id: string }
  assert.equal(prop.status, 'awaiting_confirmation')
  assert.equal((await repo.getInitiative(v.initiative_id))!.next_action, '미팅 잡기', '확인 전에 이니셔티브가 바뀌었다')
  const [pending] = await repo.listAiActions(chatId)
  assert.deepEqual([pending.status, pending.kind, pending.target_id], ['pending', 'initiative_update', v.initiative_id])
  assert.ok(Date.parse(pending.expires_at) - Date.now() <= 15 * 60_000 + 1000, '제안 만료가 15분보다 길다')

  as('sales_staff')
  assert.equal(await repo.decideAiAction(prop.action_id, true), null, '남(직원)이 회장의 제안을 확인한다')
  as('chairman')
  const decided = await repo.decideAiAction(prop.action_id, true)
  assert.equal(decided?.status, 'confirmed', '주인이 확인하지 못한다')
  assert.deepEqual(decided?.payload, { initiative_id: v.initiative_id, changes: { next_action: '계약서 초안 회신' } }, '확인된 줄의 payload가 미리보기와 다르다')
  assert.equal(await repo.decideAiAction(prop.action_id, true), null, '같은 제안을 두 번 확인한다')
  const audit = await repo.listEntityAudit('initiatives', v.initiative_id)
  assert.ok(audit.some((r) => r.note === 'AI 제안, 회장 확인'), '확인이 이니셔티브 이력에 «AI 제안, 회장 확인»으로 안 남는다')

  // ── 7. 검증: 이니셔티브 상세에서 «틀린 것» = 빈 필수 칸(코드가 찾음) ──
  const vctx = makeContext({ question: '', repo, user: chair2, path: `/initiatives/${v.initiative_id}`, chatId: null, history: [] })
  const val = (await tool('validate_screen').run({}, vctx)) as { findings: { check: string; what: string }[] }
  assert.ok(val.findings.some((f) => f.check === 'missing_required' && f.what.includes('VLING24')), '빈 필수 칸을 못 찾는다')
  const bctx = makeContext({ question: '', repo, user: chair2, path: '/finance/biz_vana', chatId: null, history: [] })
  const bval = (await tool('validate_screen').run({}, bctx)) as { counts: Record<string, number>; not_checked: string[] }
  assert.ok('ledger_imbalance' in bval.counts && 'provisional_vs_confirmed' in bval.counts, '회사 재무 화면에서 재무 검증을 안 한다')

  // ── 8. 창구: 카카오는 읽기만 — 제안 · 재무 · 첨부 도구가 없다 ──
  const kctx = makeContext({ question: '', repo, user: chair2, path: '/', chatId: null, history: [], channel: 'kakao' })
  const ktools = ALL_TOOLS.filter((t) => t.available(kctx)).map((t) => t.def.name)
  assert.ok(ktools.every((n) => !n.startsWith('propose_')) && !ktools.includes('finance_query') && !ktools.includes('attachment_summaries'), `카카오에 쓰기 · 제한 도구가 열린다: ${ktools}`)

  console.log(
    'PASS: 화면 변경 → «개발 세션에서 처리합니다»(데이터 요청은 통과) · 직원 재무 → 권한 없음 + 재무/회장 도구 없음 · 계산기(코드 · eval 없음 · 거절) · ' +
      'VANA 9월 합 = 원장 줄 합 · 없는 달 표시 · 기한 없는 이니셔티브 = 실제 줄 · VLING24 없으면 제안 없음 → 있으면 pending(미변경) → 남 확인 불가 → 주인 한 번 → 감사 «AI 제안, 회장 확인» · 검증(빈 칸 · 재무) · 카카오 읽기만',
  )
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

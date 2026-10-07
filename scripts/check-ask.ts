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

import { readFileSync } from 'node:fs'

import Anthropic from '@anthropic-ai/sdk'

import { CalcError, evaluate } from '../src/lib/ai/assistant/calc'
import { aiErrorMessage, classifyAiError, type AiErrorKind } from '../src/lib/ai/assistant/errors'
import { historyForModel, lastExpired, liveActions, sanitizeHistory } from '../src/lib/ai/assistant/history'
import {
  ALL_TOOLS,
  DEV_SESSION_LINE,
  isAppChangeRequest,
  isAttachRequest,
  isConfirmIntent,
  makeContext,
  runAssistant,
} from '../src/lib/ai/assistant/run'
import { AMOUNT_INVALID_MESSAGE } from '../src/lib/approval-line'
import { approvalSubmitError, submitApprovalWith } from '../src/lib/approval-submit'
import { kstToday } from '../src/lib/chairman-project'
import { financeByBusiness, hasDraftGrant } from '../src/lib/module-grants'
import { dummyRepository as repo } from '../src/lib/repository/dummy'
import { dummyModuleGrants, dummyViewer, setDummyModuleGrant } from '../src/lib/repository/dummy-org'
import type { AiAction, AiChatMessage, SessionUser } from '../src/types'

delete process.env.ANTHROPIC_API_KEY

/** lib/auth/session.ts dummyUser()와 같은 모양 — 모듈 줄(재무 · «결재 올리기»)까지 읽는다. */
function sessionOf(): SessionUser {
  const v = dummyViewer()
  const grants = dummyModuleGrants(v.user_id)
  return {
    user_id: v.user_id,
    name: v.display_name,
    role: v.role,
    title_ko: v.title_ko,
    display_name_en: null,
    language: 'ko',
    finance: financeByBusiness(grants),
    approvals_write: v.role === 'Chairman' || hasDraftGrant(grants),
  }
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
  for (const q of ['VLING24 다음 행동 바꿔줘', '기한 없는 이니셔티브', '이 화면에 틀린 것 있어?', 'VANA 9월 손익 합계', '다음 주 화요일에 일정 추가해줘', '이 결재 기안 만들어줘', '첨부해줘', '첨부 탭에 견적서 넣어줘', '이 결재에 영수증 파일 붙여줘']) {
    assert.ok(!isAppChangeRequest(q), `데이터 요청이 화면 변경으로 거절된다: ${q}`)
  }
  for (const q of ['결재 화면에 버튼 추가해줘', '첨부 탭에 그래프 추가해줘', '문서 화면에 업로드 기능 만들어줘']) assert.ok(isAppChangeRequest(q), `화면 변경으로 안 읽힌다: ${q}`)
  // 첨부 말 · 확인 말(모델 앞 규칙) — 찾기 · 요약 · 새 값이 섞인 말은 걸리지 않는다.
  for (const q of ['첨부해줘', '견적서 첨부해줘', '파일은 어디에 올려?', '첨부 좀 해 줘']) assert.ok(isAttachRequest(q), `첨부 요청으로 안 읽힌다: ${q}`)
  for (const q of ['첨부 파일 요약해줘', '첨부된 문서 찾아줘', '이 결재에 첨부 있어?', '이번 달 마감 결재']) assert.ok(!isAttachRequest(q), `첨부 요청으로 잘못 읽힌다: ${q}`)
  for (const q of ['확인했어, 진행해', '결재 올려줘', '그대로 진행해 주세요', '네']) assert.ok(isConfirmIntent(q), `확인 말로 안 읽힌다: ${q}`)
  for (const q of ['금액을 300000원으로 바꿔서 진행해', '그대로 두고 목적만 바꿔 줘', '이번 달 마감 결재', '네이버 광고비 결재 내용 알려줘']) assert.ok(!isConfirmIntent(q), `확인 말로 잘못 읽힌다: ${q}`)

  // ── 2. 직원 세션의 재무 질문 → 권한 없음(모델 호출 없음) · 재무 도구도 안 준다 ──
  const staff = as('sales_staff')
  const s = await ask(staff, 'VANA 9월 손익 합계')
  assert.ok(s.ruled && s.answer.startsWith('권한이 없습니다 — ') && s.answer.includes('대표에게'), `직원의 재무 질문이 «권한이 없습니다 — … 대표에게»가 아니다: ${s.answer}`)
  const staffCtx = makeContext({ question: '', repo, user: staff, path: '/', chatId: null, history: [] })
  const staffTools = ALL_TOOLS.filter((t) => t.available(staffCtx)).map((t) => t.def.name)
  for (const n of ['finance_query', 'finance_input_help', 'chairman_direction', 'list_initiatives', 'propose_checkin', 'propose_memo_tidy', 'dependency', 'attention', 'propose_approval_draft']) {
    assert.ok(!staffTools.includes(n), `직원에게 ${n} 도구가 열린다`)
  }
  for (const n of ['list_approvals', 'list_approval_templates', 'propose_approval_form', 'closing_status', 'search_documents', 'my_tasks', 'attachment_summaries']) {
    assert.ok(staffTools.includes(n), `직원에게 ${n} 도구가 없다`)
  }
  // 직원에게 싣는 도구 설명에 «회장 / Chairman»이 없다(직원 화면 용어 원칙).
  for (const t of ALL_TOOLS.filter((x) => x.available(staffCtx))) {
    const d = t.staffDescription ?? t.def.description ?? ''
    assert.ok(!/회장|chairman/i.test(d), `직원에게 가는 ${t.def.name} 설명에 «회장/Chairman»이 있다: ${d}`)
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

  await staffFlow()

  console.log(
    'PASS: 화면 변경 → «개발 세션에서 처리합니다»(데이터 요청은 통과) · 직원 재무 → 권한 없음 + 재무/회장 도구 없음 · 계산기(코드 · eval 없음 · 거절) · ' +
      'VANA 9월 합 = 원장 줄 합 · 없는 달 표시 · 기한 없는 이니셔티브 = 실제 줄 · VLING24 없으면 제안 없음 → 있으면 pending(미변경) → 남 확인 불가 → 주인 한 번 → 감사 «AI 제안, 회장 확인» · 검증(빈 칸 · 재무) · 카카오 읽기만 · ' +
      '오류 분류 · 대화 모양(번갈아 · 맥락 메모) · 직원 권한 밖 «권한이 없습니다 — … 대표에게» · 직원 도구(내 결재 · 마감 · 문서 · 전표 도움 · 양식 결재) · ' +
      '양식 결재 빈 칸 · 금액 모양(0054 approval_amount_invalid 문장) → 카드 → 중복 없음 → «확인했어» = 버튼 안내 → 확인 → 결재선 · 팀장 대기 · «첨부해줘» = «첨부» 칸 · 직원 글에 «회장» 없음',
  )
}

/** 직원(김병훈 자리 = DY 경영지원, DY 재무 입력 · «결재 올리기») — 결재 조회 · 마감 · 양식 결재 제안 → 확인 · 첨부 · 오류 · 대화 모양. */
async function staffFlow() {
  const today = kstToday()
  const NO_BOSS = /회장|chairman/i

  // ── 9. 오류 분류 — 종류마다 다른 문장 · 구조 로그의 재료(status · request id) ──
  const sdk429 = Anthropic.APIError.generate(429, { error: { type: 'rate_limit_error', message: 'rate limited' } }, undefined, new Headers({ 'request-id': 'req_429' }))
  const samples: [unknown, AiErrorKind][] = [
    [{ status: 401, type: 'authentication_error', message: 'invalid x-api-key' }, 'auth'],
    [{ status: 403, type: 'permission_error', message: 'no' }, 'auth'],
    [{ status: 400, type: 'invalid_request_error', message: 'Your credit balance is too low to access the Anthropic API.' }, 'credit'],
    [sdk429, 'rate_limit'],
    [{ status: 529, type: 'overloaded_error', message: 'Overloaded' }, 'overloaded'],
    [new Anthropic.APIConnectionTimeoutError(), 'timeout'],
    [new Anthropic.APIConnectionError({ message: 'Connection error.' }), 'connection'],
    [{ status: 400, type: 'invalid_request_error', message: 'messages: roles must alternate' }, 'bad_request'],
    [{ status: 500, type: 'api_error', message: 'Internal' }, 'server'],
    [new Error('???'), 'unknown'],
  ]
  for (const [e, kind] of samples) assert.equal(classifyAiError(e).kind, kind, `오류 분류가 틀린다: ${String(e)} → ${classifyAiError(e).kind}`)
  assert.equal(classifyAiError(sdk429).requestId, 'req_429', 'request id를 못 읽는다')
  assert.equal(classifyAiError(sdk429).status, 429)
  const kinds: AiErrorKind[] = ['auth', 'credit', 'rate_limit', 'overloaded', 'timeout', 'connection', 'bad_request', 'server', 'unknown']
  assert.equal(new Set(kinds.map((k) => aiErrorMessage(k))).size, kinds.length, '오류 종류의 문장이 겹친다')
  assert.ok(kinds.every((k) => !NO_BOSS.test(aiErrorMessage(k))), '오류 문장에 «회장»이 있다')

  // ── 10. 대화 모양 — user로 시작 · 번갈아(답 없는 질문은 이어 붙인다) · 맥락 메모는 모델 사본에만 ──
  assert.deepEqual(
    sanitizeHistory([
      { role: 'assistant', content: '앞이 잘린 답' },
      { role: 'user', content: 'q1' },
      { role: 'user', content: 'q2' },
      { role: 'assistant', content: 'a2' },
      { role: 'assistant', content: 'a3' },
      { role: 'user', content: '  ' },
    ]),
    [
      { role: 'user', content: 'q1\n\nq2' },
      { role: 'assistant', content: 'a2\n\na3' },
    ],
  )
  const hist: AiChatMessage[] = [
    { id: 1, chat_id: 'c', role: 'user', content: '이번 달 마감 결재', sources: [], created_at: '' },
    { id: 2, chat_id: 'c', role: 'assistant', content: '한 건입니다.', sources: [{ label: '택배비', href: '/approvals?id=dec_x', detail: 'DY · 팀장 대기' }], created_at: '' },
  ]
  const forModel = historyForModel(hist, [])
  assert.ok(forModel[1].content.startsWith('한 건입니다.') && forModel[1].content.includes('결재 dec_x') && forModel[1].content.includes('맥락 메모'), '앞선 답의 결재 id가 다음 턴 맥락에 없다')
  assert.equal(hist[1].content, '한 건입니다.', '맥락 메모가 저장된 글을 바꿨다')
  // 만료 카드: 살아 있는 카드 없음 · 최근(1시간 안) 만료만 «새로 만들까요»의 대상.
  const t0 = Date.now()
  const fake = (min: number, ttl: number) =>
    ({ action_id: `a${min}`, chat_id: 'c', kind: 'approval_draft', payload: {}, preview: { title: '지출 결재', lines: [] }, target_table: null, target_id: null, business_id: null, status: 'pending', result: null, created_at: new Date(t0 - min * 60_000).toISOString(), expires_at: new Date(t0 - min * 60_000 + ttl * 60_000).toISOString() }) as AiAction
  assert.equal(liveActions([fake(20, 15)], t0).length, 0)
  assert.equal(lastExpired([fake(20, 15)], t0)?.action_id, 'a20')
  assert.equal(lastExpired([fake(90, 15)], t0), null, '한 시간 넘은 카드에 «만료» 안내를 한다')
  assert.equal(lastExpired([fake(5, 15)], t0), null, '살아 있는 카드를 만료로 본다')
  assert.ok(historyForModel([{ ...hist[1], action_ids: ['a20'] }], [fake(20, 15)], 12, t0)[0] === undefined, '앞이 assistant인 대화가 그대로 실린다')
  assert.ok(historyForModel([hist[0], { ...hist[1], action_ids: ['a20'] }], [fake(20, 15)], 12, t0)[1].content.includes('만료됨'), '맥락 메모에 카드 상태가 없다')

  // ── 11. 권한 밖은 «권한이 없습니다 — …» (침묵 · «권한 때문일 수 있습니다» 아님) ──
  const member = as('sales_staff')
  const mctx = makeContext({ question: '', repo, user: member, path: '/', chatId: null, history: [] })
  const denyForm = (await tool('propose_approval_form').run({ template: '지출', fields: { amount: '1000' } }, mctx)) as { error: string; message: string }
  assert.equal(denyForm.error, 'no_permission', '«결재 올리기» 없는 직원에게 결재 카드가 선다')
  assert.ok(denyForm.message.startsWith('권한이 없습니다 — ') && denyForm.message.includes('대표에게'), denyForm.message)
  const denyClose = (await tool('closing_status').run({}, mctx)) as { error: string; message: string }
  assert.equal(denyClose.error, 'no_permission', '재무 권한 없는 직원에게 마감 상태가 읽힌다')
  assert.ok(denyClose.message.startsWith('권한이 없습니다 — ') && !NO_BOSS.test(denyClose.message))
  assert.equal(mctx.actionIds.length, 0)
  // 옛 기안 액션의 권한 오류도 모듈 경로를 내보이지 않는다(«대표에게 … 요청하세요»).
  const draftSrc = readFileSync('src/app/actions/draft-decision.ts', 'utf8')
  assert.ok(draftSrc.includes('«결재 올리기» 권한을 켜 달라고 요청하세요') && !draftSrc.includes('(/chairman/decisions 쓰기 권한이 필요합니다)'), 'draft-decision 권한 오류에 모듈 경로가 보인다')

  // ── 12. 김병훈 자리(DY 경영지원 · DY 재무 입력 · «결재 올리기») — 도구 · 조회 ──
  const lead = as('support_lead')
  setDummyModuleGrant(lead.user_id, { module: '/chairman/decisions', can_write: true, can_approve: false })
  const kim = as('support_lead')
  assert.equal(kim.approvals_write, true)
  const kchat = await repo.createAiChat('검증 · 직원 결재', { user_id: kim.user_id, role: kim.role }, '/approvals')
  const kctx = makeContext({ question: '', repo, user: kim, path: '/approvals', chatId: kchat, history: [] })
  const ktools = ALL_TOOLS.filter((t) => t.available(kctx)).map((t) => t.def.name)
  for (const n of ['finance_query', 'finance_input_help', 'closing_status', 'propose_approval_form', 'list_approval_templates', 'search_documents']) assert.ok(ktools.includes(n), `DY 재무 입력자에게 ${n}가 없다`)
  for (const n of ['propose_approval_draft', 'chairman_direction', 'attention', 'dependency', 'propose_memo_tidy']) assert.ok(!ktools.includes(n), `직원에게 ${n}가 열린다`)

  const close = (await tool('closing_status').run({}, kctx)) as { rows: { business_id: string; can_enter_slips: boolean; can_close: boolean; period: string }[] }
  assert.ok(close.rows.length >= 1 && close.rows.every((r) => r.business_id === 'biz_dy'), `마감 상태가 DY 밖으로 샌다: ${close.rows.map((r) => r.business_id)}`)
  assert.deepEqual([close.rows[0].can_enter_slips, close.rows[0].can_close, close.rows[0].period], [true, false, today.slice(0, 7)])
  const help = (await tool('finance_input_help').run({ business: 'DY', account_query: '현금' }, kctx)) as { can_enter: boolean; where: string; templates: unknown[] }
  assert.ok(help.can_enter && help.where.includes('/finance/biz_dy/journal') && help.templates.length > 0, '전표 입력 도움이 비었다')
  const docs = (await tool('search_documents').run({}, kctx)) as { documents: { id: string }[]; attachments: { security_class: string }[] }
  assert.ok(docs.attachments.every((a) => a.security_class !== 'Vault'), '문서 찾기에 Vault가 섞인다')
  const templates = (await tool('list_approval_templates').run({}, kctx)) as { can_submit: unknown; templates: { key: string }[] }
  assert.equal(templates.can_submit, true)
  assert.ok(templates.templates.some((t) => t.key === 'expense'))

  // ── 13. 양식 결재: 빈 필수 → missing_fields(카드 없음) · 채우면 카드(결재선 미리보기) · 같은 카드 또 없음 ──
  const miss = (await tool('propose_approval_form').run({ template: '지출', business: 'DY', fields: { amount: '120000' } }, kctx)) as { error: string; message: string }
  assert.equal(miss.error, 'missing_fields', `빈 필수 항목에 카드가 선다: ${JSON.stringify(miss)}`)
  assert.equal(kctx.actionIds.length, 0)
  // 0054 C1 — 금액이 숫자 모양이 아니면(«600만» · 쉼표 틀림) 카드 없이 화면 · 트리거와 같은 문장.
  for (const bad of ['600만', '60,00,000', '1.000.000']) {
    const r = (await tool('propose_approval_form').run({ template: '지출', business: 'DY', fields: { amount: bad, purpose: '택배비', spent_on: today, vendor: '우체국' } }, kctx)) as { error: string; message: string }
    assert.deepEqual([r.error, r.message], ['invalid', AMOUNT_INVALID_MESSAGE], `금액 «${bad}»에 카드가 선다: ${JSON.stringify(r)}`)
  }
  assert.equal(kctx.actionIds.length, 0)
  assert.equal(approvalSubmitError(new Error('approval_amount_invalid'), (await repo.listApprovalTemplates()).find((t) => t.template_key === 'expense')!, kim.role), AMOUNT_INVALID_MESSAGE, 'DB 거부 approval_amount_invalid가 금액 문장으로 안 바뀐다')
  const fields = { amount: '120,000', purpose: '9월 마감 증빙 택배비', spent_on: today, vendor: '우체국' }
  type Card = { status: string; action_id: string; preview: { lines: { label: string; after: string }[] } }
  const card = (await tool('propose_approval_form').run({ template: '지출', business: 'DY', fields }, kctx)) as Card
  assert.equal(card.status, 'awaiting_confirmation', JSON.stringify(card))
  const lineRow = card.preview.lines.find((l) => l.label === '결재선')
  assert.ok(lineRow && lineRow.after.startsWith('팀장 ') && !NO_BOSS.test(JSON.stringify(card.preview)), `결재선 미리보기가 이상하다: ${lineRow?.after}`)
  const again = (await tool('propose_approval_form').run({ template: 'expense', business: 'biz_dy', fields }, kctx)) as Card
  assert.deepEqual([again.status, again.action_id], ['already_pending', card.action_id], '같은 내용의 카드를 또 만든다')
  assert.equal(kctx.actionIds.length, 1)

  // «확인했어, 진행해» · «결재 올려줘»(카드가 떠 있음) → 버튼을 누르라는 답(모델 호출 없음 · 새 카드 없음).
  const histNow: AiChatMessage[] = [
    { id: 1, chat_id: kchat, role: 'user', content: '결재 올려줘', sources: [], created_at: '' },
    { id: 2, chat_id: kchat, role: 'assistant', content: '카드를 띄웠습니다.', sources: [], created_at: '', action_ids: [card.action_id] },
  ]
  for (const q of ['확인했어, 진행해', '결재 올려줘']) {
    const ok = await runAssistant({ question: q, repo, user: kim, path: '/approvals', chatId: kchat, history: histNow })
    assert.ok(ok.ruled && ok.answer.includes('«확인 — 저장»을 누르면 올라갑니다') && ok.actionIds.length === 0, `확인 말에 버튼 안내가 아니다: ${ok.answer}`)
  }
  // «첨부해줘»(카드가 떠 있음) → 먼저 올리고 결재 화면의 «첨부» 칸.
  const att = await runAssistant({ question: '첨부해줘', repo, user: kim, path: '/approvals', chatId: kchat, history: histNow })
  assert.ok(att.ruled && att.answer.includes('«첨부» 칸') && !/권한/.test(att.answer), `첨부 안내가 아니다: ${att.answer}`)

  // 확인 → 화면과 같은 문(submitApprovalWith = app/actions/approval-form.ts의 몸통)으로 결재가 선다 — 결재선 · 팀장 대기.
  const decided = await repo.decideAiAction(card.action_id, true)
  assert.equal(decided?.status, 'confirmed')
  const p = decided!.payload
  const sub = await submitApprovalWith(repo, kim, { templateKey: p.template_key, businessId: p.business_id, title: p.title, deadline: p.deadline, form: p.form })
  assert.ok(!sub.error && sub.decision, `양식 결재가 안 선다: ${sub.error}`)
  const dec = sub.decision!
  assert.deepEqual([dec.template_key, dec.status, dec.lead_status, dec.created_by], ['expense', 'Open', 'pending', kim.user_id])
  assert.ok((dec.approval_line?.length ?? 0) >= 2 && dec.approval_line![0].step === 'lead' && dec.approval_line![0].user_id, '결재선(팀장 칸)이 안 섰다')
  assert.ok(!dec.approval_line!.some((st) => st.step === 'chairman'), '기준 미만인데 대표 칸이 섰다')
  await repo.finishAiAction(card.action_id, true, '결재를 올렸습니다')

  // 내 결재(scope=mine) — 상태 · 결재선 · 양식 항목 이름.
  type Rows = { rows: { id: string; state: string; form: Record<string, string> | null; approval_line: unknown[] | null }[] }
  const mine = (await tool('list_approvals').run({ scope: 'mine' }, kctx)) as Rows
  const row = mine.rows.find((r) => r.id === dec.decision_id)
  assert.ok(row && row.state === '팀장 대기' && row.form?.['지출 목적'] === fields.purpose && row.approval_line?.length, `내 결재에 방금 건이 없다: ${JSON.stringify(row)}`)
  assert.ok(!NO_BOSS.test(JSON.stringify(mine)), '직원의 결재 목록에 «회장»이 보인다')
  // 결재선 첫 칸(경영지원팀장 본인이 팀장이라 직속 상위 = DY 대표)에게는 «내가 처리할 결재».
  const approver = as('dy_ceo')
  assert.equal(dec.approval_line![0].user_id, approver.user_id, '결재선 첫 칸이 직속 상위가 아니다(dummy 가정이 바뀌었나)')
  const actx = makeContext({ question: '', repo, user: approver, path: '/', chatId: null, history: [] })
  const waiting = (await tool('list_approvals').run({ scope: 'waiting_on_me' }, actx)) as Rows
  assert.ok(waiting.rows.some((r) => r.id === dec.decision_id), '결재선 첫 칸에게 «내가 처리할 결재»로 안 보인다')

  // 카드가 끝난 뒤의 «첨부해줘» — 바로 앞 답이 가리킨 결재 한 건의 «첨부» 칸.
  as('support_lead')
  const histAfter: AiChatMessage[] = [
    ...histNow,
    { id: 3, chat_id: kchat, role: 'user', content: '내 결재', sources: [], created_at: '' },
    { id: 4, chat_id: kchat, role: 'assistant', content: '한 건입니다.', sources: [{ label: dec.title, href: `/approvals?id=${dec.decision_id}` }], created_at: '' },
  ]
  const att2 = await runAssistant({ question: '견적서 첨부해줘', repo, user: kim, path: '/', chatId: kchat, history: histAfter })
  assert.ok(att2.ruled && att2.sources.some((x) => x.href === `/approvals?id=${dec.decision_id}`) && att2.answer.includes('«첨부» 칸'), `첨부 안내가 그 결재를 안 가리킨다: ${att2.answer}`)
  // 카드가 없으면 «확인했어»는 모델로 간다(여기서는 키가 없어 연결 없음 문장) — 규칙이 가로채지 않는다.
  const noCard = await runAssistant({ question: '확인했어, 진행해', repo, user: kim, path: '/', chatId: kchat, history: histAfter })
  assert.ok(noCard.answer.includes('ANTHROPIC_API_KEY'), `카드가 없는데 확인 규칙이 답한다: ${noCard.answer}`)

  // 회장 세션은 두 결재 도구를 다 갖는다.
  const chairCtx = makeContext({ question: '', repo, user: as('chairman'), path: '/', chatId: null, history: [] })
  const ctools = ALL_TOOLS.filter((t) => t.available(chairCtx)).map((t) => t.def.name)
  assert.ok(ctools.includes('propose_approval_draft') && ctools.includes('propose_approval_form'), '회장에게 결재 도구가 빠졌다')

  // 직원에게 보인 새 도구의 결과 · 규칙 답 어디에도 «회장 / Chairman»이 없다.
  for (const out of [templates, close, help, docs, denyForm, denyClose, att.answer, att2.answer, miss]) {
    assert.ok(!NO_BOSS.test(JSON.stringify(out)), `직원에게 «회장/Chairman»이 보인다: ${JSON.stringify(out).slice(0, 200)}`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

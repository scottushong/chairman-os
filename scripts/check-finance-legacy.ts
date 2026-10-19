/**
 * 2026-10-20 A2 «예전 자료 가져오기» — dummy 저장소에서(진짜 AI 0회 · 진짜 회사 파일 없음). check:finance-overview가 이어서 부른다.
 *
 *   심기: «예전 방식 자료» 가짜 21개 = 0082 수신함에 남은 파일 18개(이름은 임의 id · 2시간 전) + «확인 필요»에 남은 0085 전 대기 3개
 *         + 0083 공식 결산 증빙 PDF 저장본 1개(결산은 저장 안 함).
 *   1. 대표가 한 번 → 21 + 1 전부 옮김(AI 0 · 대기 줄 그대로 · 원본은 규칙 엔진) → 2026-09 체크표 18/18 · 공식 결산 2024 · 2025가 그 증빙으로.
 *   2. 월별 입력(CH-026) 손입력 전표를 하나 넣고 두 번째 → 자료 · 결산은 0건 더함(월별 입력은 «이미 장부에 있음» 기록만) · 2026-08 체크표 «월별 손익계산서» ✓.
 *   3. 세 번째 → 새로 처리한 것 0.
 *   4. 대표만 — 사원은 거부 · 옮김 기록도 못 읽음. 수신함 파일은 지우지 않았고(되돌릴 수 없는 삭제 없음) 대표의 1시간 정리는 멈춰 있다.
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'

process.env.DUMMY_FIN_DEMO = 'off'
process.env.DUMMY_USER = 'chairman'

import { loadOverview } from '../src/lib/finance-overview/load'
import { importLegacy, inboxSweepAllowed, legacySummary } from '../src/lib/finance-upload/legacy-import'
import { openUpload } from '../src/lib/finance-upload/open'
import { classifyByCode, readRows, scrubSheet } from '../src/lib/finance-upload/pipeline'
import { costByBusiness, documentsByBusiness, financeByBusiness } from '../src/lib/module-grants'
import { dummyRepository as repo } from '../src/lib/repository/dummy'
import { dummyFinInboxAge } from '../src/lib/repository/dummy-finance-upload'
import { dummyModuleGrants, dummyViewer } from '../src/lib/repository/dummy-org'
import type { FinRow, SessionUser } from '../src/types'

import { buildFinanceFixtures } from './fixtures/finance-18'
import { textPdf } from './fixtures/finance-pdf'

const BIZ = 'biz_dy'
const TODAY = '2026-10-19'
const today = new Date(`${TODAY}T03:00:00Z`)

function session(): SessionUser {
  const p = dummyViewer()
  const g = dummyModuleGrants(p.user_id)
  return { user_id: p.user_id, name: p.display_name, role: p.role, title_ko: p.title_ko, display_name_en: p.display_name_en, language: 'ko', finance: financeByBusiness(g), documents: documentsByBusiness(g), cost: costByBusiness(g) }
}
const as = (key: string) => {
  process.env.DUMMY_USER = key
  return session()
}

const PENDING = new Set(['IMG_card_9월.xlsx', '대출현황_0930.xlsx', '26년 차입금.xlsx'])
const UNUSED = new Set(['월별 자금흐름표_2026-10.xlsx', '자금계획_2026-11.xlsx', '자금계획_2026-12.xlsx', '매출 세금계산서 10월.xlsx'])

async function main() {
  const chair = as('chairman')
  assert.equal(chair.role, 'Chairman')
  const fixtures = await buildFinanceFixtures()

  // ── 심기 ──
  const inboxFx = fixtures.filter((f) => !PENDING.has(f.name) && !UNUSED.has(f.name))
  assert.equal(inboxFx.length, 18)
  for (const [i, f] of inboxFx.entries()) {
    const path = `${BIZ}/${chair.user_id}/legacy${String(i).padStart(2, '0')}.xlsx`
    await repo.finInboxPut!(path, f.bytes)
    assert.ok(dummyFinInboxAge(path, 2 * 3_600_000))
  }
  // 0085 전 «확인 필요» 대기 — 코드가 읽은 줄을 대기(pending)에 두고 보류 까닭(meta.hold)은 없다(0082 · 0083 때 모양).
  for (const f of fixtures.filter((x) => PENDING.has(x.name))) {
    const opened = await openUpload(f.bytes, f.name)
    assert.ok(opened.ok)
    const { sheet } = scrubSheet(opened.sheets[0])
    const cls = classifyByCode(sheet)
    assert.equal(cls.kind, f.expect, `${f.name} 종류`)
    const read = readRows(sheet, cls)
    await repo.finUploadRecord({
      business_id: BIZ, kind: cls.kind, period: '2026-09', file_name: f.name, file_sha256: opened.sha256, sheet_name: sheet.name,
      ai_confidence: 'medium', ai_used: 0, status: 'needs_review', pending: { rows: read.rows as FinRow[], meta: { reason: '0082 미리보기(확인 필요)' } }, error: null,
    })
  }
  // 0083 공식 결산 증빙 PDF 저장본(미리보기만 하고 결산은 저장하지 않은 것).
  const pdf = textPdf([[
    ['표준재무제표'],
    ['계정과목', '2024', '2025'],
    ['재무상태표'],
    ['1.보통예금', 100_000_000, 200_000_000],
    ['1.외상매출금', 50_000_000, 50_000_000],
    ['자산총계', 150_000_000, 250_000_000],
    ['1.외상매입금', 50_000_000, 50_000_000],
    ['1.자본금', 100_000_000, 200_000_000],
    ['부채와자본총계', 150_000_000, 250_000_000],
  ]])
  const evidencePath = `${BIZ}/${createHash('sha256').update(pdf).digest('hex')}.pdf`
  await repo.putOfficialEvidence(BIZ, evidencePath, pdf)
  assert.deepEqual(await repo.listOfficialEvidence(BIZ), [evidencePath])

  const before = await loadOverview(repo, BIZ, '2026-09', TODAY)
  const got0 = before.checklist.filter((c) => c.state !== 'missing').map((c) => c.label)
  console.log(`심기 뒤 · 가져오기 전 체크표 ${got0.length}/18(${got0.join(' · ') || '없음'})`)
  assert.ok(got0.length <= 1, `가져오기 전에 체크표에 받은 것이 많다: ${got0.join(' · ')}`)
  const uploads0 = (await repo.listFinUploads(BIZ)).length
  assert.equal(uploads0, 3)

  // ── 1. 한 번 ──
  const r1 = await importLegacy({ repo, user: chair, businessId: BIZ, today })
  const fresh1 = r1.items.filter((i) => i.fresh)
  console.log(legacySummary(r1))
  for (const i of fresh1) console.log(`  ${i.source} · ${i.outcome} · ${i.message.slice(0, 110)}`)
  const bySource = (s: string) => fresh1.filter((i) => i.source === s)
  assert.equal(bySource('inbox').length, 18, '수신함 18개를 다 보지 않았다')
  assert.equal(bySource('pending').length, 3, '예전 대기 3개를 다 보지 않았다')
  assert.equal(bySource('evidence').length, 1, '증빙 PDF를 보지 않았다')
  const notSaved = fresh1.filter((i) => i.outcome !== 'saved')
  assert.deepEqual(notSaved.map((i) => `${i.source}:${i.message}`), [], '옮기지 못한 것이 있다')
  assert.equal(r1.moved.inbox + r1.moved.pending + r1.moved.evidence, 22)
  const uploads1 = await repo.listFinUploads(BIZ)
  assert.equal(uploads1.filter((u) => u.status === 'needs_review').length, 0, '대기가 남았다')
  assert.equal(uploads1.reduce((a, u) => a + u.ai_used, 0), 0, 'AI를 불렀다')
  const after = await loadOverview(repo, BIZ, '2026-09', TODAY)
  const missing = after.checklist.filter((c) => c.state === 'missing').map((c) => c.label)
  assert.deepEqual(missing, [], `체크표에 빠진 것: ${missing.join(' · ')}`)
  assert.equal(after.checklist.length, 18)
  const officials1 = await repo.listOfficialStatements(BIZ)
  assert.deepEqual(officials1.filter((o) => o.evidence_file === evidencePath).map((o) => o.period_key).sort(), ['2024', '2025'], '증빙 PDF가 공식 결산(2024 · 2025)으로 저장되지 않았다')
  const statementsAll1 = (await repo.listOfficialStatements(BIZ, 'all')).length

  // ── 2. 월별 입력(손입력) 전표 하나 + 두 번째 ──
  const accounts = (await repo.loadFinanceLedger()).accounts.filter((a) => a.business_id === BIZ && a.active)
  const cash = accounts.find((a) => a.section === 'cash') ?? accounts[0]
  const rev = accounts.find((a) => a.section === 'revenue')!
  assert.ok(cash && rev, '계정과목표가 들어오지 않았다')
  const augBefore = (await loadOverview(repo, BIZ, '2026-08', TODAY)).checklist.find((c) => c.key === 'pl_monthly')!
  assert.equal(augBefore.state, 'missing')
  await repo.postJournalEntry({ business_id: BIZ, entry_date: '2026-08-31', memo: '2026-08 월별 간이 손익', evidence_url: null, lines: [{ account_code: cash.account_code, side: 'debit', amount: 1_000_000 }, { account_code: rev.account_code, side: 'credit', amount: 1_000_000 }] }, { user_id: chair.user_id, role: chair.role })
  const r2 = await importLegacy({ repo, user: chair, businessId: BIZ, today })
  const fresh2 = r2.items.filter((i) => i.fresh)
  assert.deepEqual(fresh2.map((i) => `${i.source}:${i.outcome}`), ['monthly:already'], `두 번째에 새로 처리한 것이 월별 입력 하나가 아니다: ${JSON.stringify(fresh2)}`)
  assert.equal(r2.moved.inbox + r2.moved.pending + r2.moved.evidence + r2.moved.monthly, 0, '두 번째에 자료를 더 넣었다')
  assert.equal((await repo.listFinUploads(BIZ)).length, uploads1.length, '두 번째에 올리기 줄이 늘었다')
  assert.equal((await repo.listOfficialStatements(BIZ, 'all')).length, statementsAll1, '두 번째에 공식 결산이 늘었다')
  // 수신함 18 · 증빙 1은 옮김 기록으로 건너뛰고, 예전 대기 3은 이미 저장(applied)되어 대기가 아니다.
  assert.equal(r2.items.filter((i) => !i.fresh).length, 19, '앞에서 처리한 수신함 18 · 증빙 1을 건너뛴 것으로 세지 않았다')
  const aug = (await loadOverview(repo, BIZ, '2026-08', TODAY)).checklist.find((c) => c.key === 'pl_monthly')!
  assert.equal(aug.state, 'ok', '월별 입력 전표가 체크표 «월별 손익계산서»에 반영되지 않았다')

  // ── 3. 세 번째 ──
  const r3 = await importLegacy({ repo, user: chair, businessId: BIZ, today })
  assert.equal(r3.items.filter((i) => i.fresh).length, 0, '세 번째에 새로 처리한 것이 있다')
  assert.match(legacySummary(r3), /새로 옮길 것이 없습니다/)

  // ── 4. 대표만 · 지우지 않음 ──
  assert.equal((await repo.finInboxList(`${BIZ}/${chair.user_id}`)).length, 18, '수신함 파일을 지웠다(되돌릴 수 없는 삭제)')
  assert.equal(inboxSweepAllowed('Chairman', true), false)
  assert.equal(inboxSweepAllowed('Chairman', false), true)
  assert.equal(inboxSweepAllowed('Member', true), true)
  const staff = as('teamless_staff')
  await assert.rejects(importLegacy({ repo, user: staff, businessId: BIZ, today }), /fin_legacy_denied/, '사원이 예전 자료 가져오기를 했다')
  await assert.rejects(repo.markFinLegacyImport({ business_id: BIZ, source: 'inbox', source_ref: 'x', outcome: 'saved', upload_id: null, note: null }), /fin_legacy_denied/, '사원이 옮김 기록을 적었다')
  assert.deepEqual(await repo.listFinLegacyImports(BIZ), [], '사원이 옮김 기록을 읽었다')
  as('chairman')
  assert.ok((await repo.listFinLegacyImports(BIZ)).filter((r) => r.source === 'run').length === 3, '누름 기록이 셋이 아니다')

  console.log('PASS: A2 예전 자료 가져오기 — 수신함 18 + 예전 대기 3 + 증빙 PDF 1 한 번에 옮김(AI 0) · 체크표 18/18 · 공식 결산 2024 · 2025 · 두 번째 자료 0건 더함(월별 입력 «이미 장부» 기록만 · 8월 체크표 ✓) · 세 번째 0 · 대표만 · 수신함 파일 지우지 않음')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

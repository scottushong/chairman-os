/**
 * 0089 재무 보강 검사 — check-finance-upload.ts가 부른다(dummy repo · 진짜 AI 0회 · 진짜 회사 파일 없음).
 *
 *   A1 ECOUNT 엑셀 그대로: 14가지 × 변형 셋(① 비슷한 이름 ② 머리글 3행 + 제목 줄 + 회사 고유 열 이름 ③ 2번째 시트 · 열 순서 섞기)이 전부 «저장됨».
 *      ②는 가짜 AI가 한 번 맞추고 → (회사, 종류) 열 맞춤이 dummy 저장소에 남고 → 같은 양식 두 번째 올리기(시트명 · 값 · 달 다름)는 AI 0회.
 *      못 맞춘 열만 «이 열은 무엇입니까?»(ask) — 답을 저장하면 다음 올리기는 그 열까지 읽고 다시 묻지 않는다.
 *      화면 · 서버 문구에 «엑셀을 고치세요»류가 없다.
 *   A3 공식 결산 102줄을 계정과목표 없이 저장(전부 «기타(자동)») → 계정과목표를 올리면 102/102 다시 맞춤 · 기타 0 · 균형 · 학습 · 남은 줄 0.
 */
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

import ExcelJS from 'exceljs'

import { FEATURES } from '../src/lib/features'
import { kindSpec } from '../src/lib/finance-upload/kinds'
import type { OfficialDraft, OfficialDraftLine } from '../src/lib/finance-upload/doc-read'
import { autoSaveOfficial } from '../src/lib/finance-upload/official-auto'
import { stdKey, type OfficialGroup } from '../src/lib/finance-upload/official-lines'
import { signedAmount } from '../src/lib/finance-upload/official-sign'
import { processUpload, type AiClassify, type FileCard } from '../src/lib/finance-upload/process'
import { labelKey } from '../src/lib/finance-upload/synonyms'
import { costByBusiness, documentsByBusiness, financeByBusiness } from '../src/lib/module-grants'
import { dummyRepository as repo } from '../src/lib/repository/dummy'
import { dummyModuleGrants, dummyViewer } from '../src/lib/repository/dummy-org'
import type { SessionUser } from '../src/types'

import { oddLabels, RENAME_KINDS, renameFile, VARIANT_KO, VARIANTS } from './fixtures/finance-rename'

const BIZ = 'biz_dy'

function session(): SessionUser {
  const p = dummyViewer()
  const g = dummyModuleGrants(p.user_id)
  return { user_id: p.user_id, name: p.display_name, role: p.role, title_ko: p.title_ko, display_name_en: p.display_name_en, language: 'ko', finance: financeByBusiness(g), documents: documentsByBusiness(g), cost: costByBusiness(g) }
}

/**
 * 가짜 AI — 진짜 AI가 할 일을 흉내 낸다: 코드가 종류를 알면 그대로, 모르면 시트명으로 종류를 알아보고 머리글 줄을 찾아
 * «회사 고유 열 이름»(fixture의 odd)과 나머지 이름을 칸에 맞춘다. 부를 때마다 센다(진짜 호출 없음).
 */
function fakeAi(calls: { n: number; sent: string[] }): AiClassify {
  return async (sample, code) => {
    calls.n += 1
    calls.sent.push(JSON.stringify(sample))
    const fx = code.kind !== 'unknown' ? RENAME_KINDS.find((k) => k.kind === code.kind) : RENAME_KINDS.find((k) => sample.sheet.startsWith(k.sheet))
    if (!fx) return { kind: code.kind, header_row: code.headerRow, columns: code.columns, row_labels: [], account_head_col: null, company: null, period: null, confidence: 'low', reason: '가짜 AI(모름)', cost_usd: 0 }
    const names = new Map<string, string>()
    for (const c of fx.cols) for (const n of [c.base, c.syn, c.odd]) if (n) names.set(labelKey(n), c.key)
    const odd = oddLabels(fx.kind)
    let best = { idx: -1, hits: 0 }
    sample.rows.forEach((r, i) => {
      const hits = r.filter((t) => names.has(labelKey(String(t ?? '')))).length
      if (hits > best.hits) best = { idx: i, hits }
    })
    const headerRow = best.idx >= 0 ? (sample.row_no?.[best.idx] ?? best.idx) : code.headerRow
    const columns: Record<string, number> = code.kind === fx.kind && headerRow === code.headerRow ? { ...code.columns } : {}
    ;(best.idx >= 0 ? sample.rows[best.idx] : []).forEach((t, i) => {
      const key = labelKey(String(t ?? ''))
      const k = odd[key] ?? names.get(key)
      if (k && !(k in columns)) columns[k] = i
    })
    return { kind: fx.kind, header_row: headerRow, columns, row_labels: [], account_head_col: null, company: null, period: null, confidence: 'high', reason: '가짜 AI(회사 고유 열 이름)', cost_usd: 0 }
  }
}

const saved = (cs: FileCard[]) => cs.filter((c) => c.status === 'applied')
const ym = (y: number, m: number) => `${y}-${String(m).padStart(2, '0')}`

export async function runMappingChecks(): Promise<string> {
  const prevUser = process.env.DUMMY_USER
  process.env.DUMMY_USER = 'support_lead' // DY 재무 입력 · TeamLead(대표 · CFO 아님)
  const calls = { n: 0, sent: [] as string[] }
  const ai = fakeAi(calls)
  const run = (name: string, bytes: Uint8Array) => processUpload({ repo, businessId: BIZ, fileName: name, bytes, classify: ai, aiBudget: 2, today: new Date('2099-06-15') })

  assert.ok(FEATURES.some((f) => f.key === 'finance_upload_ai'), '기능 스위치 finance_upload_ai가 없다')
  assert.equal(RENAME_KINDS.length, 14, '가짜 엑셀이 14가지가 아니다')

  // ── A1. 14가지 × 변형 셋 ──
  const table: string[] = []
  const aiBy: Record<string, number[]> = {}
  let total = 0
  for (const [i, k] of RENAME_KINDS.entries()) {
    const year = 2060 + i
    aiBy[k.kind] = []
    for (const [vi, v] of VARIANTS.entries()) {
      const f = await renameFile(k, v, ym(year, vi + 1))
      const before = calls.n
      const cards = await run(f.name, f.bytes)
      const ok = saved(cards).filter((c) => c.kind === k.kind)
      assert.equal(ok.length, 1, `${k.kind} ${VARIANT_KO[v]}: 저장되지 않았다 — ${JSON.stringify(cards.map((c) => [c.status, c.kind, c.sheet, c.message]))}`)
      const card = ok[0]
      assert.equal(card.period, ym(year, vi + 1), `${k.kind} ${v}: 달이 다르다(${card.period})`)
      assert.equal(card.rows, k.kind === 'payroll' ? k.rows.length : k.rows.length, `${k.kind} ${v}: 줄 수가 다르다(${card.rows})`)
      // 필수 칸이 모두 읽혔다(빈칸으로 저장되지 않았다).
      const req = kindSpec(k.kind).fields.filter((x) => x.required).map((x) => x.key)
      const store = await import('../src/lib/repository/dummy-finance-upload')
      // ⑮ 평가금액은 줄 표가 아니라 평가 표(0072 fin_inventory_valuations)에 선다.
      const lines =
        k.kind === 'valuation'
          ? store.dummyFinStore().valuations.filter((x) => x.source_upload_id === card.upload_id).map((x) => ({ row: x as unknown as Record<string, unknown> }))
          : store.dummyFinLines().filter((l) => l.upload_id === card.upload_id && !l.people)
      assert.ok(lines.length > 0 && lines.every((l) => req.every((r) => l.row[r] !== null && l.row[r] !== undefined && l.row[r] !== '')), `${k.kind} ${v}: 필수 칸(${req.join(',')})이 비어 저장됐다`)
      if (v === 'sheet2') assert.equal(card.sheet, k.sheet, `${k.kind} ③: 2번째 시트를 고르지 않았다(${card.sheet})`)
      aiBy[k.kind].push(calls.n - before)
      total += 1
    }
    // ② 같은 양식 두 번째 올리기 — 시트명 · 값 · 달이 달라도(학습 서명이 달라도) 저장된 열 맞춤으로 AI 0회.
    const f2 = await renameFile(k, 'title3', ym(year, 7), { scale: 2, sheetSuffix: ' 2' })
    const before2 = calls.n
    const c2 = await run(f2.name, f2.bytes)
    assert.equal(saved(c2).length, 1, `${k.kind} ② 두 번째: 저장되지 않았다 — ${JSON.stringify(c2.map((c) => [c.status, c.message]))}`)
    assert.equal(calls.n - before2, 0, `${k.kind} ② 두 번째 올리기에 AI를 ${calls.n - before2}번 불렀다(저장된 열 맞춤을 쓰지 않았다)`)
    assert.equal(saved(c2)[0].ai_used, 0)
    table.push(`${k.kind} AI ${aiBy[k.kind].join('/')}→0`)
  }
  // ②는 코드로는 못 맞추는 열이 있다 — AI를 한 번은 불렀어야 한다(가짜).
  for (const k of RENAME_KINDS) assert.ok(aiBy[k.kind][1] >= 1, `${k.kind} ②에서 AI를 부르지 않았다 — 회사 고유 이름을 코드가 맞췄다?`)
  // ①은 비슷한 이름 표로 — AI 없이.
  for (const k of RENAME_KINDS) assert.equal(aiBy[k.kind][0], 0, `${k.kind} ①(비슷한 이름)에 AI를 불렀다`)
  // ③은 비슷한 이름 + 열 순서 섞기 — AI 없이. 1번째 안내 시트(표 없음)도 AI에 보내지 않는다.
  for (const k of RENAME_KINDS) assert.equal(aiBy[k.kind][2], 0, `${k.kind} ③(2번째 시트 · 열 섞기)에 AI를 불렀다 — 안내 시트를 AI에 보냈다?`)
  // AI에 숫자가 가지 않았다(머리글 아래 숫자 칸은 «<숫자>»).
  assert.ok(!calls.sent.some((s) => /\b(10000|50000|3000000|400000000|70000)\b/.test(s)), 'AI 견본에 금액이 갔다')
  // dummy 저장소에 (회사, 종류) 열 맞춤 — 14가지 전부.
  const maps = await repo.listFinColumnMaps(BIZ)
  for (const k of RENAME_KINDS) {
    const m = maps.find((x) => x.kind === k.kind)
    assert.ok(m, `${k.kind}: 열 맞춤이 저장되지 않았다`)
    const odd = k.cols.find((c) => c.odd)!
    assert.equal(m!.label_map[labelKey(odd.odd!)], odd.key, `${k.kind}: AI가 맞춘 «${odd.odd}»가 저장되지 않았다`)
    assert.ok(!Object.values(m!.label_map).some((v) => /\d{3,}/.test(v)), `${k.kind}: 열 맞춤에 숫자가 들어갔다`)
  }
  assert.ok(maps.some((m) => m.source === 'ai'), 'AI가 맞춘 열 맞춤의 출처가 ai가 아니다')

  // ── A1 «이 열은 무엇입니까?» — 못 맞춘 열만 묻고(나머지는 저장) · 답 → 다음엔 읽고 묻지 않음 ──
  const wb = async (head: (string | null)[], rows: (string | number | null)[][], m: string) => {
    const b = new ExcelJS.Workbook()
    const ws = b.addWorksheet('판매현황')
    ws.addRow([`회사명 : (주)가짜산업 / ${m.replace('-', '/')}/01 ~ ${m.replace('-', '/')}/28 / 판매현황`])
    ws.addRow(head)
    for (const r of rows) ws.addRow(r)
    return new Uint8Array(await b.xlsx.writeBuffer())
  }
  const askHead = ['판매일자', '거래처명', '품목명', '수량', '판가', '공급가액', '규격']
  const a1 = await run('가짜 판매 판가.xlsx', await wb(askHead, [['2075-01-03', '가짜 거래처 A', '가짜 제품 1', 10, 1000, 10000, '25kg'], ['2075-01-04', '가짜 거래처 B', '가짜 제품 2', 2, 1500, 3000, '20kg']], '2075-01'))
  const s1 = saved(a1)[0]
  assert.ok(s1, `판가 파일이 저장되지 않았다: ${JSON.stringify(a1.map((c) => c.message))}`)
  assert.deepEqual(s1.ask?.map((x) => x.label), ['판가', '규격'], `못 맞춘 열만 묻지 않았다: ${JSON.stringify(s1.ask)}`)
  assert.ok(s1.ask_fields?.some((f) => f.key === 'unit_price') && !s1.ask_fields?.some((f) => f.key === 'amount'), '고를 칸이 «아직 빈 칸»이 아니다')
  // 화면 «열 맞춤 저장»과 같은 저장(서버 액션 answerColumns → repo.saveFinColumnMap, 출처 person).
  await repo.saveFinColumnMap({ business_id: BIZ, kind: 'sales', label_map: { [labelKey('판가')]: 'unit_price', [labelKey('규격')]: '-' }, source: 'person' })
  const a2 = await run('가짜 판매 판가 2월.xlsx', await wb(askHead, [['2075-02-03', '가짜 거래처 A', '가짜 제품 1', 7, 1100, 7700, '25kg']], '2075-02'))
  const s2 = saved(a2)[0]
  assert.ok(s2 && !s2.ask, `답한 뒤에도 다시 물었다: ${JSON.stringify(s2?.ask)}`)
  const l2 = (await import('../src/lib/repository/dummy-finance-upload')).dummyFinLines().find((l) => l.upload_id === s2.upload_id)
  assert.equal(l2?.row.unit_price, 1100, '답한 열(판가 → 단가)을 읽지 않았다')

  // ── A1 «엑셀을 고치세요»류 문구 없음(코드 전체 — 화면 · 서버 · 직원 문구) ──
  const FIX_EXCEL = /(엑셀|파일|양식|머리글|열 이름|칸 이름|시트)[을를]?\s*(고쳐|수정해|바꿔|바꾸어)\s*(다시|주세요|올려)|(엑셀|파일|양식)[을를]?\s*고치세요|양식을 맞춰|그 줄을 고쳐/
  const hits: string[] = []
  const walk = (dir: string) => {
    for (const n of readdirSync(dir)) {
      const p = join(dir, n)
      if (statSync(p).isDirectory()) walk(p)
      else if (/\.(ts|tsx)$/.test(n)) readFileSync(p, 'utf8').split('\n').forEach((line, i) => FIX_EXCEL.test(line) && hits.push(`${p}:${i + 1}`))
    }
  }
  walk('src')
  assert.deepEqual(hits, [], `«엑셀을 고치세요»류 문구가 남았다: ${hits.join(' · ')}`)

  // ── A3. 공식 결산 102줄 — 계정과목표 없이 저장(전부 기타) → 계정과목표 올리기 → 102/102 다시 맞춤 ──
  process.env.DUMMY_USER = 'chairman'
  const chair = session()
  const a3 = await officialRematch102(chair)
  process.env.DUMMY_USER = prevUser
  return `0089 A1: 14가지 × 변형 셋 ${total}개 전부 저장(${table.join(' · ')}) · 두 번째 올리기 AI 0 · 열 맞춤 14가지 dummy 저장 · «이 열은 무엇입니까?» 못 맞춘 열만 · 답 → 다음엔 읽음 · «엑셀을 고치세요» 0 · A3: ${a3}`
}

const GROUPS: { g: OfficialGroup; n: number; tag: string; code: number; head: string; value: number }[] = [
  { g: 'asset', n: 30, tag: '자산', code: 1701, head: '자산', value: 1_000_000 },
  { g: 'liability', n: 20, tag: '부채', code: 2701, head: '부채', value: 1_000_000 },
  { g: 'equity', n: 5, tag: '자본', code: 3701, head: '자본', value: 2_000_000 },
  { g: 'revenue', n: 10, tag: '매출', code: 4101, head: '매출', value: 3_000_000 },
  { g: 'cogs', n: 10, tag: '원가', code: 4601, head: '매출원가', value: 1_500_000 },
  { g: 'sga', n: 20, tag: '판관', code: 8601, head: '판매비와관리비', value: 300_000 },
  { g: 'nonop_income', n: 3, tag: '외수', code: 9601, head: '영업외수익', value: 50_000 },
  { g: 'nonop_expense', n: 3, tag: '외비', code: 9611, head: '영업외비용', value: 40_000 },
  { g: 'tax', n: 1, tag: '법인세', code: 9981, head: '법인세비용', value: 100_000 },
]

async function officialRematch102(user: SessionUser): Promise<string> {
  const YEAR = '2091'
  const lines: OfficialDraftLine[] = []
  const chart: (string | number)[][] = []
  for (const G of GROUPS) {
    for (let i = 0; i < G.n; i += 1) {
      const name = G.g === 'tax' ? '가짜법인세비용' : `가짜${G.tag}계정${String(i + 1).padStart(3, '0')}`
      const label = `${i + 1}.${name}`
      lines.push({ label, group: G.g, values: { [YEAR]: G.value }, printed: G.value, account_code: null, account_name: null, section: null, how: null, confidence: null, std_key: stdKey(G.g, label), skip: false, amount: null })
      chart.push([String(G.code + i), name, G.head, '사용'])
    }
  }
  assert.equal(lines.length, 102)
  const sha = 'c'.repeat(64)
  const evidence = await repo.putOfficialEvidence(BIZ, `${BIZ}/${sha}.pdf`, new Uint8Array([37, 80, 68, 70]))
  const draft: OfficialDraft = {
    period_key: YEAR, years: [YEAR], net_income: {}, company: '(주)가짜산업', title: '표준재무제표', lines, unmatched: 102, balance: null, errors: [], warnings: [], reason: '시험',
    no_accounts: false, year_from: 'columns', evidence_file: evidence, evidence_note: null, ai_suggested: 0,
  }
  const first = await autoSaveOfficial({ repo, user, businessId: BIZ, draft, fileName: '가짜 2091 표준재무제표.pdf' })
  assert.equal(first.status, 'applied', `102줄 결산이 저장되지 않았다: ${first.message} ${first.warnings}`)
  assert.equal(first.matched, 0, '계정과목표 없이 맞춘 줄이 있다(시험 전제가 틀림)')
  const pending0 = await repo.listOfficialUnmatched(BIZ)
  assert.equal(pending0.filter((p) => p.statement_id === first.ids[0]).length, 102, `다시 맞출 줄이 102개가 아니다(${pending0.length})`)

  // 계정과목표(ECOUNT 모양) 올리기 → legacy 계정과목표 저장 → 다시 맞춤.
  const b = new ExcelJS.Workbook()
  const ws = b.addWorksheet('계정과목')
  for (const r of [['계정과목 목록'], ['회사 : DY'], [null, null, null, '(단위 : 원)'], ['코드', '계정명', '구분', '사용여부'], ...chart]) ws.addRow(r)
  const bytes = new Uint8Array(await b.xlsx.writeBuffer())
  const cards = await processUpload({ repo, businessId: BIZ, fileName: '계정과목표_가짜_2091.xlsx', bytes, classify: null, aiBudget: 0, today: new Date('2099-06-15'), boss: true, user })
  assert.equal(cards[0]?.legacy, 'accounts', `계정과목표로 알아보지 못했다: ${JSON.stringify(cards.map((c) => [c.status, c.message]))}`)
  assert.equal(cards[0].status, 'applied', `계정과목표가 저장되지 않았다: ${cards[0].message} ${cards[0].warnings}`)
  assert.match(cards[0].message, /공식 결산 미매칭 줄 102\/102 다시 맞춤/, `다시 맞춤 문구가 102/102가 아니다: ${cards[0].message}`)

  const st = (await repo.listOfficialStatements(BIZ)).find((s) => s.period_key === YEAR && s.superseded_at === null)!
  assert.ok(st && st.id !== first.ids[0], '다시 맞춘 결산이 새로 서지 않았다(저장본을 고쳤다?)')
  assert.equal(st.evidence_file, evidence, '다시 맞춘 결산의 증빙이 바뀌었다')
  const got = await repo.listOfficialStatementLines(BIZ, [st.id])
  assert.equal(got.filter((l) => l.account_code.startsWith('ZZ-')).length, 0, `기타(자동) 계정 줄이 남았다: ${got.filter((l) => l.account_code.startsWith('ZZ-')).map((l) => l.account_code)}`)
  assert.equal(got.length, 102, `다시 맞춘 결산 줄이 102개가 아니다(${got.length})`)
  const accounts = (await repo.loadFinanceLedger()).accounts.filter((a) => a.business_id === BIZ)
  let matched = 0
  for (const l of lines) {
    const name = l.label.replace(/^\d+\./, '')
    const acc = accounts.find((a) => a.name === name)
    assert.ok(acc, `계정 «${name}»이 계정과목표로 만들어지지 않았다`)
    const line = got.find((g) => g.account_code === acc!.account_code)
    assert.equal(line?.amount, signedAmount(acc!.section, acc!.name, l.printed, name), `«${name}» 금액 · 부호가 다르다`)
    matched += 1
  }
  const bs = got.reduce((a, l) => {
    const s = accounts.find((x) => x.account_code === l.account_code)!.section
    return ['cash', 'receivable', 'other_asset', 'payable', 'other_liability', 'equity'].includes(s) ? a + Math.round(l.amount * 100) : a
  }, 0)
  assert.equal(bs, 0, '다시 맞춘 결산의 재무상태표가 닫히지 않는다')
  assert.equal((await repo.listOfficialUnmatched(BIZ)).filter((p) => p.statement_id === st.id).length, 0, '다시 맞춘 뒤 남은 줄이 있다')
  const learned = await repo.listOfficialAccountMap(BIZ)
  assert.ok(lines.every((l) => learned.some((m) => m.std_key === l.std_key)), '다시 맞춘 줄이 학습 표에 남지 않았다')
  // 다시 올려도 늘지 않는다(남은 줄이 없다).
  return `공식 결산 ${matched}/102 다시 맞춤(기타 0 · 금액 · 부호 · 균형 · 증빙 그대로 · 새 결산 · 학습 102)`
}

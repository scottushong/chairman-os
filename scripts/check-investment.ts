/**
 * Investment Intelligence 검사(0094~) — npm run check:investment. 네트워크 · DB 없이 돈다(가짜 응답).
 *   판정(NEW · ADD · TRIM · EXIT · HOLD · UNKNOWN) · 주가 상승 ≠ 매수 · 분할 보정 · 분할 의심 · 13F 파서(기밀 자리표) · 수정공시 ·
 *   NBIM 파서 · XBRL → 재무 지표 · 수집 순서(하루 한도 · 실패해도 다음 단계 · 마지막 성공 시각 · 비밀값 가림) ·
 *   0094 SQL 시드 = TS 시드 · Demo 숫자는 DEMO일 때만 · 화면/API 문(직원 403) · Expand-only(0094~ drop · rename 없음).
 * DB 권한(직원 · anon 0행 · 수집 계정 · AI 계정)은 check:migrations의 check-investment-db.ts가 PGlite로 잰다.
 */
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import Anthropic from '@anthropic-ai/sdk'

import { CHANGE_VERSION, aggregate, classify, countChanges, effectivePeriods, suspectSplit } from '../src/lib/investment/changes'
import type { FetchLike } from '../src/lib/investment/collect/http'
import { kindFromFigi } from '../src/lib/investment/collect/market'
import { holdingsFromFile, periodsFromInit } from '../src/lib/investment/collect/nbim'
import { runCollect, splitFactorFor } from '../src/lib/investment/collect/run'
import { filingQuality, parseCover, parseInfoTable } from '../src/lib/investment/collect/sec13f'
import { memorySink } from '../src/lib/investment/collect/sink'
import { factsFromCompanyFacts } from '../src/lib/investment/collect/xbrl'
import { estimateUsd, investmentAi } from '../src/lib/investment/ai'
import { DEMO_KPIS, DEMO_VALUATION } from '../src/lib/investment/demo'
import { decide, etfChecks, stockChecks } from '../src/lib/investment/recommend'
import { demandGrowthScore, institutionalSignal, latestFactors, marketScore, opportunityScore, r2 } from '../src/lib/investment/scores'
import { round2, valuate, validateInput } from '../src/lib/investment/valuation'
import { annualRows, computeMetrics, quarterRows } from '../src/lib/investment/metrics'
import { INVESTMENT_MENU } from '../src/lib/investment/menu'
import { SEED_MANAGERS, SEED_SETTINGS, SEED_SOURCES } from '../src/lib/investment/seed'
import type { InvDisclosure, InvFact, InvPosition } from '../src/lib/investment/types'

let passed = 0
const round6 = (n: number) => Math.round(n * 1e6) / 1e6
async function ok(name: string, fn: () => void | Promise<void>) {
  try {
    await fn()
    passed++
    console.log(`  ✓ ${name}`)
  } catch (e) {
    console.error(`  ✗ ${name}`)
    throw e
  }
}

const disc = (id: string, as_of: string, extra: Partial<InvDisclosure> = {}): InvDisclosure => ({
  disclosure_id: id,
  manager_id: 'berkshire',
  source_id: 'sec13f:berkshire',
  source_type: 'sec_13f',
  doc_key: id,
  form: '13F-HR',
  data_as_of: as_of,
  source_published_at: as_of,
  source_url: 'https://www.sec.gov/x',
  is_amendment: false,
  amendment_type: null,
  amends_key: null,
  coverage: '13F',
  position_count: 0,
  total_value: 0,
  currency: 'USD',
  data_quality: 95,
  status: 'complete',
  is_demo: false,
  ingested_at: `${as_of}T00:00:00Z`,
  ...extra,
})
const pos = (d: string, key: string, shares: number | null, value: number | null, extra: Partial<InvPosition> = {}): InvPosition => ({
  disclosure_id: d,
  line_no: 1,
  holding_key: key,
  issuer_name: key,
  title_of_class: 'COM',
  cusip: key.length === 9 ? key : null,
  isin: null,
  ticker: null,
  security_id: `sec-${key}`,
  shares,
  share_type: 'SH',
  put_call: null,
  value,
  value_currency: 'USD',
  ownership_pct: null,
  weight_pct: null,
  country: null,
  sector: null,
  discretion: null,
  ...extra,
})

async function main() {
  console.log('판정(원문 4.2)')
  const A = disc('a', '2026-03-31')
  const B = disc('b', '2026-06-30')
  const run = (prev: InvPosition[], cur: InvPosition[], basis: 'shares' | 'presence' = 'shares', split?: (k: string) => number | null) =>
    classify({ manager: 'berkshire', sourceId: 'sec13f:berkshire', from: A, to: B, prev, cur, basis, splitFactor: split ? (h) => split(h.key) : undefined })
  await ok('NEW · EXIT · ADD · TRIM · HOLD', () => {
    const out = run(
      [pos('a', 'AAAAAAAA1', 1_000_000, 100e6), pos('a', 'BBBBBBBB2', 800_000, 80e6), pos('a', 'CCCCCCCC3', 2_000_000, 200e6), pos('a', 'DDDDDDDD4', 400_000, 40e6)],
      [pos('b', 'AAAAAAAA1', 1_250_000, 130e6), pos('b', 'CCCCCCCC3', 2_000_000, 230e6), pos('b', 'DDDDDDDD4', 320_000, 30e6), pos('b', 'EEEEEEEE5', 10, 1e3)],
    )
    const by = Object.fromEntries(out.map((c) => [c.holding_key, c]))
    assert.equal(by.AAAAAAAA1.status, 'ADD')
    assert.equal(by.AAAAAAAA1.change_pct, 25)
    assert.equal(by.AAAAAAAA1.net_change, 250_000)
    assert.equal(by.BBBBBBBB2.status, 'EXIT')
    assert.equal(by.CCCCCCCC3.status, 'HOLD')
    assert.equal(by.DDDDDDDD4.status, 'TRIM')
    assert.equal(by.DDDDDDDD4.change_pct, -20)
    assert.equal(by.EEEEEEEE5.status, 'NEW')
    assert.equal(out[0].calculation_version, CHANGE_VERSION)
  })
  await ok('주가 상승 ≠ 추가 매수 — 평가액만 늘면 HOLD(검증 6)', () => {
    const [c] = run([pos('a', 'AAAAAAAA1', 1000, 1000)], [pos('b', 'AAAAAAAA1', 1000, 5000)])
    assert.equal(c.status, 'HOLD')
    assert.equal(c.net_change, 0)
  })
  await ok('주식분할 — 기록된 2:1이면 HOLD(검증 7)', () => {
    const [c] = run([pos('a', 'AAAAAAAA1', 1000, 100_000)], [pos('b', 'AAAAAAAA1', 2000, 101_000)], 'shares', () => 2)
    assert.equal(c.status, 'HOLD')
    assert.equal(c.prev_shares_adj, 2000)
    assert.equal(c.split_factor, 2)
  })
  await ok('주식분할 — 분할 후 실제 매수는 ADD(보정 뒤 수량으로)', () => {
    const [c] = run([pos('a', 'AAAAAAAA1', 1000, 100_000)], [pos('b', 'AAAAAAAA1', 2500, 130_000)], 'shares', () => 2)
    assert.equal(c.status, 'ADD')
    assert.equal(c.change_pct, 25)
  })
  await ok('기록 없는 10:1 분할 의심 → UNKNOWN(매수로 세지 않음)', () => {
    const [c] = run([pos('a', 'AAAAAAAA1', 1000, 1_000_000)], [pos('b', 'AAAAAAAA1', 10_000, 1_100_000)])
    assert.equal(c.status, 'UNKNOWN')
    assert.match(c.note ?? '', /분할 의심/)
    assert.equal(suspectSplit({ key: 'k', issuer: '', cusip: null, security_id: null, shares: 1000, value: 1_000_000, ownership: null }, { key: 'k', issuer: '', cusip: null, security_id: null, shares: 1200, value: 1_300_000, ownership: null }), null)
  })
  await ok('분할 자료를 받은 종목 · 기간 밖 분할은 1 · 자료 없는 종목은 null', () => {
    const f = splitFactorFor([{ security_id: 's1', ex_date: '2026-05-01', kind: 'split', ratio: 4, amount: null, currency: null, source: 'twelvedata', source_url: 'x' }], new Set(['s1', 's2']), '2026-03-31', '2026-06-30')
    const h = (id: string | null) => ({ key: 'k', issuer: '', cusip: null, security_id: id, shares: 1, value: 1, ownership: null })
    assert.equal(f(h('s1')), 4)
    assert.equal(f(h('s2')), 1)
    assert.equal(f(h('s3')), null)
    assert.equal(f(h(null)), null)
  })
  await ok('같은 종목 여러 줄은 합치고 옵션 줄 · PRN은 따로', () => {
    const agg = aggregate([pos('a', 'AAAAAAAA1', 100, 10), pos('a', 'AAAAAAAA1', 50, 5), pos('a', 'AAAAAAAA1', 999, 99, { put_call: 'Call' }), pos('a', 'AAAAAAAA1', 7, 7, { share_type: 'PRN' })])
    assert.equal(agg.get('AAAAAAAA1')?.shares, 150)
    assert.equal(agg.get('AAAAAAAA1:PRN')?.shares, 7)
    assert.equal(agg.size, 2)
  })
  await ok('NBIM 전체 목록(주식 수 없음) — 계속 보유는 UNKNOWN, 목록 기준 NEW/EXIT', () => {
    const out = run([pos('a', 'nbim:1', null, 10, { ownership_pct: 1 }), pos('a', 'nbim:2', null, 10)], [pos('b', 'nbim:1', null, 20, { ownership_pct: 1.2 }), pos('b', 'nbim:3', null, 5)], 'presence')
    assert.deepEqual(countChanges(out), { NEW: 1, ADD: 0, TRIM: 0, EXIT: 1, HOLD: 0, UNKNOWN: 1 })
    assert.match(out.find((c) => c.holding_key === 'nbim:1')!.note!, /지분율 \+0.2%p/)
  })
  await ok('수정공시 — RESTATEMENT는 원본을 대신, NEW HOLDINGS는 더함', () => {
    const o = disc('o', '2026-06-30', { source_published_at: '2026-08-14' })
    const n = disc('n', '2026-06-30', { is_amendment: true, amendment_type: 'NEW HOLDINGS', source_published_at: '2026-09-01' })
    let eff = effectivePeriods([o, n])
    assert.deepEqual(eff[0].members.map((d) => d.disclosure_id), ['o', 'n'])
    const r = disc('r', '2026-06-30', { is_amendment: true, amendment_type: 'RESTATEMENT', source_published_at: '2026-09-10' })
    eff = effectivePeriods([o, n, r])
    assert.equal(eff[0].primary.disclosure_id, 'r')
    assert.deepEqual(eff[0].members.map((d) => d.disclosure_id), ['r'])
  })

  console.log('파서')
  const cover = `<edgarSubmission><headerData><filerInfo><periodOfReport>06-30-2026</periodOfReport></filerInfo></headerData><formData><coverPage><isAmendment>false</isAmendment></coverPage><summaryPage><tableEntryTotal>2</tableEntryTotal><tableValueTotal>300</tableValueTotal><isConfidentialOmitted>false</isConfidentialOmitted></summaryPage></formData></edgarSubmission>`
  const info = `<informationTable xmlns="x"><infoTable><nameOfIssuer>APPLE INC</nameOfIssuer><titleOfClass>COM</titleOfClass><cusip>037833100</cusip><value>200</value><shrsOrPrnAmt><sshPrnamt>10</sshPrnamt><sshPrnamtType>SH</sshPrnamtType></shrsOrPrnAmt><investmentDiscretion>SOLE</investmentDiscretion></infoTable><ns1:infoTable><ns1:nameOfIssuer>AT&amp;T INC</ns1:nameOfIssuer><ns1:titleOfClass>COM</ns1:titleOfClass><ns1:cusip>00206r102</ns1:cusip><ns1:value>100</ns1:value><ns1:shrsOrPrnAmt><ns1:sshPrnamt>5</ns1:sshPrnamt><ns1:sshPrnamtType>SH</ns1:sshPrnamtType></ns1:shrsOrPrnAmt><ns1:putCall>Call</ns1:putCall></ns1:infoTable></informationTable>`
  await ok('13F 표지 · 정보표(접두사 · &amp; · 옵션)', () => {
    const c = parseCover(cover)
    assert.equal(c.period, '2026-06-30')
    assert.equal(c.table_entry_total, 2)
    const e = parseInfoTable(info)
    assert.equal(e.length, 2)
    assert.equal(e[1].issuer, 'AT&T INC')
    assert.equal(e[1].cusip, '00206R102')
    assert.equal(e[1].put_call, 'Call')
    assert.equal(filingQuality({ ref: { accession: 'x', form: '13F-HR', report_date: '', filing_date: '' }, ...c, entries: e, index_url: '' }), 95)
  })
  await ok('기밀 처리 13F(Norges 1 · 3분기) — 자리표 줄은 보유가 아니고 품질 50 미만', () => {
    const ph = `<informationTable><infoTable><nameOfIssuer>NA</nameOfIssuer><titleOfClass>NA</titleOfClass><cusip>000000000</cusip><value>0</value><shrsOrPrnAmt><sshPrnamt>0</sshPrnamt><sshPrnamtType>SH</sshPrnamtType></shrsOrPrnAmt></infoTable></informationTable>`
    const e = parseInfoTable(ph)
    assert.equal(e.length, 0)
    const q = filingQuality({ ref: { accession: 'x', form: '13F-HR', report_date: '', filing_date: '' }, period: '2026-03-31', is_amendment: false, amendment_type: null, table_entry_total: 1507, table_value_total: 864e9, confidential_omitted: true, entries: e, index_url: '' })
    assert.ok(q < 50, String(q))
  })
  await ok('13F 모양이 다르면 빈 목록이 아니라 오류', () => {
    assert.throws(() => parseInfoTable('<html>blocked</html>'))
  })
  await ok('NBIM — 주식 줄만 · 기준일 목록', () => {
    const p = periodsFromInit({ data: { details: [{ label: '2025', fileName: '2025-12-31.json', v: 'x' }, { label: 'H1 2026', fileName: '2026-06-30.json', v: 'x', interim: true }] } })
    assert.equal(p[0].as_of, '2026-06-30')
    const h = holdingsFromFile({ data: [{ id: 'a', n: 'Apple Inc', cc: 'US', a: { e: 5, n: 50 }, at: 0, o: 1.2, eq: { vid: 'aapl', v: 1.2, s: 'Technology' } }, { id: 'b', n: 'Bond', a: { e: 1 }, at: 1 }] })
    assert.equal(h.length, 1)
    assert.equal(h[0].ticker, 'AAPL')
    assert.throws(() => holdingsFromFile({ data: [] }))
  })
  await ok('OpenFIGI 종류 — ETP는 ETF', () => {
    assert.equal(kindFromFigi({ securityType: 'ETP', securityType2: 'Mutual Fund' }), 'etf')
    assert.equal(kindFromFigi({ securityType: 'Common Stock' }), 'stock')
  })

  console.log('재무 지표(원문 5.2)')
  const F = (concept: string, value: number, start: string | null, end: string, filed: string, unit = 'USD', accession = `acc-${filed}`): InvFact => ({
    security_id: 's', cik: '0000000001', taxonomy: 'us-gaap', concept, unit, period_start: start, period_end: end, period_key: `${start ?? ''}|${end}`, fy: null, fp: null, form: '10-K', filed, accession, frame: null, value, source_url: 'x',
  })
  const facts: InvFact[] = []
  for (const [y, rev] of [[2021, 100], [2022, 110], [2023, 121], [2024, 133.1], [2025, 146.41], [2020, 90]] as const) {
    facts.push(F('Revenues', rev, `${y}-01-01`, `${y}-12-31`, `${y + 1}-02-01`))
    facts.push(F('NetCashProvidedByUsedInOperatingActivities', 30, `${y}-01-01`, `${y}-12-31`, `${y + 1}-02-01`))
    facts.push(F('PaymentsToAcquirePropertyPlantAndEquipment', 10, `${y}-01-01`, `${y}-12-31`, `${y + 1}-02-01`))
    facts.push(F('OperatingIncomeLoss', 25, `${y}-01-01`, `${y}-12-31`, `${y + 1}-02-01`))
    facts.push(F('WeightedAverageNumberOfDilutedSharesOutstanding', 10, `${y}-01-01`, `${y}-12-31`, `${y + 1}-02-01`, 'shares'))
  }
  facts.push(F('Revenues', 999, '2025-01-01', '2025-12-31', '2026-03-01', 'USD', 'restated')) // 같은 기간 늦은 공시가 이긴다
  facts.push(F('StockholdersEquity', 100, null, '2025-12-31', '2026-02-01'))
  facts.push(F('LongTermDebt', 30, null, '2025-12-31', '2026-02-01'))
  facts.push(F('CashAndCashEquivalentsAtCarryingValue', 30, null, '2025-12-31', '2026-02-01'))
  facts.push(F('Revenues', 40, '2026-04-01', '2026-06-30', '2026-08-01'))
  facts.push(F('NetCashProvidedByUsedInOperatingActivities', 10, '2026-01-01', '2026-03-31', '2026-05-01'))
  facts.push(F('NetCashProvidedByUsedInOperatingActivities', 25, '2026-01-01', '2026-06-30', '2026-08-01'))
  await ok('연간 줄 · 늦은 공시 우선 · FCF · ROIC · CAGR', () => {
    const rows = annualRows(facts)
    assert.equal(rows[0].period_end, '2025-12-31')
    assert.equal(rows[0].revenue, 999)
    assert.equal(rows[0].fcf, 20)
    const m = computeMetrics(facts, [{ d: '2026-06-30', close: 50, adj_close: null, volume: null, source: 'sec13f_implied', source_url: null }], null)
    assert.equal(m.fcfPerShare, 2)
    assert.equal(m.marketCap, 500)
    assert.equal(m.pFcf, 25)
    assert.ok(Math.abs((m.roic ?? 0) - 25 * 0.79) < 1e-9, String(m.roic)) // 세율 없음 → 21% · 투자자본 100+30−30
    assert.equal(m.price?.source, 'sec13f_implied')
  })
  await ok('분기 현금흐름 = 누계 차이(10-Q)', () => {
    const q = quarterRows(facts)
    assert.equal(q[0].period_end, '2026-06-30')
    assert.equal(q[0].ocf, 15)
  })
  await ok('XBRL — 최근 7년 · 10-K/10-Q만 · 같은 공시 중복 하나', () => {
    const rows = factsFromCompanyFacts(
      {
        cik: 320193,
        facts: {
          'us-gaap': {
            Revenues: { units: { USD: [{ start: '2025-01-01', end: '2025-12-31', val: 1, accn: 'a', form: '10-K', filed: '2026-02-01' }, { start: '2025-01-01', end: '2025-12-31', val: 1, accn: 'a', form: '10-K', filed: '2026-02-01' }, { start: '2010-01-01', end: '2010-12-31', val: 1, accn: 'b', form: '10-K' }, { start: '2025-01-01', end: '2025-12-31', val: 1, accn: 'c', form: '8-K' }] } },
          },
        },
      },
      's',
      '2026-10-25',
    )
    assert.equal(rows.length, 1)
    assert.equal(rows[0].cik, '0000320193')
  })

  console.log('수집 순서(가짜 응답)')
  const sub = (forms: [string, string, string, string][]) => ({ filings: { recent: { form: forms.map((f) => f[0]), accessionNumber: forms.map((f) => f[1]), reportDate: forms.map((f) => f[2]), filingDate: forms.map((f) => f[3]) } } })
  const infoXml = (rows: [string, number, number][]) =>
    `<informationTable>${rows.map(([c, v, s]) => `<infoTable><nameOfIssuer>N${c}</nameOfIssuer><titleOfClass>COM</titleOfClass><cusip>${c}</cusip><value>${v}</value><shrsOrPrnAmt><sshPrnamt>${s}</sshPrnamt><sshPrnamtType>SH</sshPrnamtType></shrsOrPrnAmt></infoTable>`).join('')}</informationTable>`
  const coverXml = (p: string, n: number) => `<x><periodOfReport>${p}</periodOfReport><isAmendment>false</isAmendment><tableEntryTotal>${n}</tableEntryTotal></x>`
  const routes: Record<string, unknown> = {
    'data.sec.gov/submissions/CIK0001067983.json': sub([['13F-HR', '0000000001-26-000002', '2026-06-30', '2026-08-14'], ['13F-HR', '0000000001-26-000001', '2026-03-31', '2026-05-15']]),
    '000000000126000002/index.json': { directory: { item: [{ name: 'primary_doc.xml' }, { name: 'info.xml' }] } },
    '000000000126000001/index.json': { directory: { item: [{ name: 'primary_doc.xml' }, { name: 'info.xml' }] } },
    '000000000126000002/primary_doc.xml': coverXml('06-30-2026', 2),
    '000000000126000001/primary_doc.xml': coverXml('03-31-2026', 2),
    '000000000126000002/info.xml': infoXml([['037833100', 1500, 15], ['594918104', 100, 1]]),
    '000000000126000001/info.xml': infoXml([['037833100', 1000, 10], ['02079K305', 50, 5]]),
    'nbim.no/api/investments/v2/init.json': { data: { details: [] } },
    'api.openfigi.com': [{ data: [{ figi: 'BBG000B9XRY4', ticker: 'AAPL', exchCode: 'US', securityType: 'Common Stock' }] }, { data: [{ figi: 'BBG000BPH459', ticker: 'MSFT', exchCode: 'US', securityType: 'Common Stock' }] }, { data: [{ figi: 'BBG009S39JX6', ticker: 'GOOGL', exchCode: 'US', securityType: 'Common Stock' }] }],
    'frankfurter.dev': { rates: { '2026-10-23': { KRW: 1400 } } },
    'company_tickers.json': { 0: { cik_str: 320193, ticker: 'AAPL' } },
    'companyfacts/CIK0000320193.json': { cik: 320193, facts: { 'us-gaap': { Revenues: { units: { USD: [{ start: '2025-01-01', end: '2025-12-31', val: 5, accn: 'z', form: '10-K', filed: '2026-02-01' }] } } } } },
    'submissions/CIK0000320193.json': { sicDescription: 'ELECTRONIC COMPUTERS' },
  }
  const seen: string[] = []
  const fake: FetchLike = async (url) => {
    seen.push(url)
    const key = Object.keys(routes).find((k) => url.includes(k))
    if (!key) return { ok: false, status: 404, text: async () => 'nope', json: async () => ({}) }
    const body = routes[key]
    return { ok: true, status: 200, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)), json: async () => body }
  }
  const managers = SEED_MANAGERS.map((m) => (m.manager_id === 'berkshire' ? m : { ...m, sec_cik: null }))
  await ok('SEC_USER_AGENT 없으면 sec.gov를 부르지 않고 «필요»를 적는다(운영 403 — 2026-10-25)', async () => {
    delete process.env.SEC_USER_AGENT
    const { sink, state } = memorySink({ managers, sources: SEED_SOURCES.map((s) => ({ ...s })), settings: SEED_SETTINGS })
    const before = seen.length
    const r = await runCollect(sink, { trigger: 'test', fetchImpl: fake, sleep: async () => undefined, now: () => new Date('2026-10-25T00:00:00Z') })
    assert.ok(!seen.slice(before).some((u) => u.includes('sec.gov')))
    assert.match(state.sources.find((s) => s.source_id === 'sec13f:berkshire')!.status_note ?? '', /SEC_USER_AGENT 필요/)
    assert.equal(state.sources.find((s) => s.source_id === 'sec:xbrl')!.status, 'UNAVAILABLE')
    assert.equal(state.sources.find((s) => s.source_id === 'prices:sec13f')!.status, 'UNAVAILABLE')
    assert.ok(r.steps.some((x) => !x.ok && /SEC_USER_AGENT/.test(x.note)))
  })
  process.env.SEC_USER_AGENT = 'Test Co test@example.com'
  await ok('한 번 돌기 — 공시 · 판정 · 종목 · 티커 · 파생 가격 · 재무 · 실패한 경로는 오류만', async () => {
    const { sink, state } = memorySink({ managers, sources: SEED_SOURCES.map((s) => ({ ...s })), settings: SEED_SETTINGS })
    delete process.env.TWELVEDATA_API_KEY
    const r = await runCollect(sink, { trigger: 'test', fetchImpl: fake, sleep: async () => undefined, now: () => new Date('2026-10-25T00:00:00Z') })
    assert.equal(state.disclosures.length, 2)
    assert.equal(state.disclosures[0].source_published_at, '2026-05-15')
    assert.equal(state.disclosures[1].data_as_of, '2026-06-30')
    const ch = Object.fromEntries(state.changes.map((c) => [c.holding_key, c.status]))
    assert.deepEqual(ch, { '037833100': 'ADD', '594918104': 'NEW', '02079K305': 'EXIT' })
    assert.equal(state.securities.filter((s) => s.watch).length, 2)
    assert.equal(state.securities.find((s) => s.cusip === '037833100')?.ticker, 'AAPL')
    assert.equal(state.securities.find((s) => s.cusip === '037833100')?.sector, 'ELECTRONIC COMPUTERS')
    const aapl = state.securities.find((s) => s.cusip === '037833100')!
    assert.deepEqual((state.prices.get(aapl.security_id) ?? []).map((p) => [p.d, p.close, p.source]), [['2026-03-31', 100, 'sec13f_implied'], ['2026-06-30', 100, 'sec13f_implied']])
    assert.equal(state.facts.length, 1)
    assert.equal(state.positions.find((p) => p.cusip === '037833100')?.security_id, aapl.security_id)
    const nbim = state.sources.find((s) => s.source_id === 'nbim:holdings')!
    assert.equal(nbim.status, 'UNAVAILABLE')
    assert.equal(state.sources.find((s) => s.source_id === 'sec13f:berkshire')!.status, 'LIVE')
    assert.equal(state.sources.find((s) => s.source_id === 'prices:twelvedata')!.status, 'UNAVAILABLE')
    assert.match(state.sources.find((s) => s.source_id === 'prices:twelvedata')!.status_note ?? '', /키 필요: TWELVEDATA_API_KEY/)
    assert.ok(r.steps.some((s) => s.step === '주가 · 분할' && s.ok && /키 없음/.test(s.note)))
    assert.ok(seen.every((u) => !u.includes('apikey=')))
    // 두 번째: 이미 받은 공시는 다시 받지 않고 판정도 그대로
    const before = seen.length
    await runCollect(sink, { trigger: 'test', fetchImpl: fake, sleep: async () => undefined, now: () => new Date('2026-10-25T01:00:00Z') })
    assert.equal(state.disclosures.length, 2)
    assert.ok(!seen.slice(before).some((u) => u.includes('info.xml')))
  })
  await ok('하루 호출 한도 — 넘기면 그 단계만 멈추고 «한도» 기록 · 마지막 성공 시각은 그대로', async () => {
    const { sink, state } = memorySink({ managers, sources: SEED_SOURCES.map((s) => ({ ...s, calls_day: '2026-10-25', calls_today: 0 })), settings: { ...SEED_SETTINGS, collect_daily_limit: 50 } })
    state.sources[0].calls_today = 48
    const r = await runCollect(sink, { trigger: 'test', fetchImpl: fake, sleep: async () => undefined, now: () => new Date('2026-10-25T00:00:00Z') })
    assert.ok(r.calls <= 2)
    assert.ok(r.steps.some((s) => !s.ok && /하루 호출 한도 50회/.test(s.note)))
  })
  await ok('비밀값은 오류 문장에 남지 않는다', async () => {
    process.env.TWELVEDATA_API_KEY = 'SECRET-KEY-123'
    const { sink, state } = memorySink({ managers, sources: SEED_SOURCES.map((s) => ({ ...s })), settings: SEED_SETTINGS })
    const r = await runCollect(sink, { trigger: 'test', fetchImpl: fake, sleep: async () => undefined, now: () => new Date('2026-10-25T00:00:00Z') })
    delete process.env.TWELVEDATA_API_KEY
    const all = JSON.stringify(r.steps) + JSON.stringify(state.sources)
    assert.ok(!all.includes('SECRET-KEY-123'))
    assert.ok(r.steps.some((s) => s.step === '주가 · 분할' && !s.ok))
  })

  console.log('시드 · 메뉴 · Demo · 문')
  const sql = readFileSync('supabase/migrations/0094_investment_radar.sql', 'utf8')
  await ok('0094 SQL 시드 = TS 시드(기관 · CIK · 유형 · 가중치 · 경로 · 키 이름)', () => {
    const mgr = [...sql.matchAll(/\('([a-z]+)', '[^']+', '[^']+', '[^']+', '(\d{10})', '[^']+', '(index|concentrated)', ([\d.]+),/g)].map((m) => `${m[1]}:${m[2]}:${m[3]}:${Number(m[4])}`)
    assert.deepEqual(mgr, SEED_MANAGERS.map((m) => `${m.manager_id}:${m.sec_cik}:${m.style}:${m.signal_weight}`))
    const src = [...sql.matchAll(/\('([a-z0-9:._-]+)', (null|'[a-z]+'), '[^']+', '([a-z_0-9]+)', '[^']+', '[^']+', (null|'[A-Z_]+'), '([A-Z]+)'/g)].map((m) => `${m[1]}:${m[3]}:${m[4].replace(/'/g, '')}:${m[5]}`)
    assert.deepEqual(src, SEED_SOURCES.map((s) => `${s.source_id}:${s.kind}:${s.key_env ?? 'null'}:${s.status}`))
  })
  await ok('메뉴 8개 — 원문 2.1 이름 · 순서 그대로', () => {
    assert.deepEqual(INVESTMENT_MENU.filter((m) => m.no).map((m) => `${m.no}. ${m.label}`), ['1. Dashboard', '2. Investor Radar', '3. Future Markets', '4. Stock & ETF 360', '5. AI Investment Engine', '6. Recommendations', '7. DY Portfolio', '8. Performance & Learning'])
  })
  await ok('Demo 숫자는 DEMO일 때만(검증 12) — 실측 화면 코드는 DEMO_KPIS를 mode=demo에서만 쓴다', () => {
    assert.deepEqual(DEMO_KPIS, { managers: 4, candidates: 28, newPositions: 4, added: 11, trimmed: 7, buyZone: 3, monthlyKrw: 1_000_000, yearlyKrw: 12_000_000 })
    const view = readFileSync('src/lib/investment/view.ts', 'utf8')
    assert.match(view, /if \(demo\) return \{ mode: 'demo', \.\.\.DEMO_KPIS/)
    assert.equal((view.match(/DEMO_KPIS/g) ?? []).length, 2) // import + demo 갈래 하나
    const page = readFileSync('src/app/(dashboard)/investment/page.tsx', 'utf8')
    assert.match(page, /kpis\.mode === 'demo' \? <DemoBanner/)
    assert.match(page, /kpis\.mode === 'demo' \? \(\s*<T minWidth=\{420\}>/)
    assert.ok(!/is_demo:\s*true/.test(readFileSync('src/lib/investment/collect/run.ts', 'utf8')))
  })
  await ok('화면 · API 문 — 직원 · 시스템 계정은 못 본다, 지정자는 본다(검증 15 · 머리말 403)', async () => {
    const { canSeeInvestment } = await import('../src/lib/investment/screen-rules')
    assert.equal(canSeeInvestment({ role: 'Chairman' }), true)
    assert.equal(canSeeInvestment({ role: 'Member' }), false)
    assert.equal(canSeeInvestment({ role: 'GroupCFO' }), false)
    assert.equal(canSeeInvestment({ role: 'TeamLead', investment: true }), true)
    assert.equal(canSeeInvestment({ role: 'AIAgent', investment: true }), false)
    assert.equal(canSeeInvestment(null), false)
    const api = readFileSync('src/app/api/investment/data/route.ts', 'utf8')
    assert.match(api, /investmentApiGate\(\)[\s\S]*status: gate\.status/)
    const screen = readFileSync('src/lib/investment/screen.ts', 'utf8')
    assert.match(screen, /if \(!user\) return \{ status: 403 \}/)
    assert.match(screen, /redirect\('\/me'\)/)
  })
  await ok('자동 실거래 없음(검증 16) — 주문 · 증권사 경로가 코드에 없다', () => {
    const files: string[] = []
    const walk = (d: string) => {
      for (const f of readdirSync(d, { withFileTypes: true })) {
        if (f.isDirectory()) walk(join(d, f.name))
        else if (/\.(ts|tsx)$/.test(f.name)) files.push(join(d, f.name))
      }
    }
    walk('src/lib/investment')
    walk('src/app/(dashboard)/investment')
    for (const f of files) assert.ok(!/placeOrder|submitOrder|brokerage|kiwoom|ebest|alpaca|\/orders\b/i.test(readFileSync(f, 'utf8')), f)
  })
  await ok('Expand-only — 0094 이후 마이그레이션에 drop · rename · 칸 타입 바꾸기 · truncate 없음', () => {
    for (const f of readdirSync('supabase/migrations').filter((x) => x >= '0094')) {
      const body = readFileSync(join('supabase/migrations', f), 'utf8').replace(/--.*$/gm, '')
      assert.ok(!/\bdrop\s+(table|column|view|function|type|schema|index)\b/i.test(body), `${f}: drop`)
      assert.ok(!/\brename\b/i.test(body), `${f}: rename`)
      assert.ok(!/alter\s+column\s+\w+\s+(set\s+data\s+)?type\b/i.test(body), `${f}: 칸 타입`)
      assert.ok(!/\btruncate\b|\bdelete\s+from\b/i.test(body), `${f}: 자료 지우기`)
    }
  })
  await ok('직원 화면 용어 — 투자 화면 · 문구에 «회장» 없음', () => {
    const files: string[] = []
    const walk = (d: string) => {
      for (const f of readdirSync(d, { withFileTypes: true })) {
        if (f.isDirectory()) walk(join(d, f.name))
        else if (/\.(ts|tsx)$/.test(f.name)) files.push(join(d, f.name))
      }
    }
    walk('src/lib/investment')
    walk('src/components/investment')
    walk('src/app/(dashboard)/investment')
    for (const f of files) assert.ok(!/회장|Chairman OS/.test(readFileSync(f, 'utf8').replace(/role === 'Chairman'|'Chairman'/g, '')), f)
  })


  console.log('2단계 — 가치평가 · 점수 · BUY 조건(원문 8 · 9 · 10)')
  await ok('8.3 예시 정확히 — $201.14 · $114.13 · $91.30 · WATCH', () => {
    const r = valuate({ ...DEMO_VALUATION })
    assert.equal(round2(r.futurePrice), 201.14)
    assert.equal(round2(r.presentValue), 114.13)
    assert.equal(round2(r.buyPrice), 91.3)
    assert.equal(r.priceZone, 'WATCH')
    assert.equal(round2(r.futureFcfPerShare), 10.06)
    assert.equal(validateInput({ ...DEMO_VALUATION, fcfPerShare: -1 }) !== null, true)
  })
  await ok('입력이 바뀌면 다시 계산(성장률 20% → 기준가가 오른다)', () => {
    const a = valuate({ ...DEMO_VALUATION })
    const b = valuate({ ...DEMO_VALUATION, fcfCagr: 0.2 })
    assert.ok(b.buyPrice > a.buyPrice)
    assert.equal(valuate({ ...DEMO_VALUATION, price: 80 }).priceZone, 'BELOW_BUY')
    assert.equal(valuate({ ...DEMO_VALUATION, price: 130 }).priceZone, 'ABOVE_VALUE')
  })
  await ok('Opportunity 원문 9 예시 = 76.75 · Institutional UNKNOWN이면 나머지로 다시 나눔', () => {
    const o = opportunityScore({ market: 80, leader: 85, valuation: 65, institutional: 70 })
    assert.equal(o.total, 76.75)
    const u = opportunityScore({ market: 80, leader: 85, valuation: 65, institutional: null })
    assert.equal(u.total, r2((80 * 30 + 85 * 35 + 65 * 30) / 95))
    assert.match(u.note ?? '', /UNKNOWN/)
    assert.equal(opportunityScore({ market: null, leader: 85, valuation: 65, institutional: 70 }).total, null)
  })
  await ok('Market Score — 저장된 입력으로 다시 계산 · 요소 하나 빠지면 NEED DATA · 늦은 판단 줄이 AI 추정을 이김', () => {
    const f = (factor: string, score: number, method: 'formula' | 'judgment' | 'ai_estimate', at: string) => ({ factor, score, method, raw_value: null, raw_unit: null, evidence: 'x', source_url: null, as_of: null, data_quality: 80, created_at: at })
    const rows = [f('demand_growth', 100, 'formula', '1'), f('profit_pool', 90, 'ai_estimate', '1'), f('adoption', 80, 'ai_estimate', '1'), f('bottleneck', 90, 'ai_estimate', '1'), f('durability', 65, 'ai_estimate', '1')]
    const s1 = marketScore(latestFactors(rows))
    assert.equal(s1.total, r2(100 * 0.25 + 90 * 0.2 + 80 * 0.2 + 90 * 0.2 + 65 * 0.15))
    assert.equal(s1.aiEstimated, true)
    const s2 = marketScore(latestFactors([...rows, f('durability', 40, 'judgment', '2')]))
    assert.equal(s2.total, r2(100 * 0.25 + 90 * 0.2 + 80 * 0.2 + 90 * 0.2 + 40 * 0.15))
    assert.equal(marketScore(latestFactors(rows.slice(1))).total, null)
    assert.equal(demandGrowthScore(15), 50)
  })
  await ok('Institutional Signal — 13F 범위 밖은 UNKNOWN(null) · NBIM은 가중치 0.5', () => {
    assert.equal(institutionalSignal([], SEED_MANAGERS).score, null)
    const c = (manager_id: 'nbim' | 'berkshire', status: 'ADD' | 'NEW') => ({ manager_id, status }) as never
    assert.equal(institutionalSignal([c('berkshire', 'ADD')], SEED_MANAGERS).score, 65)
    assert.equal(institutionalSignal([c('nbim', 'ADD')], SEED_MANAGERS).score, 57.5)
  })
  const okA = { value: 1, source_url: 'https://www.sec.gov/x', as_of: '2026-06-30', quality: 90 }
  const gate = (over: Partial<Parameters<typeof stockChecks>[0]> = {}) => {
    const v = valuate({ ...DEMO_VALUATION, price: 80 })
    return stockChecks({
      kind: 'stock',
      price: { value: 80, as_of: '2026-10-24', source: 'twelvedata' },
      today: '2026-10-25',
      financialsAsOf: '2025-12-31',
      assumptions: { fcfPerShare: okA, fcfCagr: okA, exitMultiple: okA, requiredReturn: { ...okA, value: 12 }, marginOfSafety: okA },
      minQuality: 70,
      dataQuality: 85,
      evidenceCount: 2,
      thesisBroken: false,
      netDebtToEbitda: 1,
      fcf: 100,
      valuation: v,
      requiredReturnPct: 12,
      ...over,
    })
  }
  await ok('BUY는 점수와 별개 — 조건 전부 통과일 때만 BUY ZONE', () => {
    const v = valuate({ ...DEMO_VALUATION, price: 80 })
    assert.equal(decide(gate(), { thesisBroken: false, valuation: v }), 'BUY ZONE')
  })
  await ok('검증된 주가가 아니면(13F 분기말 파생) NEED DATA — Opportunity가 높아도', () => {
    const v = valuate({ ...DEMO_VALUATION, price: 80 })
    assert.equal(decide(gate({ price: { value: 80, as_of: '2026-06-30', source: 'sec13f_implied' } }), { thesisBroken: false, valuation: v }), 'NEED DATA')
  })
  await ok('가정 하나라도 출처 · 기준일 · 품질 미달이면 NEED DATA(AI는 분석 글만, BUY 불가)', () => {
    const v = valuate({ ...DEMO_VALUATION, price: 80 })
    assert.equal(decide(gate({ assumptions: { fcfPerShare: okA, fcfCagr: { ...okA, source_url: null }, exitMultiple: okA, requiredReturn: { ...okA, value: 12 }, marginOfSafety: okA } }), { thesisBroken: false, valuation: v }), 'NEED DATA')
    assert.equal(decide(gate({ assumptions: { fcfPerShare: okA, fcfCagr: okA, exitMultiple: { ...okA, quality: 60 }, requiredReturn: { ...okA, value: 12 }, marginOfSafety: okA } }), { thesisBroken: false, valuation: v }), 'NEED DATA')
  })
  await ok('안전마진 밖 → WATCH · 현재가치 위 → OVERVALUED · 가설 훼손 → THESIS BROKEN · 근거 부족 → WATCH', () => {
    const w = valuate({ ...DEMO_VALUATION })
    assert.equal(decide(gate({ valuation: w, price: { value: 100, as_of: '2026-10-24', source: 'twelvedata' } }), { thesisBroken: false, valuation: w }), 'WATCH')
    const o = valuate({ ...DEMO_VALUATION, price: 130 })
    assert.equal(decide(gate({ valuation: o }), { thesisBroken: false, valuation: o }), 'OVERVALUED')
    const v = valuate({ ...DEMO_VALUATION, price: 80 })
    assert.equal(decide(gate({ thesisBroken: true }), { thesisBroken: true, valuation: v }), 'THESIS BROKEN')
    assert.equal(decide(gate({ evidenceCount: 1 }), { thesisBroken: false, valuation: v }), 'WATCH')
    assert.equal(decide(gate({ netDebtToEbitda: 5 }), { thesisBroken: false, valuation: v }), 'WATCH')
  })
  await ok('기관 데이터가 없어도 BUY를 막지 않는다(머리말)', () => {
    const src = readFileSync('src/lib/investment/recommend.ts', 'utf8')
    assert.ok(!/institutional/i.test(src.slice(src.indexOf('export function stockChecks'), src.indexOf('export function etfChecks'))))
  })
  await ok('ETF는 재무 대신 가격 · 기초지수 · 총보수 · 구성 종목 · 추적오차', () => {
    const base = { kind: 'etf' as const, price: { value: 100, as_of: '2026-10-24', source: 'twelvedata' as const }, today: '2026-10-25', minQuality: 70, dataQuality: 80, thesisBroken: false }
    const all = { index: { ok: true, detail: '' }, expenseRatio: { ok: true, detail: '' }, holdings: { ok: true, detail: '' }, trackingError: { ok: true, detail: '' } }
    assert.equal(decide(etfChecks({ ...base, items: all }), { thesisBroken: false, valuation: null, etf: true }), 'BUY ZONE')
    assert.equal(decide(etfChecks({ ...base, items: { ...all, trackingError: { ok: false, detail: '' } } }), { thesisBroken: false, valuation: null, etf: true }), 'NEED DATA')
  })

  console.log('2단계 — AI 한도 · 물러서기(가짜 Anthropic · 가짜 예약)')
  const fakeSb = (opts: { deny?: string }) => {
    const calls: string[] = []
    let id = 0
    return {
      calls,
      sb: {
        rpc: async (fn: string) => {
          calls.push(fn)
          if (fn === 'investment_ai_reserve' && opts.deny) return { data: null, error: { message: opts.deny } }
          return { data: ++id, error: null }
        },
        from: () => ({ insert: () => ({ then: (f: (x: { error: null }) => void) => f({ error: null }) }) }),
      } as never,
    }
  }
  const okMsg = { stop_reason: 'end_turn', usage: { input_tokens: 100, output_tokens: 50 }, content: [{ type: 'text', text: '{"summary":"요약"}' }] }
  await ok('한도 도달이면 LLM만 DISABLED(호출 안 함)', async () => {
    process.env.ANTHROPIC_API_KEY = 'test'
    let created = 0
    const f = fakeSb({ deny: 'investment_ai_limit_day' })
    const r = await investmentAi({ sb: f.sb, kind: 'brief', system: 's', payload: {}, schema: {}, maxTokens: 10, client: { messages: { create: async () => (created++, okMsg) } } as never })
    assert.equal(r.ok, false)
    assert.equal(!r.ok && r.reason, 'LIMIT_DAY')
    assert.equal(created, 0)
    const m = fakeSb({ deny: 'investment_ai_limit_month' })
    const r2 = await investmentAi({ sb: m.sb, kind: 'brief', system: 's', payload: {}, schema: {}, maxTokens: 10, client: { messages: { create: async () => okMsg } } as never })
    assert.equal(!r2.ok && r2.reason, 'LIMIT_MONTH')
  })
  await ok('예약 → 호출 → 끝 기록 · 구조 강제 400이면 다시 예약하고 한 번만 물러섬', async () => {
    const f = fakeSb({})
    const r = await investmentAi<{ summary: string }>({ sb: f.sb, kind: 'brief', system: 's', payload: {}, schema: {}, maxTokens: 10, client: { messages: { create: async () => okMsg } } as never })
    assert.equal(r.ok && r.json.summary, '요약')
    assert.deepEqual(f.calls, ['investment_ai_reserve', 'investment_ai_finish'])
    const g = fakeSb({})
    let n = 0
    const bad = new Anthropic.BadRequestError(400, { error: { message: 'output_config.format is not supported' } }, 'output_config.format is not supported', new Headers())
    const r2 = await investmentAi<{ summary: string }>({ sb: g.sb, kind: 'brief', system: 's', payload: {}, schema: {}, maxTokens: 10, client: { messages: { create: async () => { n += 1; if (n === 1) throw bad; return okMsg } } } as never })
    assert.equal(r2.ok, true)
    assert.equal(n, 2)
    assert.deepEqual(g.calls, ['investment_ai_reserve', 'investment_ai_finish', 'investment_ai_reserve', 'investment_ai_finish'])
  })
  await ok('예상 비용 = 입력 상한 + 출력 상한 × 단가(sonnet-5 $2/$10)', () => {
    assert.equal(estimateUsd('claude-sonnet-5', 2000, 1000), round6((1300 * 2 + 1000 * 10) / 1e6))
  })

  console.log(`\nPASS: check:investment ${passed}개`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

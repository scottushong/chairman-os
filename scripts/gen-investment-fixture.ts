/**
 * dummy 모드 스냅숏 만들기 — 실제 공개 자료(SEC 13F · NBIM · OpenFIGI · XBRL · ECB 환율)를 메모리 싱크로 한 번 받아 줄인다.
 *   npx tsx scripts/gen-investment-fixture.ts
 *   → src/lib/investment/fixtures/snapshot.json (dummy-investment.ts가 읽는다)
 * 줄이는 규칙: NBIM 전체 목록은 평가액 상위 150 + 관심 종목 티커만, Norges 13F는 관심 종목 CUSIP만, 그 줄의 판정만.
 * XBRL은 종목마다 같은 기간의 가장 늦은 공시 값만. 환율은 3년. DB에는 아무것도 쓰지 않는다.
 * SEC_USER_AGENT가 비면 기본 이름으로 부른다(환경변수에 넣고 돌리기를 권함).
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { investmentDbSetup } from './check-investment-db'
import { runCollect } from '../src/lib/investment/collect/run'
import { memorySink } from '../src/lib/investment/collect/sink'
import { SEED_MANAGERS, SEED_SETTINGS, SEED_SOURCES } from '../src/lib/investment/seed'
import type { InvFact } from '../src/lib/investment/types'

async function main() {
  const { sink, state } = memorySink({ managers: SEED_MANAGERS, sources: SEED_SOURCES, settings: { ...SEED_SETTINGS, collect_daily_limit: 2000 } })
  let r = await runCollect(sink, { trigger: 'test', quarters: 5, nbimPeriods: 2, xbrlPerRun: 5, budgetMs: 600_000 })
  console.log('run1', r.ok, r.calls, r.steps.map((s) => `${s.ok ? 'OK' : 'ERR'} ${s.step}: ${s.note}`).join('\n'))
  r = await runCollect(sink, { trigger: 'test', quarters: 5, nbimPeriods: 2, xbrlPerRun: 0, budgetMs: 200_000 })
  console.log('run2', r.ok, r.calls)

  const watch = state.securities.filter((s) => s.watch)
  const cusips = new Set(watch.map((s) => s.cusip).filter(Boolean))
  const tickers = new Set(watch.map((s) => s.ticker).filter(Boolean))
  const nbimList = state.disclosures.filter((d) => d.source_id === 'nbim:holdings').map((d) => d.disclosure_id)
  const norges = state.disclosures.filter((d) => d.source_id === 'sec13f:nbim').map((d) => d.disclosure_id)
  const keepNbim = new Set<string>()
  for (const id of nbimList) {
    const rows = state.positions.filter((p) => p.disclosure_id === id).sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
    rows.slice(0, 150).forEach((p) => keepNbim.add(p.holding_key))
    rows.filter((p) => p.ticker && tickers.has(p.ticker)).forEach((p) => keepNbim.add(p.holding_key))
  }
  const positions = state.positions.filter((p) =>
    nbimList.includes(p.disclosure_id) ? keepNbim.has(p.holding_key) : norges.includes(p.disclosure_id) ? !!p.cusip && cusips.has(p.cusip) : true,
  )
  // NBIM 전체 목록의 NEW · EXIT는 평가액 큰 120줄씩만.
  const bigNew = new Set(
    (['NEW', 'EXIT'] as const).flatMap((st) =>
      state.changes
        .filter((c) => c.source_id === 'nbim:holdings' && c.status === st)
        .sort((a, b) => (b.cur_value ?? b.prev_value ?? 0) - (a.cur_value ?? a.prev_value ?? 0))
        .slice(0, 120)
        .map((c) => `${c.to_disclosure}|${c.holding_key}`),
    ),
  )
  const changes = state.changes.filter((c) =>
    c.source_id === 'nbim:holdings'
      ? keepNbim.has(c.holding_key) || bigNew.has(`${c.to_disclosure}|${c.holding_key}`)
      : c.source_id === 'sec13f:nbim'
        ? !!c.cusip && cusips.has(c.cusip)
        : true,
  )
  // XBRL: 연간(1년 기간 · 시점 값) · 3개월 분기 · 현금흐름 누계(분기 차이용)만, 종목마다 같은 기간의 가장 늦은 공시 값만, 출처 주소는 dummy가 CIK로 다시 만든다.
  const days = (f: InvFact) => (f.period_start ? (Date.parse(f.period_end) - Date.parse(f.period_start)) / 86400_000 : 0)
  const latest = new Map<string, InvFact>()
  for (const f of state.facts.filter((x) => !x.period_start || days(x) > 330 || days(x) < 100 || /CashProvided|CashFlows|PaymentsToAcquire|PurchaseOfProperty/.test(x.concept))) {
    const k = `${f.security_id}|${f.taxonomy}|${f.concept}|${f.unit}|${f.period_key}`
    const cur = latest.get(k)
    if (!cur || (f.filed ?? '') > (cur.filed ?? '')) latest.set(k, f)
  }
  const fx = state.securities.find((s) => s.kind === 'fx')
  const prices = [...state.prices].map(([id, xs]) => [id, id === fx?.security_id ? xs.slice(-780) : xs] as const)
  // 0095 산업 시드 — SQL이 원천(PGlite에 마이그레이션을 올려 그대로 떠 온다 · TS로 베끼지 않는다)
  const { db } = await investmentDbSetup()
  const dump = async (t: string) => (await db.query(`select * from ${t}`)).rows
  const seed95 = {
    markets: await dump('future_markets'),
    market_sources: await dump('market_research_sources'),
    forecasts: await dump('market_forecasts'),
    value_chains: await dump('market_value_chains'),
    scores: await dump('investment_scores'),
    philosophy: await dump('investment_manager_philosophy'),
  }
  await db.close()
  const out = {
    generated_at: new Date().toISOString(),
    seed95,
    sources: state.sources,
    runs: state.runs.map((x) => ({ ...x })),
    disclosures: state.disclosures,
    positions,
    changes,
    securities: state.securities,
    prices,
    actions: state.actions,
    facts: [...latest.values()].map((f) => ({ ...f, source_url: '' })),
  }
  const dir = join(__dirname, '..', 'src', 'lib', 'investment', 'fixtures')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'snapshot.json'), JSON.stringify(out))
  console.log('positions', positions.length, 'changes', changes.length, 'facts', out.facts.length, 'securities', out.securities.length)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

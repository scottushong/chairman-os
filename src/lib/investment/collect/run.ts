import { CHANGE_VERSION, classify, effectivePeriods, type Holding } from '../changes'
import type { InvChange, InvCorporateAction, InvDisclosure, InvManager, InvPosition, InvPrice, InvSecurity, InvSource } from '../types'
import { BudgetExceeded, Http, secUserAgent, type FetchLike } from './http'
import { impliedPrice, figiMap, normTicker, twelveKey, twelvePrices, twelveSplits, usdKrw } from './market'
import { fetchNbimHoldings, listNbimPeriods, NBIM_PAGE } from './nbim'
import { fetchFiling, filingQuality, listFilings } from './sec13f'
import type { CollectorSink, NewPosition, NewSecurity, RunStep } from './sink'
import { factsFromCompanyFacts, fetchCompanyFacts, fetchTickerMap } from './xbrl'

/**
 * 수집 한 번(cron · 대표 «지금 수집» · 시험). 순서:
 *   1 환율 → 2 13F 네 곳 → 3 NBIM 전체 목록 → 4 종목 마스터(집중투자 기관 보유 = 관심 후보) → 5 OpenFIGI 티커
 *   → 6 보유 줄 ↔ 종목 잇기 → 7 변화 판정 → 8 13F 파생 분기말 가격 → 9 XBRL 재무 → 10 Twelve Data 주가 · 분할(키 있을 때만)
 * 단계마다 실패해도 다음 단계로 간다 — 그 경로만 last_error를 남기고 마지막 성공 시각은 그대로 둔다.
 * 하루 호출 한도(investment_settings.collect_daily_limit)와 시간 한도(budgetMs)를 넘기면 남은 단계는 다음 실행으로 미룬다.
 * 한 번에 다 못 받는 것(13F 다섯 분기 · 재무 · 주가)은 실행마다 돌려가며 채운다.
 */

export interface CollectOptions {
  trigger: 'cron' | 'manual' | 'test'
  budgetMs?: number
  now?: () => Date
  fetchImpl?: FetchLike
  sleep?: (ms: number) => Promise<void>
  /** 13F 분기 몇 개를 쌓나(최신부터). 4분기 추이 + 비교 하나 = 5. */
  quarters?: number
  nbimPeriods?: number
  figiPerRun?: number
  xbrlPerRun?: number
  pricesPerRun?: number
}

export interface CollectResult {
  runId: number
  ok: boolean
  calls: number
  steps: RunStep[]
  newDisclosures: number
}

/** 이 품질 아래 공시는 변화 비교에서 뺀다(저장 · 표시는 한다). */
export const COMPARABLE_QUALITY = 50

export const seoulDay = (d: Date) => new Date(d.getTime() + 9 * 3600_000).toISOString().slice(0, 10)
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400_000).toISOString().slice(0, 10)

export const BENCHMARKS: readonly { ticker: string; name: string; reason: string }[] = [
  { ticker: 'SPY', name: 'SPDR S&P 500 ETF Trust', reason: '벤치마크 — 미국 대형주' },
  { ticker: 'ACWI', name: 'iShares MSCI ACWI ETF', reason: '벤치마크 — 글로벌 주식' },
  { ticker: 'AGG', name: 'iShares Core U.S. Aggregate Bond ETF', reason: '벤치마크 — 투자등급 채권' },
]

export async function runCollect(sink: CollectorSink, opts: CollectOptions): Promise<CollectResult> {
  const now = opts.now ?? (() => new Date())
  const started = now().getTime()
  const budget = opts.budgetMs ?? 240_000
  const day = seoulDay(now())
  const settings = await sink.settings()
  const sources = await sink.sources()
  const managers = await sink.managers()
  const usedToday = sources.filter((s) => s.calls_day === day).reduce((t, s) => t + s.calls_today, 0)
  const http = new Http({
    remaining: Math.max(0, settings.collect_daily_limit - usedToday),
    fetchImpl: opts.fetchImpl,
    sleep: opts.sleep,
    secrets: [twelveKey() ?? '', process.env.OPENFIGI_API_KEY?.trim() ?? ''],
  })
  const runId = await sink.startRun(opts.trigger)
  const steps: RunStep[] = []
  let newDisclosures = 0
  const src = (id: string) => sources.find((s) => s.source_id === id) as InvSource | undefined
  const timeLeft = () => budget - (now().getTime() - started)

  async function step(name: string, sourceId: string | null, fn: () => Promise<string>) {
    if (timeLeft() <= 0) {
      steps.push({ step: name, ok: true, calls: 0, note: '시간 한도 — 다음 실행에서' })
      return
    }
    const before = http.calls
    const at = now().toISOString()
    try {
      const note = await fn()
      steps.push({ step: name, ok: true, calls: http.calls - before, note })
      if (sourceId) await sink.markSource(sourceId, { last_attempt_at: at, last_error: null })
    } catch (e) {
      const msg = e instanceof BudgetExceeded ? `하루 호출 한도 ${settings.collect_daily_limit}회 도달 — 내일 다시` : http.redact(e instanceof Error ? e.message : String(e))
      steps.push({ step: name, ok: false, calls: http.calls - before, note: msg.slice(0, 300) })
      if (sourceId) {
        const s = src(sourceId)
        await sink.markSource(sourceId, {
          last_attempt_at: at,
          last_error: msg.slice(0, 500),
          // 한 번도 성공하지 못했으면 UNAVAILABLE. 성공한 적이 있으면 상태는 두고 마지막 성공 시각이 말하게 한다.
          ...(s?.last_success_at ? {} : { status: 'UNAVAILABLE' as const }),
        })
      }
    } finally {
      if (sourceId && http.calls > before) await sink.addCalls(sourceId, http.calls - before, day)
    }
  }
  const ok = async (sourceId: string, status: InvSource['status'], note: string) => {
    await sink.markSource(sourceId, { status, status_note: note, last_success_at: now().toISOString(), last_error: null })
    const s = src(sourceId)
    if (s) Object.assign(s, { status, last_success_at: now().toISOString() })
  }

  // ── 1. 환율 USD→KRW ──
  await step('환율 USD→KRW', 'fx:frankfurter', async () => {
    const fx = await ensureSecurity(sink, { kind: 'fx', ticker: 'USDKRW', name: 'USD/KRW (ECB 기준환율)', currency: 'KRW', source: 'frankfurter', source_url: 'https://frankfurter.dev' })
    const last = await sink.lastPriceDate(fx.security_id, 'frankfurter')
    if (last && last >= addDays(day, -1)) return '오늘 받을 것 없음'
    const rows = await usdKrw(http, last ? addDays(last, 1) : addDays(day, -365 * 6), day)
    await sink.upsertPrices(fx.security_id, rows)
    await ok('fx:frankfurter', 'LIVE', `마지막 고시일 ${rows.at(-1)?.d ?? last ?? '—'}`)
    return `${rows.length}일`
  })

  // ── 2. SEC 13F ──
  const ua = secUserAgent()
  /** sec.gov 문서 서버(Archives · company_tickers)는 연락 이메일 없는 User-Agent를 403으로 막는다(2026-10-25 운영 확인). 헛호출하지 않는다. */
  const UA_NEEDED = 'SEC_USER_AGENT 필요(회사명 + 연락 이메일, 예: «DY Industry admin@회사도메인») — sec.gov가 연락처 없는 요청을 403으로 막는다'
  for (const m of managers) {
    if (!m.sec_cik) continue
    const sid = `sec13f:${m.manager_id}`
    if (!ua.configured) {
      const s0 = src(sid)
      await sink.markSource(sid, { status: s0?.last_success_at ? s0.status : 'UNAVAILABLE', status_note: UA_NEEDED })
      steps.push({ step: `13F ${m.name}`, ok: false, calls: 0, note: UA_NEEDED })
      continue
    }
    await step(`13F ${m.name}`, sid, async () => {
      const refs = await listFilings(http, m.sec_cik!)
      const periods = [...new Set(refs.map((r) => r.report_date))].sort().reverse().slice(0, opts.quarters ?? 5)
      const have = new Set((await sink.disclosures(sid)).map((d) => d.doc_key))
      const todo = refs.filter((r) => periods.includes(r.report_date) && !have.has(r.accession)).sort((a, b) => a.filing_date.localeCompare(b.filing_date))
      let added = 0
      for (const ref of todo) {
        if (timeLeft() <= 20_000) break
        const f = await fetchFiling(http, m.sec_cik!, ref)
        const positions: NewPosition[] = f.entries.map((e, i) => ({
          line_no: i + 1,
          holding_key: e.cusip,
          issuer_name: e.issuer,
          title_of_class: e.title_of_class,
          cusip: e.cusip,
          isin: null,
          ticker: null,
          security_id: null,
          shares: e.shares,
          share_type: e.share_type,
          put_call: e.put_call,
          value: e.value,
          value_currency: 'USD',
          ownership_pct: null,
          weight_pct: null,
          country: null,
          sector: null,
          discretion: e.discretion,
        }))
        const total = f.entries.reduce((s, e) => s + e.value, 0)
        for (const p of positions) p.weight_pct = total > 0 && p.value !== null ? Math.round((p.value / total) * 1e6) / 1e4 : null
        await sink.insertDisclosure(
          {
            manager_id: m.manager_id,
            source_id: sid,
            source_type: 'sec_13f',
            doc_key: ref.accession,
            form: ref.form,
            data_as_of: f.period,
            source_published_at: ref.filing_date,
            source_url: f.index_url,
            is_amendment: f.is_amendment,
            amendment_type: f.amendment_type,
            amends_key: null,
            coverage: '13F 대상 미국 증권만(분기말 기준) — 현금 · 비상장 · 해외 직접 · 공매도 · 일부 파생 제외',
            position_count: positions.length,
            total_value: total,
            currency: 'USD',
            data_quality: filingQuality(f),
            status: f.confidential_omitted ? 'partial' : 'complete',
            is_demo: false,
          },
          positions,
        )
        added += 1
      }
      newDisclosures += added
      const all = await sink.disclosures(sid)
      const latest = all.sort((a, b) => a.data_as_of.localeCompare(b.data_as_of)).at(-1)
      if (latest) await ok(sid, 'LIVE', `최근 기준일 ${latest.data_as_of} · 공개 ${latest.source_published_at ?? '—'} · 쌓인 공시 ${all.length}건`)
      return `새 공시 ${added}건${todo.length > added ? ` · 남은 ${todo.length - added}건은 다음 실행` : ''}`
    })
  }

  // ── 3. NBIM 전체 보유 목록 ──
  await step('NBIM 전체 보유 목록', 'nbim:holdings', async () => {
    const periods = (await listNbimPeriods(http)).slice(0, opts.nbimPeriods ?? 2)
    const have = new Set((await sink.disclosures('nbim:holdings')).map((d) => d.doc_key))
    let added = 0
    for (const p of [...periods].reverse()) {
      const key = `nbim:${p.as_of}`
      if (have.has(key) || timeLeft() <= 30_000) continue
      const rows = await fetchNbimHoldings(http, p)
      const total = rows.reduce((s, r) => s + r.value_usd, 0)
      await sink.insertDisclosure(
        {
          manager_id: 'nbim',
          source_id: 'nbim:holdings',
          source_type: 'nbim_holdings',
          doc_key: key,
          form: p.interim ? `반기(${p.label})` : `연간(${p.label})`,
          data_as_of: p.as_of,
          source_published_at: null,
          source_url: NBIM_PAGE,
          is_amendment: false,
          amendment_type: null,
          amends_key: null,
          coverage: '전체 공개 주식 보유(평가액 · 지분율 · 국가 · 업종) — 주식 수 없음. 공개일은 파일에 없다(처음 확인한 때 = 수집 시각)',
          position_count: rows.length,
          total_value: total,
          currency: 'USD',
          data_quality: 85,
          status: 'complete',
          is_demo: false,
        },
        rows.map((r, i) => ({
          line_no: i + 1,
          holding_key: `nbim:${r.id}`,
          issuer_name: r.name,
          title_of_class: null,
          cusip: null,
          isin: null,
          ticker: r.ticker,
          security_id: null,
          shares: null,
          share_type: null,
          put_call: null,
          value: r.value_usd,
          value_currency: 'USD',
          ownership_pct: r.ownership_pct,
          weight_pct: total > 0 ? Math.round((r.value_usd / total) * 1e8) / 1e6 : null,
          country: r.country,
          sector: r.sector,
          discretion: null,
        })),
      )
      added += 1
    }
    newDisclosures += added
    const latest = (await sink.disclosures('nbim:holdings')).sort((a, b) => a.data_as_of.localeCompare(b.data_as_of)).at(-1)
    if (latest) await ok('nbim:holdings', 'LIVE', `최근 기준일 ${latest.data_as_of} · ${latest.position_count?.toLocaleString('en-US')}종목 · 주식 수 없음(계속 보유는 UNKNOWN)`)
    return `새 기준일 ${added}개`
  })

  // ── 4. 종목 마스터 — 집중투자 기관(13F) 최신 보유 = 관심 후보 · 벤치마크 ──
  let securities = await sink.securities()
  const latestPositions = new Map<string, { manager: InvManager; rows: InvPosition[]; disclosure: InvDisclosure }>()
  await step('종목 마스터', null, async () => {
    const inserts: NewSecurity[] = []
    const byCusip = new Map(securities.filter((s) => s.cusip).map((s) => [s.cusip!, s]))
    const holders = new Map<string, Set<string>>()
    const first = new Map<string, { name: string; url: string; as_of: string; title: string | null }>()
    for (const m of managers) {
      if (!m.sec_cik) continue
      const eff = effectivePeriods(await sink.disclosures(`sec13f:${m.manager_id}`)).at(-1)
      if (!eff) continue
      const rows = await sink.positions(eff.members.map((d) => d.disclosure_id))
      latestPositions.set(m.manager_id, { manager: m, rows, disclosure: eff.primary })
      if (m.style !== 'concentrated') continue
      for (const r of rows) {
        if (!r.cusip || r.put_call || r.share_type === 'PRN') continue
        holders.set(r.cusip, (holders.get(r.cusip) ?? new Set()).add(m.name))
        if (!first.has(r.cusip)) first.set(r.cusip, { name: r.issuer_name, url: eff.primary.source_url, as_of: eff.primary.data_as_of, title: r.title_of_class })
      }
    }
    let updated = 0
    for (const [cusip, who] of holders) {
      const reason = `집중투자 기관 13F 보유 — ${[...who].join(' · ')}`
      const s = byCusip.get(cusip)
      if (!s) {
        const f = first.get(cusip)!
        inserts.push(newSecurity({ kind: /\bETF\b/i.test(`${f.name} ${f.title ?? ''}`) ? 'etf' : 'stock', name: f.name, cusip, source: 'sec13f', source_url: f.url, data_as_of: f.as_of, watch: true, watch_reason: reason }))
      } else if (!s.watch || s.watch_reason !== reason) {
        if (s.watch_reason?.startsWith('대표 지정')) continue
        await sink.updateSecurity(s.security_id, { watch: true, watch_reason: reason })
        updated += 1
      }
    }
    for (const b of BENCHMARKS) {
      if (!securities.some((s) => s.ticker === b.ticker && s.kind === 'etf')) {
        inserts.push(newSecurity({ kind: 'etf', name: b.name, ticker: b.ticker, source: 'seed', source_url: null, watch: false, watch_reason: b.reason }))
      }
    }
    if (inserts.length) await sink.insertSecurities(inserts)
    securities = await sink.securities()
    return `새 종목 ${inserts.length} · 관심 사유 갱신 ${updated} · 관심 후보 ${securities.filter((s) => s.watch).length}`
  })

  // ── 5. OpenFIGI — CUSIP → 티커 · 거래소 · ETF 여부 ──
  await step('OpenFIGI 티커', 'openfigi', async () => {
    const need = securities.filter((s) => s.cusip && !s.figi && s.exchange !== 'UNMAPPED').slice(0, opts.figiPerRun ?? 60)
    if (need.length === 0) {
      if (securities.some((s) => s.figi)) await ok('openfigi', 'LIVE', '모든 관심 종목에 티커가 있다')
      return '할 것 없음'
    }
    const hits = await figiMap(http, need.map((s) => s.cusip!))
    let mapped = 0
    for (const h of hits) {
      const s = need.find((x) => x.cusip === h.cusip)!
      if (!h.figi) {
        await sink.updateSecurity(s.security_id, { exchange: 'UNMAPPED' })
        continue
      }
      await sink.updateSecurity(s.security_id, {
        ticker: h.ticker,
        exchange: h.exchange,
        figi: h.figi,
        kind: h.kind === 'other' ? s.kind : h.kind,
      })
      mapped += 1
    }
    securities = await sink.securities()
    await ok('openfigi', 'LIVE', `티커 연결 ${securities.filter((s) => s.figi).length}/${securities.filter((s) => s.cusip).length}`)
    return `${mapped}/${need.length} 연결`
  })

  // ── 6 · 7. 보유 줄 잇기 · 변화 판정 ──
  await step('변화 판정', null, async () => {
    if (newDisclosures > 0) for (const s of securities) if (s.cusip) await sink.linkPositions(s.cusip, s.security_id)
    const done = await sink.changedDisclosures(CHANGE_VERSION)
    const actions = await sink.corporateActions()
    const covered = new Set(securities.filter((s) => s.prices_checked_at).map((s) => s.security_id))
    let pairs = 0
    let rows = 0
    for (const s of sources.filter((x) => x.kind === 'sec_13f' || x.kind === 'nbim_holdings')) {
      // 품질 50 미만(기밀 처리로 공개 줄이 거의 없는 공시)은 비교에서 뺀다 — 넣으면 전 종목이 EXIT · NEW로 뒤집힌다.
      const eff = effectivePeriods((await sink.disclosures(s.source_id)).filter((d) => (d.data_quality ?? 100) >= COMPARABLE_QUALITY))
      for (let i = Math.max(1, eff.length - 4); i < eff.length; i++) {
        const from = eff[i - 1]
        const to = eff[i]
        if (done.has(to.primary.disclosure_id)) continue
        if (timeLeft() <= 15_000) break
        const prev = await sink.positions(from.members.map((d) => d.disclosure_id))
        const cur = await sink.positions(to.members.map((d) => d.disclosure_id))
        const out = classify({
          manager: s.manager_id!,
          sourceId: s.source_id,
          from: from.primary,
          to: to.primary,
          prev,
          cur,
          basis: s.kind === 'nbim_holdings' ? 'presence' : 'shares',
          splitFactor: splitFactorFor(actions, covered, from.as_of, to.as_of),
        })
        await sink.upsertChanges(out)
        pairs += 1
        rows += out.length
      }
    }
    return `비교 ${pairs}쌍 · ${rows}줄`
  })

  // ── 8. 13F 파생 분기말 가격(평가액 ÷ 주식 수) ──
  await step('13F 파생 가격', 'prices:sec13f', async () => {
    const universe = securities.filter((s) => s.cusip && s.watch)
    const want = new Set(universe.map((s) => s.cusip!))
    const byKey = new Map<string, { rows: InvPosition[]; url: string }>()
    for (const m of managers) {
      if (!m.sec_cik) continue
      for (const eff of effectivePeriods(await sink.disclosures(`sec13f:${m.manager_id}`))) {
        const rows = (latestPositions.get(m.manager_id)?.disclosure.disclosure_id === eff.primary.disclosure_id
          ? latestPositions.get(m.manager_id)!.rows
          : await sink.positions(eff.members.map((d) => d.disclosure_id))
        ).filter((r) => r.cusip && want.has(r.cusip))
        for (const r of rows) {
          const k = `${r.cusip}|${eff.as_of}`
          const cur = byKey.get(k) ?? { rows: [], url: eff.primary.source_url }
          cur.rows.push(r)
          byKey.set(k, cur)
        }
      }
    }
    let points = 0
    for (const s of universe) {
      const rows: InvPrice[] = []
      for (const [k, v] of byKey) {
        const [cusip, as_of] = k.split('|')
        if (cusip !== s.cusip) continue
        const p = impliedPrice(v.rows)
        if (p !== null) rows.push({ d: as_of, close: Math.round(p * 10000) / 10000, adj_close: null, volume: null, source: 'sec13f_implied', source_url: v.url })
      }
      if (rows.length) {
        await sink.upsertPrices(s.security_id, rows)
        points += rows.length
      }
    }
    if (points > 0 || src('prices:sec13f')?.last_success_at) await ok('prices:sec13f', 'PARTIAL', `분기말 파생 가격 ${points}점 — 일별 주가는 Twelve Data 키 필요`)
    else await sink.markSource('prices:sec13f', { status: 'UNAVAILABLE', status_note: '13F 보유 종목이 아직 없음(13F 수집 뒤)' })
    return `${points}점`
  })

  // ── 9. XBRL 재무 ──
  await step('XBRL 재무', 'sec:xbrl', async () => {
    const stocks = securities.filter((s) => s.watch && s.kind === 'stock' && s.ticker)
    if (!ua.configured) {
      await sink.markSource('sec:xbrl', { status: src('sec:xbrl')?.last_success_at && securities.some((s) => s.facts_checked_at) ? 'LIVE' : 'UNAVAILABLE', status_note: UA_NEEDED })
      return UA_NEEDED
    }
    if (stocks.length === 0) {
      await sink.markSource('sec:xbrl', { status: 'UNAVAILABLE', status_note: '관심 종목(13F 보유)이 아직 없음' })
      return '관심 종목 없음'
    }
    if (stocks.some((s) => !s.cik)) {
      const map = await fetchTickerMap(http)
      for (const s of stocks) {
        const cik = s.cik ? null : map.get(normTicker(s.ticker!))
        if (cik) {
          await sink.updateSecurity(s.security_id, { cik })
          s.cik = cik
        }
      }
    }
    const due = stocks
      .filter((s) => s.cik && (!s.facts_checked_at || s.facts_checked_at.slice(0, 10) < addDays(day, -6)))
      .sort((a, b) => (a.facts_checked_at ?? '').localeCompare(b.facts_checked_at ?? ''))
      .slice(0, opts.xbrlPerRun ?? 6)
    let facts = 0
    for (const s of due) {
      if (timeLeft() <= 20_000) break
      const j = await fetchCompanyFacts(http, s.cik!)
      const rows = factsFromCompanyFacts(j, s.security_id, day)
      await sink.insertFacts(rows)
      // 업종(SIC) — 13F · OpenFIGI에는 없다. SEC 제출 목록 한 번(처음만).
      const sector = s.sector ? null : await http.json<{ sicDescription?: string; stateOfIncorporation?: string }>(`https://data.sec.gov/submissions/CIK${s.cik}.json`, 'sec').catch(() => null)
      await sink.updateSecurity(s.security_id, { facts_checked_at: now().toISOString(), ...(sector?.sicDescription ? { sector: sector.sicDescription } : {}) })
      facts += rows.length
    }
    const withCik = stocks.filter((s) => s.cik).length
    await ok('sec:xbrl', 'LIVE', `CIK 연결 ${withCik}/${stocks.length} · 이번 ${due.length}종목 ${facts}개 값`)
    return `${due.length}종목 · ${facts}개 값`
  })

  // ── 10. Twelve Data 주가 · 분할(키 있을 때만) ──
  await step('주가 · 분할', 'prices:twelvedata', async () => {
    if (!twelveKey()) {
      await sink.markSource('prices:twelvedata', { status: 'UNAVAILABLE', status_note: '키 필요: TWELVEDATA_API_KEY — twelvedata.com 무료 Basic(하루 800 크레딧 · 분당 8회). 키를 넣으면 다음 수집부터 돈다.' })
      return '키 없음 — 건너뜀'
    }
    const due = securities
      .filter((s) => s.ticker && (s.watch || BENCHMARKS.some((b) => b.ticker === s.ticker)) && s.kind !== 'fx')
      .filter((s) => !s.prices_checked_at || s.prices_checked_at.slice(0, 10) < day)
      .sort((a, b) => (a.prices_checked_at ?? '').localeCompare(b.prices_checked_at ?? ''))
      .slice(0, opts.pricesPerRun ?? 10)
    let n = 0
    for (const s of due) {
      if (timeLeft() <= 30_000) break
      const full = !(await sink.lastPriceDate(s.security_id, 'twelvedata'))
      await sink.upsertPrices(s.security_id, await twelvePrices(http, s.ticker!, full))
      if (full || !s.prices_checked_at) await sink.upsertActions(await twelveSplits(http, s.ticker!, s.security_id))
      await sink.updateSecurity(s.security_id, { prices_checked_at: now().toISOString() })
      n += 1
    }
    await ok('prices:twelvedata', 'LIVE', `이번 ${n}종목 · 실행마다 돌려가며 갱신(무료 분당 8회)`)
    return `${n}종목`
  })

  const failed = steps.filter((s) => !s.ok)
  const result = { runId, ok: failed.length === 0, calls: http.calls, steps, newDisclosures }
  await sink.finishRun(runId, {
    ok: result.ok,
    calls: http.calls,
    steps,
    note: failed.length ? `실패 ${failed.length}단계 — ${failed.map((f) => f.step).join(' · ')}` : null,
  })
  return result
}

/** 두 기준일 사이 기록된 분할 비율(누적). 분할 자료를 받은 종목인데 기록이 없으면 1, 자료가 없는 종목이면 null(의심 판정으로). */
export function splitFactorFor(actions: readonly InvCorporateAction[], covered: ReadonlySet<string>, fromAsOf: string, toAsOf: string) {
  return (h: Holding): number | null => {
    if (!h.security_id) return null
    const xs = actions.filter((a) => a.kind === 'split' && a.security_id === h.security_id && a.ex_date > fromAsOf && a.ex_date <= toAsOf && a.ratio)
    if (xs.length) return xs.reduce((f, a) => f * a.ratio!, 1)
    const manual = actions.some((a) => a.security_id === h.security_id && a.source === 'manual')
    return covered.has(h.security_id) || manual ? 1 : null
  }
}

function newSecurity(p: Partial<NewSecurity> & Pick<NewSecurity, 'kind' | 'name' | 'source'>): NewSecurity {
  return {
    ticker: null,
    exchange: null,
    cusip: null,
    isin: null,
    figi: null,
    cik: null,
    currency: 'USD',
    country: null,
    sector: null,
    industry: null,
    etf_issuer: null,
    etf_index: null,
    hedged: null,
    benchmark_ticker: null,
    watch: false,
    watch_reason: null,
    facts_checked_at: null,
    prices_checked_at: null,
    source_url: null,
    data_as_of: null,
    is_demo: false,
    ...p,
  }
}

async function ensureSecurity(sink: CollectorSink, p: Pick<NewSecurity, 'kind' | 'ticker' | 'name' | 'currency' | 'source' | 'source_url'>): Promise<InvSecurity> {
  const found = (await sink.securities()).find((s) => s.kind === p.kind && s.ticker === p.ticker)
  if (found) return found
  await sink.insertSecurities([newSecurity(p)])
  return (await sink.securities()).find((s) => s.kind === p.kind && s.ticker === p.ticker)!
}

export type { InvChange }

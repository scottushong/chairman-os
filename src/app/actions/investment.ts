'use server'

import { revalidatePath } from 'next/cache'

import { currentUser } from '@/lib/auth/session'
import { kstToday } from '@/lib/chairman-project'
import { DATA_MODE } from '@/lib/env'
import { featureOn } from '@/lib/features-server'
import { aiReasons, aiRunners } from '@/lib/investment/ai-runners'
import { inputsToValuation, runAnalysis } from '@/lib/investment/analyze'
import { collectAsIntegration } from '@/lib/investment/collect/service'
import { computeMetrics } from '@/lib/investment/metrics'
import { DEFAULT_WEIGHTS, type Weights } from '@/lib/investment/scores'
import type { ManualDisclosureInput } from '@/lib/investment/store'
import type { InvForecast, ManagerId, ScenarioInputs } from '@/lib/investment/types'
import { validateInput } from '@/lib/investment/valuation'
import { getRepository } from '@/lib/repository'
import { createSupabaseServerClient } from '@/lib/supabase/server'

/**
 * Investment Intelligence 대표 동작(0094) — 지금 수집 · 손 입력(출처 · 기준일 필수) · 관심 지정 · 설정.
 * 대표만(지정자는 읽기만). 판정은 DB(inv_admin)가 한 번 더 한다. 실거래 · 주문 동작은 없다.
 */

export interface ActionResult {
  ok: boolean
  message: string
}

async function admin(): Promise<ActionResult | null> {
  const user = await currentUser()
  if (!user || user.role !== 'Chairman') return { ok: false, message: '대표만 할 수 있습니다.' }
  if (!(await featureOn(user, 'investment'))) return { ok: false, message: '꺼진 기능입니다.' }
  return null
}

const URL_RE = /^https:\/\/[^\s]{4,500}$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const str = (f: FormData, k: string) => String(f.get(k) ?? '').trim()
const numOrNull = (v: string) => {
  if (!v) return null
  const n = Number(v.replace(/[,\s$%]/g, ''))
  return Number.isFinite(n) ? n : NaN
}

export async function investmentCollectNow(): Promise<ActionResult> {
  const denied = await admin()
  if (denied) return denied
  if (DATA_MODE === 'dummy') return { ok: false, message: 'dummy 모드 — 화면은 스냅숏(scripts/gen-investment-fixture.ts)을 읽습니다.' }
  try {
    const out = await collectAsIntegration('manual', 240_000)
    revalidatePath('/investment', 'layout')
    const failed = out.steps.filter((s) => !s.ok)
    return {
      ok: out.ok,
      message: `수집 ${out.ok ? '완료' : '일부 실패'} — 호출 ${out.calls}회 · 새 공시 ${out.newDisclosures}건${failed.length ? ` · 실패: ${failed.map((s) => `${s.step}(${s.note.slice(0, 60)})`).join(' / ')}` : ''}`,
    }
  } catch (e) {
    return { ok: false, message: `수집 계정으로 시작하지 못했습니다: ${e instanceof Error ? e.message.slice(0, 120) : '알 수 없음'}` }
  }
}

export async function investmentSetWatch(securityId: string, watch: boolean, reason: string): Promise<ActionResult> {
  const denied = await admin()
  if (denied) return denied
  const r = reason.trim()
  if (watch && r.length < 2) return { ok: false, message: '관심 사유를 적습니다.' }
  const repo = await getRepository()
  await repo.invSetWatch(securityId, watch, watch ? `대표 지정 — ${r}` : `대표 해제 — ${r || '사유 없음'}`)
  revalidatePath('/investment', 'layout')
  return { ok: true, message: watch ? '관심 종목으로 지정했습니다.' : '관심 종목에서 뺐습니다.' }
}

/** 분할 손 입력 — 판정의 분할 보정에 바로 쓰인다(다음 수집에서 다시 판정). */
export async function investmentAddSplit(_: ActionResult | null, f: FormData): Promise<ActionResult> {
  const denied = await admin()
  if (denied) return denied
  const security_id = str(f, 'security_id')
  const ex_date = str(f, 'ex_date')
  const ratio = numOrNull(str(f, 'ratio'))
  const source_url = str(f, 'source_url')
  if (!DATE_RE.test(ex_date)) return { ok: false, message: '분할 기준일(YYYY-MM-DD)을 적습니다.' }
  if (ratio === null || !Number.isFinite(ratio) || ratio <= 0) return { ok: false, message: '비율(새 주식 수 ÷ 옛 주식 수, 예: 2:1 → 2)을 적습니다.' }
  if (!URL_RE.test(source_url)) return { ok: false, message: '출처 주소(https://…)가 필요합니다 — 공식 공시 · IR 자료.' }
  const repo = await getRepository()
  await repo.invAddAction({ security_id, ex_date, kind: 'split', ratio, amount: null, currency: null, source_url })
  revalidatePath(`/investment/securities/${security_id}`)
  return { ok: true, message: `분할 ${ex_date} ×${ratio} 기록 — 다음 수집에서 보유 변화를 다시 판정합니다.` }
}

const METRICS = ['expense_ratio', 'aum_usd', 'tracking_error', 'distribution_yield', 'index_return_1y', 'etf_return_1y'] as const

/** ETF 지표 손 입력(총보수 · AUM · 추적오차 · 분배금 · 기초지수 대비) — 운용사 공식 자료 출처 · 기준일 필수. */
export async function investmentAddMetric(_: ActionResult | null, f: FormData): Promise<ActionResult> {
  const denied = await admin()
  if (denied) return denied
  const security_id = str(f, 'security_id')
  const metric = str(f, 'metric') as (typeof METRICS)[number]
  const value = numOrNull(str(f, 'value'))
  const as_of = str(f, 'as_of')
  const source_url = str(f, 'source_url')
  if (!METRICS.includes(metric)) return { ok: false, message: '지표를 고릅니다.' }
  if (value === null || !Number.isFinite(value)) return { ok: false, message: '숫자를 적습니다.' }
  if (!DATE_RE.test(as_of)) return { ok: false, message: '기준일(YYYY-MM-DD)을 적습니다.' }
  if (!URL_RE.test(source_url)) return { ok: false, message: '출처 주소(https://…)가 필요합니다 — 운용사 공식 자료.' }
  const repo = await getRepository()
  await repo.invAddMetric({ security_id, metric, value, text_value: null, unit: metric === 'aum_usd' ? 'USD' : '%', as_of, source_type: 'manual_official', source_url, note: null })
  revalidatePath(`/investment/securities/${security_id}`)
  return { ok: true, message: '저장했습니다.' }
}

/** 자동 수집이 막힌 공식 자료(Fundsmith Factsheet · Pershing 사이트)의 공개 보유 손 입력. 줄: «이름 | 티커 | 비중% | 주식 수» */
export async function investmentManualHoldings(_: ActionResult | null, f: FormData): Promise<ActionResult> {
  const denied = await admin()
  if (denied) return denied
  const source_id = str(f, 'source_id') as ManualDisclosureInput['source_id']
  const manager_id = (source_id === 'fundsmith:factsheet' ? 'fundsmith' : source_id === 'pershing:site' ? 'pershing' : str(f, 'manager_id')) as ManagerId
  const data_as_of = str(f, 'data_as_of')
  const published = str(f, 'source_published_at')
  const source_url = str(f, 'source_url')
  if (!['fundsmith:factsheet', 'pershing:site'].includes(source_id)) return { ok: false, message: '자료를 고릅니다.' }
  if (!DATE_RE.test(data_as_of)) return { ok: false, message: '자료 기준일(YYYY-MM-DD)을 적습니다.' }
  if (published && !DATE_RE.test(published)) return { ok: false, message: '공개일은 YYYY-MM-DD(모르면 비움).' }
  if (!URL_RE.test(source_url)) return { ok: false, message: '출처 주소(https://…)가 필요합니다.' }
  const rows: ManualDisclosureInput['rows'] = []
  for (const line of str(f, 'rows').split(/\r?\n/).map((l) => l.trim()).filter(Boolean)) {
    const [name, ticker, weight, sh] = line.split('|').map((x) => x.trim())
    if (!name) continue
    const w = numOrNull(weight ?? '')
    const s = numOrNull(sh ?? '')
    if (Number.isNaN(w) || Number.isNaN(s)) return { ok: false, message: `숫자를 읽지 못한 줄: ${line.slice(0, 60)}` }
    rows.push({ issuer_name: name.slice(0, 200), ticker: ticker ? ticker.toUpperCase().slice(0, 20) : null, weight_pct: w, shares: s, value: null })
  }
  if (rows.length === 0) return { ok: false, message: '보유 줄이 없습니다(줄마다 «이름 | 티커 | 비중% | 주식 수»).' }
  const repo = await getRepository()
  await repo.invManualDisclosure({
    manager_id,
    source_id,
    data_as_of,
    source_published_at: published || null,
    source_url,
    coverage: source_id === 'fundsmith:factsheet' ? 'Factsheet 공개 상위 보유만(손 입력)' : '공식 사이트 공개 포지션만(손 입력)',
    rows,
  })
  revalidatePath('/investment', 'layout')
  return { ok: true, message: `${rows.length}줄을 기준일 ${data_as_of}로 저장했습니다.` }
}

export async function investmentSaveSettings(_: ActionResult | null, f: FormData): Promise<ActionResult> {
  const denied = await admin()
  if (denied) return denied
  const n = (k: string) => Number(str(f, k))
  const patch = {
    collect_daily_limit: n('collect_daily_limit'),
    data_quality_min: n('data_quality_min'),
    monthly_budget_krw: n('monthly_budget_krw'),
  }
  if (!Number.isInteger(patch.collect_daily_limit) || patch.collect_daily_limit < 50 || patch.collect_daily_limit > 5000) return { ok: false, message: '하루 호출 한도는 50~5000.' }
  if (!Number.isInteger(patch.data_quality_min) || patch.data_quality_min < 0 || patch.data_quality_min > 100) return { ok: false, message: '데이터 품질 기준은 0~100.' }
  if (!Number.isInteger(patch.monthly_budget_krw) || patch.monthly_budget_krw < 0) return { ok: false, message: '월 투자 예정액은 0 이상 정수(원).' }
  const repo = await getRepository()
  await repo.invSaveSettings(patch)
  revalidatePath('/investment', 'layout')
  return { ok: true, message: '설정을 저장했습니다.' }
}

// ── 0095 AI Investment Engine · Future Markets · Recommendations ──

const ASSUMPTIONS = ['fcf_per_share', 'fcf_cagr', 'exit_multiple', 'required_return', 'margin_of_safety'] as const

/** 시나리오 저장(새 버전 줄 — 고치지 않는다). 가정마다 값 · 출처 · 기준일 · 품질(0~100). FCF/주는 XBRL 값을 기본으로 채워 둔다. */
export async function investmentSaveScenario(_: ActionResult | null, f: FormData): Promise<ActionResult> {
  const denied = await admin()
  if (denied) return denied
  const security_id = str(f, 'security_id')
  const scenario = str(f, 'scenario') as 'bear' | 'base' | 'bull'
  if (!['bear', 'base', 'bull'].includes(scenario)) return { ok: false, message: '시나리오(Bear · Base · Bull)를 고릅니다.' }
  const years = Number(str(f, 'years') || '5')
  if (!Number.isInteger(years) || years < 1 || years > 20) return { ok: false, message: '투자 기간은 1~20년.' }
  const inputs = {} as ScenarioInputs
  for (const k of ASSUMPTIONS) {
    const v = numOrNull(str(f, `${k}_value`))
    if (v === null || Number.isNaN(v)) return { ok: false, message: `${k} 값을 숫자로 적습니다.` }
    const url = str(f, `${k}_source`)
    const asOf = str(f, `${k}_as_of`)
    const q = numOrNull(str(f, `${k}_quality`))
    if (url && !URL_RE.test(url)) return { ok: false, message: `${k} 출처는 https://… 주소.` }
    if (asOf && !DATE_RE.test(asOf)) return { ok: false, message: `${k} 기준일은 YYYY-MM-DD.` }
    if (q !== null && (Number.isNaN(q) || q < 0 || q > 100)) return { ok: false, message: `${k} 품질은 0~100.` }
    inputs[k] = { value: v, source_url: url || null, as_of: asOf || null, quality: q }
  }
  const vi = inputsToValuation(inputs, years, 1)
  const bad = validateInput({ ...vi, price: 1 })
  if (bad) return { ok: false, message: bad }
  const prob = numOrNull(str(f, 'probability'))
  const repo = await getRepository()
  await repo.invAddScenario({
    security_id,
    scenario,
    inputs,
    years,
    probability: prob !== null && !Number.isNaN(prob) ? prob : null,
    probability_is_ai: false,
    premise: str(f, 'premise') || null,
    risk: str(f, 'risk') || null,
    created_kind: 'human',
  })
  await repo.invAudit('scenario.save', 'investment_scenarios', security_id, { scenario, inputs, years })
  revalidatePath('/investment', 'layout')
  return { ok: true, message: `${scenario.toUpperCase()} 시나리오를 새 버전으로 저장했습니다(이전 버전은 그대로 남습니다).` }
}

/** 점수 요소 판단(대표) — 근거 필수. 같은 요소의 최신 줄이 계산에 쓰인다(AI 추정 줄보다 늦으면 판단이 이긴다). */
export async function investmentAddScore(_: ActionResult | null, f: FormData): Promise<ActionResult> {
  const denied = await admin()
  if (denied) return denied
  const subject_type = str(f, 'subject_type') as 'market' | 'company'
  const subject_id = str(f, 'subject_id')
  const factor = str(f, 'factor')
  const score = numOrNull(str(f, 'score'))
  const evidence = str(f, 'evidence')
  const source_url = str(f, 'source_url')
  const as_of = str(f, 'as_of')
  if (!['market', 'company'].includes(subject_type) || !subject_id) return { ok: false, message: '대상이 없습니다.' }
  if (score === null || Number.isNaN(score) || score < 0 || score > 100) return { ok: false, message: '점수는 0~100.' }
  if (evidence.length < 4) return { ok: false, message: '근거를 적습니다(숫자 · 자료).' }
  if (source_url && !URL_RE.test(source_url)) return { ok: false, message: '출처는 https://… 주소.' }
  if (as_of && !DATE_RE.test(as_of)) return { ok: false, message: '기준일은 YYYY-MM-DD.' }
  const repo = await getRepository()
  await repo.invAddScore({ subject_type, subject_id, factor, score, method: 'judgment', raw_value: null, raw_unit: null, evidence, source_url: source_url || null, as_of: as_of || null, data_quality: source_url ? 80 : 60, model_version: null, created_kind: 'human' })
  revalidatePath('/investment', 'layout')
  return { ok: true, message: '점수 입력을 저장했습니다 — 화면을 열 때마다 저장된 입력으로 다시 계산합니다.' }
}

/** 투자 가설 · 근거(대표). CONFIRMED는 공식 문서 출처 · 문서 기준일이 있어야 한다(DB가 한 번 더). «훼손»은 상태 줄. */
export async function investmentAddThesis(_: ActionResult | null, f: FormData): Promise<ActionResult> {
  const denied = await admin()
  if (denied) return denied
  const security_id = str(f, 'security_id') || null
  const manager_id = (str(f, 'manager_id') || null) as ManagerId | null
  const kind = str(f, 'kind') as 'company' | 'manager_reason' | 'invalidation'
  const classification = str(f, 'classification') as 'CONFIRMED' | 'INFERRED' | 'HYPOTHESIS' | 'UNKNOWN'
  const statement = str(f, 'statement')
  const state = str(f, 'state') === 'broken' ? 'broken' : 'active'
  const source_url = str(f, 'source_url')
  const document_date = str(f, 'document_date')
  if (!['company', 'manager_reason', 'invalidation'].includes(kind)) return { ok: false, message: '종류를 고릅니다.' }
  if (!['CONFIRMED', 'INFERRED', 'HYPOTHESIS', 'UNKNOWN'].includes(classification)) return { ok: false, message: '분류를 고릅니다.' }
  if (statement.length < 4) return { ok: false, message: '가설 문장을 적습니다.' }
  if (source_url && !URL_RE.test(source_url)) return { ok: false, message: '출처는 https://… 주소.' }
  if (document_date && !DATE_RE.test(document_date)) return { ok: false, message: '문서 기준일은 YYYY-MM-DD.' }
  if (classification === 'CONFIRMED' && (!source_url || !document_date)) return { ok: false, message: 'CONFIRMED는 공식 문서 출처와 문서 기준일이 있어야 합니다.' }
  const evidence = str(f, 'evidence')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const [label, value, url, asOf] = line.split('|').map((x) => x.trim())
      return { label: label ?? '근거', value_text: value ?? '', source_url: url && URL_RE.test(url) ? url : null, as_of: asOf && DATE_RE.test(asOf) ? asOf : null, created_kind: 'human' as const }
    })
    .filter((e) => e.value_text)
  const repo = await getRepository()
  const id = await repo.invAddThesis({ security_id, manager_id, kind, statement, classification, state, source_url: source_url || null, document_date: document_date || null, model_version: null, created_kind: 'human' }, evidence)
  await repo.invAudit('thesis.add', 'investment_theses', id, { kind, classification, state })
  revalidatePath('/investment', 'layout')
  return { ok: true, message: `가설을 저장했습니다(근거 ${evidence.length}줄${state === 'broken' ? ' · 훼손 표시' : ''}).` }
}

export async function investmentAddMarketData(_: ActionResult | null, f: FormData): Promise<ActionResult> {
  const denied = await admin()
  if (denied) return denied
  const market_id = str(f, 'market_id')
  const publisher = str(f, 'publisher')
  const title = str(f, 'title')
  const url = str(f, 'url')
  const published = str(f, 'published_date')
  const metric = str(f, 'metric') as InvForecast['metric']
  const label = str(f, 'label')
  const year = numOrNull(str(f, 'year'))
  const value = numOrNull(str(f, 'value'))
  const unit = str(f, 'unit')
  const kind = str(f, 'kind') as InvForecast['kind']
  if (!market_id) return { ok: false, message: '산업을 고릅니다.' }
  if (!URL_RE.test(url) || publisher.length < 2 || title.length < 2) return { ok: false, message: '출처(발행처 · 제목 · https 주소)가 필요합니다 — 출처 없는 숫자를 실측으로 넣지 않습니다.' }
  if (published && !DATE_RE.test(published)) return { ok: false, message: '발표일은 YYYY-MM-DD(모르면 비움).' }
  if (!['market_size', 'cagr', 'historical_growth', 'adoption', 'penetration', 'unit_cost', 'profit_pool', 'other'].includes(metric)) return { ok: false, message: '지표를 고릅니다.' }
  if (!['actual', 'forecast'].includes(kind)) return { ok: false, message: '실측 · 전망을 고릅니다.' }
  if (value === null || Number.isNaN(value) || label.length < 2) return { ok: false, message: '지표 이름과 값을 적습니다.' }
  const repo = await getRepository()
  const existing = (await repo.invMarketSources()).find((s) => s.market_id === market_id && s.url === url)
  const source_id = existing?.source_id ?? (await repo.invAddMarketSource({ market_id, publisher, title, url, published_date: published || null, verified: 'manual', note: null }))
  await repo.invAddForecast({ market_id, metric, label, year: year !== null && !Number.isNaN(year) ? year : null, value, unit: unit || null, text_value: null, kind, source_id, note: null })
  revalidatePath('/investment/markets', 'layout')
  return { ok: true, message: '산업 자료를 출처와 함께 저장했습니다.' }
}

export async function investmentSetMarket(securityId: string, marketId: string | null): Promise<ActionResult> {
  const denied = await admin()
  if (denied) return denied
  const repo = await getRepository()
  await repo.invSetSecurityMarket(securityId, marketId)
  revalidatePath('/investment', 'layout')
  return { ok: true, message: marketId ? `산업 ${marketId}로 지정했습니다.` : '산업 지정을 뺐습니다.' }
}

export async function investmentSaveWeights(_: ActionResult | null, f: FormData): Promise<ActionResult> {
  const denied = await admin()
  if (denied) return denied
  const w = Object.fromEntries(Object.keys(DEFAULT_WEIGHTS).map((k) => [k, Number(str(f, k))])) as unknown as Weights
  const sum = (keys: (keyof Weights)[]) => keys.reduce((t, k) => t + w[k], 0)
  if (Object.values(w).some((x) => !Number.isFinite(x) || x < 0 || x > 100)) return { ok: false, message: '가중치는 0~100 숫자.' }
  if (sum(['w_market_demand', 'w_market_profit', 'w_market_adoption', 'w_market_bottleneck', 'w_market_durability']) !== 100) return { ok: false, message: 'Market Score 가중치 합이 100이어야 합니다.' }
  if (sum(['w_leader_share', 'w_leader_moat', 'w_leader_cash', 'w_leader_balance', 'w_leader_mgmt']) !== 100) return { ok: false, message: 'Leader Score 가중치 합이 100이어야 합니다.' }
  if (sum(['w_opp_market', 'w_opp_leader', 'w_opp_valuation', 'w_opp_inst']) !== 100) return { ok: false, message: 'Opportunity 가중치 합이 100이어야 합니다.' }
  const repo = await getRepository()
  await repo.invSaveWeights(w)
  revalidatePath('/investment', 'layout')
  return { ok: true, message: '가중치를 저장했습니다 — 지난 추천은 그 시점 가중치 그대로 남습니다.' }
}

export async function investmentMarkAlertRead(alertId: number): Promise<ActionResult> {
  const denied = await admin()
  if (denied) return denied
  const repo = await getRepository()
  await repo.invMarkAlertRead(alertId)
  revalidatePath('/investment', 'layout')
  return { ok: true, message: '읽음' }
}

/** 지금 분석 — 대표 세션으로 결정론 분석 + (스위치 investment_ai가 켜져 있으면) AI 설명 · 요약(한도 안). */
export async function investmentRunAnalysis(): Promise<ActionResult> {
  const denied = await admin()
  if (denied) return denied
  const user = await currentUser()
  const repo = await getRepository()
  const notes: string[] = []
  const aiOn = DATA_MODE !== 'dummy' && !!user && (await featureOn(user, 'investment_ai'))
  const ai = aiOn ? aiRunners(await createSupabaseServerClient(), notes) : null
  const out = await runAnalysis(repo, { today: kstToday(), nowIso: new Date().toISOString(), explain: ai?.explain ?? null, summarize: ai?.summarize ?? null, maxExplain: 5 })
  revalidatePath('/investment', 'layout')
  return {
    ok: true,
    message: `분석 ${out.analyzed}종목 · 새 추천 버전 ${out.newRecommendations} · 가치평가 ${out.newValuations} · 알림 ${out.alerts} · 브리핑 ${out.brief ? '새로' : '오늘 것 있음'} · AI 설명 ${out.aiExplained}${aiOn ? '' : '(AI 꺼짐)'}${notes.length ? ` · ${[...new Set(notes)].join(' / ')}` : ''}`,
  }
}

/** 기관이 이 종목을 보유한 이유 — AI 추론(INFERRED · HYPOTHESIS · UNKNOWN). 결과는 가설 줄(AI 작성)로 남는다. */
export async function investmentAiReasons(securityId: string, managerId: ManagerId): Promise<ActionResult> {
  const denied = await admin()
  if (denied) return denied
  const user = await currentUser()
  if (DATA_MODE === 'dummy' || !user || !(await featureOn(user, 'investment_ai'))) return { ok: false, message: 'AI DISABLED — 스위치 investment_ai 꺼짐(또는 dummy)' }
  const repo = await getRepository()
  const [sec, phil, facts, prices] = await Promise.all([repo.invSecurity(securityId), repo.invPhilosophy(), repo.invFacts(securityId), repo.invPrices(securityId)])
  if (!sec) return { ok: false, message: '종목이 없습니다.' }
  const m = computeMetrics(facts, prices, null)
  const r = await aiReasons(await createSupabaseServerClient(), {
    manager: managerId,
    philosophy: phil.filter((p) => p.manager_id === managerId).map((p) => p.principle),
    company: { name: sec.name, ticker: sec.ticker, sector: sec.sector },
    metrics: { fy: m.fy?.label, revenue: m.revenue, opMargin: m.opMargin, fcf: m.fcf, roic: m.roic, netDebtToEbitda: m.netDebtToEbitda },
  })
  if (!r.ok) return { ok: false, message: r.message }
  for (const x of r.json.reasons.slice(0, 3)) {
    await repo.invAddThesis({ security_id: securityId, manager_id: managerId, kind: 'manager_reason', statement: x.statement, classification: x.classification, state: 'active', source_url: null, document_date: null, model_version: r.model, created_kind: 'ai' }, [])
  }
  revalidatePath(`/investment/securities/${securityId}`)
  return { ok: true, message: `AI 추론 ${Math.min(3, r.json.reasons.length)}개 저장(비용 약 $${r.usd.toFixed(4)})` }
}

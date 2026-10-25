'use server'

import { revalidatePath } from 'next/cache'

import { currentUser } from '@/lib/auth/session'
import { DATA_MODE } from '@/lib/env'
import { featureOn } from '@/lib/features-server'
import { collectAsIntegration } from '@/lib/investment/collect/service'
import type { ManualDisclosureInput } from '@/lib/investment/store'
import type { ManagerId } from '@/lib/investment/types'
import { getRepository } from '@/lib/repository'

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

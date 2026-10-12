'use server'

import { revalidatePath } from 'next/cache'

import { canCloseBooks, canKeepBooks } from '@/lib/auth/roles'
import { currentUser } from '@/lib/auth/session'
import { featureOn } from '@/lib/features-server'
import { finV21Error, parseValue } from '@/lib/finance-upload/v21-text'
import { getRepository } from '@/lib/repository'
import type { CostScope, FinDedupeSetting, NonProductionKind, RollCategory, ValuationCategory } from '@/types'

/**
 * 0072 «회계 · 재무 v2.1 차이분» 서버 액션 — 재공품 · 완제품 평가금액(저장 · 확정 · 무효) · 첫 달 기초재고 · 원료 출고 일괄 결정 ·
 * 같은 거래 결정 · 기준 출처 · 재마감 대상 풀기. 판정은 DB(0072 RPC)다 — 여기서는 모양만 본다.
 * 값은 고치지 않는다: 빈칸은 «미입력»(null)으로, 0은 «확인된 0»으로만 보낸다.
 */

type Result = { ok?: true; error?: string; n?: number }
const text = (v: unknown, max = 500) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const UUID = /^[0-9a-f-]{36}$/i
const BIZ = /^[a-z0-9_]{2,40}$/
const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/
const DATE = /^\d{4}-\d{2}-\d{2}$/
/** 0073 기능 스위치로 꺼진 기능의 문장. */
const OFF = '지금은 쓸 수 없는 기능입니다.'

function touch(businessId: string) {
  revalidatePath(`/finance/${businessId}/valuation`)
  revalidatePath(`/finance/${businessId}/upload`)
}

/** 줄 id로 오는 동작 — 화면이 보낸 회사가 그 줄의 회사와 같아야 한다(0073 리뷰 I1: 다른 회사 스위치로 우회 금지). */
async function rowGuard(kind: 'valuation' | 'tx_group' | 'reclose', id: string, businessId: string): Promise<string | null> {
  if (!UUID.test(id)) return '줄을 알 수 없습니다.'
  const real = await (await getRepository()).finRowBusiness(kind, id).catch(() => null)
  return real && real === businessId ? null : '줄을 찾지 못했습니다(없거나 볼 권한이 없습니다).'
}

async function guard(businessId: string): Promise<string | null> {
  const user = await currentUser()
  if (!user) return '세션이 만료되었습니다. 다시 로그인하세요.'
  if (!BIZ.test(businessId)) return '회사를 알 수 없습니다.'
  if (!canKeepBooks(user, businessId)) return '이 회사의 재무를 넣을 권한이 없습니다.'
  // 0073 기능 스위치 «자료 올리기»(0070 · 0072를 함께 끈다).
  if (!(await featureOn(user, 'finance_upload', businessId))) return OFF
  return null
}

export interface ValuationInput {
  businessId: unknown
  period: unknown
  category: unknown
  amount: unknown
  valuationDate: unknown
  method: unknown
  costScope: unknown
  sourceRef: unknown
  note: unknown
  status: unknown
  reason?: unknown
}

export async function saveValuation(x: ValuationInput): Promise<Result> {
  const businessId = text(x.businessId, 40)
  const denied = await guard(businessId)
  if (denied) return { error: denied }
  const period = text(x.period, 7)
  const category = text(x.category, 10) as ValuationCategory
  const scope = text(x.costScope, 30) as CostScope
  const status = text(x.status, 12) as 'entering' | 'provisional'
  const date = text(x.valuationDate, 10)
  if (!PERIOD.test(period) || !['wip', 'finished'].includes(category) || !['material_only', 'material_labor_overhead'].includes(scope) || !['entering', 'provisional'].includes(status)) {
    return { error: '월 · 구분 · 포함 원가 범위 · 상태를 확인하세요.' }
  }
  if (date && !DATE.test(date)) return { error: '평가 기준일은 YYYY-MM-DD로 적어 주세요.' }
  const v = parseValue(x.amount)
  if (v === 'bad') return { error: '평가금액은 숫자로 적어 주세요(비우면 «미입력», 0은 «확인된 0»).' }
  try {
    await (await getRepository()).finValuationSave({
      business_id: businessId, period, category, amount: v.amount, state: v.state, valuation_date: date || null, method: text(x.method, 60) || null,
      cost_scope: scope, source: 'manual', upload_id: null, source_ref: text(x.sourceRef, 120) || null, note: text(x.note) || null, status, reason: text(x.reason) || null,
    })
    touch(businessId)
    return { ok: true }
  } catch (e) {
    return { error: finV21Error(e) }
  }
}

export async function confirmValuation(valuationId: unknown, businessId: unknown, reason: unknown): Promise<Result> {
  const biz = text(businessId, 40)
  const denied = await guard(biz)
  if (denied) return { error: denied }
  const id = text(valuationId, 64)
  if (!UUID.test(id)) return { error: '평가금액 줄을 알 수 없습니다.' }
  const wrong = await rowGuard('valuation', id, biz)
  if (wrong) return { error: wrong }
  try {
    const ok = await (await getRepository()).finValuationConfirm(id, text(reason) || null)
    touch(biz)
    return ok ? { ok: true } : { error: '이미 확정했거나 무효인 줄입니다.' }
  } catch (e) {
    return { error: finV21Error(e) }
  }
}

export async function voidValuation(valuationId: unknown, businessId: unknown, reason: unknown): Promise<Result> {
  const biz = text(businessId, 40)
  const denied = await guard(biz)
  if (denied) return { error: denied }
  const id = text(valuationId, 64)
  if (!UUID.test(id)) return { error: '평가금액 줄을 알 수 없습니다.' }
  const wrong = await rowGuard('valuation', id, biz)
  if (wrong) return { error: wrong }
  try {
    const ok = await (await getRepository()).finValuationVoid(id, text(reason))
    touch(biz)
    return ok ? { ok: true } : { error: '이미 무효인 줄입니다.' }
  } catch (e) {
    return { error: finV21Error(e) }
  }
}

export async function saveOpening(x: { businessId: unknown; period: unknown; category: unknown; amount: unknown; source: unknown; note: unknown }): Promise<Result> {
  const businessId = text(x.businessId, 40)
  const denied = await guard(businessId)
  if (denied) return { error: denied }
  const period = text(x.period, 7)
  const category = text(x.category, 10) as RollCategory
  const source = text(x.source, 10) as 'manual' | 'statement'
  if (!PERIOD.test(period) || !['raw', 'wip', 'finished'].includes(category)) return { error: '월 · 구분을 확인하세요.' }
  if (!['manual', 'statement'].includes(source)) return { error: '출처를 고르세요(직접 입력 · 재고금액명세서).' }
  const v = parseValue(x.amount)
  if (v === 'bad') return { error: '금액은 숫자로 적어 주세요(비우면 «미입력», 0은 «확인된 0»).' }
  try {
    await (await getRepository()).finOpeningSave({ business_id: businessId, period, category, amount: v.amount, state: v.state, source, upload_id: null, note: text(x.note) })
    touch(businessId)
    return { ok: true }
  } catch (e) {
    return { error: finV21Error(e) }
  }
}

export async function bulkDecideIssue(x: { businessId: unknown; period: unknown; material: unknown; choice: unknown; reason: unknown }): Promise<Result> {
  const businessId = text(x.businessId, 40)
  const denied = await guard(businessId)
  if (denied) return { error: denied }
  const period = text(x.period, 7)
  const material = text(x.material, 200)
  const choice = text(x.choice, 20)
  const kinds: NonProductionKind[] = ['sample', 'scrap', 'return', 'transfer', 'adjust']
  if (!PERIOD.test(period) || !material) return { error: '월 · 원료를 확인하세요.' }
  if (choice !== 'production' && !kinds.includes(choice as NonProductionKind)) return { error: '구분을 고르세요.' }
  try {
    const n = await (await getRepository()).finIssueBulkDecide({
      business_id: businessId, period, material, class: choice === 'production' ? 'production' : 'non_production',
      non_production_kind: choice === 'production' ? null : (choice as NonProductionKind), reason: text(x.reason, 200),
    })
    touch(businessId)
    return { ok: true, n }
  } catch (e) {
    return { error: finV21Error(e) }
  }
}

export async function decideTxGroup(groupId: unknown, businessId: unknown, status: unknown, reason: unknown): Promise<Result> {
  const biz = text(businessId, 40)
  const denied = await guard(biz)
  if (denied) return { error: denied }
  const id = text(groupId, 64)
  const st = text(status, 10)
  if (!UUID.test(id) || (st !== 'same' && st !== 'rejected')) return { error: '묶음 · 결정을 확인하세요.' }
  const wrong = await rowGuard('tx_group', id, biz)
  if (wrong) return { error: wrong }
  try {
    const ok = await (await getRepository()).finTxGroupDecide(id, st, text(reason))
    touch(biz)
    return ok ? { ok: true } : { error: '이미 정한 묶음입니다.' }
  } catch (e) {
    return { error: finV21Error(e) }
  }
}

export async function saveDedupeSetting(businessId: unknown, amountBase: unknown, qtyBase: unknown, reason: unknown): Promise<Result> {
  const biz = text(businessId, 40)
  const denied = await guard(biz)
  if (denied) return { error: denied }
  const a = text(amountBase, 20) as FinDedupeSetting['amount_base']
  const q = text(qtyBase, 20) as FinDedupeSetting['qty_base']
  if (!['ledger', 'tax_invoice', 'r2_ecount'].includes(a) || !['r2_ecount', 'ledger'].includes(q)) return { error: '기준 출처를 고르세요.' }
  try {
    await (await getRepository()).finDedupeSettingSave(biz, { amount_base: a, qty_base: q }, text(reason))
    touch(biz)
    return { ok: true }
  } catch (e) {
    return { error: finV21Error(e) }
  }
}

export async function clearReclose(flagId: unknown, businessId: unknown, note: unknown): Promise<Result> {
  const user = await currentUser()
  if (!user) return { error: '세션이 만료되었습니다. 다시 로그인하세요.' }
  const biz = text(businessId, 40)
  const id = text(flagId, 64)
  if (!BIZ.test(biz) || !UUID.test(id)) return { error: '재마감 대상을 알 수 없습니다.' }
  if (!canCloseBooks(user, biz)) return { error: '그 달을 마감할 수 있는 사람만 풉니다.' }
  if (!(await featureOn(user, 'finance_upload', biz))) return { error: OFF }
  const wrong = await rowGuard('reclose', id, biz)
  if (wrong) return { error: wrong }
  try {
    const ok = await (await getRepository()).finRecloseClear(id, text(note) || null)
    touch(biz)
    return ok ? { ok: true } : { error: '이미 풀린 줄입니다.' }
  } catch (e) {
    return { error: finV21Error(e) }
  }
}

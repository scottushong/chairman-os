'use server'

import { revalidatePath } from 'next/cache'

import { canCloseBooks, canKeepBooks } from '@/lib/auth/roles'
import { currentUser } from '@/lib/auth/session'
import { featureOn } from '@/lib/features-server'
import { plError } from '@/lib/monthly-pl/text'
import { getRepository } from '@/lib/repository'
import type { PlAdjustmentKind, PlMethod, PlRevenueSource } from '@/types'

/**
 * 0075 «월별 손익 — 재고 반영 · 마감» 서버 액션. 판정은 DB(0075 RPC — 기능 스위치 · 장부 권한 · 마감 권한을 다시 본다)이고,
 * 여기서도 같은 문을 먼저 본다(화면만 막지 않는다): 로그인 · 회사 모양 · 권한 · 기능 스위치 'monthly_pl'.
 * 숫자는 고치지 않는다 — 조정은 «보정값 + 사유»를 따로 남기고, 마감은 저장본을 새로 만들 뿐 원천을 바꾸지 않는다.
 */

type Result = { ok?: true; error?: string; n?: number }
const text = (v: unknown, max = 500) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const BIZ = /^[a-z0-9_]{2,40}$/
const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/
const UUID = /^[0-9a-f-]{36}$/i
const OFF = '지금은 쓸 수 없는 기능입니다.'

type Need = 'keep' | 'close' | 'top'

async function guard(businessId: string, need: Need): Promise<string | null> {
  const user = await currentUser()
  if (!user) return '세션이 만료되었습니다. 다시 로그인하세요.'
  if (!BIZ.test(businessId)) return '회사를 알 수 없습니다.'
  if (need === 'keep' && !canKeepBooks(user, businessId)) return '이 회사의 재무를 넣을 권한이 없습니다.'
  if (need === 'close' && !canCloseBooks(user, businessId)) return '이 회사의 월을 마감할 권한이 없습니다.'
  if (need === 'top' && user.role !== 'Chairman' && user.role !== 'GroupCFO') return '대표 · 그룹 CFO만 할 수 있습니다.'
  if (!(await featureOn(user, 'monthly_pl', businessId))) return OFF
  return null
}

// 2026-10-20 A5 — 마감 · 조정 · 설정 칸은 재무 현황 «손익계산서» 탭 아래로 옮겼다(예전 /finance/<회사>/monthly는 그 탭으로 넘긴다).
const touch = (businessId: string) => {
  revalidatePath('/finance')
  revalidatePath(`/finance/${businessId}`)
}

/** 잠정 저장(final = false · 장부 쓰기) · 내부 마감 확정(final = true · 마감 권한). */
export async function recordMonthlyPl(x: { businessId: unknown; period: unknown; final: unknown; reason?: unknown }): Promise<Result> {
  const businessId = text(x.businessId, 40)
  const final = x.final === true
  const denied = await guard(businessId, final ? 'close' : 'keep')
  if (denied) return { error: denied }
  const period = text(x.period, 7)
  if (!PERIOD.test(period)) return { error: '달을 YYYY-MM으로 고르세요.' }
  try {
    await (await getRepository()).finPlRecord(businessId, period, final, text(x.reason) || null)
    touch(businessId)
    return { ok: true }
  } catch (e) {
    return { error: plError(e) }
  }
}

/** 다시 열기 — 대표 · 그룹 CFO + 이유. 이후 확정 달은 덮어쓰지 않고 «재마감 대상»으로만 표시된다. */
export async function reopenMonthlyPl(x: { businessId: unknown; period: unknown; reason: unknown }): Promise<Result> {
  const businessId = text(x.businessId, 40)
  const denied = await guard(businessId, 'top')
  if (denied) return { error: denied }
  const period = text(x.period, 7)
  const reason = text(x.reason)
  if (!PERIOD.test(period)) return { error: '달을 YYYY-MM으로 고르세요.' }
  if (reason.length < 2) return { error: '이유를 2자 이상 적어 주세요.' }
  try {
    const n = await (await getRepository()).finPlReopen(businessId, period, reason)
    touch(businessId)
    return { ok: true, n }
  } catch (e) {
    return { error: plError(e) }
  }
}

const KINDS: readonly PlAdjustmentKind[] = ['shrinkage', 'scrap', 'other']

/** 재고 조정 제안(보정값 · 사유) — 장부 쓰기. 승인은 다른 마감 권한자. */
export async function proposePlAdjustment(x: { businessId: unknown; period: unknown; kind: unknown; amount: unknown; reason: unknown }): Promise<Result> {
  const businessId = text(x.businessId, 40)
  const denied = await guard(businessId, 'keep')
  if (denied) return { error: denied }
  const period = text(x.period, 7)
  const kind = text(x.kind, 20) as PlAdjustmentKind
  const raw = text(String(x.amount ?? ''), 30).replace(/[,\s원₩]/g, '')
  const amount = /^-?\d+$/.test(raw) ? Number(raw) : NaN
  const reason = text(x.reason)
  if (!PERIOD.test(period) || !KINDS.includes(kind)) return { error: '달과 조정 종류를 확인하세요.' }
  if (!Number.isSafeInteger(amount) || amount === 0) return { error: '금액은 원 단위 정수로 적어 주세요(0이 아님 · 손실은 양수).' }
  if (reason.length < 2) return { error: '이유를 2자 이상 적어 주세요.' }
  try {
    await (await getRepository()).finPlAdjustPropose({ business_id: businessId, period, kind, amount, reason })
    touch(businessId)
    return { ok: true }
  } catch (e) {
    return { error: plError(e) }
  }
}

/** 조정 승인(마감 권한 · 제안한 사람 아님) · 무효(장부 쓰기 + 이유). 화면이 보낸 회사와 그 줄의 회사가 같아야 한다. */
export async function decidePlAdjustment(x: { adjId: unknown; businessId: unknown; action: unknown; reason?: unknown }): Promise<Result> {
  const businessId = text(x.businessId, 40)
  const action = x.action === 'approve' ? 'approve' : x.action === 'void' ? 'void' : null
  if (!action) return { error: '동작을 알 수 없습니다.' }
  const denied = await guard(businessId, action === 'approve' ? 'close' : 'keep')
  if (denied) return { error: denied }
  const adjId = text(x.adjId, 64)
  if (!UUID.test(adjId)) return { error: '조정 줄을 알 수 없습니다.' }
  const repo = await getRepository()
  const row = await repo.finPlAdjustRow(adjId).catch(() => null)
  if (!row || row.business_id !== businessId) return { error: '조정 줄을 찾지 못했습니다(없거나 볼 권한이 없습니다).' }
  try {
    const ok = await repo.finPlAdjustDecide(adjId, action, text(x.reason) || null)
    touch(businessId)
    return ok ? { ok: true } : { error: '이미 처리된 줄입니다.' }
  } catch (e) {
    return { error: plError(e) }
  }
}

/** 설정 — 대표 · 그룹 CFO + 이유. 평가방법(세무사 확인 뒤 바꾸는 곳) · 대사 허용오차 · 매출 원천 · 원료 대금 항목 규칙. */
export async function savePlSettings(x: {
  businessId: unknown
  method: unknown
  methodConfirmed: unknown
  tolerance: unknown
  revenueSource: unknown
  categories: unknown
  reason: unknown
}): Promise<Result> {
  const businessId = text(x.businessId, 40)
  const denied = await guard(businessId, 'top')
  if (denied) return { error: denied }
  const method = text(x.method, 20) as PlMethod
  const revenue_source = text(x.revenueSource, 20) as PlRevenueSource
  const tol = text(String(x.tolerance ?? ''), 20).replace(/[,\s원]/g, '')
  const tolerance_krw = /^\d+$/.test(tol) ? Number(tol) : NaN
  const payment_categories = text(x.categories, 500).split(/[,·]/).map((c) => c.trim()).filter(Boolean)
  const reason = text(x.reason)
  if (!['monthly_wa', 'statement'].includes(method) || !['books', 'sales_upload'].includes(revenue_source)) return { error: '평가방법 · 매출 원천을 고르세요.' }
  if (!Number.isSafeInteger(tolerance_krw) || tolerance_krw > 1_000_000) return { error: '허용오차는 0원부터 1,000,000원까지 원 단위로 적어 주세요.' }
  if (payment_categories.length < 1 || payment_categories.length > 20) return { error: '원료 대금 항목 규칙을 쉼표로 1~20개 적어 주세요.' }
  if (reason.length < 2) return { error: '이유를 2자 이상 적어 주세요.' }
  try {
    await (await getRepository()).finPlSettingsSave(businessId, { method, method_confirmed: x.methodConfirmed === true, tolerance_krw, revenue_source, payment_categories }, reason)
    touch(businessId)
    return { ok: true }
  } catch (e) {
    return { error: plError(e) }
  }
}

'use server'

import { revalidatePath } from 'next/cache'

import { currentUser } from '@/lib/auth/session'
import { costEngineError } from '@/lib/costs/errors'
import { getRepository } from '@/lib/repository'
import { OVERHEAD_CATEGORIES, type AllocBasis, type Overhead, type OverheadBasis, type OverheadCategory } from '@/types'

/**
 * 원가 엔진 · 원가 관리(0065 비용 마스터 · 배부 기준) Server Action.
 *
 * 권한의 문은 DB다(RLS cost_can costing · cost_alloc_set). 여기서는 입력의 모양을 거르고 DB의 거부를 사람의 말로 바꾼다(lib/costs/errors.ts).
 * BOM은 여기 없다 — 대표 BOM은 actions/bom.ts(대표 BOM 화면만 부른다).
 */

export interface CostsState {
  error?: string
}

const BIZ = /^[a-z0-9_]{1,60}$/
const DATE = /^\d{4}-\d{2}-\d{2}$/

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

function num(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v !== 'string') return null
  const s = v.replace(/,/g, '').trim()
  if (!s) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

function done(businessId: string) {
  revalidatePath(`/costs/${businessId}`)
  revalidatePath(`/sales/${businessId}`)
}

const EXPIRED = { error: '세션이 만료되었습니다. 다시 로그인하세요.' }

export async function addOverheadAction(input: Record<string, unknown>): Promise<CostsState & { overhead?: Overhead }> {
  const businessId = str(input.businessId, 60)
  if (!BIZ.test(businessId)) return { error: '어느 회사인지 알 수 없습니다.' }
  const category = input.category as OverheadCategory
  if (!OVERHEAD_CATEGORIES.includes(category)) return { error: '항목을 고르세요.' }
  const basis = input.basis as OverheadBasis
  if (basis !== 'monthly' && basis !== 'per_kg') return { error: '방식(월 금액 · 원/kg)을 고르세요.' }
  const amount = num(input.amount)
  if (amount === null || amount < 0 || amount > 1e13) return { error: '금액을 0 이상으로 적으세요(0 = 그 날부터 없음).' }
  // 월 금액은 1원 단위, 원/kg는 소수 둘째 자리까지.
  if (basis === 'monthly' ? !Number.isInteger(amount) : Math.round(amount * 100) / 100 !== amount) {
    return { error: basis === 'monthly' ? '월 금액은 원 단위로 적으세요.' : '원/kg는 소수 둘째 자리까지 적으세요.' }
  }
  const effectiveFrom = str(input.effectiveFrom, 10)
  if (!DATE.test(effectiveFrom)) return { error: '적용 시작일을 고르세요.' }
  const productRaw = str(input.productId, 70)
  const productId = basis === 'per_kg' && /^prd_[a-z0-9_]{4,60}$/.test(productRaw) ? productRaw : null
  const user = await currentUser()
  if (!user) return EXPIRED
  try {
    const overhead = await (await getRepository()).addOverhead(businessId, {
      category,
      basis,
      amount,
      product_id: productId,
      effective_from: effectiveFrom,
      note: str(input.note, 300),
    })
    done(businessId)
    return { overhead }
  } catch (e) {
    console.error('[costs] overhead', e instanceof Error ? e.message : String(e))
    return { error: costEngineError(e, user.role === 'Chairman') }
  }
}

export async function voidOverheadAction(businessId: string, overheadId: number, reason: string): Promise<CostsState> {
  if (!BIZ.test(businessId) || !Number.isSafeInteger(overheadId)) return { error: '어느 줄인지 알 수 없습니다.' }
  const why = typeof reason === 'string' ? reason.trim().slice(0, 300) : ''
  if (!why) return { error: '무효 이유를 적으세요.' }
  const user = await currentUser()
  if (!user) return EXPIRED
  try {
    await (await getRepository()).voidOverhead(businessId, overheadId, why)
    done(businessId)
    return {}
  } catch (e) {
    console.error('[costs] overhead void', e instanceof Error ? e.message : String(e))
    return { error: costEngineError(e, user.role === 'Chairman') }
  }
}

export async function setAllocAction(input: Record<string, unknown>): Promise<CostsState> {
  const businessId = str(input.businessId, 60)
  if (!BIZ.test(businessId)) return { error: '어느 회사인지 알 수 없습니다.' }
  const basis = input.basis as AllocBasis
  if (basis !== 'trailing' && basis !== 'plan') return { error: '배부 기준을 고르세요.' }
  const windowDays = num(input.windowDays)
  if (windowDays === null || !Number.isInteger(windowDays) || windowDays < 7 || windowDays > 365) return { error: '기간은 7~365일로 적으세요.' }
  const planned = num(input.plannedKgMonth)
  if (planned !== null && (planned <= 0 || planned > 1e12)) return { error: '월 계획 생산량(kg)은 0보다 크게 적으세요.' }
  if (basis === 'plan' && planned === null) return { error: '계획 기준이면 월 계획 생산량(kg)을 적으세요.' }
  const user = await currentUser()
  if (!user) return EXPIRED
  try {
    await (await getRepository()).setAllocSettings(businessId, basis, windowDays, planned)
    done(businessId)
    return {}
  } catch (e) {
    console.error('[costs] alloc', e instanceof Error ? e.message : String(e))
    return { error: costEngineError(e, user.role === 'Chairman') }
  }
}

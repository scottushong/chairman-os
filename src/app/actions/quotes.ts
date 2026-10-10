'use server'

import { revalidatePath } from 'next/cache'

import { currentUser } from '@/lib/auth/session'
import { getRepository } from '@/lib/repository'
import { salesCostError } from '@/lib/sales/cost'
import { QUOTE_CURRENCIES } from '@/types'

/**
 * 0066 견적 — 저장 · 대표 승인 요청 · 확정 · 취소. 판정 · 스냅숏 · 결재선 · 감사는 DB 함수(quote_*)가 한다.
 * 여기서는 모양만 거르고 거부를 사람 말로 바꾼다(lib/sales/cost.ts salesCostError). 원가 · 원료는 받지 않는다.
 */
type Result = { id?: string; error?: string }

const ID = /^qt_[a-z0-9]{6,40}$/
const num = (v: unknown) => {
  const s = typeof v === 'string' ? v.replace(/,/g, '').trim() : v
  return typeof s === 'number' ? s : typeof s === 'string' && s !== '' ? Number(s) : NaN
}

function refresh(businessId: string, quoteId?: string) {
  revalidatePath(`/sales/${businessId}/quotes`)
  if (quoteId) revalidatePath(`/sales/${businessId}/quotes/${quoteId}`)
}

export async function createQuoteAction(input: {
  businessId: unknown
  productId: unknown
  customerName: unknown
  customerCompany: unknown
  kg: unknown
  price: unknown
  currency: unknown
  validUntil: unknown
  parentId: unknown
}): Promise<Result> {
  const businessId = typeof input.businessId === 'string' ? input.businessId : ''
  const productId = typeof input.productId === 'string' ? input.productId.trim() : ''
  const kg = num(input.kg)
  const price = num(input.price)
  const currency = typeof input.currency === 'string' ? input.currency : ''
  const validUntil = typeof input.validUntil === 'string' ? input.validUntil : ''
  const parentId = typeof input.parentId === 'string' && ID.test(input.parentId) ? input.parentId : null
  if (!/^prd_[a-z0-9_]{4,60}$/.test(productId)) return { error: '제품을 고르세요.' }
  if (!Number.isFinite(kg) || !Number.isFinite(price) || !Number.isInteger(price) || !(QUOTE_CURRENCIES as readonly string[]).includes(currency) || !/^\d{4}-\d{2}-\d{2}$/.test(validUntil)) {
    return { error: salesCostError('quote_invalid') }
  }
  if (!(await currentUser())) return { error: '세션이 만료되었습니다. 다시 로그인하세요.' }
  try {
    const id = await (await getRepository()).createQuote({
      product_id: productId,
      customer_name: String(input.customerName ?? ''),
      customer_company: String(input.customerCompany ?? ''),
      kg,
      price_krw_per_kg: price,
      currency,
      valid_until: validUntil,
      parent_id: parentId,
    })
    refresh(businessId, parentId ?? undefined)
    return { id }
  } catch (e) {
    console.error('[createQuoteAction]', e instanceof Error ? e.message : String(e))
    return { error: salesCostError(e) }
  }
}

async function act(businessId: unknown, quoteId: unknown, what: 'request' | 'confirm' | 'cancel'): Promise<Result> {
  const biz = typeof businessId === 'string' ? businessId : ''
  const id = typeof quoteId === 'string' && ID.test(quoteId) ? quoteId : ''
  if (!id) return { error: '어느 견적인지 알 수 없습니다.' }
  if (!(await currentUser())) return { error: '세션이 만료되었습니다. 다시 로그인하세요.' }
  try {
    const repo = await getRepository()
    const out = what === 'request' ? await repo.requestQuoteApproval(id) : what === 'confirm' ? await repo.confirmQuote(id) : await repo.cancelQuote(id)
    refresh(biz, id)
    return { id: typeof out === 'string' ? out : id }
  } catch (e) {
    console.error(`[quote ${what}]`, e instanceof Error ? e.message : String(e))
    return { error: salesCostError(e) }
  }
}

export async function requestQuoteApprovalAction(businessId: unknown, quoteId: unknown) {
  return act(businessId, quoteId, 'request')
}
export async function confirmQuoteAction(businessId: unknown, quoteId: unknown) {
  return act(businessId, quoteId, 'confirm')
}
export async function cancelQuoteAction(businessId: unknown, quoteId: unknown) {
  return act(businessId, quoteId, 'cancel')
}

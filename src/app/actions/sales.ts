'use server'

import { currentUser } from '@/lib/auth/session'
import { getRepository } from '@/lib/repository'
import { salesCostError } from '@/lib/sales/cost'
import type { PriceCheck } from '@/types'

/**
 * 영업 원가 — 제시가 확인(0062 cost_price_check). 판정 · 한도(하루 200건) · 감사는 DB가 한다. 여기서는 모양만 거르고
 * 거부를 사람 말로 바꾼다(lib/sales/cost.ts salesCostError). 원료는 받지도 돌려주지도 않는다.
 */
export async function checkPriceAction(input: { productId: unknown; price: unknown }): Promise<{ result?: PriceCheck; error?: string }> {
  const productId = typeof input.productId === 'string' ? input.productId.trim() : ''
  if (!/^prd_[a-z0-9_]{4,60}$/.test(productId)) return { error: '어느 제품인지 알 수 없습니다.' }
  const raw = typeof input.price === 'string' ? input.price.replace(/,/g, '').trim() : input.price
  const price = typeof raw === 'number' ? raw : typeof raw === 'string' && raw !== '' ? Number(raw) : NaN
  if (!Number.isFinite(price) || price <= 0 || price > 1e9) return { error: salesCostError('cost_price_invalid') }
  if (!(await currentUser())) return { error: '세션이 만료되었습니다. 다시 로그인하세요.' }
  try {
    return { result: await (await getRepository()).costPriceCheck(productId, price) }
  } catch (e) {
    console.error('[checkPriceAction]', e instanceof Error ? e.message : String(e))
    return { error: salesCostError(e) }
  }
}

import 'server-only'

import { notFound } from 'next/navigation'

import { canReadPurchasing, canWritePurchasing } from '@/lib/auth/roles'
import { currentUser } from '@/lib/auth/session'
import { getRepository } from '@/lib/repository'

/**
 * 구매 화면 다섯 장의 공통 문. /finance/[business_id]와 같다 — 없는 회사 · 볼 수 없는 회사 · 구매 줄이 없는 사람은 모두 404
 * (있는지 없는지 말하지 않는다). 볼 수 있음 = 대표 또는 '/purchasing/<biz>' · '/costing/<biz>' 줄(안내 — 문은 DB cost_can).
 * 회사 범위(has_business)는 listBusinesses가 이미 자른다.
 */
export async function openPurchasing(businessId: string) {
  const [repo, user] = await Promise.all([getRepository(), currentUser()])
  const business = (await repo.listBusinesses()).find((b) => b.business_id === businessId)
  if (!business || !canReadPurchasing(user, businessId)) notFound()
  return { repo, user: user!, business, canWrite: canWritePurchasing(user, businessId) }
}

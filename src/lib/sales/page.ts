import 'server-only'

import { notFound } from 'next/navigation'

import { canReadSales } from '@/lib/auth/roles'
import { currentUser } from '@/lib/auth/session'
import { getRepository } from '@/lib/repository'

/**
 * 영업 원가 화면의 문. openPurchasing과 같다 — 없는 회사 · 볼 수 없는 회사 · 영업 줄이 없는 사람은 모두 404.
 * 볼 수 있음 = 대표 또는 '/sales/<biz>' · '/costing/<biz>' 줄(안내 — 문은 DB 0062 cost_gate).
 */
export async function openSales(businessId: string) {
  const [repo, user] = await Promise.all([getRepository(), currentUser()])
  const business = (await repo.listBusinesses()).find((b) => b.business_id === businessId)
  if (!business || !canReadSales(user, businessId)) notFound()
  return { repo, user: user!, business }
}

import 'server-only'

import { notFound } from 'next/navigation'

import { canReadCosts, canWriteCosts } from '@/lib/auth/roles'
import { currentUser } from '@/lib/auth/session'
import { getRepository } from '@/lib/repository'

/**
 * 원가 관리 화면의 문. openSales와 같다 — 없는 회사 · 볼 수 없는 회사 · 원가 관리 줄이 없는 사람은 모두 404.
 * 볼 수 있음 = 대표 또는 '/costing/<biz>' 줄(안내 — 문은 DB 0065 · 0062 cost_gate).
 */
export async function openCosts(businessId: string) {
  const [repo, user] = await Promise.all([getRepository(), currentUser()])
  const business = (await repo.listBusinesses()).find((b) => b.business_id === businessId)
  if (!business || !canReadCosts(user, businessId)) notFound()
  return { repo, user: user!, business, canWrite: canWriteCosts(user, businessId) }
}

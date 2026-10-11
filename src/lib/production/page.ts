import 'server-only'

import { notFound } from 'next/navigation'

import { canReadProduction, canWriteProduction } from '@/lib/auth/roles'
import { currentUser } from '@/lib/auth/session'
import { getRepository } from '@/lib/repository'

/**
 * 생산 화면의 문. openPurchasing과 같다 — 없는 회사 · 볼 수 없는 회사 · 생산 줄이 없는 사람은 모두 404.
 * 볼 수 있음 = 대표 또는 '/production/<biz>' 줄(안내 — 문은 DB 0064 RLS · 함수).
 */
export async function openProduction(businessId: string) {
  const [repo, user] = await Promise.all([getRepository(), currentUser()])
  const business = (await repo.listBusinesses()).find((b) => b.business_id === businessId)
  if (!business || !canReadProduction(user, businessId)) notFound()
  return { repo, user: user!, business, canWrite: canWriteProduction(user, businessId) }
}

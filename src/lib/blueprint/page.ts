import 'server-only'

import { notFound } from 'next/navigation'

import { currentUser } from '@/lib/auth/session'
import { getRepository } from '@/lib/repository'
import type { SessionUser } from '@/types'

/**
 * 0081 새 화면의 문 — openCosts와 같은 결(없는 회사 · 볼 수 없는 회사 · 줄이 없는 사람은 모두 404). 원가 관리 줄만 보는 openCosts로는
 * 영업이 볼 카드(제품 진단 ⑤~⑧ · 고객별 본인 판매)가 막혀, 여기서는 «대표 또는 고른 영역 줄 하나»로 연다(안내 — 진짜 문은 0081 RPC).
 */
export type BlueprintArea = 'costing' | 'sales' | 'purchasing' | 'production'

export function hasArea(user: SessionUser | null, businessId: string, areas: readonly BlueprintArea[]): boolean {
  if (!user) return false
  if (user.role === 'Chairman') return true
  if (user.role === 'AIAgent' || user.role === 'Integration') return false
  return areas.some((a) => !!user.cost?.[a]?.[businessId])
}

export async function openBlueprint(businessId: string, areas: readonly BlueprintArea[]) {
  const [repo, user] = await Promise.all([getRepository(), currentUser()])
  const business = (await repo.listBusinesses()).find((b) => b.business_id === businessId)
  if (!business || !user || !hasArea(user, businessId, areas)) notFound()
  return { repo, user, business }
}

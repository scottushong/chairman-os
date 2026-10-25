import 'server-only'

import { notFound, redirect } from 'next/navigation'

import { currentUser } from '@/lib/auth/session'
import { featureOn } from '@/lib/features-server'
import { getRepository } from '@/lib/repository'
import type { SessionUser } from '@/types'

import { canSeeInvestment } from './screen-rules'

export { canSeeInvestment }

/**
 * Investment Intelligence 화면의 문(0094) — 대표 · «/investment» 지정자가 아니면 /me로(화면의 존재를 알리지 않는다 ·
 * CLAUDE.md «대표 전용 기능 숨김»), 스위치 investment가 꺼졌으면 404. 판정은 DB(inv_reader)가 한 번 더 한다.
 */
export async function investmentViewer() {
  const user = await currentUser()
  if (!user) redirect('/login')
  if (!canSeeInvestment(user)) redirect('/me')
  if (!(await featureOn(user, 'investment'))) notFound()
  return { user: user as SessionUser, repo: await getRepository(), admin: user.role === 'Chairman' }
}

/** API 문 — 로그인 없거나 대표 · 지정자가 아니면 403, 스위치 꺼짐 404. */
export async function investmentApiGate(): Promise<{ status: 200; user: SessionUser } | { status: 403 | 404 }> {
  const user = await currentUser()
  if (!user) return { status: 403 }
  if (!canSeeInvestment(user)) return { status: 403 }
  if (!(await featureOn(user, 'investment'))) return { status: 404 }
  return { status: 200, user }
}

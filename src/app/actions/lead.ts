'use server'

import { revalidatePath } from 'next/cache'

import { currentUser } from '@/lib/auth/session'
import { boss } from '@/lib/boss'
import { getRepository } from '@/lib/repository'

/**
 * 팀장 요청함 · 회장 기안(취합) (Phase 6-2, 0042). 판정은 DB다 — 팀장 = 얼린 결재선의 첫 칸.
 */

/** 호칭은 보는 사람에 맞춘다 — 직원 화면 용어 원칙(CLAUDE.md). */
const resultKo = (b: string) =>
  ({
    closed_by_rule: '승인했습니다 — 규칙 판정으로 팀 선에서 종결됐습니다.',
    to_chairman: `승인했습니다 — 규칙 판정으로 ${b} 결재에 올라갔습니다.`,
    rejected: '반려했습니다.',
  }) as const

export async function leadDecideAction(input: { decisionId: unknown; approve: unknown; escalate?: unknown }): Promise<{
  error?: string
  message?: string
}> {
  const user = await currentUser()
  if (!user) return { error: '세션이 만료되었습니다. 다시 로그인하세요.' }
  const id = typeof input.decisionId === 'string' ? input.decisionId : ''
  if (!id) return { error: '요청을 알 수 없습니다.' }
  try {
    const repo = await getRepository()
    const r = await repo.leadDecide(id, input.approve === true, input.escalate === true, { user_id: user.user_id, role: user.role })
    revalidatePath('/me')
    revalidatePath('/approvals')
    const b = boss(user.role)
    return { message: input.escalate === true && r === 'to_chairman' ? `${b} 확인 요청으로 올렸습니다.` : resultKo(b)[r] }
  } catch (e) {
    const m = e instanceof Error ? e.message : ''
    if (/lead_forbidden/.test(m)) return { error: '이 요청의 팀장이 아닙니다.' }
    if (/lead_not_pending/.test(m)) return { error: '이미 처리된 요청입니다.' }
    console.error('[leadDecideAction]', e)
    return { error: '처리하지 못했습니다.' }
  }
}

export async function leadBundleAction(input: { decisionIds: unknown; title: unknown }): Promise<{ error?: string; id?: string }> {
  const user = await currentUser()
  if (!user) return { error: '세션이 만료되었습니다. 다시 로그인하세요.' }
  const ids = Array.isArray(input.decisionIds) ? input.decisionIds.filter((x): x is string => typeof x === 'string') : []
  const title = typeof input.title === 'string' ? input.title.trim() : ''
  if (ids.length < 2) return { error: '두 건 이상 고르세요.' }
  if (!title) return { error: '묶음 제목을 넣으세요.' }
  try {
    const repo = await getRepository()
    const id = await repo.leadBundle(ids, title, { user_id: user.user_id, role: user.role })
    revalidatePath('/me')
    revalidatePath('/approvals')
    return { id }
  } catch (e) {
    const m = e instanceof Error ? e.message : ''
    if (/bundle_mixed_business/.test(m)) return { error: '같은 회사의 요청끼리만 묶을 수 있습니다.' }
    if (/bundle_forbidden/.test(m)) return { error: `내가 승인해 ${boss(user.role)}에게 올린, 아직 열린 요청만 묶을 수 있습니다.` }
    console.error('[leadBundleAction]', e)
    return { error: '묶지 못했습니다.' }
  }
}

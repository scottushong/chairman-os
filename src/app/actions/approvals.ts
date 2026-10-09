'use server'

import { revalidatePath } from 'next/cache'

import { currentUser } from '@/lib/auth/session'
import { boss } from '@/lib/boss'
import { getRepository } from '@/lib/repository'
import type { Role } from '@/types'

/**
 * 0059 단계 결재 처리 — 승인 · 반려(한 건)와 «선택 항목 한 번에 승인».
 *
 * 판정은 DB다(approval_decide · approval_decide_many): 지금 차례인 결재자만, 반려는 사유 필수, 건마다 audit_log · 알림.
 * 여기서는 입력 모양을 보고, DB 오류 키를 사람 말로 바꾸고, 화면을 새로 그린다.
 *
 * 예전 결재(step_chain = false — «팀장 대기» · «대표 대기»)는 이 문을 지나지 않는다 — lead.ts · decisions.ts 그대로.
 */

export interface ApprovalDecideState {
  error?: string
  message?: string
}

const NOTE_MAX = 2000

const RESULT_KO = {
  next: '승인했습니다. 다음 결재자 차례로 넘어갔습니다.',
  approved: '최종 승인했습니다.',
  rejected: '반려했습니다. 올린 사람에게 알림이 갔습니다.',
} as const

/** DB(또는 dummy) 오류 → 사람 말. 호칭은 보는 사람에 맞춘다(직원 화면 용어 원칙). */
function decideError(message: string, role: Role): string | null {
  if (/approval_not_found/.test(message)) return '결재를 찾지 못했습니다. 다른 회사의 결재이거나 지워졌을 수 있습니다.'
  if (/approval_not_pending/.test(message)) return '이미 끝났거나 단계 결재가 아닌 결재입니다. 화면을 새로 고쳐 보세요.'
  if (/approval_not_your_turn/.test(message)) return '지금 내 결재 차례가 아닙니다. 앞 단계가 먼저 처리해야 합니다(대신 처리는 결재자가 떠났거나 회사 접근을 잃었을 때만 됩니다).'
  if (/approval_reason_required/.test(message)) return '반려 사유를 적어 주세요.'
  if (/approval_note_too_long/.test(message)) return `의견은 ${NOTE_MAX.toLocaleString('ko-KR')}자까지 적을 수 있습니다.`
  if (/approval_batch_invalid/.test(message)) return '한 번에 승인할 결재를 1~200건 고르세요.'
  if (/approval_use_steps|approval_closed_frozen/.test(message)) return '이 결재는 결재선 단계로만 처리할 수 있습니다.'
  if (/42501|PGRST301|row-level security/.test(message)) return `처리할 권한이 없습니다. ${boss(role)}에게 문의하세요.`
  return null
}

/** approval_decide_many 오류 끝의 ':<결재 id>'. */
function failedId(message: string): string | null {
  return /:([A-Za-z0-9_-]+)\s*$/.exec(message)?.[1] ?? null
}

function revalidateApprovals() {
  revalidatePath('/approvals')
  revalidatePath('/approvals/ledger')
  revalidatePath('/me')
  revalidatePath('/')
}

export async function approvalDecideAction(input: { decisionId: unknown; approve: unknown; note?: unknown }): Promise<ApprovalDecideState> {
  const user = await currentUser()
  if (!user) return { error: '세션이 만료되었습니다. 다시 로그인하세요.' }
  const id = typeof input.decisionId === 'string' ? input.decisionId.trim() : ''
  if (!id || id.length > 64) return { error: '결재를 알 수 없습니다.' }
  if (typeof input.approve !== 'boolean') return { error: '승인인지 반려인지 알 수 없습니다.' }
  const note = typeof input.note === 'string' ? input.note.trim() : ''
  if (!input.approve && !note) return { error: '반려 사유를 적어 주세요.' }
  if (note.length > NOTE_MAX) return { error: `의견은 ${NOTE_MAX.toLocaleString('ko-KR')}자까지 적을 수 있습니다.` }
  try {
    const repo = await getRepository()
    const r = await repo.approvalDecide(id, input.approve, note || null, { user_id: user.user_id, role: user.role })
    revalidateApprovals()
    return { message: RESULT_KO[r] }
  } catch (e) {
    const m = e instanceof Error ? e.message : ''
    const known = decideError(m, user.role)
    if (known) return { error: known }
    console.error('[approvalDecideAction]', e)
    return { error: '처리하지 못했습니다.' }
  }
}

export async function approvalDecideManyAction(input: { decisionIds: unknown; note?: unknown }): Promise<ApprovalDecideState> {
  const user = await currentUser()
  if (!user) return { error: '세션이 만료되었습니다. 다시 로그인하세요.' }
  const ids = Array.isArray(input.decisionIds)
    ? [...new Set(input.decisionIds.filter((x): x is string => typeof x === 'string' && x.length > 0 && x.length <= 64))]
    : []
  if (ids.length === 0) return { error: '승인할 결재를 고르세요.' }
  if (ids.length > 200) return { error: '한 번에 200건까지 승인할 수 있습니다.' }
  const note = typeof input.note === 'string' ? input.note.trim() : ''
  if (note.length > NOTE_MAX) return { error: `의견은 ${NOTE_MAX.toLocaleString('ko-KR')}자까지 적을 수 있습니다.` }
  try {
    const repo = await getRepository()
    const n = await repo.approvalDecideMany(ids, note || null, { user_id: user.user_id, role: user.role })
    revalidateApprovals()
    return { message: `${n}건을 승인했습니다.` }
  } catch (e) {
    const m = e instanceof Error ? e.message : ''
    // 한 트랜잭션 — 한 건이라도 막히면 전부 되돌아간다. 어느 건이 막았는지 적는다.
    const bad = failedId(m)
    const why = decideError(m, user.role)
    if (bad && why) return { error: `${bad}에서 막혀 한 건도 승인하지 않았습니다 — ${why}` }
    if (why) return { error: why }
    console.error('[approvalDecideManyAction]', e)
    return { error: bad ? `${bad}에서 막혀 한 건도 승인하지 않았습니다.` : '승인하지 못했습니다.' }
  }
}

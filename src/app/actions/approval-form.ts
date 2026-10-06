'use server'

import { revalidatePath } from 'next/cache'

import { approvalState, submitApprovalWith } from '@/lib/approval-submit'
import { currentUser } from '@/lib/auth/session'
import { getRepository } from '@/lib/repository'

/**
 * 양식으로 결재 올리기 (Phase 9 블록 2, /approvals/new).
 *
 * 몸통(검사 · createDecision · 오류 문구)은 lib/approval-submit.ts다 — AI 어시스턴트의 확인 버튼도 이 액션을
 * 그대로 부른다(lib/ai/assistant/execute.ts). 여기는 세션 · repo를 고르고 화면을 새로 그릴 뿐이다.
 *
 * 결재선은 **보내지 않는다.** 0038 트리거가 팀장 → 규칙 판정 → 회장을 새로 만들고 얼린다.
 *
 * 첨부(사내 스토리지 링크) 칸은 2026-10-06에 뺐다 — 첫 직원이 «주소»를 몰라 막혔다. 링크가 필요한 양식은
 * 항목에 «링크»(type 'url', 선택)를 둔다. 형식 검사는 앱이 한다(DB는 fields를 jsonb로만 본다).
 * 파일은 올린 뒤 결재 상세의 «첨부» 칸(0045)에 붙인다.
 */

export interface ApprovalFormState {
  error?: string
  decisionId?: string
  /** 올린 직후 상태 한 마디(«팀장 대기» · «대표 결재 대기» · «기록 완료»). AI 확인 카드가 쓴다. */
  state?: string
}

export async function submitApprovalForm(input: {
  templateKey: unknown
  businessId: unknown
  title: unknown
  deadline: unknown
  form: unknown
}): Promise<ApprovalFormState> {
  const user = await currentUser()
  if (!user) return { error: '세션이 만료되었습니다. 다시 로그인하세요.' }
  const r = await submitApprovalWith(await getRepository(), user, input)
  if (r.error !== undefined) return { error: r.error }
  revalidatePath('/approvals')
  revalidatePath('/groupware')
  revalidatePath('/me')
  revalidatePath('/')
  return { decisionId: r.decision.decision_id, state: approvalState(r.decision, user.role) }
}

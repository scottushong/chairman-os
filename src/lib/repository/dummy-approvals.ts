import { bossChain, CHAIN_ROLES, chainLine } from '@/lib/approval-chain'
import { toChairman } from '@/lib/approval-line'
import type { ApprovalStep, ApprovalStepState, ApprovalTemplate, Decision, UserAccount } from '@/types'

/**
 * 0059 단계 결재의 dummy 거울 — approval_steps 저장소 · 사슬 계산 · approval_decide 판정.
 *
 * 저장소를 globalThis에 둔다 — webpack dev는 Server Action 층과 화면 층이 이 모듈을 따로 읽어 저장소가 둘이 된다
 * (2026-10-07 모듈 권한 · 결재 양식에서 겪은 함정). 판정 문장 · 오류 키는 DB(0059)와 같은 글자다.
 */
const g = globalThis as unknown as { __dummyApprovalSteps?: ApprovalStepState[] }
export const dummySteps: ApprovalStepState[] = (g.__dummyApprovalSteps ??= [])

/** 0059 user_has_business — 그 사람이 그 회사를 볼 수 있는가(살아 있고 · 전사 역할이거나 회사 접근). */
export function personHasBusiness(p: UserAccount | undefined, businessId: string): boolean {
  if (!p || p.revoked_at || p.status !== 'active') return false
  return p.role === 'Chairman' || p.role === 'GroupCFO' || p.business_ids.includes(businessId)
}

/** 0059 approval_ledger_grant — 사람 역할의 '/approvals/ledger/<회사>' 줄. */
export function ledgerGrant(viewer: UserAccount, businessId: string, modules: readonly { module: string }[]): boolean {
  if (viewer.revoked_at || !['GroupCFO', 'BusinessCEO', 'Executive', 'TeamLead', 'Member'].includes(viewer.role)) return false
  return modules.some((m) => m.module === `/approvals/ledger/${businessId}`)
}

export interface ChainSubmit {
  line: ApprovalStep[]
  chairman_required: boolean
  /** 대표 본인이 올린 결재 — 바로 대표 결정으로 닫는다. */
  self_close: boolean
}

/** 0059 decisions_approval_line() INSERT의 사슬 부분 거울. */
export function buildChain(
  template: ApprovalTemplate,
  form: Record<string, string>,
  requester: UserAccount,
  businessId: string,
  people: readonly UserAccount[],
): ChainSubmit {
  if (requester.role === 'Chairman') {
    return { line: [{ step: 'rule', user_id: null, name: '규칙 판정', why: '대표 본인 결재' }], chairman_required: false, self_close: true }
  }
  const chair = people.find((p) => p.role === 'Chairman' && !p.revoked_at)
  if (!chair) throw new Error('approval_no_chairman')
  const bosses = bossChain(requester.user_id, people, (uid) => personHasBusiness(people.find((p) => p.user_id === uid), businessId))
  const line = chainLine(template, form, bosses, { user_id: chair.user_id, name: '대표' }, requester.reports_to === chair.user_id)
  return { line, chairman_required: toChairman(template, form) || bosses.length === 0, self_close: false }
}

/** 올린 순간 단계 칸(decisions_steps_create). */
export function stepsFromLine(decisionId: string, line: readonly ApprovalStep[]): ApprovalStepState[] {
  return line
    .filter((s) => s.step === 'boss' || s.step === 'chairman')
    .map((s, i) => ({
      decision_id: decisionId,
      seq: i + 1,
      approver_user_id: s.user_id ?? '',
      approver_name: s.name,
      why: s.why,
      is_chairman: s.step === 'chairman',
      status: i === 0 ? ('pending' as const) : ('waiting' as const),
      decided_at: null,
      decided_by: null,
      note: null,
    }))
}

export interface DecideOutcome {
  result: 'next' | 'approved' | 'rejected'
  step: ApprovalStepState
  next: ApprovalStepState | null
  proxy: boolean
}

/**
 * 0059 approval_decide()의 차례 판정만 — 아무것도 고치지 않는다. 한 번에 승인의 미리 검사(한 트랜잭션의 거울)와
 * decideStep이 같은 판정을 쓴다. 지금 차례 칸과 대표 대리 여부를 돌려준다.
 */
export function turnCheck(
  d: Decision,
  decisionStatus: Decision['status'],
  viewer: UserAccount,
  people: readonly UserAccount[],
): { step: ApprovalStepState; proxy: boolean } {
  if (viewer.revoked_at || !personHasBusiness(viewer, d.business_id)) throw new Error('approval_not_found')
  // 0059 리뷰 M2 — 결재선 밖 사람에게는 «없는 결재»(대표는 대리 처리가 있어 예외).
  if (viewer.role !== 'Chairman' && !dummySteps.some((s) => s.decision_id === d.decision_id && s.approver_user_id === viewer.user_id)) {
    throw new Error('approval_not_found')
  }
  if (!d.step_chain || decisionStatus !== 'Open') throw new Error('approval_not_pending')
  const step = dummySteps.find((s) => s.decision_id === d.decision_id && s.status === 'pending')
  if (!step) throw new Error('approval_not_pending')
  let proxy = false
  if (step.approver_user_id !== viewer.user_id) {
    const approver = people.find((p) => p.user_id === step.approver_user_id)
    // 떠남 · 회사 접근 잃음 · 사람 역할이 아니게 된 칸만(리뷰 M7 · 재리뷰 Minor 2 — 대표 역할 칸은 가로채지 못한다).
    const human = !!approver && ['Chairman', ...CHAIN_ROLES].includes(approver.role)
    if (viewer.role === 'Chairman' && (!personHasBusiness(approver, d.business_id) || (!step.is_chairman && !human))) proxy = true
    else throw new Error('approval_not_your_turn')
  }
  return { step, proxy }
}

/**
 * 0059 approval_decide()의 거울. decision · dummySteps를 고친다. 오류 키는 DB와 같다.
 * decisionStatus = 지금 상태(dummy는 상태 덮어쓰기 표가 따로 있다).
 */
export function decideStep(
  d: Decision,
  decisionStatus: Decision['status'],
  viewer: UserAccount,
  people: readonly UserAccount[],
  approve: boolean,
  note: string | null,
): DecideOutcome {
  const { step, proxy } = turnCheck(d, decisionStatus, viewer, people)
  const reason = (note ?? '').trim() || null
  if (!approve && !reason) throw new Error('approval_reason_required')
  if ((reason ?? '').length > 2000) throw new Error('approval_note_too_long')
  const now = new Date().toISOString()
  Object.assign(step, { status: approve ? 'approved' : 'rejected', decided_at: now, decided_by: viewer.user_id, note: reason })
  const kind = viewer.role === 'Chairman' ? 'chairman' : ['BusinessCEO', 'Executive', 'TeamLead'].includes(viewer.role) ? 'ceo' : null
  if (!approve) {
    for (const s of dummySteps) if (s.decision_id === d.decision_id && s.status === 'waiting') s.status = 'cancelled'
    Object.assign(d, { status: 'Rejected', decided_at: now, decided_by_kind: kind })
    return { result: 'rejected', step, next: null, proxy }
  }
  const next = dummySteps
    .filter((s) => s.decision_id === d.decision_id && s.status === 'waiting')
    .sort((a, b) => a.seq - b.seq)[0]
  if (next) {
    next.status = 'pending'
    return { result: 'next', step, next, proxy }
  }
  Object.assign(d, { status: 'Approved', decided_at: now, decided_by_kind: kind })
  return { result: 'approved', step, next: null, proxy }
}

/** 0059 트리거의 재상신 판정. */
export function resubmitOk(orig: Decision | undefined, origStatus: Decision['status'] | undefined, requesterId: string, input: { template_key?: string; business_id: string }): boolean {
  return !!orig && orig.created_by === requesterId && origStatus === 'Rejected' && orig.template_key === input.template_key && orig.business_id === input.business_id
}


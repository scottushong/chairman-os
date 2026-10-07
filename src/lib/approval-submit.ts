import { AMOUNT_INVALID_MESSAGE, amountInvalid, missingFields } from '@/lib/approval-line'
import { boss } from '@/lib/boss'
import type { ChairmanRepository } from '@/lib/repository'
import { APPROVAL_TEMPLATE_KEY, DECISION_STATUS_LABEL_KO, type ApprovalChainBoss, type ApprovalTemplate, type ApprovalTemplateKey, type Decision, type SessionUser } from '@/types'

/**
 * 양식으로 결재 올리기의 몸통 — 화면(/approvals/new → app/actions/approval-form.ts)과 AI 어시스턴트의 확인 버튼
 * (lib/ai/assistant/execute.ts → 같은 서버 액션)이 **같은 문**을 지난다. 서버 액션은 세션 · repo를 고르고
 * 화면을 새로 그리는 일만 더한다. 검증(scripts/check-ask.ts)은 이 함수를 dummy repo로 바로 부른다.
 *
 * 결재선은 보내지 않는다. 0059 트리거(dummy는 그 거울)가 조직도 상사 사슬 → (기준 이상이면) 대표를 새로 만들고 얼린다.
 * 여기서 필수 항목을 먼저 보는 이유는 거부가 'approval_form_missing:purpose'로만 오면 직원이 무엇을 채워야
 * 하는지 모르기 때문이다 — 판정은 트리거가 한 번 더 한다.
 *
 * 양식 결재는 선택안이 늘 «승인 / 반려» 둘이다(02_데이터필드: options 필수).
 */

export interface ApprovalSubmitInput {
  templateKey: unknown
  businessId: unknown
  title: unknown
  deadline: unknown
  form: unknown
  /** 0059 재상신 — 반려된 내 결재(같은 양식 · 같은 회사)를 고쳐 다시 올리면 그 원본 id. 판정은 트리거가 한다. */
  resubmitOf?: unknown
}

export type ApprovalSubmitResult = { error: string; decision?: undefined } | { error?: undefined; decision: Decision }

const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
const DATE = /^\d{4}-\d{2}-\d{2}$/

export function isHttpUrl(v: string): boolean {
  if (!/^https?:\/\//i.test(v)) return false
  try {
    new URL(v)
    return true
  } catch {
    return false
  }
}

/** 빈 칸을 걷은 양식 값(모두 문자열). */
export function cleanForm(raw: unknown): Record<string, string> {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return Object.fromEntries(
    Object.entries(obj)
      .map(([k, v]) => [k, typeof v === 'number' ? String(v) : text(v)] as const)
      .filter(([, v]) => v !== ''),
  )
}

/** 저장 전에 사람 말로 먼저 거절할 것. 없으면 null. 화면 · AI 제안 · 실행이 같은 말을 한다. */
export function formProblem(template: ApprovalTemplate, form: Record<string, string>, role: SessionUser['role']): string | null {
  const missing = missingFields(template, form)
  if (missing.length > 0) {
    const labels = template.fields.filter((f) => missing.includes(f.key)).map((f) => f.label_ko)
    return `필수 항목이 비었습니다: ${labels.join(', ')}`
  }
  // 0054 리뷰 C1 — 대표 기준 금액이 있는 양식은 금액이 숫자 모양(AMOUNT_PATTERN)이어야 한다. 화면 · AI 제안 ·
  // 실행이 같은 말을 한다. 판정은 트리거가 한 번 더 한다(approval_amount_invalid).
  if (amountInvalid(template, form)) return AMOUNT_INVALID_MESSAGE
  const badUrl = template.fields.find((f) => f.type === 'url' && form[f.key] && !isHttpUrl(form[f.key]))
  if (badUrl) return `${badUrl.label_ko}은(는) https:// 로 시작하는 주소로 넣으세요.`
  // 옛 설정(0038 시드 — 첨부 필수)이 남아 있으면 DB가 거부한다. 첨부 칸이 화면에 없으니 직원이 고칠 수 없다 —
  // 양식 설정을 저장하면(/settings/approvals) 꺼진다.
  if (template.attachment_required) return `${template.name_ko} 양식 설정이 아직 바뀌지 않았습니다. ${boss(role)}에게 알려 주세요.`
  return null
}

export function approvalTitle(template: ApprovalTemplate, form: Record<string, string>, given: unknown): string {
  const firstText = template.fields.find((f) => f.type === 'text' && form[f.key])
  return text(given).slice(0, 300) || `${template.name_ko}${firstText ? ` · ${form[firstText.key]}` : ''}`
}

/** DB(또는 dummy) 거부 → 사람 말. 0002 decisions_create = 회사 범위 AND «결재 올리기» 권한(user_module_access '/chairman/decisions'). */
export function approvalSubmitError(e: unknown, template: ApprovalTemplate, role: SessionUser['role']): string {
  const message = e instanceof Error ? e.message : ''
  if (/approval_form_missing/.test(message)) return '필수 항목이 비었습니다.'
  if (/approval_amount_invalid/.test(message)) return AMOUNT_INVALID_MESSAGE
  if (/approval_attachment_missing/.test(message)) {
    return `${template.name_ko} 양식 설정이 아직 바뀌지 않았습니다. ${boss(role)}에게 알려 주세요.`
  }
  // 0059 재상신 — 내가 올려 반려된 같은 양식 · 같은 회사 결재만, 원본 한 건에 한 번(decisions_resubmit_once).
  if (/decisions_resubmit_once/.test(message)) return '이 반려 결재는 이미 다시 올렸습니다. 결재 목록에서 재상신한 건을 확인하세요.'
  if (/approval_resubmit_invalid/.test(message)) {
    return '다시 올릴 수 없는 결재입니다. 내가 올려 반려된 결재만, 같은 양식 · 같은 회사로 다시 올릴 수 있습니다.'
  }
  if (/approval_no_chairman/.test(message)) return `결재선을 만들 수 없습니다. ${boss(role)} 계정이 없습니다 — 관리자에게 알려 주세요.`
  if (/42501|PGRST301|row-level security|decisions_create/.test(message)) {
    return `결재를 올릴 권한이 아직 없습니다. ${boss(role)}에게 «결재 올리기» 권한을 켜 달라고 요청하세요.`
  }
  return '결재를 올리지 못했습니다.'
}

/** 결재 한 건의 지금 상태 한 마디 — /me «내 요청»의 requestState와 같은 말(보는 사람에 맞춘 호칭). */
export function approvalState(d: Decision, role: SessionUser['role']): string {
  // 0059 단계 결재 — 지금 차례는 approval_steps에 있다(여기서는 결재 한 줄만 본다). 올린 직후는 첫 칸이 차례다.
  if (d.step_chain && d.status === 'Open') {
    const first = d.approval_line?.find((s) => s.step === 'boss' || s.step === 'chairman')
    if (!first || first.step === 'chairman') return `${boss(role)} 결재 대기`
    return '상사 결재 대기'
  }
  if (d.lead_status === 'pending') return '팀장 대기'
  if (d.status === 'Open' && d.chairman_required) return `${boss(role)} 결재 대기`
  if (d.status === 'Approved' && d.decided_by_kind === 'rule') return '기록 완료'
  return DECISION_STATUS_LABEL_KO[d.status] ?? d.status
}

export async function submitApprovalWith(
  repo: ChairmanRepository,
  user: SessionUser,
  input: ApprovalSubmitInput,
): Promise<ApprovalSubmitResult> {
  const templateKey = text(input.templateKey) as ApprovalTemplateKey
  if (!APPROVAL_TEMPLATE_KEY.includes(templateKey)) return { error: '양식을 고르세요.' }
  const businessId = text(input.businessId)
  if (!businessId) return { error: '회사를 고르세요.' }
  const deadline = text(input.deadline)
  if (!DATE.test(deadline)) return { error: '결재 기한을 넣으세요.' }

  const form = cleanForm(input.form)
  const template = (await repo.listApprovalTemplates()).find((t) => t.template_key === templateKey)
  if (!template) return { error: '양식을 찾지 못했습니다.' }
  const problem = formProblem(template, form, user.role)
  if (problem) return { error: problem }
  const resubmitOf = text(input.resubmitOf)
  if (resubmitOf.length > 64) return { error: '다시 올릴 원본 결재를 알 수 없습니다.' }

  try {
    const decision = await repo.createDecision(
      {
        business_id: businessId,
        title: approvalTitle(template, form, input.title),
        options: ['승인', '반려'],
        impact: 'Medium',
        deadline,
        template_key: templateKey,
        form,
        ...(resubmitOf ? { resubmit_of: resubmitOf } : {}),
      },
      { user_id: user.user_id, role: user.role },
    )
    return { decision }
  } catch (e) {
    console.error('[submitApprovalForm]', e)
    return { error: approvalSubmitError(e, template, user.role) }
  }
}

/** 결재 올리기 미리보기의 상사 사슬 — 회사 하나(0059 my_approval_chain). */
export interface ApprovalChainPreview {
  bosses: ApprovalChainBoss[]
  /**
   * 직속 상사가 대표인가(대표 칸의 문장 «직속 상사(대표)» · «결재할 상사가 없어 대표»가 갈린다).
   * 세션은 reports_to를 모른다 — 사슬이 비고 결재선 첫 칸 후보(my_approval_lead, 대표는 후보가 아님)도 없으면 대표로 본다.
   * 미리보기 문장 하나의 차이이고, 얼리는 값은 트리거가 정한다.
   */
  directBossIsChairman: boolean
}

export async function approvalChainPreview(repo: ChairmanRepository, businessId: string): Promise<ApprovalChainPreview> {
  const [bosses, lead] = await Promise.all([
    repo.myApprovalChain(businessId).catch(() => [] as ApprovalChainBoss[]),
    repo.myApprovalLead().catch(() => null),
  ])
  return { bosses, directBossIsChairman: bosses.length === 0 && lead === null }
}

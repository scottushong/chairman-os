import { AMOUNT_INVALID_MESSAGE, amountInvalid, missingFields } from '@/lib/approval-line'
import { boss } from '@/lib/boss'
import type { ChairmanRepository } from '@/lib/repository'
import { APPROVAL_TEMPLATE_KEY, DECISION_STATUS_LABEL_KO, type ApprovalTemplate, type ApprovalTemplateKey, type Decision, type SessionUser } from '@/types'

/**
 * 양식으로 결재 올리기의 몸통 — 화면(/approvals/new → app/actions/approval-form.ts)과 AI 어시스턴트의 확인 버튼
 * (lib/ai/assistant/execute.ts → 같은 서버 액션)이 **같은 문**을 지난다. 서버 액션은 세션 · repo를 고르고
 * 화면을 새로 그리는 일만 더한다. 검증(scripts/check-ask.ts)은 이 함수를 dummy repo로 바로 부른다.
 *
 * 결재선은 보내지 않는다. 0038 트리거(dummy는 그 거울)가 팀장 → 규칙 판정 → 대표를 새로 만들고 얼린다.
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
  if (/42501|PGRST301|row-level security|decisions_create/.test(message)) {
    return `결재를 올릴 권한이 아직 없습니다. ${boss(role)}에게 «결재 올리기» 권한을 켜 달라고 요청하세요.`
  }
  return '결재를 올리지 못했습니다.'
}

/** 결재 한 건의 지금 상태 한 마디 — /me «내 요청»의 requestState와 같은 말(보는 사람에 맞춘 호칭). */
export function approvalState(d: Decision, role: SessionUser['role']): string {
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
      },
      { user_id: user.user_id, role: user.role },
    )
    return { decision }
  } catch (e) {
    console.error('[submitApprovalForm]', e)
    return { error: approvalSubmitError(e, template, user.role) }
  }
}

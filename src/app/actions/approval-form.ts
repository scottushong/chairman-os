'use server'

import { revalidatePath } from 'next/cache'

import { missingFields } from '@/lib/approval-line'
import { currentUser } from '@/lib/auth/session'
import { getRepository } from '@/lib/repository'
import { APPROVAL_TEMPLATE_KEY, type ApprovalTemplateKey } from '@/types'

/**
 * 양식으로 결재 올리기 (Phase 9 블록 2, /approvals/new).
 *
 * 결재선은 **보내지 않는다.** 0038 트리거가 팀장 → 규칙 판정 → 회장을 새로 만들고 얼린다.
 * 여기서 필수 항목을 먼저 보는 이유는 거부가 'approval_form_missing:purpose'로만 오면 회장님
 * 직원이 무엇을 채워야 하는지 모르기 때문이다 — 판정은 트리거가 한 번 더 한다.
 *
 * 양식 결재는 선택안이 늘 «승인 / 반려» 둘이다. 기존 결재(선택안을 고르는 결재)와 같은 표에
 * 사는 대신 선택안 칸을 비워 둘 수는 없어서다(02_데이터필드: options 필수).
 */

export interface ApprovalFormState {
  error?: string
  decisionId?: string
}

const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
const DATE = /^\d{4}-\d{2}-\d{2}$/

export async function submitApprovalForm(input: {
  templateKey: unknown
  businessId: unknown
  title: unknown
  deadline: unknown
  attachmentUrl: unknown
  form: unknown
}): Promise<ApprovalFormState> {
  const user = await currentUser()
  if (!user) return { error: '세션이 만료되었습니다. 다시 로그인하세요.' }

  const templateKey = text(input.templateKey) as ApprovalTemplateKey
  if (!APPROVAL_TEMPLATE_KEY.includes(templateKey)) return { error: '양식을 고르세요.' }
  const businessId = text(input.businessId)
  if (!businessId) return { error: '회사를 고르세요.' }
  const deadline = text(input.deadline)
  if (!DATE.test(deadline)) return { error: '결재 기한을 넣으세요.' }
  const attachmentUrl = text(input.attachmentUrl)
  if (attachmentUrl && !/^https?:\/\//.test(attachmentUrl)) return { error: '첨부는 사내 스토리지 링크(https://…)만 받습니다.' }

  const raw = (input.form ?? {}) as Record<string, unknown>
  const form: Record<string, string> = Object.fromEntries(
    Object.entries(raw).map(([k, v]) => [k, text(v)]).filter(([, v]) => v !== ''),
  )

  const repo = await getRepository()
  const template = (await repo.listApprovalTemplates()).find((t) => t.template_key === templateKey)
  if (!template) return { error: '양식을 찾지 못했습니다.' }
  const missing = missingFields(template, form)
  if (missing.length > 0) {
    const labels = template.fields.filter((f) => missing.includes(f.key)).map((f) => f.label_ko)
    return { error: `필수 항목이 비었습니다: ${labels.join(', ')}` }
  }
  if (template.attachment_required && !attachmentUrl) return { error: `${template.name_ko} 결재는 첨부 링크가 필요합니다.` }

  const firstText = template.fields.find((f) => f.type === 'text' && form[f.key])
  const title = text(input.title) || `${template.name_ko}${firstText ? ` · ${form[firstText.key]}` : ''}`

  try {
    const decision = await repo.createDecision(
      {
        business_id: businessId,
        title,
        options: ['승인', '반려'],
        impact: 'Medium',
        deadline,
        attachment_url: attachmentUrl || undefined,
        template_key: templateKey,
        form,
      },
      { user_id: user.user_id, role: user.role },
    )
    revalidatePath('/approvals')
    revalidatePath('/groupware')
    revalidatePath('/')
    return { decisionId: decision.decision_id }
  } catch (e) {
    console.error('[submitApprovalForm]', e)
    const message = e instanceof Error ? e.message : ''
    if (/approval_form_missing|approval_attachment_missing/.test(message)) {
      return { error: '필수 항목 또는 첨부가 비었습니다.' }
    }
    if (/42501|PGRST301|row-level security/.test(message)) {
      return { error: '이 회사에 결재를 올릴 권한이 없습니다. (결재 기안 모듈 권한이 필요합니다)' }
    }
    return { error: '결재를 올리지 못했습니다.' }
  }
}

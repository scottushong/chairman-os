'use server'

import { revalidatePath } from 'next/cache'

import { missingFields } from '@/lib/approval-line'
import { currentUser } from '@/lib/auth/session'
import { boss } from '@/lib/boss'
import { getRepository } from '@/lib/repository'
import { APPROVAL_TEMPLATE_KEY, type ApprovalTemplateKey } from '@/types'

/**
 * 양식으로 결재 올리기 (Phase 9 블록 2, /approvals/new).
 *
 * 결재선은 **보내지 않는다.** 0038 트리거가 팀장 → 규칙 판정 → 회장을 새로 만들고 얼린다.
 * 여기서 필수 항목을 먼저 보는 이유는 거부가 'approval_form_missing:purpose'로만 오면 회장님
 * 직원이 무엇을 채워야 하는지 모르기 때문이다 — 판정은 트리거가 한 번 더 한다.
 *
 * 첨부(사내 스토리지 링크) 칸은 2026-10-06에 뺐다 — 첫 직원이 «주소»를 몰라 막혔다. 링크가 필요한 양식은
 * 항목에 «링크»(type 'url', 선택)를 둔다. 형식 검사는 여기서 한다(DB는 fields를 jsonb로만 본다).
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
function isUrl(v: string): boolean {
  if (!/^https?:\/\//i.test(v)) return false
  try {
    new URL(v)
    return true
  } catch {
    return false
  }
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

  const templateKey = text(input.templateKey) as ApprovalTemplateKey
  if (!APPROVAL_TEMPLATE_KEY.includes(templateKey)) return { error: '양식을 고르세요.' }
  const businessId = text(input.businessId)
  if (!businessId) return { error: '회사를 고르세요.' }
  const deadline = text(input.deadline)
  if (!DATE.test(deadline)) return { error: '결재 기한을 넣으세요.' }

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
  const badUrl = template.fields.find((f) => f.type === 'url' && form[f.key] && !isUrl(form[f.key]))
  if (badUrl) return { error: `${badUrl.label_ko}은(는) https:// 로 시작하는 주소로 넣으세요.` }
  // 옛 설정(0038 시드 — 첨부 필수)이 남아 있으면 DB가 거부한다. 첨부 칸이 화면에 없으니 직원이 고칠 수 없다 —
  // 양식 설정을 저장하면(/settings/approvals) 꺼진다.
  if (template.attachment_required) {
    return { error: `${template.name_ko} 양식 설정이 아직 바뀌지 않았습니다. ${boss(user.role)}에게 알려 주세요.` }
  }

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
    if (/approval_form_missing/.test(message)) return { error: '필수 항목이 비었습니다.' }
    if (/approval_attachment_missing/.test(message)) {
      return { error: `${template.name_ko} 양식 설정이 아직 바뀌지 않았습니다. ${boss(user.role)}에게 알려 주세요.` }
    }
    // 0002 decisions_create = 회사 범위 AND «결재 올리기» 권한(user_module_access '/chairman/decisions').
    if (/42501|PGRST301|row-level security/.test(message)) {
      return { error: `결재를 올릴 권한이 아직 없습니다. ${boss(user.role)}에게 «결재 올리기» 권한을 켜 달라고 요청하세요.` }
    }
    return { error: '결재를 올리지 못했습니다.' }
  }
}

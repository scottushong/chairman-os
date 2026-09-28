import type { ApprovalLead, ApprovalStep, ApprovalTemplate } from '@/types'

/**
 * 결재선 미리보기 — "팀장 → (규칙 판정) → 회장"을 **제출 전에** 보여 준다 (Phase 9 블록 2).
 *
 * **판정은 DB다.** 0038 decisions_approval_line() 트리거가 제출 순간 같은 규칙으로 결재선을
 * 새로 적고 얼린다. 이 파일은 그 규칙을 화면에 미리 그리는 거울이다 — 둘이 갈라지면 미리보기가
 * 거짓말을 하므로 문장(why)까지 트리거와 같게 쓴다. scripts/check-migrations.ts가 트리거를,
 * 이 파일은 dummy 어댑터와 화면이 쓴다.
 */

/** 폼의 금액 칸(key='amount')을 숫자로. '6,000,000' · '6000000원'을 같게 읽는다(트리거와 같은 정규식). */
export function formAmount(form: Record<string, string>): number | null {
  const raw = (form.amount ?? '').replace(/[^0-9.]/g, '')
  if (!raw) return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

export function toChairman(template: ApprovalTemplate, form: Record<string, string>): boolean {
  if (template.chairman_always) return true
  const amount = formAmount(form)
  return template.chairman_over !== null && amount !== null && amount >= template.chairman_over
}

export function ruleWhy(template: ApprovalTemplate, form: Record<string, string>): string {
  const amount = formAmount(form)
  if (template.chairman_always) return `${template.name_ko} 양식은 금액과 상관없이 회장 결재`
  if (template.chairman_over === null) return `${template.name_ko} 양식은 회장 규칙 없음`
  const a = amount === null ? '—' : String(amount)
  return toChairman(template, form)
    ? `금액 ${a}원 ≥ 기준 ${template.chairman_over}원`
    : `금액 ${a}원 < 기준 ${template.chairman_over}원`
}

export function approvalLine(
  template: ApprovalTemplate,
  form: Record<string, string>,
  lead: ApprovalLead | null,
  chairman: { user_id: string | null; name: string } = { user_id: null, name: '회장' },
): ApprovalStep[] {
  const steps: ApprovalStep[] = [
    lead
      ? {
          step: 'lead',
          user_id: lead.user_id,
          name: lead.display_name,
          why: lead.via === 'team_lead' ? '팀장' : '팀장 부재 · 직속 상위',
        }
      : { step: 'lead', user_id: null, name: '—', why: '팀장 · 직속 상위가 없음' },
    { step: 'rule', user_id: null, name: '규칙 판정', why: ruleWhy(template, form) },
  ]
  if (toChairman(template, form)) {
    steps.push({ step: 'chairman', user_id: chairman.user_id, name: chairman.name, why: '규칙이 회장까지 올린다' })
  }
  return steps
}

/** 비어 있는 필수 항목의 key. 트리거의 approval_form_missing과 같은 판정. */
export function missingFields(template: ApprovalTemplate, form: Record<string, string>): string[] {
  return template.fields.filter((f) => f.required && !(form[f.key] ?? '').trim()).map((f) => f.key)
}

// scripts/check-migrations.ts가 이 파일을 바로 import한다 — 런타임 import는 상대 경로로 둔다.
import { isChairman } from './boss'
import type { ApprovalLead, ApprovalStep, ApprovalTemplate, Role } from '@/types'

/**
 * 결재선 미리보기 — "팀장 → (규칙 판정) → 회장"을 **제출 전에** 보여 준다 (Phase 9 블록 2).
 *
 * **판정은 DB다.** 0038 decisions_approval_line() 트리거가 제출 순간 같은 규칙으로 결재선을
 * 새로 적고 얼린다. 이 파일은 그 규칙을 화면에 미리 그리는 거울이다 — 둘이 갈라지면 미리보기가
 * 거짓말을 하므로 문장(why)까지 트리거와 같게 쓴다. scripts/check-migrations.ts가 트리거를,
 * 이 파일은 dummy 어댑터와 화면이 쓴다.
 */

/**
 * 금액 칸이 받는 모양 — 0054 트리거의 정규식과 같은 글자. 숫자 · 세 자리 쉼표 · 소수 · 끝의 «원» · 앞뒤 공백만.
 * «600만» · «10억» · «1.000.000»은 받지 않는다 — 숫자만 걸러 읽으면 600 · null · 오류가 되어 기준 미만으로 닫혔다(0054 리뷰 C1).
 */
export const AMOUNT_PATTERN = /^\s*([0-9]+|[0-9]{1,3}(,[0-9]{3})+)(\.[0-9]+)?\s*원?\s*$/

export const AMOUNT_INVALID_MESSAGE = '금액은 숫자로 적어 주세요 — 예: 6000000 또는 6,000,000'

/** 폼의 금액 칸(key='amount')을 숫자로. '6,000,000' · '6000000원'을 같게 읽는다. 모양이 틀리면 null. */
export function formAmount(form: Record<string, string>): number | null {
  const raw = form.amount ?? ''
  if (!AMOUNT_PATTERN.test(raw)) return null
  const n = Number(raw.replace(/[^0-9.]/g, ''))
  return Number.isFinite(n) ? n : null
}

/** 대표 기준 금액이 있는 양식인데 금액이 숫자 모양이 아니다 — 트리거의 approval_amount_invalid와 같은 판정(닫힌 쪽 실패). */
export function amountInvalid(template: ApprovalTemplate, form: Record<string, string>): boolean {
  return template.chairman_over !== null && formAmount(form) === null
}

export function toChairman(template: ApprovalTemplate, form: Record<string, string>): boolean {
  if (template.chairman_always) return true
  const amount = formAmount(form)
  return template.chairman_over !== null && amount !== null && amount >= template.chairman_over
}

export function ruleWhy(template: ApprovalTemplate, form: Record<string, string>): string {
  const amount = formAmount(form)
  if (template.chairman_always) return `${template.name_ko} 양식은 금액과 상관없이 대표 결재`
  if (template.chairman_over === null) return `${template.name_ko} 양식은 대표 규칙 없음`
  const a = amount === null ? '—' : String(amount)
  return toChairman(template, form)
    ? `금액 ${a}원 ≥ 기준 ${template.chairman_over}원`
    : `금액 ${a}원 < 기준 ${template.chairman_over}원`
}

/** 빈 팀장 칸의 문장 — 0054 트리거와 같은 글자. 상사가 대표뿐인 사람에게 «직속 상위가 없음»은 거짓이라 바꿨다. */
export const NO_LEAD_WHY = '팀장 결재 단계 없음'

/** my_approval_lead()가 보는 사람 한 줄의 모양. */
export interface LeadCandidate {
  user_id: string
  display_name: string
  role: Role
  team_id: string | null
  reports_to: string | null
  revoked_at: string | null
  status: string
}

/**
 * 0038/0054 my_approval_lead()의 거울 — dummy 어댑터가 쓴다. 팀장(공석 · 본인 · 떠남이면 reports_to).
 * **대표(Chairman)는 후보가 아니다**(0054) — 팀장이 대표면 reports_to로, reports_to도 대표면 null(팀장 단계 건너뜀).
 * 떠난 사람과 대표는 **고르기 전에** 뺀다 — 고른 뒤에 빼면 reports_to로 넘어가지 못한다(0038 리뷰 지적 3).
 */
export function pickApprovalLead(
  meId: string,
  people: readonly LeadCandidate[],
  teams: readonly { team_id: string; lead_user_id: string | null }[],
): ApprovalLead | null {
  const me = people.find((p) => p.user_id === meId)
  if (!me) return null
  const alive = (id: string | null) => {
    const p = id ? people.find((x) => x.user_id === id) : undefined
    return p && !p.revoked_at && p.status === 'active' && p.role !== 'Chairman' ? p : undefined
  }
  const team = teams.find((t) => t.team_id === me.team_id)
  const lead = team && team.lead_user_id !== me.user_id ? alive(team.lead_user_id) : undefined
  if (lead) return { user_id: lead.user_id, display_name: lead.display_name, via: 'team_lead' }
  const boss = alive(me.reports_to)
  return boss ? { user_id: boss.user_id, display_name: boss.display_name, via: 'reports_to' } : null
}

export function approvalLine(
  template: ApprovalTemplate,
  form: Record<string, string>,
  lead: ApprovalLead | null,
  chairman: { user_id: string | null; name: string } = { user_id: null, name: '대표' },
): ApprovalStep[] {
  const steps: ApprovalStep[] = [
    lead
      ? {
          step: 'lead',
          user_id: lead.user_id,
          name: lead.display_name,
          why: lead.via === 'team_lead' ? '팀장' : '팀장 부재 · 직속 상위',
        }
      : { step: 'lead', user_id: null, name: '—', why: NO_LEAD_WHY },
    { step: 'rule', user_id: null, name: '규칙 판정', why: ruleWhy(template, form) },
  ]
  if (toChairman(template, form)) {
    steps.push({ step: 'chairman', user_id: chairman.user_id, name: chairman.name, why: '규칙이 대표까지 올린다' })
  }
  return steps
}

/**
 * 취합 묶음 제목의 «대표 기안 / 회장 기안»을 보는 사람에 맞춘다 — 직원 화면 용어 원칙(CLAUDE.md).
 * 0049부터 DB는 «대표 기안»으로 적는다. 제목은 사람이 쓴 글이라 bossText처럼 «대표»를 통째로 바꾸지 않고
 * 이 한 낱말만 바꾼다(«VANA 대표 보고»의 대표는 회사 대표다).
 */
export function bundleTitle(title: string, viewer: Role | null | undefined): string {
  return isChairman(viewer) ? title.replace(/대표 기안/g, '회장 기안') : title.replace(/회장 기안/g, '대표 기안')
}

/** 비어 있는 필수 항목의 key. 트리거의 approval_form_missing과 같은 판정. */
export function missingFields(template: ApprovalTemplate, form: Record<string, string>): string[] {
  return template.fields.filter((f) => f.required && !(form[f.key] ?? '').trim()).map((f) => f.key)
}

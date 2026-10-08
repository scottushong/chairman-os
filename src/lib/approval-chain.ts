// scripts/check-migrations.ts가 이 파일을 바로 import한다 — 런타임 import는 상대 경로로 둔다.
import { formAmount, toChairman } from './approval-line'
import type { ApprovalStep, ApprovalTemplate, Role } from '@/types'

/**
 * 0059 단계 결재의 거울 — 조직도 상사 사슬(reports_to) → (기준 이상 · 계약 · 채용이면) 대표.
 *
 * **판정은 DB다.** 0059 decisions_approval_line() 트리거가 올리는 순간 같은 규칙으로 결재선을 새로 적고 얼린다.
 * 이 파일은 결재 올리기 화면의 미리보기와 dummy 어댑터가 쓴다. 문장(why)까지 트리거와 같게 쓴다 —
 * scripts/check-migrations.ts가 둘을 나란히 잰다.
 *
 * 규칙(회장 결정 2026-10-07):
 *   · 기준 금액 미만(금액 규칙 없는 양식 포함) → 직속 상사 한 칸으로 종결.
 *   · 기준 이상 · 늘 대표 양식(계약 · 채용) → 사슬 전부 → 대표 최종.
 *   · 사슬이 비면(상사가 대표뿐이거나 아무도 없음) 대표 한 칸.
 *   · 건너뛰기: 떠남(revoked · left) · 사람 역할 아님 · 그 회사 접근 없음 · 이미 나온 사람. 대표를 만나면 멈춘다.
 */

/** 결재자가 될 수 있는 역할(0059 approval_boss_chain과 같은 목록). */
export const CHAIN_ROLES: readonly Role[] = ['GroupCFO', 'BusinessCEO', 'Executive', 'TeamLead', 'Member']

export interface ChainPerson {
  user_id: string
  display_name: string
  role: Role
  reports_to: string | null
  revoked_at: string | null
  status: string
}

export interface ChainBoss {
  seq: number
  user_id: string
  display_name: string
}

/** 0059 approval_boss_chain(사람, 회사)의 거울. hasBusiness = 그 사람이 그 회사를 볼 수 있는가. */
export function bossChain(
  meId: string,
  people: readonly ChainPerson[],
  hasBusiness: (userId: string) => boolean,
): ChainBoss[] {
  const byId = new Map(people.map((p) => [p.user_id, p]))
  const seen = new Set([meId])
  const out: ChainBoss[] = []
  let cur = byId.get(meId)?.reports_to ?? null
  for (let i = 0; i < 50; i++) {
    if (!cur || seen.has(cur)) break
    seen.add(cur)
    const p = byId.get(cur)
    if (!p || p.role === 'Chairman') break
    if (!p.revoked_at && p.status === 'active' && CHAIN_ROLES.includes(p.role) && hasBusiness(p.user_id)) {
      out.push({ seq: out.length + 1, user_id: p.user_id, display_name: p.display_name })
    }
    cur = p.reports_to
  }
  return out
}

/** 규칙 칸의 문장 — 0059 트리거와 같은 글자. */
export function chainRuleWhy(template: ApprovalTemplate, form: Record<string, string>): string {
  if (template.chairman_always) return `${template.name_ko} 양식은 금액과 상관없이 상사 결재 → 대표 최종 승인`
  if (template.chairman_over === null) return `${template.name_ko} 양식은 직속 상사 승인으로 종결`
  const a = String(formAmount(form) ?? '—')
  return toChairman(template, form)
    ? `금액 ${a}원 ≥ 기준 ${template.chairman_over}원 → 상사 결재 → 대표 최종 승인`
    : `금액 ${a}원 < 기준 ${template.chairman_over}원 → 직속 상사 승인으로 종결`
}

/**
 * 0059 트리거가 얼리는 approval_line의 거울. bosses = bossChain()의 답(대표 앞까지).
 * directBossIsChairman = 올린 사람의 reports_to가 대표인가(대표 칸의 문장이 갈린다).
 */
export function chainLine(
  template: ApprovalTemplate,
  form: Record<string, string>,
  bosses: readonly ChainBoss[],
  chairman: { user_id: string | null; name: string } = { user_id: null, name: '대표' },
  directBossIsChairman = false,
): ApprovalStep[] {
  const up = toChairman(template, form)
  const steps: ApprovalStep[] = (up ? bosses : bosses.slice(0, 1)).map((b, i) => ({
    step: 'boss',
    user_id: b.user_id,
    name: b.display_name,
    why: i === 0 ? '직속 상사' : '상위 상사',
  }))
  if (up || bosses.length === 0) {
    steps.push({
      step: 'chairman',
      user_id: chairman.user_id,
      name: chairman.name,
      why: up ? '대표 최종 승인' : directBossIsChairman ? '직속 상사(대표)' : '결재할 상사가 없어 대표',
    })
  }
  steps.push({ step: 'rule', user_id: null, name: '규칙 판정', why: chainRuleWhy(template, form) })
  return steps
}

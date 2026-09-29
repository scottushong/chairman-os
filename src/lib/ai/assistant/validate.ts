import 'server-only'

import { kstToday } from '@/lib/chairman-project'

import { addEvidence, auditRestrictedRead, INITIATIVE_ROLES, krw, type AssistantTool, type ToolContext } from './kit'

/**
 * «이 화면에 틀린 것 있어?» — 검증은 **코드가 한다.** 모델은 이 목록을 옮겨 말할 뿐이다.
 *
 * 넷을 본다(회장 지시):
 *   ledger_imbalance     전표 한 장(회사 × 전표번호)의 차변 합 ≠ 대변 합
 *   overdue              다음 행동 날짜가 지난 진행 중 이니셔티브 · 마감이 지난 안 끝난 업무 · 마감 지난 대기 결재
 *   missing_required     비어 있으면 안 되는 칸(이니셔티브 목표 · 다음 행동 · 담당 · 목표일 / 결재 선택안 · 마감)
 *   provisional_vs_confirmed  마감 때 전표로 보이던 값(잠정)과 결산(확정)이 다른 칸
 * 범위는 지금 화면이다: 이니셔티브 상세면 그 건, 회사 · 회사 재무면 그 회사, 그 밖에는 볼 수 있는 전부.
 * 재무 둘(전표 · 잠정/확정)은 재무 권한이 있을 때만 잰다 — 없으면 «권한 밖이라 못 쟀다»고 적는다.
 */

interface Finding {
  check: 'ledger_imbalance' | 'overdue' | 'missing_required' | 'provisional_vs_confirmed'
  what: string
  detail: string
  link: string
}

const MAX_PER_CHECK = 15

async function run(ctx: ToolContext) {
  const today = kstToday()
  const s = ctx.screen
  const businessScope = s.kind === 'business' || s.kind === 'finance_business' || s.kind === 'dependency' ? s.id : null
  const initiativeScope = s.kind === 'initiative' ? s.id : null
  const findings: Finding[] = []
  const skipped: string[] = []
  const push = (f: Finding) => {
    if (findings.filter((x) => x.check === f.check).length < MAX_PER_CHECK) findings.push(f)
  }

  // ── 이니셔티브: 지난 다음 행동 · 빈 필수 칸 ──
  if (INITIATIVE_ROLES.has(ctx.user.role) && !businessScope) {
    const list = (await ctx.repo.listInitiatives()).filter((i) => i.status === 'Active' && (!initiativeScope || i.initiative_id === initiativeScope))
    for (const i of list) {
      const link = `/initiatives/${i.initiative_id}`
      if (i.next_action_date && i.next_action_date < today) {
        push({ check: 'overdue', what: `이니셔티브 «${i.title}» 다음 행동`, detail: `${i.next_action || '(내용 없음)'} — ${i.next_action_date} 지남`, link })
      }
      const empty = [
        !i.goal.trim() && '목표',
        !i.next_action.trim() && '다음 행동',
        !i.next_action_owner.trim() && '다음 행동 담당',
        !i.next_action_date && '다음 행동 날짜',
        !i.target_date && '목표일',
      ].filter(Boolean)
      if (empty.length) push({ check: 'missing_required', what: `이니셔티브 «${i.title}»`, detail: `빈 칸: ${empty.join(' · ')}`, link })
    }
  } else if (!INITIATIVE_ROLES.has(ctx.user.role)) {
    skipped.push('이니셔티브(이 계정은 볼 수 없음)')
  }

  // ── 업무 · 결재: 마감 지남 · 빈 필수 칸 ──
  if (!initiativeScope) {
    const [tasks, decisions] = await Promise.all([ctx.repo.listTasks().catch(() => []), ctx.repo.listDecisions().catch(() => [])])
    for (const t of tasks) {
      if (t.status !== 'Done' && t.deadline && t.deadline < today) {
        push({ check: 'overdue', what: `업무 «${t.title}»`, detail: `마감 ${t.deadline} 지남 · 상태 ${t.status}`, link: `/tasks/${t.task_id}` })
      }
    }
    for (const d of decisions.filter((x) => x.status === 'Open' && (!businessScope || x.business_id === businessScope))) {
      const link = `/approvals?id=${d.decision_id}`
      if (d.deadline && d.deadline < today) push({ check: 'overdue', what: `결재 «${d.title}»`, detail: `마감 ${d.deadline} 지남 · 대기 중`, link })
      const empty = [!d.options?.length && '선택안', !d.deadline && '마감일'].filter(Boolean)
      if (empty.length) push({ check: 'missing_required', what: `결재 «${d.title}»`, detail: `빈 칸: ${empty.join(' · ')}`, link })
    }
  }

  // ── 재무 둘: 전표 차대 · 잠정 vs 확정 ──
  if (!initiativeScope) {
    if (!ctx.financeAllowed) {
      skipped.push('전표 차대 · 잠정/확정(재무 권한 밖)')
    } else {
      const ledger = await ctx.repo.loadFinanceLedger()
      const inScope = (b: string) => !businessScope || b === businessScope
      const slips = new Map<string, { business: string; slip: string; date: string; dr: number; cr: number }>()
      for (const l of ledger.journal.filter((x) => inScope(x.business_id))) {
        const k = `${l.business_id}|${l.slip_no}`
        const cur = slips.get(k) ?? { business: l.business_id, slip: l.slip_no, date: l.entry_date, dr: 0, cr: 0 }
        // 원 단위 정수로 더한다(소수 전표는 전 단위까지 반올림) — 부동소수 찌꺼기로 가짜 불일치를 만들지 않는다.
        const cents = Math.round(l.amount * 100)
        if (l.side === 'debit') cur.dr += cents
        else cur.cr += cents
        slips.set(k, cur)
      }
      for (const v of slips.values()) {
        if (v.dr !== v.cr) {
          push({
            check: 'ledger_imbalance',
            what: `전표 ${v.slip} (${v.business})`,
            detail: `차변 ${krw(v.dr / 100)} ≠ 대변 ${krw(v.cr / 100)} · 차이 ${krw((v.dr - v.cr) / 100)}`,
            link: `/finance/${v.business}/journal`,
          })
        }
      }
      let diffs = 0
      for (const c of ledger.closings.filter((x) => inScope(x.business_id))) {
        if (c.provisional_amount !== null && Math.round(c.provisional_amount * 100) !== Math.round(c.amount * 100)) {
          diffs++
          push({
            check: 'provisional_vs_confirmed',
            what: `${c.business_id} · ${c.period} · 계정 ${c.account_code}`,
            detail: `잠정 ${krw(c.provisional_amount)} → 확정 ${krw(c.amount)} (차이 ${krw(c.amount - c.provisional_amount)})`,
            link: `/finance/${c.business_id}/monthly`,
          })
        }
      }
      await auditRestrictedRead(ctx, { path: `/ai-assistant/validate${businessScope ? `/${businessScope}` : ''}`, kind: 'finance', entity_table: 'journal_lines', business_id: businessScope })
      if (diffs > MAX_PER_CHECK) skipped.push(`잠정/확정 차이 ${diffs}건 중 ${MAX_PER_CHECK}건만 실음`)
    }
  }

  for (const f of findings.slice(0, 8)) addEvidence(ctx, { label: f.what, href: f.link, detail: f.detail })
  const counts = Object.fromEntries(
    (['ledger_imbalance', 'overdue', 'missing_required', 'provisional_vs_confirmed'] as const).map((k) => [k, findings.filter((f) => f.check === k).length]),
  )
  return { today, scope: { screen: s.kind, id: s.id }, counts, findings, not_checked: skipped }
}

export const validateTool: AssistantTool = {
  def: {
    name: 'validate_screen',
    description:
      '«이 화면에 틀린 것 있어?» — 지금 화면 범위에서 코드가 검사한다: 전표 차대 불일치 · 기한 지난 다음 행동/업무/결재 · ' +
      '비어 있는 필수 칸 · 잠정 vs 확정 차이. 결과 목록을 그대로 전한다(고치는 것은 제안 도구로, 결정은 하지 않는다).',
    input_schema: { type: 'object', properties: {} },
  },
  available: (ctx) => ctx.channel === 'web',
  run: (_input, ctx) => run(ctx),
}

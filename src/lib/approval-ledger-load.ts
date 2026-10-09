import 'server-only'

import { buildLedgerRows, filterLedger, sortLedger, type LedgerFilters, type LedgerRow } from '@/lib/approval-ledger'
import type { ChairmanRepository } from '@/lib/repository'
import type { ApprovalStepState, ApprovalTemplate, Business, Decision, Role } from '@/types'

/**
 * 결재 대장 한 번 읽기 — 화면(/approvals/ledger)과 엑셀(/approvals/ledger/export)이 같은 이 함수를 쓴다.
 *
 * repo는 **요청한 사람의 세션**으로 만든 것이어야 한다(getRepository() — 쿠키 세션, service_role 없음).
 * 그래서 결재 · 단계 줄은 이미 RLS(본인 · 결재선 · 회장 · 0059 대장 열람 줄)를 지나 온다. 여기 거르기는 좁히기만 한다.
 *
 * 단계 줄은 거른 뒤의 결재만 묻는다 — 거르기는 단계(현재 결재자)를 보지 않으니 순서를 바꿔도 같은 줄이 남는다.
 */
export interface LedgerLoad {
  /** 거르기 전 — 고르기 칸(회사 · 양식 · 사람 · 팀 · 구입처)의 선택지. 이것도 RLS 안의 줄뿐이다. */
  all: LedgerRow[]
  /** 거르고 정렬한 줄. */
  rows: LedgerRow[]
  decisions: Decision[]
  steps: ApprovalStepState[]
  templates: ApprovalTemplate[]
  businesses: Business[]
}

export async function loadLedger(repo: ChairmanRepository, viewer: Role | null | undefined, filters: LedgerFilters): Promise<LedgerLoad> {
  const [decisions, templates, businesses] = await Promise.all([
    repo.listDecisions(),
    repo.listApprovalTemplates(),
    repo.listBusinesses(),
  ])
  const ledger = decisions.filter((d) => !!d.template_key)
  const all = buildLedgerRows(ledger, [], templates, viewer)
  const ids = new Set(filterLedger(all, filters).map((r) => r.id))
  const picked = ledger.filter((d) => ids.has(d.decision_id))
  const steps = ids.size > 0 ? await repo.listApprovalSteps([...ids]) : []
  const rows = sortLedger(buildLedgerRows(picked, steps, templates, viewer), filters.sort, filters.dir)
  return { all, rows, decisions: picked, steps, templates, businesses }
}

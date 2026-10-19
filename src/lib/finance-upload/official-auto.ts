import { canCloseBooks } from '@/lib/auth/roles'
import type { AuditActor, ChairmanRepository } from '@/lib/repository'
import { balanceCheck } from '@/lib/statements/balance'
import type { AccountSection, SessionUser } from '@/types'

import { ensureOtherAccount } from './auto-accounts'
import type { OfficialDraft } from './doc-read'
import { isSuggestion, OFFICIAL_GROUP_KO, officialLines, type PickedLine } from './official-lines'

/**
 * 0085 공식 결산(세무사 확정 · 표준재무제표)도 «놓으면 저장» — 코드 · 학습 · AI가 맞춘 계정으로 해마다 바로 저장하고(같은 해는 바꾸기),
 * 못 맞춘 줄은 묶음별 «기타 …(자동)» 계정으로 넣은 뒤 경고로 남긴다. 줄을 나중에 바꾸면(다시 올리기 · «공식 결산» 화면) 다시 계산된다.
 * 저장은 0083 official_statement_save_v2 그대로(증빙 = 올린 원본 · 학습 · 감사). 막는 것:
 *   증빙을 보관하지 못함 · 재무상태표가 닫히지 않는데 올린 사람이 대표 · CFO · 마감 권한자가 아님(→ 보류 — 그분들이 이유를 적고 저장).
 */

export interface OfficialAutoResult {
  status: 'applied' | 'held'
  message: string
  warnings: string[]
  ids: number[]
  years: string[]
  matched: number
  total: number
}

/** 0089 그 해의 «다시 맞출 줄» — 기타 계정에 넣은 줄과 묶음 계정(영업외수익 · 잡손실 …)으로만 맞춘 줄. */
export function unmatchedFor(
  live: OfficialDraft['lines'],
  year: string,
  others: ReadonlyMap<string, { account_code: string }>,
): { std_key: string; label: string; grp: string | null; printed: number; from_code: string }[] {
  const out: { std_key: string; label: string; grp: string | null; printed: number; from_code: string }[] = []
  for (const l of live) {
    const printed = l.values[year]
    if (printed === undefined || printed === null || !l.group) continue
    const from = l.account_code && l.section ? (l.how === 'group' ? l.account_code : null) : (others.get(l.group)?.account_code ?? null)
    if (from) out.push({ std_key: l.std_key, label: l.label.slice(0, 200), grp: l.group, printed, from_code: from })
  }
  return out
}

export async function autoSaveOfficial(o: { repo: ChairmanRepository; user: SessionUser; businessId: string; draft: OfficialDraft; fileName: string }): Promise<OfficialAutoResult> {
  const { repo, user, businessId, draft } = o
  const actor: AuditActor = { user_id: user.user_id, role: user.role }
  const live = draft.lines.filter((l) => !l.skip)
  const total = live.length
  const matchedLines = live.filter((l) => l.account_code && l.section)
  const base = { ids: [] as number[], years: [] as string[], matched: matchedLines.length, total }
  if (!total) return { ...base, status: 'held', message: '보류 — 결산서의 계정 · 금액 줄을 읽지 못했습니다.', warnings: draft.errors }
  if (!draft.evidence_file) return { ...base, status: 'held', message: `보류 — ${draft.evidence_note ?? '올린 원본을 증빙으로 보관하지 못했습니다.'}`, warnings: [] }
  const years = draft.years.filter((y) => /^\d{4}$/.test(y))
  if (!years.length) return { ...base, status: 'held', message: '보류 — 몇 년도 결산인지 알아보지 못했습니다.', warnings: [] }

  const ledger = await repo.loadFinanceLedger()
  const have = new Set(ledger.accounts.filter((a) => a.business_id === businessId).map((a) => a.account_code))
  const nameOf = new Map(ledger.accounts.filter((a) => a.business_id === businessId).map((a) => [a.account_code, a.name]))
  const warnings: string[] = [...draft.warnings]
  const others = new Map<string, { account_code: string; name: string; section: AccountSection }>()
  const unplaced: string[] = []
  for (const l of live) {
    if (l.account_code && l.section) continue
    if (!l.group) {
      unplaced.push(l.label)
      continue
    }
    if (!others.has(l.group)) others.set(l.group, await ensureOtherAccount(repo, actor, businessId, l.group, have))
  }
  const otherCount = live.filter((l) => !(l.account_code && l.section) && l.group).length
  if (otherCount) warnings.push(`못 맞춘 줄 ${otherCount}개는 «기타 …(자동)» 계정으로 넣었습니다(${[...others.keys()].map((g) => OFFICIAL_GROUP_KO[g as keyof typeof OFFICIAL_GROUP_KO]).join(' · ')}) — «공식 결산» 화면에서 계정을 고르면 다시 계산됩니다.`)
  if (unplaced.length) warnings.push(`표의 어느 부분인지 모르는 줄 ${unplaced.length}개는 넣지 않았습니다(${unplaced.slice(0, 3).join(' · ')}).`)
  const suggested = matchedLines.filter((l) => isSuggestion(l.how)).length
  if (suggested) warnings.push(`이름이 비슷한 계정으로 맞춘 줄 ${suggested}개 — «공식 결산» 화면에서 확인하세요.`)

  const ids: number[] = []
  const saved: string[] = []
  for (const year of years) {
    const picked: PickedLine[] = []
    for (const l of live) {
      const printed = l.values[year]
      if (printed === undefined || printed === null) continue
      const acc = l.account_code && l.section ? { account_code: l.account_code, name: l.account_name ?? nameOf.get(l.account_code) ?? '', section: l.section } : l.group ? others.get(l.group) : undefined
      if (acc) picked.push({ label: l.label, account: acc, printed })
    }
    const lines = officialLines(picked)
    if (!lines.length) continue
    const bal = balanceCheck(lines)
    let reason: string | null = null
    if (!bal.balanced) {
      if (!canCloseBooks(user, businessId)) {
        warnings.push(`${year}년 재무상태표가 ${bal.difference.toLocaleString('ko-KR')}원 닫히지 않아 보류했습니다 — 대표 · CFO가 «공식 결산»에서 이유를 적고 저장합니다.`)
        continue
      }
      reason = `자동 저장 — 차이 ${bal.difference.toLocaleString('ko-KR')}원(세무사 반올림 · 읽기 차이 확인 필요)`
      warnings.push(`${year}년 재무상태표 차이 ${bal.difference.toLocaleString('ko-KR')}원 — 이유를 적고 저장했습니다.`)
    }
    try {
      const id = await repo.saveOfficialStatement(
        {
          business_id: businessId,
          period_kind: 'year',
          period_key: year,
          evidence_url: '',
          evidence_file: draft.evidence_file,
          memo: `자료 올리기 — ${o.fileName}`.slice(0, 200),
          lines: lines.map((x) => ({ account_code: x.account_code, amount: x.amount })),
          unbalanced_reason: reason,
          replace: true,
          learn: matchedLines.filter((l) => !isSuggestion(l.how) || l.how === 'ai').map((l) => ({ std_key: l.std_key, account_code: l.account_code! })),
        },
        actor,
      )
      ids.push(id)
      saved.push(year)
      // 0089 — 계정을 못 맞춘 줄(기타 · 묶음 계정)을 «다시 맞출 줄»로 둔다. 계정과목표가 올라오면 이 줄만 다시 맞춘다(official-rematch.ts).
      const pending = unmatchedFor(live, year, others)
      if (pending.length) await repo.saveOfficialUnmatched(id, pending).catch((e) => console.error('[official-auto] unmatched', e instanceof Error ? e.message : e))
    } catch (e) {
      warnings.push(`${year}년을 저장하지 못했습니다(${e instanceof Error ? e.message.slice(0, 80) : '?'}).`)
    }
  }
  if (!ids.length) return { ...base, status: 'held', message: '보류 — 공식 결산을 저장하지 못했습니다(아래 경고).', warnings }
  return {
    ...base,
    ids,
    years: saved,
    status: 'applied',
    message: `저장됨 · ${saved.join(' · ')}년 · 계정 ${matchedLines.length}/${total} 맞춤${otherCount ? ` · 기타 ${otherCount}` : ''}`,
    warnings: [...new Set(warnings)].slice(0, 20),
  }
}

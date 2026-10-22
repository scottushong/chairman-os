import { canCloseBooks } from '@/lib/auth/roles'
import type { AuditActor, ChairmanRepository } from '@/lib/repository'
import { balanceCheck } from '@/lib/statements/balance'
import type { AccountSection, OfficialUnmatchedLine, SessionUser } from '@/types'

import { cleanLabel, matchOfficial, type MatchHow, type OfficialGroup } from './official-lines'
import { signedAmount } from './official-sign'

/**
 * 0089 A3 — 계정과목표가 올라오면 공식 결산(0083 · 0085 «놓으면 저장»)에서 계정을 못 맞춰 «기타 …(자동)» · 묶음 계정에 넣어 둔 줄을
 * 새 계정과목표로 다시 맞춘다. 저장본을 고치지 않고(0020 규칙) 같은 해 결산을 «바꾸기»로 새로 세운다 — 옮긴 줄만 금액이 옮겨 가고
 * 나머지 줄 · 증빙 · 메모는 그대로다. 다시 맞춘 줄은 학습 표(official_account_map)에도 남는다(이름 그대로 · 표준 이름 바꿈만).
 *
 * 막는 것: 옮긴 뒤 재무상태표가 닫히지 않는데(묶음이 다른 계정으로 옮겨 부호가 바뀐 경우) 올린 사람이 마감 권한이 없으면 그 해는 그대로 둔다(경고).
 * AI는 부르지 않는다 — 코드 맞춤(이름 · 표준 이름 바꿈 · 앞뒤 일치 · 학습)만.
 */

export interface RematchResult {
  /** 다시 세운 결산 수 */
  statements: number
  /** 다시 맞출 줄(전부) · 옮긴 줄 · 남은 줄 */
  total: number
  moved: number
  remaining: number
  warnings: string[]
  /** 새 결산 id */
  ids: number[]
}

const cents = (n: number) => Math.round(n * 100)
/** 다시 맞춤에서 학습까지 하는 맞춤(확정) — 그 밖(앞뒤 일치 · 묶음)은 옮기기만 하고 학습하지 않는다. */
const LEARN: readonly MatchHow[] = ['learned', 'exact', 'alias']

export async function rematchOfficial(o: { repo: ChairmanRepository; user: SessionUser; businessId: string }): Promise<RematchResult> {
  const { repo, user, businessId } = o
  const zero: RematchResult = { statements: 0, total: 0, moved: 0, remaining: 0, warnings: [], ids: [] }
  const pending = await repo.listOfficialUnmatched(businessId).catch(() => [] as OfficialUnmatchedLine[])
  if (!pending.length) return zero
  const actor: AuditActor = { user_id: user.user_id, role: user.role }
  const [ledger, learnedRows, statements] = await Promise.all([repo.loadFinanceLedger(), repo.listOfficialAccountMap(businessId).catch(() => []), repo.listOfficialStatements(businessId)])
  const accounts = ledger.accounts.filter((a) => a.business_id === businessId)
  const byCode = new Map(accounts.map((a) => [a.account_code, a]))
  // 기타(자동) 계정은 다시 맞출 곳이 아니다.
  const pool = accounts.filter((a) => a.active !== false && !a.account_code.startsWith('ZZ-')).map((a) => ({ account_code: a.account_code, name: a.name, section: a.section }))
  const learned = new Map(learnedRows.map((m) => [m.std_key, m.account_code]))
  const out: RematchResult = { ...zero, warnings: [], ids: [] }
  out.total = pending.length

  const byStatement = new Map<number, OfficialUnmatchedLine[]>()
  for (const p of pending) byStatement.set(p.statement_id, [...(byStatement.get(p.statement_id) ?? []), p])

  for (const [sid, rows] of byStatement) {
    const st = statements.find((s) => s.id === sid && s.superseded_at === null)
    if (!st) {
      out.remaining += rows.length
      continue
    }
    const moves: { r: OfficialUnmatchedLine; to: { account_code: string; name: string; section: AccountSection }; how: MatchHow }[] = []
    const keep: OfficialUnmatchedLine[] = []
    for (const r of rows) {
      const m = matchOfficial(r.label, (r.grp as OfficialGroup | null) ?? null, pool, learned)
      // 묶음 계정(«영업외수익» · «잡손실»)으로만 맞는 줄은 옮기지 않는다 — 이미 그 자리에 있거나 더 나은 계정이 아니다.
      if (m && m.how !== 'group' && m.acc.account_code !== r.from_code) moves.push({ r, to: m.acc, how: m.how })
      else keep.push(r)
    }
    if (!moves.length) {
      out.remaining += rows.length
      continue
    }
    const current = await repo.listOfficialStatementLines(businessId, [sid])
    const amounts = new Map<string, number>(current.map((l) => [l.account_code, cents(l.amount)]))
    let broken = false
    for (const mv of moves) {
      const from = byCode.get(mv.r.from_code)
      if (!from) {
        broken = true
        break
      }
      const name = cleanLabel(mv.r.label).name
      amounts.set(from.account_code, (amounts.get(from.account_code) ?? 0) - cents(signedAmount(from.section, from.name, mv.r.printed, name)))
      amounts.set(mv.to.account_code, (amounts.get(mv.to.account_code) ?? 0) + cents(signedAmount(mv.to.section, mv.to.name, mv.r.printed, name)))
    }
    if (broken) {
      out.warnings.push(`${st.period_key}년 결산의 기타 계정을 찾지 못해 다시 맞추지 않았습니다.`)
      out.remaining += rows.length
      continue
    }
    const lines = [...amounts.entries()].filter(([, c]) => c !== 0).map(([account_code, c]) => ({ account_code, amount: c / 100 }))
    const bal = balanceCheck(lines.map((l) => ({ account_code: l.account_code, section: byCode.get(l.account_code)?.section ?? 'other_asset', amount: l.amount })))
    const diff = Math.round(bal.difference * 100) / 100
    let reason: string | null = null
    if (!bal.balanced && diff !== 0) {
      if (st.unbalanced_reason) reason = st.unbalanced_reason
      else if (canCloseBooks(user, businessId)) reason = `계정과목표로 다시 맞춤 — 차이 ${diff.toLocaleString('ko-KR')}원(확인 필요)`
      else {
        out.warnings.push(`${st.period_key}년 결산은 다시 맞추면 재무상태표가 ${diff.toLocaleString('ko-KR')}원 닫히지 않아 그대로 두었습니다 — 대표 · CFO가 «공식 결산»에서 계정을 고릅니다.`)
        out.remaining += rows.length
        continue
      }
    }
    try {
      const id = await repo.saveOfficialStatement(
        {
          business_id: businessId,
          period_kind: st.period_kind,
          period_key: st.period_key,
          evidence_url: st.evidence_url ?? '',
          evidence_file: st.evidence_file ?? null,
          memo: st.memo.startsWith('계정 다시 맞춤 — ') ? st.memo : `계정 다시 맞춤 — ${st.memo}`.slice(0, 200),
          lines,
          unbalanced_reason: reason,
          replace: true,
          learn: moves.filter((m) => LEARN.includes(m.how)).map((m) => ({ std_key: m.r.std_key, account_code: m.to.account_code })),
        },
        actor,
      )
      out.ids.push(id)
      out.statements += 1
      out.moved += moves.length
      out.remaining += keep.length
      await repo.saveOfficialUnmatched(id, keep.map(({ std_key, label, grp, printed, from_code }) => ({ std_key, label, grp, printed, from_code }))).catch((e) => {
        out.warnings.push(`${st.period_key}년 남은 줄 ${keep.length}개를 기록하지 못했습니다(${e instanceof Error ? e.message.slice(0, 60) : '?'}).`)
      })
      const near = moves.filter((m) => !LEARN.includes(m.how)).length
      if (near) out.warnings.push(`${st.period_key}년 — 이름이 비슷한 계정으로 다시 맞춘 줄 ${near}개(«공식 결산» 화면에서 확인하세요).`)
    } catch (e) {
      out.remaining += rows.length
      out.warnings.push(`${st.period_key}년 결산을 다시 맞추지 못했습니다(${e instanceof Error ? e.message.slice(0, 80) : '?'}).`)
    }
  }
  return out
}

/** 카드 · 안내 한 줄 — «공식 결산 미매칭 계정 n/m 다시 맞춤». 다시 맞출 줄이 없으면 빈 글. */
export function rematchNote(r: RematchResult): string {
  if (!r.total) return ''
  return `공식 결산 미매칭 줄 ${r.moved}/${r.total} 다시 맞춤${r.statements ? `(${r.statements}개 해)` : ''}${r.remaining ? ` · 남은 ${r.remaining}` : ''}`
}

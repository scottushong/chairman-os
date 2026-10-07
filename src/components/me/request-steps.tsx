import Link from 'next/link'

import { boss, bossEn, bossText } from '@/lib/boss'
import { formatDateTime } from '@/lib/format'
import { tr, type Lang } from '@/lib/i18n'
import type { ApprovalStepState, Decision, Role } from '@/types'

/**
 * /me «내 요청» 한 건의 단계 진행(0059 단계 결재). 누가 언제 승인했는지 · 지금 누구 차례인지 · 반려 사유.
 * 대표 칸은 이름 대신 boss(보는 사람) — 직원 화면에 «회장»이 찍히지 않게(CLAUDE.md).
 * 옛 결재(step_chain false)는 이 칸을 그리지 않는다 — 기존 한 줄 상태 그대로.
 */
export function stepLabel(s: ApprovalStepState, role: Role | null): string {
  return s.is_chairman ? boss(role) : `${bossText(s.why, role)} ${s.approver_name}`.trim()
}

export function RequestSteps({ decision, steps, lang, viewerRole }: { decision: Decision; steps: ApprovalStepState[]; lang: Lang; viewerRole: Role | null }) {
  const shown = steps.filter((s) => s.status !== 'cancelled').sort((a, b) => a.seq - b.seq)
  const pending = shown.find((s) => s.status === 'pending')
  const rejected = shown.find((s) => s.status === 'rejected')
  const who = (s: ApprovalStepState) => (s.is_chairman ? tr(lang, boss(viewerRole), bossEn(viewerRole)) : stepLabel(s, viewerRole))

  return (
    <div className="mt-1 space-y-1 text-t11h">
      {shown.length > 0 ? (
        <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-ink-muted">
          {shown.map((s, i) => (
            <li key={s.seq} className="flex items-center gap-1.5">
              {i > 0 ? <span aria-hidden>→</span> : null}
              <span
                className={
                  s.status === 'approved'
                    ? 'text-ink-dim'
                    : s.status === 'pending'
                      ? 'font-semibold text-accent'
                      : s.status === 'rejected'
                        ? 'font-semibold text-critical'
                        : ''
                }
              >
                {s.status === 'approved' ? '✓ ' : s.status === 'rejected' ? '✕ ' : ''}
                {who(s)}
                {s.decided_at ? <span className="ml-1 tnum text-ink-muted">{formatDateTime(s.decided_at)}</span> : null}
              </span>
            </li>
          ))}
        </ol>
      ) : null}
      {decision.status === 'Open' && pending ? (
        <p className="font-semibold text-ink-dim">{tr(lang, `지금: ${who(pending)} 차례`, `Now: waiting for ${who(pending)}`)}</p>
      ) : null}
      {decision.status === 'Rejected' ? (
        <div className="rounded-md bg-raised px-2 py-1.5">
          <p className="text-ink-dim">
            <span className="font-semibold text-critical">{tr(lang, '반려 사유', 'Reason')}</span>
            {rejected ? ` (${who(rejected)})` : ''}: {rejected?.note ? bossText(rejected.note, viewerRole) : '—'}
          </p>
          <Link href={`/approvals/new?resubmit=${encodeURIComponent(decision.decision_id)}`} className="mt-1 inline-block font-semibold text-accent underline-offset-2 hover:underline">
            {tr(lang, '고쳐서 다시 올리기', 'Fix and resubmit')} →
          </Link>
        </div>
      ) : null}
    </div>
  )
}

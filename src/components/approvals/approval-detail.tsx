import { ApprovalActions } from '@/components/approvals/approval-actions'
import { Icon } from '@/components/ui/icon'
import { bundleTitle } from '@/lib/approval-line'
import { bossText } from '@/lib/boss'
import { DECISION_ACTION_LABEL_KO, type DecisionAuditRecord } from '@/lib/decision-log'
import { dDay, formatDateTime, formatDDay } from '@/lib/format'
import {
  DECISION_STATUS_LABEL_KO,
  WORK_PRIORITY_LABEL_KO,
  type Decision,
  type Role,
  type WorkPriority,
} from '@/types'

/**
 * CH-041 상세 패널 — 내용 · 첨부 · 이력.
 *
 * 이력은 decisions 표가 아니라 audit_log에서 역조회한 것이다(repository.listDecisionAudit).
 * '누가 언제 무엇을 했는가'의 답은 상태 칸이 아니라 기록에 있다 — 상태 칸은 마지막 한 번만 남긴다.
 *
 * 그래서 이 패널의 타임라인이 비어 있는데 상태가 'Approved'인 경우가 있을 수 있다.
 * 그건 고장이 아니라, audit_log_read 정책(0002)이 Chairman이 아닌 사람에게 남의 기록을
 * 내주지 않기 때문이다. 그 사실을 화면에 적어 둔다.
 */

const IMPACT_TONE: Record<WorkPriority, string> = {
  Critical: 'bg-critical/15 text-critical',
  High: 'bg-warning/15 text-warning',
  Medium: 'bg-raised text-ink-dim',
  Low: 'bg-raised text-ink-muted',
}

/** 처리 방향별 점 색. 승인만 초록, 거절만 빨강 — 나머지 둘은 '아직 끝나지 않은' 처리다. */
const ACTION_TONE: Record<DecisionAuditRecord['action'], string> = {
  approve: 'bg-ok',
  reject: 'bg-critical',
  modify: 'bg-warning',
  delegate: 'bg-info',
}

const ACTION_LABEL: Record<DecisionAuditRecord['action'], string> = {
  approve: DECISION_ACTION_LABEL_KO.Approved,
  reject: DECISION_ACTION_LABEL_KO.Rejected,
  modify: DECISION_ACTION_LABEL_KO.Modified,
  delegate: DECISION_ACTION_LABEL_KO.Delegated,
}

export function ApprovalDetail({
  decision,
  businessName,
  history,
  viewerRole,
}: {
  decision: Decision
  businessName: string
  /** 이 결정에 달린 audit_log 줄들. 최신이 먼저다. */
  history: DecisionAuditRecord[]
  /** 얼린 결재선의 «회장/대표» 문구를 보는 사람에 맞춘다 — 직원 화면 용어 원칙(CLAUDE.md). */
  viewerRole: Role | null
}) {
  const overdue = dDay(decision.deadline) < 0 && decision.status === 'Open'

  return (
    <section className="rounded-xl border border-line-soft bg-panel">
      <div className="border-b border-line-soft px-4 py-3.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <span
            className={`rounded px-1.5 py-0.5 text-t10 font-semibold ${IMPACT_TONE[decision.impact]}`}
          >
            {WORK_PRIORITY_LABEL_KO[decision.impact]}
          </span>
          <span className="text-t11h text-ink-muted">{businessName}</span>
          <span className="text-t10 text-ink-muted tnum">{decision.decision_id}</span>
          <span
            className={`ml-auto text-t12 font-semibold tnum ${
              overdue ? 'text-critical' : 'text-ink-dim'
            }`}
          >
            마감 {decision.deadline} · {formatDDay(decision.deadline)}
          </span>
        </div>
        <h2 className="mt-1.5 text-t16 leading-snug font-bold">{bundleTitle(decision.title, viewerRole)}</h2>
        <p className="mt-1 text-t11h text-ink-muted">
          현재 상태 <span className="text-ink-dim">{DECISION_STATUS_LABEL_KO[decision.status]}</span>
        </p>
      </div>

      <div className="space-y-4 px-4 py-4">
        <Field label="선택안">
          <div className="flex flex-wrap gap-1.5">
            {decision.options.length === 0 ? (
              <span className="text-t12 text-ink-muted">선택안이 등록되지 않았습니다.</span>
            ) : (
              decision.options.map((opt) => (
                <span
                  key={opt}
                  className={`rounded-md px-2 py-1 text-t12 ${
                    opt === decision.ai_recommendation
                      ? 'border border-accent/50 bg-accent/10 text-ink'
                      : 'bg-raised text-ink-dim'
                  }`}
                >
                  {opt}
                </span>
              ))
            )}
          </div>
        </Field>

        <Field label="AI 추천">
          {decision.ai_recommendation ? (
            <p className="flex flex-wrap items-center gap-1.5 text-t12h text-ink-dim">
              <Icon name="sparkles" className="size-3.5 text-accent" />
              {decision.ai_recommendation}
              {/* 신뢰도는 값이 있을 때만 붙인다. 없는 걸 0%로 그리면 '추천을 못 믿겠다'로 읽힌다. */}
              {decision.ai_confidence === undefined ? null : (
                <span className="text-t11 text-ink-muted tnum">
                  신뢰도 {Math.round(decision.ai_confidence * 100)}%
                </span>
              )}
            </p>
          ) : (
            <p className="text-t12 text-ink-muted">추천안이 없습니다.</p>
          )}
        </Field>

        {/* 0038. 양식으로 올린 결재만. 결재선은 제출 순간 DB가 얼린 값이다 — 조직이 바뀌어도 그대로다. */}
        {decision.approval_line && decision.approval_line.length > 0 ? (
          <Field label="결재선">
            <ol className="flex flex-wrap items-center gap-1.5 text-t12">
              {decision.approval_line.map((s, i) => (
                <li key={s.step} className="flex items-center gap-1.5">
                  {i > 0 ? <span className="text-ink-muted">→</span> : null}
                  <span className="rounded-md border border-line-soft bg-raised px-2 py-1" title={bossText(s.why, viewerRole)}>
                    <span className="font-semibold">{s.step === 'chairman' ? bossText(s.name, viewerRole) : s.name}</span>
                    <span className="ml-1 text-t10h text-ink-muted">{bossText(s.why, viewerRole)}</span>
                  </span>
                </li>
              ))}
            </ol>
          </Field>
        ) : null}
        {decision.form && Object.keys(decision.form).length > 0 ? (
          <Field label="양식 항목">
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-t12">
              {Object.entries(decision.form).map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-ink-muted">{k}</dt>
                  <dd className="whitespace-pre-wrap">{v}</dd>
                </div>
              ))}
            </dl>
          </Field>
        ) : null}

        <Field label="첨부">
          {decision.attachment_url ? (
            // 링크만 있다. 파일 실체는 사내 스토리지에 있고 Chairman OS는 그 주소만 안다(0006).
            <a
              href={decision.attachment_url}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-1.5 rounded-md border border-line bg-raised px-2.5 py-1.5 text-t12 text-ink-dim transition-colors hover:border-accent hover:text-ink"
            >
              <Icon name="file-text" className="size-3.5" />
              사내 스토리지에서 열기
            </a>
          ) : (
            <p className="text-t12 text-ink-muted">첨부된 문서가 없습니다.</p>
          )}
        </Field>

        <Field label="처리 이력">
          {history.length === 0 ? (
            <p className="text-t12 text-ink-muted">
              아직 처리 기록이 없습니다.
              {decision.status === 'Open'
                ? ''
                : ' (기록은 있으나 열람 권한이 없을 수도 있습니다 — 0002 audit_log_read)'}
            </p>
          ) : (
            <ol className="space-y-2.5">
              {history.map((h) => (
                <li key={`${h.occurred_at}-${h.action}`} className="flex items-start gap-2.5">
                  <span
                    className={`mt-1.5 size-1.5 shrink-0 rounded-full ${ACTION_TONE[h.action]}`}
                  />
                  <span className="min-w-0">
                    <span className="block text-t12h font-semibold">
                      {ACTION_LABEL[h.action]}
                    </span>
                    <span className="block text-t11 text-ink-muted tnum">
                      {formatDateTime(h.occurred_at)} · {h.actor_name}
                    </span>
                  </span>
                </li>
              ))}
            </ol>
          )}
        </Field>

        {decision.status === 'Open' ? (
          <div className="border-t border-line-soft pt-4">
            <ApprovalActions
              decisionId={decision.decision_id}
              businessId={decision.business_id}
            />
          </div>
        ) : (
          <p className="border-t border-line-soft pt-4 text-t12 text-ink-muted">
            이미 처리된 결정입니다. 되돌리려면 새 결재를 올려야 합니다 — 기록은 지우지 않습니다.
          </p>
        )}
      </div>
    </section>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 text-t10 font-semibold tracking-[0.08em] text-ink-muted">{label}</p>
      {children}
    </div>
  )
}

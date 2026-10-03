import { AUDIT_ACTION_LABEL_KO, fieldChanges, type EntityAuditRecord } from '@/lib/audit-log'
import { Icon } from '@/components/ui/icon'
import { bossText, isChairman } from '@/lib/boss'
import { formatDateTime } from '@/lib/format'
import type { Role } from '@/types'

/**
 * audit_log 역조회를 그리는 자리 (DEFERRED D-12).
 *
 * 업무·프로젝트 단건 화면이 같이 쓴다. 두 화면이 다른 모양으로 이력을 그리면
 * 같은 audit_log를 보고도 다른 사실처럼 읽힌다.
 *
 * 서버 컴포넌트다. 이력은 읽기만 하고 누르는 자리가 없다 —
 * audit_log는 append only라 화면에서 고칠 것이 애초에 없다(CH-051).
 */
export function AuditTimeline({
  records,
  emptyMessage,
  viewerRole,
}: {
  records: EntityAuditRecord[]
  emptyMessage: string
  /** 보는 사람의 역할. 감사 기록의 «회장» 문구 · 역할을 그 사람에 맞춘다(lib/boss.ts). */
  viewerRole: Role | null | undefined
}) {
  if (records.length === 0) {
    return <p className="text-t12 text-ink-muted">{emptyMessage}</p>
  }
  // 감사 기록의 «회장» 문구 · 역할은 보는 사람에 맞춘다 — 직원 화면 용어 원칙(CLAUDE.md).
  const viewer = viewerRole ?? null
  const roleOf = (r: string) => (r === 'Chairman' && !isChairman(viewer) ? '대표' : r)

  return (
    <ol className="space-y-2.5">
      {records.map((record) => {
        const changes = fieldChanges(record, viewer)
        return (
          <li key={record.id} className="flex gap-2.5">
            {/* 시간축. 점 하나로 '언제'가 세로로 읽히게 한다. */}
            <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-line" aria-hidden />

            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-t11h">
                <span className="font-semibold text-ink-dim">
                  {AUDIT_ACTION_LABEL_KO[record.action] ?? record.action}
                </span>
                <span className="text-ink-muted">
                  {record.actor_name}
                  {record.actor_role ? ` · ${roleOf(record.actor_role)}` : ''}
                </span>
                <span className="ml-auto shrink-0 text-t10h text-ink-muted tnum">
                  {formatDateTime(record.occurred_at)}
                </span>
              </p>

              {changes.length > 0 ? (
                <ul className="mt-1 space-y-0.5">
                  {changes.map((c) => (
                    <li
                      key={c.field}
                      className="flex flex-wrap items-center gap-1.5 text-t11 text-ink-muted"
                    >
                      <span className="rounded bg-raised px-1.5 py-px text-ink-dim">{c.label}</span>
                      <span className="tnum">{c.before}</span>
                      <Icon name="chevron-right" className="size-3" />
                      <span className="font-semibold text-ink-dim tnum">{c.after}</span>
                    </li>
                  ))}
                </ul>
              ) : null}

              {record.note ? (
                <p className="mt-1 text-t11 leading-snug text-ink-muted">{bossText(record.note, viewer)}</p>
              ) : null}
            </div>
          </li>
        )
      })}
    </ol>
  )
}

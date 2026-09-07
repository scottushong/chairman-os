import { AUDIT_ACTION_LABEL_KO, fieldChanges, type EntityAuditRecord } from '@/lib/audit-log'
import { Icon } from '@/components/ui/icon'
import { formatDateTime } from '@/lib/format'

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
}: {
  records: EntityAuditRecord[]
  emptyMessage: string
}) {
  if (records.length === 0) {
    return <p className="text-[12px] text-ink-muted">{emptyMessage}</p>
  }

  return (
    <ol className="space-y-2.5">
      {records.map((record) => {
        const changes = fieldChanges(record)
        return (
          <li key={record.id} className="flex gap-2.5">
            {/* 시간축. 점 하나로 '언제'가 세로로 읽히게 한다. */}
            <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-line" aria-hidden />

            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[11.5px]">
                <span className="font-semibold text-ink-dim">
                  {AUDIT_ACTION_LABEL_KO[record.action] ?? record.action}
                </span>
                <span className="text-ink-muted">
                  {record.actor_name}
                  {record.actor_role ? ` · ${record.actor_role}` : ''}
                </span>
                <span className="ml-auto shrink-0 text-[10.5px] text-ink-muted tnum">
                  {formatDateTime(record.occurred_at)}
                </span>
              </p>

              {changes.length > 0 ? (
                <ul className="mt-1 space-y-0.5">
                  {changes.map((c) => (
                    <li
                      key={c.field}
                      className="flex flex-wrap items-center gap-1.5 text-[11px] text-ink-muted"
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
                <p className="mt-1 text-[11px] leading-snug text-ink-muted">{record.note}</p>
              ) : null}
            </div>
          </li>
        )
      })}
    </ol>
  )
}

import Link from 'next/link'
import { notFound } from 'next/navigation'

import { PageHeader } from '@/components/layout/page-header'
import { AuditTimeline } from '@/components/shared/audit-timeline'
import { Icon } from '@/components/ui/icon'
import { dDay, formatDDay, formatPct } from '@/lib/format'
import { businessName } from '@/lib/lookup'
import { getRepository } from '@/lib/repository'
import {
  TASK_STATUS,
  TASK_STATUS_LABEL_KO,
  WORK_PRIORITY_LABEL_KO,
  type Task,
  type TaskStatus,
  type WorkPriority,
} from '@/types'

/**
 * CH-020 프로젝트 단건 화면 (DEFERRED D-12 선택지 A).
 *
 * 업무 단건(/tasks/[id])의 위층이다. 업무에서 '프로젝트 보기'로 올라오고,
 * 여기서 다시 그 프로젝트의 업무들로 내려간다 — 검색 결과의 프로젝트도 이제 여기로 온다.
 *
 * 고치는 자리가 없다. 프로젝트의 진행률·마감·담당자는 Business OS(Layer 1)가 갖는 칸이고,
 * repository의 계약에도 프로젝트를 고치는 함수가 없다. 없는 버튼을 그려 두면
 * 눌렀을 때 실패하는 화면이 된다 — 읽는 화면이라고 분명히 말하는 편이 정확하다.
 *
 * 없는 프로젝트와 볼 수 없는 프로젝트를 구분하지 않는다(0002 projects_read).
 */

const PRIORITY_TONE: Record<WorkPriority, string> = {
  Critical: 'bg-critical/15 text-critical',
  High: 'bg-warning/15 text-warning',
  Medium: 'bg-raised text-ink-dim',
  Low: 'bg-raised text-ink-muted',
}

const STATUS_TONE: Record<TaskStatus, string> = {
  Todo: 'text-ink-muted',
  Doing: 'text-ink-dim',
  Blocked: 'text-critical',
  Done: 'text-ok',
}

function waitingDays(task: Task, today = new Date()): number {
  return Math.max(0, -dDay(task.blocked_since, today))
}

export default async function ProjectDetailPage(props: PageProps<'/projects/[id]'>) {
  const { id } = await props.params

  const repo = await getRepository()
  const [projects, tasks, businesses, audit] = await Promise.all([
    repo.listProjects(),
    repo.listTasks(),
    repo.listBusinesses(),
    repo.listEntityAudit('projects', id),
  ])

  const project = projects.find((p) => p.project_id === id)
  if (!project) notFound()

  const company = businessName(businesses, project.business_id)
  const own = tasks.filter((t) => t.project_id === id)

  /** 목록과 같은 정렬이어야 한다 — 완료는 뒤로, 나머지는 오래 서 있던 것이 위로. */
  const ordered = [...own].sort(
    (a, b) =>
      Number(a.status === 'Done') - Number(b.status === 'Done') ||
      a.blocked_since.localeCompare(b.blocked_since) ||
      a.deadline.localeCompare(b.deadline),
  )

  const done = own.filter((t) => t.status === 'Done').length
  const waiting = own.filter((t) => t.chairman_needed && t.status !== 'Done').length
  const overdue = dDay(project.deadline) < 0 && project.status !== 'Done'

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-5">
      <PageHeader
        icon="folder"
        title={project.name}
        code="CH-020"
        description={`${company} · ${project.project_id}`}
      >
        <Link
          href={`/tasks?business=${encodeURIComponent(project.business_id)}`}
          className="rounded-lg border border-line px-2.5 py-1.5 text-[11.5px] text-ink-dim transition-colors hover:border-accent hover:text-ink"
        >
          업무 목록
        </Link>
        <Link
          href={`/business/${encodeURIComponent(project.business_id)}`}
          className="rounded-lg border border-line px-2.5 py-1.5 text-[11.5px] text-ink-dim transition-colors hover:border-accent hover:text-ink"
        >
          {company}
        </Link>
      </PageHeader>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="space-y-4">
          <section className="rounded-xl border border-line-soft bg-panel p-4">
            <h2 className="text-[13px] font-semibold">프로젝트</h2>

            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 md:grid-cols-4">
              <Field label="담당자">{project.owner}</Field>
              <Field label="중요도">
                <span
                  className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${PRIORITY_TONE[project.priority]}`}
                >
                  {WORK_PRIORITY_LABEL_KO[project.priority]}
                </span>
              </Field>
              <Field label="상태">
                <span className={STATUS_TONE[project.status]}>
                  {TASK_STATUS_LABEL_KO[project.status]}
                </span>
              </Field>
              <Field label="마감">
                <span className={overdue ? 'text-critical' : ''}>
                  {project.deadline} · {formatDDay(project.deadline)}
                </span>
              </Field>
            </dl>

            <div className="mt-4">
              <p className="flex items-baseline justify-between text-[11px]">
                <span className="text-ink-muted">진행률</span>
                <span className="text-[14px] font-semibold tnum">
                  {formatPct(project.progress_pct)}
                </span>
              </p>
              <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-accent/15">
                <div
                  className="h-full rounded-full bg-accent"
                  style={{ width: `${project.progress_pct}%` }}
                />
              </div>
              {/* 진행률은 프로젝트가 들고 있는 값이다. 업무 완료 수와 자동으로 맞물리지 않는다. */}
              <p className="mt-1.5 text-[10.5px] text-ink-muted tnum">
                업무 {own.length}건 중 완료 {done}건
                {waiting > 0 ? ` · 회장 확인 대기 ${waiting}건` : ''}
              </p>
            </div>
          </section>

          <section className="rounded-xl border border-line-soft bg-panel p-4">
            <h2 className="flex items-baseline gap-2 text-[13px] font-semibold">
              이 프로젝트의 업무
              <span className="text-[9px] font-normal text-ink-muted tnum">CH-040</span>
              <span className="text-[11px] font-normal text-ink-muted tnum">{own.length}건</span>
            </h2>

            {ordered.length === 0 ? (
              <p className="mt-3 text-[12px] text-ink-muted">이 프로젝트에 등록된 업무가 없습니다.</p>
            ) : (
              <ul className="mt-3 space-y-1">
                {ordered.map((t) => (
                  <li key={t.task_id}>
                    <Link
                      href={`/tasks/${encodeURIComponent(t.task_id)}`}
                      className="flex items-center gap-2 rounded-lg border border-line-soft bg-raised px-3 py-2 transition-colors hover:border-accent"
                    >
                      {t.chairman_needed && t.status !== 'Done' ? (
                        <Icon name="crown" className="size-3.5 shrink-0 text-gold" filled />
                      ) : null}
                      <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold">
                        {t.title}
                      </span>
                      <span className={`shrink-0 text-[11px] ${STATUS_TONE[t.status]}`}>
                        {TASK_STATUS_LABEL_KO[t.status]}
                      </span>
                      <span className="shrink-0 text-[11px] text-ink-muted tnum">
                        {t.status === 'Done'
                          ? '—'
                          : waitingDays(t) > 0
                            ? `${waitingDays(t)}일`
                            : '오늘'}
                      </span>
                      <span
                        className={`w-12 shrink-0 text-right text-[11px] font-semibold tnum ${
                          dDay(t.deadline) < 0 && t.status !== 'Done'
                            ? 'text-critical'
                            : 'text-ink-dim'
                        }`}
                      >
                        {formatDDay(t.deadline)}
                      </span>
                      <Icon name="chevron-right" className="size-3.5 shrink-0 text-ink-muted" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <aside className="space-y-4">
          <section className="rounded-xl border border-line-soft bg-panel p-4">
            <h2 className="text-[13px] font-semibold">상태별</h2>
            <ul className="mt-2.5 space-y-1.5">
              {TASK_STATUS.map((s) => (
                <li key={s} className="flex items-baseline justify-between text-[12px]">
                  <span className={STATUS_TONE[s]}>{TASK_STATUS_LABEL_KO[s]}</span>
                  <span className="text-ink-dim tnum">
                    {own.filter((t) => t.status === s).length}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <section className="rounded-xl border border-line-soft bg-panel p-4">
            <h2 className="flex items-baseline gap-2 text-[13px] font-semibold">
              이력
              <span className="text-[9px] font-normal text-ink-muted tnum">CH-051</span>
            </h2>
            <div className="mt-3">
              <AuditTimeline
                records={audit}
                emptyMessage="이 프로젝트를 고친 기록이 없습니다. 프로젝트를 고치는 경로는 Business OS(Layer 1)에 있습니다."
              />
            </div>
          </section>
        </aside>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10.5px] text-ink-muted">{label}</dt>
      <dd className="mt-0.5 truncate text-[12.5px] text-ink-dim tnum">{children}</dd>
    </div>
  )
}

import Link from 'next/link'
import { notFound } from 'next/navigation'

import { PageHeader } from '@/components/layout/page-header'
import { AuditTimeline } from '@/components/shared/audit-timeline'
import { TaskControls } from '@/components/tasks/task-controls'
import { Icon } from '@/components/ui/icon'
import { dDay, formatDDay } from '@/lib/format'
import { businessName } from '@/lib/lookup'
import { getRepository } from '@/lib/repository'
import {
  TASK_STATUS_LABEL_KO,
  WORK_PRIORITY_LABEL_KO,
  type Task,
  type TaskStatus,
  type WorkPriority,
} from '@/types'

/**
 * CH-040 / CH-017 업무 단건 화면 (DEFERRED D-12 선택지 A).
 *
 * 이 화면이 생긴 이유는 하나다. CH-017 Waiting on Me의 Acceptance가 '원 Task와 연결'인데,
 * 지금까지는 그 업무가 **보이는 목록**까지만 갈 수 있었다(UAT TC-010 P0 Fail).
 * 이제 그 줄이 이 주소를 가리킨다 — 업무 하나를 링크로 지목할 수 있다.
 *
 * 화면 순서는 '무엇인가 → 어떻게 바꾸나 → 무슨 일이 있었나'다.
 *   왼쪽  제목·회사·프로젝트·중요도·마감·대기일수
 *   오른쪽 상태 변경 / 회장 확인 토글 (CH-040)
 *   아래  audit_log 역조회 이력 (CH-051)
 *
 * 없는 업무와 볼 수 없는 업무를 구분하지 않는다. tasks_read(0002)가 자기 회사 밖의 업무를
 * 아예 내주지 않으므로 둘 다 목록에 없고 둘 다 404다 — 회사 상세 화면과 같은 규칙이다.
 */

/** 상태 색. Blocked만 색을 준다 — 색은 위험에만 쓴다(요구사항서 2번). */
const STATUS_TONE: Record<TaskStatus, string> = {
  Todo: 'text-ink-muted',
  Doing: 'text-ink-dim',
  Blocked: 'text-critical',
  Done: 'text-ok',
}

const PRIORITY_TONE: Record<WorkPriority, string> = {
  Critical: 'bg-critical/15 text-critical',
  High: 'bg-warning/15 text-warning',
  Medium: 'bg-raised text-ink-dim',
  Low: 'bg-raised text-ink-muted',
}

/** 지금 상태로 들어간 지 며칠인가(DEFERRED D-02 결정 A). 목록·대시보드와 같은 계산이어야 한다. */
function waitingDays(task: Task, today = new Date()): number {
  return Math.max(0, -dDay(task.blocked_since, today))
}

export default async function TaskDetailPage(props: PageProps<'/tasks/[id]'>) {
  const { id } = await props.params

  const repo = await getRepository()
  const [tasks, projects, businesses, audit] = await Promise.all([
    repo.listTasks(),
    repo.listProjects(),
    repo.listBusinesses(),
    repo.listEntityAudit('tasks', id),
  ])

  const task = tasks.find((t) => t.task_id === id)
  if (!task) notFound()

  const project = projects.find((p) => p.project_id === task.project_id) ?? null
  const businessId = project?.business_id ?? ''
  const company = businessName(businesses, businessId)

  const days = waitingDays(task)
  const overdue = dDay(task.deadline) < 0 && task.status !== 'Done'

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-5">
      <PageHeader
        icon="clipboard"
        title={task.title}
        code="CH-040"
        description={`${company}${project ? ` · ${project.name}` : ''} · ${task.task_id}`}
      >
        {/* 돌아갈 자리를 두 개 준다. 이 업무가 있던 목록과, 이 업무가 속한 회사다. */}
        <Link
          href={`/tasks?business=${encodeURIComponent(businessId)}`}
          className="rounded-lg border border-line px-2.5 py-1.5 text-[11.5px] text-ink-dim transition-colors hover:border-accent hover:text-ink"
        >
          업무 목록
        </Link>
        {businessId ? (
          <Link
            href={`/business/${encodeURIComponent(businessId)}`}
            className="rounded-lg border border-line px-2.5 py-1.5 text-[11.5px] text-ink-dim transition-colors hover:border-accent hover:text-ink"
          >
            {company}
          </Link>
        ) : null}
      </PageHeader>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="space-y-4">
          <section className="rounded-xl border border-line-soft bg-panel p-4">
            <h2 className="text-[13px] font-semibold">업무</h2>

            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 md:grid-cols-3">
              <Field label="담당자">{task.owner}</Field>

              <Field label="중요도">
                <span
                  className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${PRIORITY_TONE[task.priority]}`}
                >
                  {WORK_PRIORITY_LABEL_KO[task.priority]}
                </span>
              </Field>

              <Field label="상태">
                <span className={STATUS_TONE[task.status]}>
                  {TASK_STATUS_LABEL_KO[task.status]}
                </span>
              </Field>

              <Field label="마감">
                <span className={overdue ? 'text-critical' : ''}>
                  {task.deadline} · {formatDDay(task.deadline)}
                </span>
              </Field>

              <Field label="상태 진입일">{task.blocked_since}</Field>

              <Field label="대기일수">
                {task.status === 'Done' ? '—' : days > 0 ? `${days}일` : '오늘'}
              </Field>
            </dl>

            {project ? (
              <Link
                href={`/projects/${encodeURIComponent(project.project_id)}`}
                className="mt-4 flex items-center gap-1.5 rounded-lg border border-line-soft bg-raised px-3 py-2 text-[12px] text-ink-dim transition-colors hover:border-accent hover:text-ink"
              >
                <Icon name="folder" className="size-4 shrink-0 text-ink-muted" />
                <span className="min-w-0 flex-1 truncate">{project.name}</span>
                <span className="shrink-0 text-[11px] text-ink-muted">프로젝트 보기</span>
                <Icon name="chevron-right" className="size-3.5 shrink-0" />
              </Link>
            ) : (
              /* project_id는 있는데 프로젝트가 안 보이는 경우다. 지워졌거나 RLS가 가렸다. */
              <p className="mt-4 text-[11.5px] text-ink-muted">
                이 업무가 속한 프로젝트({task.project_id})를 볼 수 없습니다.
              </p>
            )}
          </section>

          <section className="rounded-xl border border-line-soft bg-panel p-4">
            <h2 className="flex items-baseline gap-2 text-[13px] font-semibold">
              이력
              <span className="text-[9px] font-normal text-ink-muted tnum">CH-051</span>
              <span className="text-[11px] font-normal text-ink-muted tnum">{audit.length}건</span>
            </h2>
            <p className="mt-1 mb-3 text-[11px] text-ink-muted">
              감사 기록(audit_log)을 이 업무로 되짚은 것이다. 지워지지 않는다.
            </p>
            <AuditTimeline
              records={audit}
              emptyMessage="아직 이 업무를 고친 기록이 없습니다."
            />
          </section>
        </div>

        <aside className="rounded-xl border border-line-soft bg-panel p-4 xl:sticky xl:top-4 xl:self-start">
          <h2 className="flex items-baseline gap-2 text-[13px] font-semibold">
            바꾸기
            <span className="text-[9px] font-normal text-ink-muted tnum">CH-040</span>
          </h2>
          <div className="mt-3">
            <TaskControls task={task} />
          </div>
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

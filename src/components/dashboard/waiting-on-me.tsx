import Link from 'next/link'

import { Icon } from '@/components/ui/icon'
import { dDay, formatDDay } from '@/lib/format'
import { businessName, businessOfProject } from '@/lib/lookup'
import { TASK_STATUS_LABEL_KO, type Business, type Project, type Task } from '@/types'

/**
 * CH-017 Waiting on Me.
 * 내 승인 하나 때문에 멈춰 있는 일들이다. 회사별로 묶는 이유는,
 * 같은 회사 건이 흩어져 있으면 "이 회사는 나 때문에 며칠째 서 있다"가 안 보이기 때문이다.
 */

/**
 * 대기일수 임계. 일주일 넘게 내 책상에 있으면 그건 이미 사고다.
 * 요구사항서 CH-017의 Acceptance는 '원 Task와 연결'이라 줄마다 /tasks/[id]로 가는 자리를 둔다.
 */
const STALE_DAYS = 7

/** 대기일수 = 지금 상태로 들어간 날부터 오늘까지(DEFERRED D-02 결정 A). */
function waitingDays(task: Task, today = new Date()): number {
  return Math.max(0, -dDay(task.blocked_since, today))
}

interface WaitingOnMeProps {
  tasks: Task[]
  /** Task → 회사를 잇는 다리. Task는 회사를 직접 들고 있지 않다. */
  projects: Project[]
  businesses: Business[]
}

export function WaitingOnMe({ tasks, projects, businesses }: WaitingOnMeProps) {
  const mine = tasks
    .filter((t) => t.chairman_needed && t.status !== 'Done')
    .sort((a, b) => waitingDays(b) - waitingDays(a) || a.deadline.localeCompare(b.deadline))

  // 회사별로 묶되 순서는 '가장 오래 기다린 건이 있는 회사'가 위로 온다.
  const groups: { businessId: string; items: Task[] }[] = []
  mine.forEach((t) => {
    const businessId = businessOfProject(projects, t.project_id)
    const found = groups.find((g) => g.businessId === businessId)
    if (found) found.items.push(t)
    else groups.push({ businessId, items: [t] })
  })

  const stale = mine.filter((t) => waitingDays(t) > STALE_DAYS).length

  return (
    <section className="flex h-full flex-col rounded-xl border border-line-soft bg-panel p-3.5">
      <div className="flex items-baseline justify-between">
        <h2 className="flex items-center gap-1.5 text-[13px] font-semibold">
          <Icon name="clipboard" className="size-4 text-ink-dim" />
          Waiting on Me
          <span className="text-[11px] font-normal text-ink-muted tnum">{mine.length}건</span>
        </h2>
        {/* CH-040으로 넘긴다. 같은 조건(회장 확인 대기)을 URL에 달아 보내야
            '전체 보기'가 다른 목록을 여는 것처럼 보이지 않는다. */}
        <Link
          href="/tasks?needed=1"
          className="text-[11px] text-ink-muted transition-colors hover:text-ink"
        >
          전체 보기
        </Link>
      </div>
      <p className="mt-0.5 text-[11px] tnum">
        {stale > 0 ? (
          <span className="text-critical">{STALE_DAYS}일 초과 {stale}건</span>
        ) : (
          <span className="text-ink-muted">{STALE_DAYS}일 초과 없음</span>
        )}
      </p>

      {mine.length === 0 ? (
        <p className="flex flex-1 items-center justify-center text-[12px] text-ink-muted">
          내 승인을 기다리는 업무가 없습니다.
        </p>
      ) : (
        <div className="-mx-1.5 mt-2 flex-1 space-y-2 overflow-y-auto">
          {groups.map((g) => (
            <div key={g.businessId}>
              <p className="px-1.5 text-[10px] font-semibold text-ink-muted">
                {businessName(businesses, g.businessId)}
                <span className="ml-1 font-normal tnum">{g.items.length}</span>
              </p>
              <ul className="mt-0.5 space-y-0.5">
                {g.items.map((t) => (
                  <WaitingItem key={t.task_id} task={t} />
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

function WaitingItem({ task }: { task: Task }) {
  const days = waitingDays(task)
  const stale = days > STALE_DAYS

  return (
    <li>
      {/* CH-017 Acceptance의 '원 Task와 연결'. 업무 단건 화면으로 바로 간다
          (DEFERRED D-12 선택지 A). 목록으로 보내던 시절이 UAT TC-010 P0 Fail의 원인이었다. */}
      <Link
        href={`/tasks/${encodeURIComponent(task.task_id)}`}
        className="block rounded-lg px-1.5 py-1 transition-colors hover:bg-raised/60">
        <div className="flex items-center gap-1.5">
          <p className="min-w-0 flex-1 truncate text-[12px] leading-snug font-semibold">
            {task.title}
          </p>
          <span
            className={`shrink-0 text-[11px] font-semibold tnum ${
              stale ? 'text-critical' : days > 0 ? 'text-warning' : 'text-ink-muted'
            }`}
          >
            {days > 0 ? `대기 ${days}일` : '오늘 접수'}
          </span>
        </div>
        <p className="mt-0.5 flex items-center gap-1.5 text-[10px] text-ink-muted tnum">
          <span className="rounded bg-raised px-1 py-px">{TASK_STATUS_LABEL_KO[task.status]}</span>
          {task.owner}
          <span className={dDay(task.deadline) < 0 ? 'text-critical' : ''}>
            {formatDDay(task.deadline)}
          </span>
        </p>
      </Link>
    </li>
  )
}

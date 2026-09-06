'use client'

import { useState, useTransition } from 'react'

import { setChairmanNeeded, setTaskStatus } from '@/app/actions/tasks'
import { Icon } from '@/components/ui/icon'
import { dDay, formatDDay } from '@/lib/format'
import {
  TASK_STATUS,
  TASK_STATUS_LABEL_KO,
  WORK_PRIORITY_LABEL_KO,
  type Task,
  type TaskStatus,
  type WorkPriority,
} from '@/types'

/**
 * CH-040 업무 한 줄.
 *
 * 이 줄만 클라이언트다. 목록 전체를 클라이언트로 올리면 회사·프로젝트 이름표까지
 * 브라우저로 실려 가고, 그 이름들은 RLS가 이미 걸러 준 서버 쪽 값이다.
 *
 * 바꾼 결과는 서버가 다시 그려 준다(revalidatePath). 그래서 여기서 목록을 직접 고치지 않고,
 * 요청이 끝날 때까지 방금 고른 값만 임시로 보여 준다 — 안 그러면 한 박자 동안 옛 값으로 돌아간다.
 */

const PRIORITY_TONE: Record<WorkPriority, string> = {
  Critical: 'bg-critical/15 text-critical',
  High: 'bg-warning/15 text-warning',
  Medium: 'bg-raised text-ink-dim',
  Low: 'bg-raised text-ink-muted',
}

/** 상태 색. Blocked만 색을 준다 — 색은 위험에만 쓴다(요구사항서 2번). */
const STATUS_TONE: Record<TaskStatus, string> = {
  Todo: 'text-ink-muted',
  Doing: 'text-ink-dim',
  Blocked: 'text-critical',
  Done: 'text-ok',
}

/** 지금 상태로 들어간 지 며칠인가(DEFERRED D-02 결정 A). */
function waitingDays(task: Task, today = new Date()): number {
  return Math.max(0, -dDay(task.blocked_since, today))
}

export function TaskRow({
  task,
  businessName,
  projectName,
  onError,
}: {
  task: Task
  businessName: string
  projectName: string
  onError: (message: string | null) => void
}) {
  const [pending, startTransition] = useTransition()
  const [draftStatus, setDraftStatus] = useState<TaskStatus | null>(null)
  const [draftNeeded, setDraftNeeded] = useState<boolean | null>(null)

  const status = draftStatus ?? task.status
  const needed = draftNeeded ?? task.chairman_needed
  const days = waitingDays(task)
  const overdue = dDay(task.deadline) < 0 && task.status !== 'Done'

  function changeStatus(next: TaskStatus) {
    if (next === status) return
    onError(null)
    setDraftStatus(next)
    startTransition(async () => {
      const result = await setTaskStatus(task.task_id, next)
      // 실패하면 고른 값을 버린다. 안 바뀐 걸 바뀐 것처럼 두면 새로고침에서 되돌아간다.
      if (result.error) {
        setDraftStatus(null)
        onError(result.error)
      }
    })
  }

  function toggleNeeded() {
    const next = !needed
    onError(null)
    setDraftNeeded(next)
    startTransition(async () => {
      const result = await setChairmanNeeded(task.task_id, next)
      if (result.error) {
        setDraftNeeded(null)
        onError(result.error)
      }
    })
  }

  return (
    <tr className={`border-t border-line-soft transition-opacity ${pending ? 'opacity-50' : ''}`}>
      <td className="px-3 py-2">
        <p className="text-[12.5px] leading-snug font-semibold">{task.title}</p>
        <p className="mt-0.5 truncate text-[10.5px] text-ink-muted">
          {businessName} · {projectName}
        </p>
      </td>

      <td className="px-3 py-2 text-[11.5px] text-ink-dim">{task.owner}</td>

      <td className="px-3 py-2">
        <span
          className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${PRIORITY_TONE[task.priority]}`}
        >
          {WORK_PRIORITY_LABEL_KO[task.priority]}
        </span>
      </td>

      <td className="px-3 py-2">
        {/* 06_상태코드의 4개만 고를 수 있다. 자유 입력을 두면 임의 상태명이 생긴다. */}
        <select
          value={status}
          disabled={pending}
          aria-label={`${task.title} 상태`}
          onChange={(e) => changeStatus(e.target.value as TaskStatus)}
          className={`rounded-md border border-line bg-raised px-1.5 py-1 text-[11.5px] outline-none focus:border-accent disabled:opacity-50 ${STATUS_TONE[status]}`}
        >
          {TASK_STATUS.map((s) => (
            <option key={s} value={s} className="bg-panel text-ink">
              {TASK_STATUS_LABEL_KO[s]}
            </option>
          ))}
        </select>
      </td>

      <td className="px-3 py-2 text-right text-[11.5px] text-ink-muted tnum">
        {status === 'Done' ? '—' : days > 0 ? `${days}일` : '오늘'}
      </td>

      <td
        className={`px-3 py-2 text-right text-[11.5px] font-semibold tnum ${
          overdue ? 'text-critical' : 'text-ink-dim'
        }`}
      >
        {formatDDay(task.deadline)}
      </td>

      <td className="px-3 py-2 text-center">
        {/* CH-017. 이 플래그 하나가 그 업무를 회장 화면으로 올리는 유일한 조건이다. */}
        <button
          type="button"
          onClick={toggleNeeded}
          disabled={pending}
          aria-pressed={needed}
          title={needed ? '회장 확인 대기에서 내린다' : '회장 확인 대기로 올린다'}
          aria-label={`${task.title} 회장 확인`}
          className={`rounded-md p-1.5 transition-colors disabled:opacity-50 ${
            needed ? 'bg-gold/15 text-gold' : 'text-ink-muted hover:bg-raised hover:text-ink-dim'
          }`}
        >
          <Icon name="crown" className="size-4" filled={needed} />
        </button>
      </td>
    </tr>
  )
}

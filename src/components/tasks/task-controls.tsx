'use client'

import { useState, useTransition } from 'react'

import { setChairmanNeeded, setTaskStatus } from '@/app/actions/tasks'
import { Icon } from '@/components/ui/icon'
import {
  TASK_STATUS,
  TASK_STATUS_LABEL_KO,
  type Task,
  type TaskStatus,
} from '@/types'

/**
 * CH-040 업무 단건 화면의 조작부 (DEFERRED D-12 선택지 A).
 *
 * task-row.tsx와 같은 Server Action을 부른다. 목록과 단건이 다른 경로로 저장하면
 * 감사 기록이 두 모양으로 남는다 — 저장하는 자리는 app/actions/tasks.ts 하나다.
 *
 * 목록의 줄과 달리 여기서는 실패 문장을 자기 안에 그린다. 단건 화면에는
 * 실패를 올려 보낼 표 머리가 없고, 화면에 조작할 것이 이것뿐이라 옆에 붙는 편이 읽힌다.
 */
export function TaskControls({ task }: { task: Task }) {
  const [pending, startTransition] = useTransition()
  const [draftStatus, setDraftStatus] = useState<TaskStatus | null>(null)
  const [draftNeeded, setDraftNeeded] = useState<boolean | null>(null)
  const [error, setError] = useState<string | null>(null)

  const status = draftStatus ?? task.status
  const needed = draftNeeded ?? task.chairman_needed

  function changeStatus(next: TaskStatus) {
    if (next === status) return
    setError(null)
    setDraftStatus(next)
    startTransition(async () => {
      const result = await setTaskStatus(task.task_id, next)
      // 실패하면 고른 값을 버린다. 안 바뀐 걸 바뀐 것처럼 두면 새로고침에서 되돌아간다.
      if (result.error) {
        setDraftStatus(null)
        setError(result.error)
      }
    })
  }

  function toggleNeeded() {
    const next = !needed
    setError(null)
    setDraftNeeded(next)
    startTransition(async () => {
      const result = await setChairmanNeeded(task.task_id, next)
      if (result.error) {
        setDraftNeeded(null)
        setError(result.error)
      }
    })
  }

  return (
    <div className={`space-y-3 transition-opacity ${pending ? 'opacity-50' : ''}`}>
      <label className="block">
        <span className="text-[11px] text-ink-dim">상태</span>
        {/* 06_상태코드의 4개만 고를 수 있다. 자유 입력을 두면 임의 상태명이 생긴다. */}
        <select
          value={status}
          disabled={pending}
          aria-label="업무 상태"
          onChange={(e) => changeStatus(e.target.value as TaskStatus)}
          className="mt-1 w-full rounded-lg border border-line bg-raised px-2.5 py-2 text-[12.5px] text-ink outline-none focus:border-accent disabled:opacity-50"
        >
          {TASK_STATUS.map((s) => (
            <option key={s} value={s} className="bg-panel text-ink">
              {TASK_STATUS_LABEL_KO[s]}
            </option>
          ))}
        </select>
      </label>

      <div>
        <span className="text-[11px] text-ink-dim">회장 확인</span>
        {/* CH-017. 이 플래그 하나가 그 업무를 회장 화면으로 올리는 유일한 조건이다. */}
        <button
          type="button"
          onClick={toggleNeeded}
          disabled={pending}
          aria-pressed={needed}
          className={`mt-1 flex w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-[12.5px] transition-colors disabled:opacity-50 ${
            needed
              ? 'border-gold/50 bg-gold/15 text-gold'
              : 'border-line bg-raised text-ink-muted hover:text-ink-dim'
          }`}
        >
          <Icon name="crown" className="size-4 shrink-0" filled={needed} />
          {needed ? '대기 중 — 누르면 내린다' : '올리지 않음 — 누르면 올린다'}
        </button>
      </div>

      {error ? (
        <p
          role="alert"
          className="flex items-start gap-1.5 rounded-lg border border-critical/40 bg-critical/10 px-2.5 py-2 text-[11.5px] leading-snug text-critical"
        >
          <Icon name="shield" className="mt-px size-3.5 shrink-0" />
          {error}
        </p>
      ) : null}

      <p className="text-[10.5px] leading-relaxed text-ink-muted">
        바꾼 값은 감사 기록(audit_log)에 남고 지워지지 않는다(CH-051). 제목·담당자·마감은
        여기서 고치지 않는다 — 그건 Business OS(Layer 1)가 갖는 칸이다.
      </p>
    </div>
  )
}

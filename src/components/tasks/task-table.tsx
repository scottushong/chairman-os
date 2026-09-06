'use client'

import { useState } from 'react'

import { TaskRow } from '@/components/tasks/task-row'
import type { Task } from '@/types'

/**
 * CH-040 업무 목록.
 *
 * 이름표(회사·프로젝트)는 서버가 이미 붙여서 내려 준다. 여기서 businesses/projects 배열을
 * 통째로 받아 훑으면 목록 길이 × 회사 수만큼 같은 배열을 다시 도는 셈이 되고,
 * 그 배열들이 브라우저 번들에 실린다.
 *
 * 실패 문구를 표 하나에 한 자리만 두는 이유는, 줄마다 두면 스크롤 밖에서 실패한 걸 못 보기 때문이다.
 */

export interface TaskListItem {
  task: Task
  businessName: string
  projectName: string
}

export function TaskTable({ items }: { items: TaskListItem[] }) {
  const [error, setError] = useState<string | null>(null)

  return (
    <div className="mt-3 rounded-xl border border-line-soft bg-panel">
      {error ? (
        <p
          role="alert"
          className="m-3 rounded-md border border-critical/40 bg-critical/10 px-2.5 py-1.5 text-[11.5px] text-critical"
        >
          {error}
        </p>
      ) : null}

      {items.length === 0 ? (
        <p className="px-4 py-10 text-center text-[12.5px] text-ink-muted">
          조건에 맞는 업무가 없습니다.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] border-collapse">
            <thead>
              <tr className="text-[10px] tracking-[0.08em] text-ink-muted">
                <th className="px-3 py-2 text-left font-semibold">업무</th>
                <th className="px-3 py-2 text-left font-semibold">담당</th>
                <th className="px-3 py-2 text-left font-semibold">중요도</th>
                <th className="px-3 py-2 text-left font-semibold">상태</th>
                <th className="px-3 py-2 text-right font-semibold">경과</th>
                <th className="px-3 py-2 text-right font-semibold">마감</th>
                <th className="px-3 py-2 text-center font-semibold">회장확인</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <TaskRow
                  key={it.task.task_id}
                  task={it.task}
                  businessName={it.businessName}
                  projectName={it.projectName}
                  onError={setError}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

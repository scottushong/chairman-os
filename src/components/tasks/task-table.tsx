'use client'

import { useState } from 'react'

import { TaskRow } from '@/components/tasks/task-row'
import { boss } from '@/lib/boss'
import type { Role, Task } from '@/types'

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

export function TaskTable({ items, viewerRole }: { items: TaskListItem[]; viewerRole: Role | null }) {
  const [error, setError] = useState<string | null>(null)

  return (
    // 폰에서는 줄마다 카드가 되므로(아래 m-cards) 바깥 상자의 테두리 · 배경을 걷는다 — 카드 속 카드가 된다.
    <div className="mt-3 rounded-xl border border-line-soft bg-panel max-sm:border-0 max-sm:bg-transparent">
      {error ? (
        <p
          role="alert"
          className="m-3 rounded-md border border-critical/40 bg-critical/10 px-2.5 py-1.5 text-t11h text-critical"
        >
          {error}
        </p>
      ) : null}

      {items.length === 0 ? (
        <p className="px-4 py-10 text-center text-t12h text-ink-muted">
          조건에 맞는 업무가 없습니다.
        </p>
      ) : (
        // 폰(640px 이하): 일곱 칸 표를 옆으로 미는 대신 업무 하나를 카드 하나로 세운다(m-cards).
        // 태블릿은 표 그대로 자기 상자 안에서 민다. m-sticky-first는 달지 않는다 — 카드가 된 첫 칸에
        // 앱 배경색이 깔려 카드 안에 띠가 생긴다.
        <div className="overflow-x-auto">
          <table className="m-cards w-full border-collapse sm:min-w-[860px]">
            <thead>
              <tr className="text-t10 tracking-[0.08em] text-ink-muted">
                <th className="px-3 py-2 text-left font-semibold">업무</th>
                <th className="px-3 py-2 text-left font-semibold">담당</th>
                <th className="px-3 py-2 text-left font-semibold">중요도</th>
                <th className="px-3 py-2 text-left font-semibold">상태</th>
                <th className="px-3 py-2 text-right font-semibold">경과</th>
                <th className="px-3 py-2 text-right font-semibold">마감</th>
                <th className="px-3 py-2 text-center font-semibold">{boss(viewerRole)}확인</th>
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
                  viewerRole={viewerRole}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

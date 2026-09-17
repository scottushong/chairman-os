'use client'

import { useState } from 'react'

import { saveChairmanProject } from '@/app/actions/chairman'
import { Icon } from '@/components/ui/icon'
import {
  CHAIRMAN_PROJECT_STATUS,
  CHAIRMAN_PROJECT_STATUS_LABEL_KO,
  type ChairmanProject,
  type ChairmanProjectStatus,
} from '@/types'

/**
 * /settings/chairman 장기 프로젝트 한 건. project가 없으면 '추가' 폼이다.
 * 목록은 서버가 다시 그린다(revalidatePath). 여기서는 폼 상태만 들고 있는다.
 */

const INPUT =
  'mt-1 w-full rounded-lg border border-line bg-raised px-3 py-2 text-[13px] text-ink outline-none placeholder:text-ink-muted focus:border-accent disabled:opacity-50'

export function ChairmanProjectEditor({ project }: { project?: ChairmanProject }) {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState(project?.title ?? '')
  const [startDate, setStartDate] = useState(project?.start_date ?? '')
  const [targetDate, setTargetDate] = useState(project?.target_date ?? '')
  const [note, setNote] = useState(project?.note ?? '')
  const [thisMonthAction, setThisMonthAction] = useState(project?.this_month_action ?? '')
  const [status, setStatus] = useState<ChairmanProjectStatus>(project?.status ?? 'Active')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const result = await saveChairmanProject({
      projectId: project?.project_id,
      title,
      startDate,
      targetDate,
      note,
      thisMonthAction,
      status,
    })
    setBusy(false)
    if (result.error) {
      setError(result.error)
      return
    }
    setOpen(false)
    if (!project) {
      setTitle('')
      setStartDate('')
      setTargetDate('')
      setNote('')
      setThisMonthAction('')
      setStatus('Active')
    }
  }

  if (!open) {
    return project ? (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-ink-muted transition-colors hover:bg-raised hover:text-ink"
      >
        <Icon name="pencil" className="size-3.5" />
        편집
      </button>
    ) : (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 rounded-md border border-line bg-panel px-3 py-1.5 text-[12px] text-ink-dim transition-colors hover:border-accent hover:text-ink"
      >
        <Icon name="plus" className="size-3.5" />
        장기 프로젝트 추가
      </button>
    )
  }

  return (
    <form
      onSubmit={submit}
      aria-label={project ? `${project.title} 편집` : '장기 프로젝트 추가'}
      className="mt-2 w-full rounded-xl border border-line bg-panel p-4"
    >
      <div className="grid gap-3 md:grid-cols-2">
        <label className="block md:col-span-2">
          <span className="text-[11px] text-ink-dim">제목</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} disabled={busy} className={INPUT} />
        </label>
        <label className="block">
          <span className="text-[11px] text-ink-dim">시작일</span>
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} disabled={busy} className={INPUT} />
        </label>
        <label className="block">
          <span className="text-[11px] text-ink-dim">목표일</span>
          <input type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} disabled={busy} className={INPUT} />
        </label>
        <label className="block md:col-span-2">
          <span className="text-[11px] text-ink-dim">이번 달 액션</span>
          <input
            value={thisMonthAction}
            onChange={(e) => setThisMonthAction(e.target.value)}
            maxLength={2000}
            disabled={busy}
            className={INPUT}
          />
        </label>
        <label className="block md:col-span-2">
          <span className="text-[11px] text-ink-dim">메모</span>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={2000} disabled={busy} className={INPUT} />
        </label>
        <label className="block">
          <span className="text-[11px] text-ink-dim">상태</span>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as ChairmanProjectStatus)}
            disabled={busy}
            className={INPUT}
          >
            {CHAIRMAN_PROJECT_STATUS.map((s) => (
              <option key={s} value={s} className="bg-panel">
                {CHAIRMAN_PROJECT_STATUS_LABEL_KO[s]}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error ? (
        <p role="alert" className="mt-3 text-[11.5px] text-critical">
          {error}
        </p>
      ) : null}

      <div className="mt-3 flex justify-end gap-2">
        <button
          type="button"
          onClick={() => setOpen(false)}
          disabled={busy}
          className="rounded-md px-3 py-1.5 text-[12px] text-ink-muted transition-colors hover:text-ink"
        >
          취소
        </button>
        <button
          type="submit"
          disabled={busy || !title.trim() || !startDate || !targetDate}
          className="rounded-md bg-accent px-3 py-1.5 text-[12px] font-semibold text-app transition-opacity disabled:opacity-40"
        >
          {busy ? '저장 중…' : '저장'}
        </button>
      </div>
    </form>
  )
}

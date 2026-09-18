'use client'

import { useState } from 'react'

import { removeEventAction, saveEventAction } from '@/app/actions/initiatives'
import { Icon } from '@/components/ui/icon'
import { EVENT_KIND, EVENT_KIND_LABEL_KO, type ChairmanEvent, type EventKind } from '@/types'

/**
 * 회장 일정(0017 events). 상세(`/initiatives/[id]`)와 캘린더(Task 8) 양쪽에서 쓴다 —
 * initiativeId/businessId를 둘 다 선택으로 받는 이유가 그것이다. 이 화면에서는 initiativeId만
 * 넘긴다.
 *
 * keymen-panel.tsx의 draft 패턴을 따른다. 종료일은 비울 수 있다(하루짜리 일정).
 * 삭제는 removeEventAction(eventId, initiativeId) — 두 번째 인자는 액션 시그니처상 선택이지만
 * 여기서는 반드시 넘긴다. 안 넘기면 이 상세 화면이 갱신되지 않는다.
 */

interface Draft {
  eventId?: string
  title: string
  kind: EventKind
  startsOn: string
  endsOn: string
  location: string
}

const EMPTY: Draft = { title: '', kind: 'Meeting', startsOn: '', endsOn: '', location: '' }

export function EventPanel({
  events,
  canEdit,
  initiativeId,
  businessId,
}: {
  events: ChairmanEvent[]
  canEdit: boolean
  /** 새 일정이 걸릴 이니셔티브. 캘린더에서 이 패널을 쓸 때는 없을 수 있다. */
  initiativeId?: string
  businessId?: string
}) {
  const [list, setList] = useState(events)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const sorted = [...list].sort((a, b) => a.starts_on.localeCompare(b.starts_on))

  async function submit() {
    if (!draft || busy) return
    setBusy(true)
    setError(null)
    const result = await saveEventAction({
      event_id: draft.eventId,
      title: draft.title,
      kind: draft.kind,
      starts_on: draft.startsOn,
      ends_on: draft.endsOn,
      location: draft.location,
      initiative_id: initiativeId,
      business_id: businessId,
    })
    setBusy(false)
    if (result.error || !result.saved) {
      setError(result.error ?? '저장하지 못했습니다.')
      return
    }
    const saved = result.saved
    setList((l) => [...l.filter((e) => e.event_id !== saved.event_id), saved])
    setDraft(null)
  }

  async function remove(e: ChairmanEvent) {
    if (busy) return
    setBusy(true)
    setError(null)
    const result = await removeEventAction(e.event_id, initiativeId)
    setBusy(false)
    if (result.error) {
      setError(result.error)
      return
    }
    setList((l) => l.filter((x) => x.event_id !== e.event_id))
  }

  return (
    <section className="rounded-xl border border-line-soft bg-panel p-4">
      <div className="flex items-baseline justify-between">
        <h2 className="flex items-center gap-1.5 text-[13px] font-semibold">
          <Icon name="calendar" className="size-4 text-ink-dim" />
          일정
          <span className="text-[11px] font-normal text-ink-muted tnum">{list.length}건</span>
        </h2>
        {canEdit && !draft ? (
          <button
            type="button"
            onClick={() => {
              setError(null)
              setDraft(EMPTY)
            }}
            className="flex items-center gap-1 rounded-md border border-line px-2 py-1 text-[11px] text-ink-dim transition-colors hover:border-accent hover:text-ink"
          >
            <Icon name="plus" className="size-3" />
            추가
          </button>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="mt-2.5 rounded-md border border-critical/40 bg-critical/10 px-2.5 py-1.5 text-[11.5px] text-critical">
          {error}
        </p>
      ) : null}

      {draft ? (
        <div className="mt-2.5 grid gap-2 rounded-lg bg-raised/60 p-2.5 md:grid-cols-5">
          <Field label="제목" value={draft.title} onChange={(title) => setDraft({ ...draft, title })} maxLength={500} />
          <label className="block text-[10px] font-semibold tracking-[0.08em] text-ink-muted">
            종류
            <select
              value={draft.kind}
              onChange={(e) => setDraft({ ...draft, kind: e.target.value as EventKind })}
              className="mt-1 w-full rounded-md border border-line bg-panel px-2 py-1.5 text-[12px] font-normal text-ink outline-none focus:border-accent"
            >
              {EVENT_KIND.map((k) => (
                <option key={k} value={k}>
                  {EVENT_KIND_LABEL_KO[k]}
                </option>
              ))}
            </select>
          </label>
          <Field
            label="시작일"
            type="date"
            value={draft.startsOn}
            onChange={(startsOn) => setDraft({ ...draft, startsOn })}
          />
          <Field
            label="종료일"
            type="date"
            value={draft.endsOn}
            onChange={(endsOn) => setDraft({ ...draft, endsOn })}
          />
          <Field label="장소" value={draft.location} onChange={(location) => setDraft({ ...draft, location })} maxLength={300} />
          <div className="flex items-center gap-1.5 md:col-span-5">
            <button
              type="button"
              onClick={submit}
              disabled={busy}
              className="rounded bg-accent px-2 py-1 text-[11px] font-semibold text-ink disabled:opacity-40"
            >
              {busy ? '저장 중…' : '저장'}
            </button>
            <button
              type="button"
              onClick={() => setDraft(null)}
              disabled={busy}
              className="rounded px-2 py-1 text-[11px] text-ink-muted hover:text-ink disabled:opacity-40"
            >
              취소
            </button>
          </div>
        </div>
      ) : null}

      {sorted.length === 0 && !draft ? (
        <p className="py-5 text-center text-[12px] text-ink-muted">
          등록된 일정이 없습니다.
          {canEdit ? '' : ' 등록은 회장 / 그룹 CFO만 할 수 있습니다.'}
        </p>
      ) : (
        <ul className="mt-2 divide-y divide-line-soft">
          {sorted.map((e) => (
            <li key={e.event_id} className="flex items-center gap-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12.5px] font-semibold">
                  {e.title}
                  <span className="ml-1.5 text-[11px] font-normal text-ink-muted">{EVENT_KIND_LABEL_KO[e.kind]}</span>
                </p>
                {e.location ? <p className="truncate text-[11px] text-ink-muted">{e.location}</p> : null}
              </div>
              <span className="shrink-0 text-[11px] text-ink-dim tnum">
                {e.starts_on}
                {e.ends_on && e.ends_on !== e.starts_on ? ` ~ ${e.ends_on}` : ''}
              </span>
              {canEdit ? (
                <button
                  type="button"
                  aria-label={`${e.title} 지우기`}
                  onClick={() => remove(e)}
                  disabled={busy}
                  className="shrink-0 rounded px-1 text-[11px] text-ink-muted hover:text-critical disabled:opacity-40"
                >
                  삭제
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function Field({
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
  maxLength,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  type?: 'text' | 'date'
  placeholder?: string
  maxLength?: number
}) {
  return (
    <label className="block text-[10px] font-semibold tracking-[0.08em] text-ink-muted">
      {label}
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        maxLength={maxLength}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-md border border-line bg-panel px-2 py-1.5 text-[12px] font-normal text-ink outline-none placeholder:text-ink-muted focus:border-accent"
      />
    </label>
  )
}

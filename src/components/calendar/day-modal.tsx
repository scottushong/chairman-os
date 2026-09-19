'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'

import { removeEventAction, saveEventAction } from '@/app/actions/initiatives'
import { Icon } from '@/components/ui/icon'
import {
  CALENDAR_ITEM_LABEL_KO, EVENT_KIND, EVENT_KIND_LABEL_KO,
  type CalendarItem, type ChairmanEvent, type EventKind, type IsoDate,
} from '@/types'

/**
 * 캘린더 날짜 팝업 (Phase 4-A 다듬기 2번).
 *
 * 한 날짜에 걸리는 것 전부를 보여 주고, 그중 **이벤트만** 이 자리에서 고친다.
 * 다음 행동·마일스톤·결재 마감은 원본이 다른 표다 — 링크로 보낸다.
 *
 * 삭제 확인에 window.confirm을 쓰지 않는다. 브라우저 모달은 이 다이얼로그 위에 또 하나를
 * 띄워 포커스 관리를 두 번 하게 만들고, 자동화(스크린샷)를 멈춘다. 지우기를 누르면
 * 그 줄이 '지운다 / 취소'로 바뀐다 — 확인은 똑같이 한 번이다.
 *
 * 저장·삭제는 event-panel.tsx와 같은 Server Action을 부른다. 그쪽이 revalidatePath로
 * /calendar를 다시 그리므로, 이 컴포넌트는 낙관적 목록(list)만 들고 있다가 닫으면 된다.
 */

interface Draft {
  eventId?: string
  title: string
  kind: EventKind
  startsOn: string
  endsOn: string
  location: string
  // 이 모달은 그 셋을 고치지 않지만, 안 실어 보내면 saveEventAction이 null/''로 채워
  // 이니셔티브·회사 연결과 메모가 조용히 끊긴다 — 폼에는 안 넣고 그대로 실어 나르기만 한다.
  // 같은 Server Action을 쓰는 형제가 initiatives/event-panel.tsx다. 그쪽 Draft에도 note가
  // 있어야 한다(없어서 메모가 지워질 뻔했다) — 한쪽만 고치면 다른 쪽이 다시 깨진다.
  initiativeId: string | null
  businessId: string | null
  note: string
}

function emptyDraft(day: IsoDate): Draft {
  // 새 일정의 시작일은 누른 날짜다. 비워 두면 회장이 달력에서 날짜를 골라 놓고 또 고른다.
  // 캘린더에서 새로 만드는 일정은 정말로 어디에도 안 걸린다 — null/null/''이 맞다.
  return {
    title: '', kind: 'Meeting', startsOn: day, endsOn: '', location: '',
    initiativeId: null, businessId: null, note: '',
  }
}

function draftOf(e: ChairmanEvent): Draft {
  return {
    eventId: e.event_id,
    title: e.title,
    kind: e.kind,
    startsOn: e.starts_on,
    endsOn: e.ends_on ?? '',
    location: e.location,
    initiativeId: e.initiative_id,
    businessId: e.business_id,
    note: e.note,
  }
}

export function DayModal({
  day,
  items,
  events,
  canEdit,
  onClose,
}: {
  day: IsoDate
  /** 이 날에 걸리는 calendar_items 전부 (호출자가 occursOn으로 이미 걸렀다) */
  items: CalendarItem[]
  /** 이 날에 걸리는 events 원본 (수정 대상) */
  events: ChairmanEvent[]
  canEdit: boolean
  onClose: () => void
}) {
  const [list, setList] = useState(events)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  // 열리면 포커스를 안으로 들인다. 안 하면 Tab이 뒤의 달력을 훑는다.
  useEffect(() => {
    ref.current?.focus()
  }, [])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  // 이벤트가 아닌 항목만 링크로 남긴다. 이벤트는 아래 목록에서 고친다.
  const others = items.filter((it) => it.kind !== 'event')

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
      initiative_id: draft.initiativeId,
      business_id: draft.businessId,
      note: draft.note,
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
    // 두 번째 인자는 이 이벤트가 걸린 이니셔티브다. 안 넘기면 그 상세 화면이 갱신되지 않는다.
    const result = await removeEventAction(e.event_id, e.initiative_id ?? undefined)
    setBusy(false)
    setConfirming(null)
    if (result.error) {
      setError(result.error)
      return
    }
    setList((l) => l.filter((x) => x.event_id !== e.event_id))
  }

  const sorted = [...list].sort((a, b) => a.starts_on.localeCompare(b.starts_on))
  const [, m, d] = day.split('-')

  return (
    // 바깥을 누르면 닫힌다. 안쪽 클릭이 올라와 닫히지 않게 stopPropagation을 건다.
    //
    // 스크림은 bg-black/50이 아니라 bg-app/80이다(add-business-modal.tsx와 같은 면).
    // 검정 스크림은 웜 팔레트를 회색으로 죽이고(globals.css '검정 그림자를 쓰면' 주석),
    // 그 위에 얹은 bg-panel 한 겹은 실효 rgb(196,194,191)까지 내려가 ink-muted 3.35:1 ·
    // critical 3.33:1로 AA를 못 넘겼다 — 이 모달의 폼 라벨이 전부 ink-muted다.
    // --color-app이 유일한 불투명 면인 이유가 바로 '모달 오버레이 바탕'이다(globals.css:31).
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-app/80 p-4 sm:items-center"
      onClick={onClose}
    >
      {/* 다이얼로그 면은 .glass다(GlassCard와 같은 면 — 그림자·흐림·@supports 폴백이 딸려 온다).
          bg-app/80 스크림 위의 흰 55%라 실효색이 rgb(250,242,233)까지 올라가고,
          그라데이션 최악점(#f0b58a) 기준으로 ink 15.60 · ink-dim 9.23 · ink-muted 5.40 ·
          critical 5.36:1이다. shadow-xl은 뗀다 — .glass가 이미 그림자를 갖는다. */}
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={`${Number(m)}월 ${Number(d)}일 일정`}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="glass w-full max-w-lg rounded-glass border border-line p-4 outline-none"
      >
        <div className="flex items-baseline justify-between">
          <h2 className="text-[14px] font-semibold tnum">
            {Number(m)}월 {Number(d)}일
            <span className="ml-2 text-[11px] font-normal text-ink-muted">
              {/* items(연 시점의 정적 prop)가 아니라 list/others — 목록과 같은 상태에서 세야
                  추가·삭제 직후에도 헤더 건수와 아래 목록이 어긋나지 않는다. */}
              {list.length + others.length}건
            </span>
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="rounded px-1.5 py-0.5 text-[12px] text-ink-muted hover:text-ink"
          >
            ✕
          </button>
        </div>

        {error ? (
          <p role="alert" className="mt-2.5 rounded-md border border-critical/40 bg-critical/10 px-2.5 py-1.5 text-[11.5px] text-critical">
            {error}
          </p>
        ) : null}

        {/* 이벤트 — 이 자리에서 고친다 */}
        <ul className="mt-3 divide-y divide-line-soft">
          {sorted.map((e) => (
            <li key={e.event_id} className="py-2">
              {draft?.eventId === e.event_id ? (
                <EventForm
                  draft={draft}
                  setDraft={setDraft}
                  onSubmit={submit}
                  onCancel={() => setDraft(null)}
                  busy={busy}
                />
              ) : confirming === e.event_id ? (
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink-dim">
                    «{e.title}» 을(를) 지웁니다.
                  </span>
                  <button
                    type="button"
                    onClick={() => remove(e)}
                    disabled={busy}
                    className="shrink-0 rounded bg-critical px-2 py-1 text-[11px] font-semibold text-ink disabled:opacity-40"
                  >
                    {busy ? '지우는 중…' : '지운다'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirming(null)}
                    disabled={busy}
                    className="shrink-0 rounded px-2 py-1 text-[11px] text-ink-muted hover:text-ink disabled:opacity-40"
                  >
                    취소
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      if (!canEdit) return
                      setError(null)
                      setDraft(draftOf(e))
                    }}
                    disabled={!canEdit}
                    aria-label={canEdit ? `${e.title} 고치기` : undefined}
                    className="min-w-0 flex-1 rounded px-1 py-0.5 text-left transition-colors enabled:hover:bg-raised"
                  >
                    <p className="truncate text-[12.5px] font-semibold">
                      {e.title}
                      <span className="ml-1.5 text-[11px] font-normal text-ink-muted">
                        {EVENT_KIND_LABEL_KO[e.kind]}
                      </span>
                    </p>
                    {e.location ? (
                      <p className="truncate text-[11px] text-ink-muted">{e.location}</p>
                    ) : null}
                  </button>
                  <span className="shrink-0 text-[11px] text-ink-dim tnum">
                    {e.ends_on && e.ends_on !== e.starts_on ? `${e.starts_on} ~ ${e.ends_on}` : ''}
                  </span>
                  {canEdit ? (
                    <button
                      type="button"
                      onClick={() => setConfirming(e.event_id)}
                      aria-label={`${e.title} 지우기`}
                      className="shrink-0 rounded px-1 text-[11px] text-ink-muted hover:text-critical"
                    >
                      삭제
                    </button>
                  ) : null}
                </div>
              )}
            </li>
          ))}
        </ul>

        {/* 이벤트가 아닌 것 — 원본이 다른 표다. 링크로 보낸다 */}
        {others.length > 0 ? (
          <ul className="mt-2 space-y-1 border-t border-line-soft pt-2">
            {others.map((it) => (
              <li key={`${it.kind}-${it.source_id}`}>
                <Link
                  href={it.href}
                  className="block truncate text-[11.5px] text-ink-dim hover:text-ink hover:underline"
                >
                  <span className="text-ink-muted">{CALENDAR_ITEM_LABEL_KO[it.kind]}</span> · {it.title}
                </Link>
              </li>
            ))}
          </ul>
        ) : null}

        {sorted.length === 0 && others.length === 0 ? (
          <p className="py-6 text-center text-[12px] text-ink-muted">이 날에는 아무것도 없습니다.</p>
        ) : null}

        {/* 새 일정 */}
        {canEdit && draft && !draft.eventId ? (
          <div className="mt-3 rounded-lg bg-raised/60 p-2.5">
            <EventForm
              draft={draft}
              setDraft={setDraft}
              onSubmit={submit}
              onCancel={() => setDraft(null)}
              busy={busy}
            />
          </div>
        ) : null}

        {canEdit && !draft ? (
          <button
            type="button"
            onClick={() => {
              setError(null)
              setConfirming(null)
              setDraft(emptyDraft(day))
            }}
            className="mt-3 flex items-center gap-1 rounded-md border border-line px-2 py-1 text-[11px] text-ink-dim transition-colors hover:border-accent hover:text-ink"
          >
            <Icon name="plus" className="size-3" />
            추가
          </button>
        ) : null}
      </div>
    </div>
  )
}

/** 추가와 수정이 같은 폼이다 — draft.eventId 유무로만 갈린다. */
function EventForm({
  draft,
  setDraft,
  onSubmit,
  onCancel,
  busy,
}: {
  draft: Draft
  setDraft: (d: Draft) => void
  onSubmit: () => void
  onCancel: () => void
  busy: boolean
}) {
  const field =
    'mt-1 w-full rounded-md border border-line bg-panel px-2 py-1.5 text-[12px] font-normal text-ink outline-none placeholder:text-ink-muted focus:border-accent'
  const label = 'block text-[10px] font-semibold tracking-[0.08em] text-ink-muted'

  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <label className={`${label} sm:col-span-2`}>
        제목
        <input
          autoFocus
          value={draft.title}
          maxLength={500}
          onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          className={field}
        />
      </label>
      <label className={label}>
        종류
        <select
          value={draft.kind}
          onChange={(e) => setDraft({ ...draft, kind: e.target.value as EventKind })}
          className={field}
        >
          {EVENT_KIND.map((k) => (
            <option key={k} value={k}>
              {EVENT_KIND_LABEL_KO[k]}
            </option>
          ))}
        </select>
      </label>
      <label className={label}>
        장소
        <input
          value={draft.location}
          maxLength={300}
          onChange={(e) => setDraft({ ...draft, location: e.target.value })}
          className={field}
        />
      </label>
      <label className={label}>
        시작일
        <input
          type="date"
          value={draft.startsOn}
          onChange={(e) => setDraft({ ...draft, startsOn: e.target.value })}
          className={field}
        />
      </label>
      <label className={label}>
        종료일
        <input
          type="date"
          value={draft.endsOn}
          onChange={(e) => setDraft({ ...draft, endsOn: e.target.value })}
          className={field}
        />
      </label>
      <div className="flex items-center gap-1.5 sm:col-span-2">
        <button
          type="button"
          onClick={onSubmit}
          disabled={busy}
          className="rounded bg-accent px-2 py-1 text-[11px] font-semibold text-ink disabled:opacity-40"
        >
          {busy ? '저장 중…' : '저장'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="rounded px-2 py-1 text-[11px] text-ink-muted hover:text-ink disabled:opacity-40"
        >
          취소
        </button>
      </div>
    </div>
  )
}

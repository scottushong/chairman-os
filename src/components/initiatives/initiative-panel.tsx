'use client'

import { useEffect, useRef, useState, useTransition } from 'react'

import { saveInitiativeField, saveInitiativeNoteAction, type InitiativeField } from '@/app/actions/initiatives'
import { Icon } from '@/components/ui/icon'
import { initiativeClock } from '@/lib/initiative'
import { businessName } from '@/lib/lookup'
import {
  INITIATIVE_KIND,
  INITIATIVE_KIND_LABEL_KO,
  INITIATIVE_STAGE,
  INITIATIVE_STAGE_LABEL_KO,
  INITIATIVE_STATUS,
  INITIATIVE_STATUS_LABEL_KO,
  type Business,
  type Initiative,
  type InitiativeKind,
  type InitiativeStage,
  type InitiativeStatus,
  type IsoDate,
} from '@/types'

/**
 * Task 7 — `/initiatives/[id]`의 칸별 인라인 편집.
 *
 * `coordinates-panel.tsx`를 그대로 베낀 모델이다: 한 번에 한 칸만 열고(useState<InitiativeField|null>),
 * Escape로 취소, 여러 줄은 Ctrl/Cmd+Enter로 커밋, 값이 안 바뀌면 저장하지 않는다(audit_log 잡음 방지),
 * `saved` 맵으로 revalidatePath가 따라올 때까지 방금 값을 들고 있는다.
 *
 * 날짜 칸(target_date/next_action_date)은 빈 값을 허용한다 — 비우는 것이 '기한 없음'이고
 * saveInitiativeField가 이미 그렇게 받는다. 여기서 required 체크를 넣으면 한 번 넣은 기한을
 * 영영 못 지운다.
 *
 * 단계(stage)·상태(status)·유형(kind)은 자유 입력이 아니라 <select>라 이 패널에 없다 —
 * `InitiativeSidePanel`이 오른쪽 <aside>에서 따로 다룬다.
 *
 * canEdit은 안내지 판정이다. 실제 문은 0017의 initiatives_write(can_write_initiatives)다.
 */

type FieldInput = 'text' | 'textarea' | 'date' | 'business'

interface FieldMeta {
  field: InitiativeField
  label: string
  input: FieldInput
  placeholder?: string
  maxLength?: number
}

const MAX_LENGTH = 500

const EDIT_FIELDS: readonly FieldMeta[] = [
  { field: 'title', label: '제목', input: 'text', placeholder: '이 건의 이름', maxLength: MAX_LENGTH },
  { field: 'goal', label: '목표', input: 'textarea', placeholder: '성사되면 무엇을 얻는가', maxLength: MAX_LENGTH },
  { field: 'target_date', label: '목표일', input: 'date' },
  { field: 'next_action', label: '다음 행동', input: 'text', placeholder: '다음에 할 일', maxLength: MAX_LENGTH },
  { field: 'next_action_date', label: '다음 행동일', input: 'date' },
  { field: 'next_action_owner', label: '담당자', input: 'text', placeholder: '누가', maxLength: MAX_LENGTH },
  { field: 'blocker', label: '막힌 것', input: 'textarea', placeholder: '무엇이 막고 있나', maxLength: MAX_LENGTH },
  { field: 'business_id', label: '연결된 회사', input: 'business' },
] as const

export function InitiativePanel({
  initiative,
  businesses,
  canEdit,
  today,
}: {
  initiative: Initiative
  businesses: Business[]
  /** Chairman / GroupCFO인가. 아니면 읽기 전용으로 그린다. */
  canEdit: boolean
  today: IsoDate
}) {
  const [editing, setEditing] = useState<InitiativeField | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<Partial<Record<InitiativeField, string>>>({})

  const clock = initiativeClock(initiative, today)

  function valueOf(field: InitiativeField): string {
    const s = saved[field]
    if (s !== undefined) return s
    const raw = initiative[field]
    return raw === null || raw === undefined ? '' : String(raw)
  }

  function displayText(meta: FieldMeta): string {
    const raw = valueOf(meta.field)
    if (meta.input === 'business') return raw ? businessName(businesses, raw) : ''
    return raw
  }

  async function save(field: InitiativeField, next: string) {
    setError(null)
    const result = await saveInitiativeField(initiative.initiative_id, field, next)
    if (result.error) {
      setError(result.error)
      return false
    }
    setSaved((s) => ({ ...s, [field]: next.trim() }))
    setEditing(null)
    return true
  }

  const fieldOf = (f: InitiativeField) => EDIT_FIELDS.find((m) => m.field === f)!

  function body(meta: FieldMeta) {
    if (editing === meta.field) {
      return (
        <FieldEditor
          input={meta.input}
          label={meta.label}
          initial={valueOf(meta.field)}
          placeholder={meta.placeholder}
          maxLength={meta.maxLength}
          businesses={businesses}
          onCancel={() => setEditing(null)}
          onSave={(next) => save(meta.field, next)}
        />
      )
    }
    return (
      <ReadCell
        text={displayText(meta)}
        canEdit={canEdit}
        label={meta.label}
        onEdit={() => {
          setError(null)
          setEditing(meta.field)
        }}
      />
    )
  }

  return (
    <section className="rounded-xl border border-line-soft bg-panel p-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-[13px] font-semibold">개요</h2>
        {canEdit ? (
          <span className="text-[10.5px] text-ink-muted">칸을 누르면 고칠 수 있습니다</span>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="mt-2.5 rounded-md border border-critical/40 bg-critical/10 px-2.5 py-1.5 text-[11.5px] text-critical">
          {error}
        </p>
      ) : null}

      <div className="mt-2.5 border-l-2 border-line pl-3 text-[14px] leading-snug font-semibold">
        {body(fieldOf('title'))}
      </div>

      <div className="mt-3.5 grid gap-2.5 md:grid-cols-2">
        <div className="rounded-lg bg-raised/60 px-3 py-2.5">
          <p className="text-[10px] font-semibold tracking-[0.08em] text-ink-muted">목표</p>
          <div className="mt-1 text-[12.5px] leading-snug text-ink-dim">{body(fieldOf('goal'))}</div>
        </div>
        <div className="rounded-lg bg-raised/60 px-3 py-2.5">
          <p className="text-[10px] font-semibold tracking-[0.08em] text-ink-muted">목표일</p>
          <div className="mt-1 text-[12.5px] leading-snug text-ink-dim tnum">{body(fieldOf('target_date'))}</div>
        </div>
      </div>

      {/* 지난 다음 행동만 색을 준다(요구사항서 2번) — 이 화면에서 색이 오르는 두 자리 중 하나다. */}
      <div className="mt-2.5 grid gap-2.5 md:grid-cols-3">
        <div className="rounded-lg border border-line-soft px-3 py-2.5">
          <p className="text-[10px] font-semibold tracking-[0.08em] text-ink-muted">다음 행동</p>
          <div
            className={`mt-1 text-[12.5px] leading-relaxed ${clock?.overdue ? 'font-semibold text-critical' : 'text-ink'}`}
          >
            {body(fieldOf('next_action'))}
          </div>
        </div>
        <div className="rounded-lg border border-line-soft px-3 py-2.5">
          <p className="flex items-center justify-between text-[10px] font-semibold tracking-[0.08em] text-ink-muted">
            다음 행동일
            {clock ? (
              <span className={`text-[10.5px] font-semibold tnum ${clock.overdue ? 'text-critical' : 'text-ink-dim'}`}>
                {clock.label}
              </span>
            ) : null}
          </p>
          <div
            className={`mt-1 text-[12.5px] leading-relaxed tnum ${clock?.overdue ? 'font-semibold text-critical' : 'text-ink'}`}
          >
            {body(fieldOf('next_action_date'))}
          </div>
        </div>
        <div className="rounded-lg border border-line-soft px-3 py-2.5">
          <p className="text-[10px] font-semibold tracking-[0.08em] text-ink-muted">담당자</p>
          <div className="mt-1 text-[12.5px] leading-relaxed text-ink">{body(fieldOf('next_action_owner'))}</div>
        </div>
      </div>

      <div className="mt-2.5 grid gap-2.5 md:grid-cols-2">
        <div className="rounded-lg bg-raised/60 px-3 py-2.5">
          <p className="text-[10px] font-semibold tracking-[0.08em] text-ink-muted">막힌 것</p>
          <div className="mt-1 text-[12.5px] leading-relaxed text-ink-dim">{body(fieldOf('blocker'))}</div>
        </div>
        <div className="rounded-lg bg-raised/60 px-3 py-2.5">
          <p className="text-[10px] font-semibold tracking-[0.08em] text-ink-muted">연결된 회사</p>
          <div className="mt-1 text-[12.5px] leading-snug text-ink-dim">{body(fieldOf('business_id'))}</div>
        </div>
      </div>
    </section>
  )
}

/**
 * 읽기 상태의 한 칸. 고칠 수 없는 사람에게는 button이 아니라 그냥 문장이다 —
 * 눌러도 아무 일 없는 버튼을 두면 스크린 리더가 그것을 조작 가능한 것으로 읽는다.
 */
function ReadCell({
  text,
  canEdit,
  label,
  onEdit,
}: {
  text: string
  canEdit: boolean
  label: string
  onEdit: () => void
}) {
  if (!canEdit) return <>{text || '—'}</>

  return (
    <button
      type="button"
      onClick={onEdit}
      aria-label={`${label} 고치기`}
      className="group -mx-1 -my-0.5 block w-full rounded px-1 py-0.5 text-left transition-colors hover:bg-accent/10"
    >
      {text || <span className="text-ink-muted">비어 있음</span>}
      <Icon
        name="pencil"
        className="ml-1.5 inline size-3 align-baseline text-transparent transition-colors group-hover:text-accent"
      />
    </button>
  )
}

/**
 * 편집 상태의 한 칸. Esc로 취소하고, 한 줄짜리는 Enter로 저장한다.
 * 여러 줄 칸(goal/blocker)은 Ctrl/Cmd+Enter다 — Enter를 저장으로 쓰면 문단을 못 쓴다.
 * 날짜 칸은 빈 값을 그대로 보낸다('기한 없음'). 회사 칸은 <select>로 그린다.
 */
function FieldEditor({
  input,
  label,
  initial,
  placeholder,
  maxLength,
  businesses,
  onCancel,
  onSave,
}: {
  input: FieldInput
  label: string
  initial: string
  placeholder?: string
  maxLength?: number
  businesses?: Business[]
  onCancel: () => void
  onSave: (next: string) => Promise<boolean>
}) {
  const [value, setValue] = useState(initial)
  const [busy, setBusy] = useState(false)
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement & HTMLSelectElement>(null)

  useEffect(() => {
    ref.current?.focus()
    if (input === 'text' || input === 'textarea') ref.current?.select?.()
  }, [input])

  async function commit() {
    if (busy) return
    // 바뀐 게 없으면 저장하지 않는다 — audit_log에 빈 변경이 쌓이면 진짜 변경을 못 찾는다.
    if (value.trim() === initial.trim()) {
      onCancel()
      return
    }
    setBusy(true)
    const ok = await onSave(value)
    if (!ok) setBusy(false)
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault()
      onCancel()
      return
    }
    if (e.key === 'Enter' && (input !== 'textarea' || e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      void commit()
    }
  }

  const shared =
    'w-full rounded-md border border-accent bg-raised px-2 py-1.5 text-[12.5px] font-normal text-ink outline-none placeholder:text-ink-muted disabled:opacity-50'

  return (
    <div>
      {input === 'textarea' ? (
        <textarea
          ref={ref}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          aria-label={label}
          rows={3}
          maxLength={maxLength}
          disabled={busy}
          className={`${shared} resize-y`}
        />
      ) : input === 'date' ? (
        <input
          ref={ref}
          type="date"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKeyDown}
          aria-label={label}
          disabled={busy}
          className={shared}
        />
      ) : input === 'business' ? (
        <select
          ref={ref}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKeyDown}
          aria-label={label}
          disabled={busy}
          className={shared}
        >
          <option value="">연결 안 함</option>
          {(businesses ?? []).map((b) => (
            <option key={b.business_id} value={b.business_id}>
              {b.name}
            </option>
          ))}
        </select>
      ) : (
        <input
          ref={ref}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          aria-label={label}
          maxLength={maxLength}
          disabled={busy}
          className={shared}
        />
      )}
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={commit}
          disabled={busy}
          className="rounded bg-accent px-2 py-1 text-[11px] font-semibold text-ink transition-opacity disabled:opacity-40"
        >
          {busy ? '저장 중…' : '저장'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="rounded px-2 py-1 text-[11px] font-normal text-ink-muted transition-colors hover:text-ink disabled:opacity-40"
        >
          취소
        </button>
        {input !== 'date' && input !== 'business' ? (
          <span className="text-[10px] font-normal text-ink-muted">
            {input === 'textarea' ? 'Ctrl+Enter 저장 · Esc 취소' : 'Enter 저장 · Esc 취소'}
          </span>
        ) : null}
      </div>
    </div>
  )
}

/**
 * 단계(stage) · 상태(status) · 유형(kind). 자유 입력이 아니라 <select>라 InitiativePanel과
 * 분리했다 — task-controls.tsx와 같은 모양(즉시 저장, 실패하면 되돌린다).
 *
 * 배지에 색을 주지 않는다(요구사항서 2번) — 색은 InitiativePanel의 지난 다음 행동과
 * 에러 메시지 둘뿐이다.
 */
export function InitiativeSidePanel({ initiative, canEdit }: { initiative: Initiative; canEdit: boolean }) {
  const [pending, startTransition] = useTransition()
  const [draftKind, setDraftKind] = useState<InitiativeKind | null>(null)
  const [draftStage, setDraftStage] = useState<InitiativeStage | null>(null)
  const [draftStatus, setDraftStatus] = useState<InitiativeStatus | null>(null)
  const [error, setError] = useState<string | null>(null)

  const kind = draftKind ?? initiative.kind
  const stage = draftStage ?? initiative.stage
  const status = draftStatus ?? initiative.status

  function changeKind(next: InitiativeKind) {
    if (next === kind) return
    setError(null)
    setDraftKind(next)
    startTransition(async () => {
      const result = await saveInitiativeField(initiative.initiative_id, 'kind', next)
      if (result.error) {
        setDraftKind(null)
        setError(result.error)
      }
    })
  }

  function changeStage(next: InitiativeStage) {
    if (next === stage) return
    setError(null)
    setDraftStage(next)
    startTransition(async () => {
      const result = await saveInitiativeField(initiative.initiative_id, 'stage', next)
      if (result.error) {
        setDraftStage(null)
        setError(result.error)
      }
    })
  }

  function changeStatus(next: InitiativeStatus) {
    if (next === status) return
    setError(null)
    setDraftStatus(next)
    startTransition(async () => {
      const result = await saveInitiativeField(initiative.initiative_id, 'status', next)
      if (result.error) {
        setDraftStatus(null)
        setError(result.error)
      }
    })
  }

  return (
    <div className={`space-y-3 transition-opacity ${pending ? 'opacity-50' : ''}`}>
      <EnumSelect
        label="유형"
        value={kind}
        options={INITIATIVE_KIND}
        labelsKo={INITIATIVE_KIND_LABEL_KO}
        canEdit={canEdit}
        pending={pending}
        onChange={changeKind}
      />
      <EnumSelect
        label="단계"
        value={stage}
        options={INITIATIVE_STAGE}
        labelsKo={INITIATIVE_STAGE_LABEL_KO}
        canEdit={canEdit}
        pending={pending}
        onChange={changeStage}
      />
      <EnumSelect
        label="상태"
        value={status}
        options={INITIATIVE_STATUS}
        labelsKo={INITIATIVE_STATUS_LABEL_KO}
        canEdit={canEdit}
        pending={pending}
        onChange={changeStatus}
      />

      {error ? (
        <p
          role="alert"
          className="flex items-start gap-1.5 rounded-lg border border-critical/40 bg-critical/10 px-2.5 py-2 text-[11.5px] leading-snug text-critical"
        >
          {error}
        </p>
      ) : null}
    </div>
  )
}

function EnumSelect<T extends string>({
  label,
  value,
  options,
  labelsKo,
  canEdit,
  pending,
  onChange,
}: {
  label: string
  value: T
  options: readonly T[]
  labelsKo: Record<T, string>
  canEdit: boolean
  pending: boolean
  onChange: (next: T) => void
}) {
  if (!canEdit) {
    return (
      <div>
        <span className="block text-[10px] font-semibold tracking-[0.08em] text-ink-muted">{label}</span>
        <p className="mt-1 text-[12.5px] text-ink-dim">{labelsKo[value]}</p>
      </div>
    )
  }
  return (
    <label className="block">
      <span className="text-[11px] text-ink-dim">{label}</span>
      <select
        value={value}
        disabled={pending}
        aria-label={label}
        onChange={(e) => onChange(e.target.value as T)}
        className="mt-1 w-full rounded-lg border border-line bg-raised px-2.5 py-2 text-[12.5px] text-ink outline-none focus:border-accent disabled:opacity-50"
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {labelsKo[o]}
          </option>
        ))}
      </select>
    </label>
  )
}

/**
 * 회장 개인 메모(0017 initiative_notes). Chairman만 이 컴포넌트를 받는다 —
 * `isChairman`이 아니면 페이지가 아예 이 컴포넌트를 렌더링하지 않는다(page.tsx).
 * 그래서 여기에는 canEdit 판정이 없다: 렌더링된다는 것 자체가 이미 Chairman이라는 뜻이고,
 * 실제 쓰기 문은 어차피 0017 initiative_notes_all이 지킨다.
 */
export function InitiativeNotePanel({ initiativeId, note }: { initiativeId: string; note: string }) {
  const [editing, setEditing] = useState(false)
  const [saved, setSaved] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const value = saved ?? note

  async function save(next: string) {
    setError(null)
    const result = await saveInitiativeNoteAction(initiativeId, next)
    if (result.error) {
      setError(result.error)
      return false
    }
    setSaved(next.trim())
    setEditing(false)
    return true
  }

  return (
    <section className="rounded-xl border border-gold/30 bg-gold/5 p-4">
      <h2 className="flex items-center gap-1.5 text-[13px] font-semibold">
        <Icon name="crown" className="size-4 text-gold" filled />
        회장 메모
      </h2>
      <p className="mt-0.5 text-[10.5px] text-ink-muted">이 칸은 회장만 봅니다.</p>

      {error ? (
        <p role="alert" className="mt-2 rounded-md border border-critical/40 bg-critical/10 px-2.5 py-1.5 text-[11.5px] text-critical">
          {error}
        </p>
      ) : null}

      <div className="mt-2 text-[12.5px] leading-relaxed text-ink-dim">
        {editing ? (
          <FieldEditor
            input="textarea"
            label="회장 메모"
            initial={value}
            maxLength={5_000}
            onCancel={() => setEditing(false)}
            onSave={save}
          />
        ) : (
          <button
            type="button"
            onClick={() => {
              setError(null)
              setEditing(true)
            }}
            aria-label="회장 메모 고치기"
            className="group -mx-1 -my-0.5 block w-full rounded px-1 py-0.5 text-left transition-colors hover:bg-gold/10"
          >
            {value || <span className="text-ink-muted">비어 있음</span>}
            <Icon
              name="pencil"
              className="ml-1.5 inline size-3 align-baseline text-transparent transition-colors group-hover:text-gold"
            />
          </button>
        )}
      </div>
    </section>
  )
}

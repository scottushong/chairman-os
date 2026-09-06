'use client'

import { useEffect, useRef, useState } from 'react'

import { saveStrategyField } from '@/app/actions/strategy'
import { Icon } from '@/components/ui/icon'
import {
  emptyStrategy,
  STRATEGY_FIELDS,
  type StrategyField,
  type StrategyFieldMeta,
} from '@/lib/strategy-fields'
import type { BusinessStrategy } from '@/types'

/**
 * CH-024 전략 좌표.
 *
 * 이 패널에는 숫자가 하나도 없다. 전부 사람이 쓴 문장이다 —
 * 그게 이 화면이 위쪽 KPI 8타일과 다른 이유고, 둘을 같은 카드에 섞지 않는 이유다.
 * 위는 '얼마인가', 여기는 '어디로 가고 무엇이 막고 있나'다.
 *
 * Gap과 Bottleneck을 크게 둔다. 나머지 넷은 잘 바뀌지 않는 값이고,
 * 회장이 이 화면을 여는 이유는 대개 그 둘 때문이다.
 *
 * 편집 (DEFERRED D-13 결정 A)
 *   칸을 누르면 그 칸만 열린다. 열한 칸짜리 폼(선택지 B)을 여는 대신 이렇게 한 이유는
 *   Bottleneck과 현재 우선순위가 매달 바뀌는 값이라, 한 줄 고치는 마찰이
 *   그대로 '안 고침'이 되기 때문이다.
 *
 *   canEdit은 안내지 판정이 아니다. 실제 문은 0008의 business_strategy_write가
 *   can_approve()로 지킨다 — 연필이 안 보이는 사람이 Server Action을 직접 불러도 거부된다.
 */
export function CoordinatesPanel({
  strategy,
  businessId,
  canEdit,
}: {
  strategy: BusinessStrategy | null
  businessId: string
  /** Chairman / BusinessCEO인가. 아니면 읽기 전용으로 그린다. */
  canEdit: boolean
}) {
  const [editing, setEditing] = useState<StrategyField | null>(null)
  const [error, setError] = useState<string | null>(null)
  /**
   * 방금 저장한 값. revalidatePath가 서버에서 새 문장을 실어 오기 전까지 이 화면이
   * 옛 값을 다시 그리는 순간이 있고, 저장을 누른 사람에게는 그게 '저장이 안 됐다'로 읽힌다.
   */
  const [saved, setSaved] = useState<Partial<Record<StrategyField, string>>>({})

  // 좌표 행이 없는 회사(CH-002로 방금 만든 곳)도 승인권자에게는 빈 칸으로 편다.
  // 안 그러면 '아직 등록되지 않았습니다'가 막다른 길이 된다 — 첫 문장을 쓸 자리가 없다.
  const shown = strategy ?? (canEdit ? emptyStrategy(businessId) : null)

  if (!shown) {
    return (
      <section className="rounded-xl border border-line-soft bg-panel px-4 py-8 text-center">
        <p className="text-[12.5px] text-ink-muted">
          이 회사의 전략 좌표가 아직 등록되지 않았습니다.
        </p>
        <p className="mt-1 text-[11px] text-ink-muted">
          채우는 일은 Chairman / Business CEO만 할 수 있습니다(0008 business_strategy_write).
        </p>
      </section>
    )
  }

  const meta = (field: StrategyField): StrategyFieldMeta =>
    STRATEGY_FIELDS.find((f) => f.field === field)!

  const valueOf = (field: StrategyField) => saved[field] ?? shown[field]

  async function save(field: StrategyField, next: string) {
    setError(null)
    const result = await saveStrategyField(businessId, field, next)
    if (result.error) {
      setError(result.error)
      return false
    }
    setSaved((s) => ({ ...s, [field]: next.trim() }))
    setEditing(null)
    return true
  }

  /** 한 칸의 알맹이. 편집 중이면 입력, 아니면 문장. 바깥 상자는 부르는 쪽이 그린다. */
  function body(field: StrategyField) {
    if (editing === field) {
      return (
        <FieldEditor
          meta={meta(field)}
          initial={valueOf(field)}
          onCancel={() => setEditing(null)}
          onSave={(next) => save(field, next)}
        />
      )
    }
    return (
      <ReadCell
        text={valueOf(field)}
        canEdit={canEdit}
        label={meta(field).label}
        onEdit={() => {
          setError(null)
          setEditing(field)
        }}
      />
    )
  }

  return (
    <section className="rounded-xl border border-line-soft bg-panel p-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-[13px] font-semibold">전략 좌표</h2>
        <span className="flex items-center gap-2">
          {canEdit ? (
            <span className="text-[10.5px] text-ink-muted">칸을 누르면 고칠 수 있습니다</span>
          ) : null}
          <span className="text-[9px] text-ink-muted tnum">CH-024</span>
        </span>
      </div>

      {error ? (
        <p
          role="alert"
          className="mt-2.5 rounded-md border border-critical/40 bg-critical/10 px-2.5 py-1.5 text-[11.5px] text-critical"
        >
          {error}
        </p>
      ) : null}

      {/* Mission만 카드 밖에 둔다. 나머지 열 칸이 답하는 질문의 전제라 위에 하나로 선다. */}
      <div className="mt-2.5 border-l-2 border-gold/60 pl-3 text-[14px] leading-snug font-semibold">
        {body('mission')}
      </div>

      <div className="mt-3.5 grid gap-2.5 md:grid-cols-2 xl:grid-cols-4">
        {(['goal_1y', 'goal_3y', 'current_position', 'target_position'] as const).map((f) => (
          <div key={f} className="rounded-lg bg-raised/60 px-3 py-2.5">
            <p className="text-[10px] font-semibold tracking-[0.08em] text-ink-muted">
              {meta(f).label}
            </p>
            <div className="mt-1 text-[12.5px] leading-snug text-ink-dim">{body(f)}</div>
          </div>
        ))}
      </div>

      {/* 이 둘만 테두리를 준다. 나머지는 배경, 이건 지금 손대야 하는 것이다. */}
      <div className="mt-2.5 grid gap-2.5 md:grid-cols-2">
        {(
          [
            { f: 'gap', icon: 'arrow-up', tone: 'border-warning/40 bg-warning/5' },
            { f: 'bottleneck', icon: 'shield', tone: 'border-critical/40 bg-critical/5' },
          ] as const
        ).map(({ f, icon, tone }) => (
          <div key={f} className={`rounded-lg border px-3 py-2.5 ${tone}`}>
            <p className="flex items-center gap-1.5 text-[10px] font-semibold tracking-[0.08em] text-ink-muted">
              <Icon name={icon} className="size-3.5" />
              {meta(f).label}
            </p>
            <div className="mt-1 text-[12.5px] leading-relaxed text-ink">{body(f)}</div>
          </div>
        ))}
      </div>

      <div className="mt-2.5 grid gap-2.5 md:grid-cols-2">
        {(['top_kpi', 'current_priority'] as const).map((f) => (
          <div key={f} className="rounded-lg bg-raised/60 px-3 py-2.5">
            <p className="text-[10px] font-semibold tracking-[0.08em] text-ink-muted">
              {meta(f).label}
            </p>
            <div className="mt-1 text-[12.5px] leading-snug text-ink-dim">{body(f)}</div>
          </div>
        ))}
      </div>

      {/* 메모는 비어 있으면 읽기 전용에서 아예 뺀다. 고칠 수 있는 사람에게만 빈 자리를 남긴다. */}
      {valueOf('chairman_comment') || canEdit ? (
        <div className="mt-3 flex items-start gap-2 rounded-lg bg-raised px-3 py-2.5 text-[12px] leading-relaxed text-ink-dim">
          <Icon name="crown" className="mt-0.5 size-3.5 shrink-0 text-gold" filled />
          <div className="min-w-0 flex-1">{body('chairman_comment')}</div>
        </div>
      ) : null}
    </section>
  )
}

/**
 * 읽기 상태의 한 칸.
 *
 * 고칠 수 없는 사람에게는 button이 아니라 그냥 문장이다 — 눌러도 아무 일 없는 버튼을 두면
 * 스크린 리더가 그것을 조작 가능한 것으로 읽는다.
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
      {/* 늘 자리를 차지하되 hover 전에는 보이지 않는다. 나타날 때 글줄이 밀리지 않게. */}
      <Icon
        name="pencil"
        className="ml-1.5 inline size-3 align-baseline text-transparent transition-colors group-hover:text-accent"
      />
    </button>
  )
}

/** 0008의 열한 칸은 전부 text지만 한 칸에 소설을 쓰라는 자리가 아니다. Server Action과 같은 한계. */
const MAX_LENGTH = 500

/**
 * 편집 상태의 한 칸.
 *
 * Esc로 취소하고, 한 줄짜리는 Enter로 저장한다. 여러 줄 칸에서 Enter를 저장으로 쓰면
 * 문단을 못 쓴다 — Gap과 Bottleneck은 대개 두 문장이다. 그쪽은 Ctrl/Cmd+Enter다.
 */
function FieldEditor({
  meta,
  initial,
  onCancel,
  onSave,
}: {
  meta: StrategyFieldMeta
  initial: string
  onCancel: () => void
  onSave: (next: string) => Promise<boolean>
}) {
  const [text, setText] = useState(initial)
  const [busy, setBusy] = useState(false)
  const ref = useRef<HTMLTextAreaElement & HTMLInputElement>(null)

  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])

  async function commit() {
    if (busy) return
    // 바뀐 게 없으면 저장하지 않는다. '아무것도 안 바꾼 수정'이 audit_log에 쌓이면
    // 나중에 진짜 변경을 찾을 때 그게 잡음이 된다.
    if (text.trim() === initial.trim()) {
      onCancel()
      return
    }
    setBusy(true)
    const ok = await onSave(text)
    // 성공하면 이 컴포넌트가 통째로 사라진다. 실패했을 때만 다시 만질 수 있게 풀어 준다.
    if (!ok) setBusy(false)
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault()
      onCancel()
      return
    }
    if (e.key === 'Enter' && (!meta.multiline || e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      void commit()
    }
  }

  const shared =
    'w-full rounded-md border border-accent bg-raised px-2 py-1.5 text-[12.5px] font-normal text-ink outline-none placeholder:text-ink-muted disabled:opacity-50'

  return (
    <div>
      {meta.multiline ? (
        <textarea
          ref={ref}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={meta.placeholder}
          aria-label={meta.label}
          rows={3}
          maxLength={MAX_LENGTH}
          disabled={busy}
          className={`${shared} resize-y`}
        />
      ) : (
        <input
          ref={ref}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={meta.placeholder}
          aria-label={meta.label}
          maxLength={MAX_LENGTH}
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
        <span className="text-[10px] font-normal text-ink-muted">
          {meta.multiline ? 'Ctrl+Enter 저장 · Esc 취소' : 'Enter 저장 · Esc 취소'}
        </span>
      </div>
    </div>
  )
}

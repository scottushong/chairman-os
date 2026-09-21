'use client'

import { useState } from 'react'

import { saveChairmanDirection } from '@/app/actions/dependency'
import { LETTER_FIELDS, type ChairmanDirection } from '@/types'

/**
 * §20 Direction + §21 Chairman Letter (편집). /dependency/[id].
 *
 * ■ 한 번에 다 쓰는 글이 아니다 ■ §21의 일곱 칸은 회장이 생각날 때 한 칸씩 채우는 것이다.
 * 그래서 절마다 따로 저장하고, 서버는 **보낸 칸만** 바꾼다(actions/dependency.ts).
 * 한 번에 전부 덮으면 다른 절에서 채운 칸이 조용히 지워진다.
 *
 * ■ 목록 칸은 줄바꿈으로 나눈다 ■ 쉼표로 나누면 "Sticky Alliance, Inc."가 두 항목이 된다.
 *
 * ■ 빈 칸은 빈 칸으로 둔다 ■ placeholder에 예시를 넣되, 저장하지 않는다. 회장이 아직
 * 안 정한 것을 시스템이 대신 적어 두면 CEO는 그것을 지시로 읽는다.
 */
export function DirectionEditor({
  businessId,
  direction,
  canWrite,
}: {
  businessId: string
  direction: ChairmanDirection | null
  canWrite: boolean
}) {
  return (
    <div className="space-y-2">
      <Field
        businessId={businessId}
        label="5년 방향 (§20)"
        name="fiveYear"
        value={direction?.five_year ?? ''}
        placeholder="한 문장. 예: 글로벌 접착제 네트워크가 된다."
        canWrite={canWrite}
      />
      <ListField
        businessId={businessId}
        label="우선순위 (§20 Priorities)"
        name="priorities"
        value={direction?.priorities ?? []}
        canWrite={canWrite}
      />
      <ListField
        businessId={businessId}
        label="하지 말 것 (§20 DO NOT)"
        name="doNot"
        value={direction?.do_not ?? []}
        canWrite={canWrite}
      />

      <p className="pt-1.5 text-[11px] font-semibold text-ink">
        Chairman Letter (§21) — CEO의 operating constitution
      </p>
      <p className="text-[10.5px] leading-relaxed text-ink-muted">
        문서 §21이 일곱 칸을 요구합니다. 아래 순서가 그 목록입니다 — 비어 있는 칸은 비어 있는
        대로 둡니다. 시스템이 대신 적어 두면 CEO는 그것을 지시로 읽습니다.
      </p>
      <Field
        businessId={businessId}
        label={`${LETTER_FIELDS[0].label} (${LETTER_FIELDS[0].doc})`}
        name="whyOwn"
        value={direction?.why_own ?? ''}
        canWrite={canWrite}
      />
      <Field
        businessId={businessId}
        label={`${LETTER_FIELDS[2].label} (${LETTER_FIELDS[2].doc})`}
        name="capitalPhilosophy"
        value={direction?.capital_philosophy ?? ''}
        canWrite={canWrite}
      />
      <ListField
        businessId={businessId}
        label={`${LETTER_FIELDS[3].label} (${LETTER_FIELDS[3].doc})`}
        name="caresAbout"
        value={direction?.cares_about ?? []}
        canWrite={canWrite}
      />
      <ListField
        businessId={businessId}
        label={`${LETTER_FIELDS[4].label} (${LETTER_FIELDS[4].doc})`}
        name="notManaged"
        value={direction?.not_managed ?? []}
        canWrite={canWrite}
      />
      <ListField
        businessId={businessId}
        label={`${LETTER_FIELDS[5].label} (${LETTER_FIELDS[5].doc})`}
        name="redLines"
        value={direction?.red_lines ?? []}
        canWrite={canWrite}
      />
      <ListField
        businessId={businessId}
        label={`${LETTER_FIELDS[6].label} (${LETTER_FIELDS[6].doc})`}
        name="contactWhen"
        value={direction?.contact_when ?? []}
        canWrite={canWrite}
      />
      <Field
        businessId={businessId}
        label="Letter 본문 (1페이지)"
        name="letter"
        value={direction?.letter ?? ''}
        rows={10}
        canWrite={canWrite}
        empty="아직 작성되지 않았습니다."
      />
    </div>
  )
}

/** 글 한 칸. 저장은 이 칸만 보낸다. */
function Field({
  businessId,
  label,
  name,
  value,
  placeholder,
  rows = 2,
  canWrite,
  empty = '아직 비어 있습니다.',
}: {
  businessId: string
  label: string
  name: string
  value: string
  placeholder?: string
  rows?: number
  canWrite: boolean
  empty?: string
}) {
  const [text, setText] = useState(value)
  const [saved, setSaved] = useState(value)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!canWrite) {
    return (
      <Readonly label={label}>
        {value ? (
          <span className="whitespace-pre-wrap">{value}</span>
        ) : (
          <span className="text-ink-muted">{empty}</span>
        )}
      </Readonly>
    )
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const r = await saveChairmanDirection({ businessId, [name]: text })
    setBusy(false)
    if (r.error) setError(r.error)
    else setSaved(text)
  }

  return (
    <form onSubmit={submit} className="rounded-lg bg-raised p-2.5" aria-label={label}>
      <label className="block text-[10.5px] text-ink-dim">
        {label}
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={rows}
          placeholder={placeholder}
          className="mt-0.5 block w-full rounded-md border border-line bg-panel px-2 py-1.5 text-[11.5px] leading-relaxed text-ink outline-none placeholder:text-ink-muted focus:border-accent"
        />
      </label>
      <div className="mt-1 flex items-center justify-end gap-2">
        {error ? (
          <span role="alert" className="text-[11px] text-critical">
            {error}
          </span>
        ) : null}
        <button
          type="submit"
          disabled={busy || text.trim() === saved.trim()}
          className="rounded-md bg-accent px-2.5 py-1 text-[11px] font-semibold text-app disabled:opacity-40"
        >
          {busy ? '저장 중…' : '저장'}
        </button>
      </div>
    </form>
  )
}

/** 목록 칸. 한 줄에 하나다 — 쉼표로 나누면 회사 이름이 두 항목이 된다. */
function ListField({
  businessId,
  label,
  name,
  value,
  canWrite,
}: {
  businessId: string
  label: string
  name: string
  value: string[]
  canWrite: boolean
}) {
  const [text, setText] = useState(value.join('\n'))
  const [saved, setSaved] = useState(value.join('\n'))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!canWrite) {
    return (
      <Readonly label={label}>
        {value.length === 0 ? (
          <span className="text-ink-muted">아직 비어 있습니다.</span>
        ) : (
          <ol className="list-inside list-decimal">
            {value.map((v) => (
              <li key={v}>{v}</li>
            ))}
          </ol>
        )}
      </Readonly>
    )
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const r = await saveChairmanDirection({ businessId, [name]: text })
    setBusy(false)
    if (r.error) setError(r.error)
    else setSaved(text)
  }

  return (
    <form onSubmit={submit} className="rounded-lg bg-raised p-2.5" aria-label={label}>
      <label className="block text-[10.5px] text-ink-dim">
        {label} — 한 줄에 하나
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={Math.max(2, value.length + 1)}
          className="mt-0.5 block w-full rounded-md border border-line bg-panel px-2 py-1.5 text-[11.5px] leading-relaxed text-ink outline-none focus:border-accent"
        />
      </label>
      <div className="mt-1 flex items-center justify-end gap-2">
        {error ? (
          <span role="alert" className="text-[11px] text-critical">
            {error}
          </span>
        ) : null}
        <button
          type="submit"
          disabled={busy || text.trim() === saved.trim()}
          className="rounded-md bg-accent px-2.5 py-1 text-[11px] font-semibold text-app disabled:opacity-40"
        >
          {busy ? '저장 중…' : '저장'}
        </button>
      </div>
    </form>
  )
}

/** 쓸 수 없는 사람에게는 글만 보인다. 눌러도 거부당하는 버튼을 두지 않는다. */
function Readonly({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-raised p-2.5">
      <p className="text-[10.5px] text-ink-dim">{label}</p>
      <div className="mt-0.5 text-[11.5px] leading-relaxed text-ink">{children}</div>
    </div>
  )
}

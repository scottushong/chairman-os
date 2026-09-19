'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { createInitiative } from '@/app/actions/initiatives'
import { Icon } from '@/components/ui/icon'
import { INITIATIVE_KIND, INITIATIVE_KIND_LABEL_KO, type InitiativeKind } from '@/types'

/**
 * 새 건 만들기. 제목과 유형만 받는다 — 나머지 칸(목표·다음 행동·마감 등)은
 * createInitiative가 기본값(Planning/Active)으로 채우고, 상세 화면에서 칸별로 채운다.
 * 빈 칸을 목록에서 다 채우게 하면 회장이 새 건을 아예 못 올린다(actions/initiatives.ts와 같은 이유).
 *
 * 저장에 성공하면 목록에 머물지 않고 상세로 곧장 넘어간다 — 만들자마자 채울 게 있기 때문이다.
 */
export function CreateInitiative() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [kind, setKind] = useState<InitiativeKind>(INITIATIVE_KIND[0])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-4 flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1.5 text-[12px] text-ink-dim transition-colors hover:border-accent hover:text-ink"
      >
        <Icon name="plus" className="size-3.5" />새 건 만들기
      </button>
    )
  }

  async function submit() {
    if (busy) return
    setError(null)
    const t = title.trim()
    if (!t) {
      setError('제목을 넣으세요.')
      return
    }
    setBusy(true)
    const result = await createInitiative(t, kind)
    setBusy(false)
    if (result.error || !result.initiativeId) {
      setError(result.error ?? '만들지 못했습니다.')
      return
    }
    router.push(`/initiatives/${result.initiativeId}`)
  }

  return (
    <div className="mt-4 flex flex-wrap items-end gap-2 rounded-xl border border-line-soft bg-panel p-3">
      <label className="text-[10.5px] text-ink-muted">
        제목
        <input
          autoFocus
          className="mt-0.5 block w-64 rounded border border-line bg-panel px-2 py-1 text-[12px] text-ink outline-none focus:border-accent disabled:opacity-50"
          value={title}
          maxLength={500}
          placeholder="예: OO사 지분 인수"
          disabled={busy}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
          }}
        />
      </label>
      <label className="text-[10.5px] text-ink-muted">
        유형
        <select
          className="mt-0.5 block rounded border border-line bg-panel px-2 py-1 text-[12px] text-ink outline-none focus:border-accent disabled:opacity-50"
          value={kind}
          disabled={busy}
          onChange={(e) => setKind(e.target.value as InitiativeKind)}
        >
          {INITIATIVE_KIND.map((k) => (
            <option key={k} value={k}>
              {INITIATIVE_KIND_LABEL_KO[k]}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        onClick={submit}
        disabled={busy}
        className="rounded bg-accent px-3 py-1.5 text-[12px] font-semibold text-ink disabled:opacity-40"
      >
        {busy ? '만드는 중…' : '만들기'}
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          setOpen(false)
          setTitle('')
          setError(null)
        }}
        className="rounded px-2 py-1.5 text-[11.5px] text-ink-muted hover:text-ink disabled:opacity-40"
      >
        취소
      </button>
      {error ? (
        <p role="alert" className="w-full text-[11.5px] text-critical">
          {error}
        </p>
      ) : null}
    </div>
  )
}

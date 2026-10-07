'use client'

import Link from 'next/link'
import { useState, useTransition } from 'react'

import { approvalDecideManyAction } from '@/app/actions/approvals'

/**
 * 승인함 «선택 항목 한 번에 승인» — 회장 차례인 단계 결재만(0059 approval_decide_many).
 *
 * 한 트랜잭션이다. 한 건이라도 막히면(그새 누가 처리했다 · 차례가 아니다) 전부 되돌아가고, 오류에 그 건의 id가 온다.
 * 반려는 여기서 하지 않는다 — 반려는 사유가 건마다 달라야 한다. 상세를 열어 한 건씩.
 */
export function BulkApprove({
  items,
  bossLabel,
}: {
  items: { id: string; title: string; business: string; href: string }[]
  /** 보는 사람에 맞춘 호칭(회장 화면이라 «회장»). */
  bossLabel: string
}) {
  const [picked, setPicked] = useState<Set<string>>(() => new Set())
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  // 처리 후 목록이 줄면, 사라진 id는 고른 수에서 빠진다.
  const live = new Set(items.map((i) => i.id))
  const chosen = [...picked].filter((id) => live.has(id))
  const all = items.length > 0 && chosen.length === items.length

  function toggle(id: string) {
    setPicked((cur) => {
      const next = new Set(cur)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function approve() {
    setError(null)
    setMessage(null)
    startTransition(async () => {
      const r = await approvalDecideManyAction({ decisionIds: chosen })
      if (r.error) setError(r.error)
      else {
        setMessage(r.message ?? null)
        setPicked(new Set())
      }
    })
  }

  return (
    <section className="rounded-xl border border-line-soft bg-panel px-3.5 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-t13 font-semibold">선택 항목 한 번에 승인</h2>
        <span className="text-t11 text-ink-muted tnum">
          {bossLabel} 차례 {items.length}건 · 선택 {chosen.length}건
        </span>
        <button
          type="button"
          onClick={() => setPicked(all ? new Set() : new Set(items.map((i) => i.id)))}
          className="ml-auto rounded-md border border-line px-2 py-1 text-t11h text-ink-dim hover:bg-raised"
        >
          {all ? '모두 풀기' : '모두 고르기'}
        </button>
        <button
          type="button"
          disabled={pending || chosen.length === 0}
          onClick={approve}
          className="rounded-md border border-accent bg-accent px-2.5 py-1 text-t11h font-semibold text-white disabled:opacity-40"
        >
          {pending ? '승인 중…' : `선택 승인${chosen.length ? ` (${chosen.length})` : ''}`}
        </button>
      </div>
      <ul className="mt-2 max-h-56 space-y-1 overflow-y-auto">
        {items.map((i) => (
          <li key={i.id} className="flex items-center gap-2 text-t12">
            <input
              type="checkbox"
              checked={picked.has(i.id)}
              onChange={() => toggle(i.id)}
              aria-label={`${i.title} 고르기`}
              className="size-3.5 accent-[var(--color-accent)]"
            />
            <span className="shrink-0 text-t10 text-ink-muted tnum">{i.id}</span>
            <Link href={i.href} className="min-w-0 truncate hover:text-accent">
              {i.title}
            </Link>
            <span className="ml-auto shrink-0 text-t11 text-ink-muted">{i.business}</span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-t10h text-ink-muted">
        한 건이라도 처리할 수 없으면 한 건도 승인하지 않습니다. 반려는 상세를 열어 사유와 함께 한 건씩 합니다.
      </p>
      {message ? (
        <p role="status" className="mt-2 rounded-md bg-raised px-2.5 py-1.5 text-t11h text-ink-dim">
          {message}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-2 rounded-md border border-critical/40 bg-critical/10 px-2.5 py-1.5 text-t11h text-critical">
          {error}
        </p>
      ) : null}
    </section>
  )
}

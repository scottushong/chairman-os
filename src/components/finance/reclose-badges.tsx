'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

import { clearReclose } from '@/app/actions/finance-v21'
import { RECLOSE_CAUSE_KO } from '@/lib/finance-upload/v21-text'
import type { FinRecloseFlag } from '@/types'

/**
 * 0072 «재마감 대상» — 마감된 달에 자료가 들어오거나 빠졌다. 자동 넣기는 자료 표에만 닿고 손익(마감 · 전표 · 월별 손익)은 건드리지 않는다.
 * 다시 마감한 뒤 그 달을 마감할 수 있는 사람(대표 · CFO · 마감 권한)이 푼다.
 */
export function RecloseBadges({ businessId, flags, canClear }: { businessId: string; flags: FinRecloseFlag[]; canClear: boolean }) {
  if (!flags.length) return null
  const months = [...new Set(flags.map((f) => f.period))].sort().reverse()
  return (
    <section className="rounded-xl border border-critical/30 bg-critical/5 p-3" aria-label="재마감 대상">
      <h2 className="text-t13 font-semibold">재마감 대상</h2>
      <p className="mt-0.5 text-t10h text-ink-muted">마감된 달에 자료가 들어오거나 바뀌었습니다. 손익은 다시 마감할 때 반영됩니다(넣기는 손익을 건드리지 않습니다).</p>
      <ul className="mt-2 space-y-1">
        {months.map((m) => (
          <li key={m} className="flex flex-wrap items-center gap-2 text-t11h">
            <span className="rounded bg-critical/15 px-1.5 py-0.5 text-t10 font-semibold text-critical tnum">재마감 대상 · {m}</span>
            {flags.filter((f) => f.period === m).map((f) => (
              <Flag key={f.flag_id} f={f} businessId={businessId} canClear={canClear} />
            ))}
          </li>
        ))}
      </ul>
    </section>
  )
}

function Flag({ f, businessId, canClear }: { f: FinRecloseFlag; businessId: string; canClear: boolean }) {
  const router = useRouter()
  const [busy, start] = useTransition()
  const [msg, setMsg] = useState<string | null>(null)
  return (
    <span className="inline-flex flex-wrap items-center gap-1 text-ink-dim">
      <span>{RECLOSE_CAUSE_KO[f.cause] ?? f.cause}{f.reason ? ` — ${f.reason}` : ''}</span>
      {canClear ? (
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            start(async () => {
              const r = await clearReclose(f.flag_id, businessId, '다시 마감함')
              setMsg(r.error ?? '풀었습니다.')
              if (r.ok) router.refresh()
            })
          }
          className="min-h-8 rounded-md border border-line px-2 text-t10h hover:border-accent disabled:opacity-40"
        >
          다시 마감함 · 풀기
        </button>
      ) : null}
      {msg ? <span className="text-t10h">{msg}</span> : null}
    </span>
  )
}

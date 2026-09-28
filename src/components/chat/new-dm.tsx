'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

import { openDm } from '@/app/actions/chat'
import { tr, type Lang } from '@/lib/i18n'

/** 새 1:1. 같은 회사를 함께 가진 사람과만 열린다(0041 open_dm). */
export function NewDm({ people, lang }: { people: { id: string; name: string }[]; lang: Lang }) {
  const router = useRouter()
  const [pick, setPick] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  return (
    <div className="mt-2 space-y-1">
      <div className="flex gap-1">
        <select value={pick} onChange={(e) => setPick(e.target.value)} className="min-w-0 flex-1 rounded-md border border-line bg-panel px-1.5 py-1 text-t11h">
          <option value="">{tr(lang, '새 1:1 — 사람 고르기', 'New DM')}</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={!pick || pending}
          onClick={() =>
            start(async () => {
              setError(null)
              const r = await openDm(pick)
              if (r.error || !r.channelId) setError(r.error ?? '')
              else router.push(`/chat?c=${r.channelId}`)
            })
          }
          className="rounded-md bg-accent px-2 py-1 text-t11 font-semibold text-white disabled:opacity-40"
        >
          {tr(lang, '열기', 'Open')}
        </button>
      </div>
      {error ? <p className="text-t10h text-critical">{error}</p> : null}
    </div>
  )
}

'use client'

import { useState, useTransition } from 'react'

import { saveNotice } from '@/app/actions/notices'
import { tr, type Lang } from '@/lib/i18n'

/**
 * 공지 쓰기 (Phase 9 블록 1). Executive 이상에게만 그린다 — 못 쓰는 사람에게 눌러도 거부당하는
 * 폼을 두지 않는다(판정은 0038이 한 번 더 한다).
 *
 * «그룹 전체»는 그룹 범위 역할(회장 · 그룹 CFO)에게만 고를 수 있게 준다.
 */
export function NoticeComposer({
  businesses,
  canGroup,
  lang,
}: {
  businesses: { id: string; name: string }[]
  canGroup: boolean
  lang: Lang
}) {
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md border border-line bg-raised px-2.5 py-1 text-t11h font-semibold hover:border-accent"
      >
        + {tr(lang, '공지 쓰기', 'New notice')}
      </button>
    )
  }

  function submit(form: FormData) {
    setError(null)
    start(async () => {
      const result = await saveNotice({
        businessId: form.get('business'),
        title: form.get('title'),
        body: form.get('body'),
        titleEn: form.get('title_en'),
        bodyEn: form.get('body_en'),
        pinned: form.get('pinned') === 'on',
        expiresOn: form.get('expires_on'),
      })
      if (result.error) setError(result.error)
      else setOpen(false)
    })
  }

  const input = 'w-full rounded-md border border-line bg-panel px-2 py-1.5 text-t12'
  return (
    <form action={submit} className="space-y-2 rounded-lg border border-line-soft bg-raised p-3">
      <select name="business" className={input} defaultValue={canGroup ? '' : (businesses[0]?.id ?? '')}>
        {canGroup ? <option value="">{tr(lang, '그룹 전체', 'Group-wide')}</option> : null}
        {businesses.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
      </select>
      <input name="title" required placeholder={tr(lang, '제목', 'Title')} className={input} />
      <textarea name="body" rows={3} placeholder={tr(lang, '내용', 'Body')} className={input} />
      <details className="text-t11 text-ink-dim">
        <summary className="cursor-pointer">{tr(lang, '영문 (선택)', 'English (optional)')}</summary>
        <div className="mt-1.5 space-y-1.5">
          <input name="title_en" placeholder="Title (EN)" className={input} />
          <textarea name="body_en" rows={2} placeholder="Body (EN)" className={input} />
        </div>
      </details>
      <div className="flex flex-wrap items-center gap-3 text-t11h text-ink-dim">
        <label className="flex items-center gap-1">
          <input type="checkbox" name="pinned" /> {tr(lang, '맨 앞에 고정', 'Pin')}
        </label>
        <label className="flex items-center gap-1">
          {tr(lang, '내리는 날', 'Until')} <input type="date" name="expires_on" className="rounded border border-line bg-panel px-1" />
        </label>
      </div>
      {error ? (
        <p role="alert" className="text-t11h text-critical">
          {error}
        </p>
      ) : null}
      <div className="flex gap-2">
        <button type="submit" disabled={pending} className="rounded-md bg-accent px-3 py-1.5 text-t12 font-semibold text-white disabled:opacity-50">
          {pending ? tr(lang, '올리는 중…', 'Posting…') : tr(lang, '올리기', 'Post')}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="rounded-md border border-line px-3 py-1.5 text-t12 text-ink-dim">
          {tr(lang, '취소', 'Cancel')}
        </button>
      </div>
    </form>
  )
}

'use client'

import { useState, useTransition } from 'react'

import { deleteNotice, markNoticeRead } from '@/app/actions/notices'
import { boss, bossEn } from '@/lib/boss'
import { pickText, tr, type Lang } from '@/lib/i18n'
import type { Notice, NoticeRead, Role } from '@/types'

/**
 * 공지 목록 (Phase 9 블록 1). 펼치는 순간 한 번 «읽음»을 찍는다.
 *
 * 읽음 확인(누가 읽었나)은 **작성자와 회장에게만** 온다 — 0038 notice_reads_read가 남의 줄을
 * 그 둘에게만 준다. 이 컴포넌트는 받은 것만 그린다: reads에 공지 id가 없으면 그 칸을 안 그린다.
 */
export function NoticeList({
  notices,
  businessNames,
  reads,
  canDelete,
  role,
  lang,
}: {
  notices: Notice[]
  businessNames: Record<string, string>
  /** notice_id → 읽은 사람들. 작성자 · 회장이 볼 수 있는 공지만 들어 있다. */
  reads: Record<number, NoticeRead[]>
  /** 지울 수 있는 공지 id(작성자 본인 또는 회장). */
  canDelete: number[]
  /** 보는 사람의 역할 — 직원 화면 용어 원칙(CLAUDE.md): 회장 외에는 «대표». */
  role: Role | null | undefined
  lang: Lang
}) {
  const [open, setOpen] = useState<number | null>(null)
  const [readNow, setReadNow] = useState<number[]>([])
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  function toggle(n: Notice) {
    const next = open === n.notice_id ? null : n.notice_id
    setOpen(next)
    if (next !== null && !n.read_by_me && !readNow.includes(n.notice_id)) {
      setReadNow((r) => [...r, n.notice_id])
      void markNoticeRead(n.notice_id)
    }
  }

  function remove(id: number) {
    setError(null)
    start(async () => {
      const result = await deleteNotice(id)
      if (result.error) setError(result.error)
    })
  }

  if (notices.length === 0) {
    return <p className="text-t12 text-ink-muted">{tr(lang, '올라온 공지가 없습니다.', 'No notices yet.')}</p>
  }

  return (
    <ul className="divide-y divide-line-soft">
      {error ? (
        <li role="alert" className="py-1.5 text-t11h text-critical">
          {error}
        </li>
      ) : null}
      {notices.map((n) => {
        const unread = !n.read_by_me && !readNow.includes(n.notice_id)
        const who = reads[n.notice_id]
        return (
          <li key={n.notice_id} className="py-2">
            <button type="button" onClick={() => toggle(n)} className="flex w-full items-baseline gap-2 text-left">
              {unread ? <span aria-label={tr(lang, '안 읽음', 'Unread')} className="size-1.5 shrink-0 rounded-full bg-accent" /> : null}
              {n.pinned ? <span className="shrink-0 text-t10h font-semibold text-accent">{tr(lang, '고정', 'Pinned')}</span> : null}
              <span className={`min-w-0 flex-1 truncate text-t12h ${unread ? 'font-semibold' : ''}`}>
                {pickText(lang, n.title, n.title_en)}
              </span>
              <span className="shrink-0 text-t10h text-ink-muted">
                {n.business_id ? (businessNames[n.business_id] ?? n.business_id) : tr(lang, '그룹 전체', 'Group-wide')} ·{' '}
                {n.created_at.slice(5, 10)}
              </span>
            </button>
            {open === n.notice_id ? (
              <div className="mt-1.5 space-y-2 rounded-lg bg-raised px-3 py-2">
                <p className="whitespace-pre-wrap text-t12 leading-relaxed text-ink-dim">{pickText(lang, n.body, n.body_en)}</p>
                <p className="text-t10h text-ink-muted">
                  {n.created_by_name}
                  {n.expires_on ? ` · ${tr(lang, '게시 종료', 'Until')} ${n.expires_on}` : ''}
                </p>
                {who ? (
                  <details className="text-t11 text-ink-dim">
                    <summary className="cursor-pointer">
                      {tr(lang, `읽음 ${who.length}명`, `Read by ${who.length}`)}
                      <span className="ml-1 text-ink-muted">{tr(lang, `(작성자 · ${boss(role)}만 봅니다)`, `(author and ${bossEn(role).replace(/^the /, '')} only)`)}</span>
                    </summary>
                    <p className="mt-1">{who.map((r) => r.name).join(', ') || '—'}</p>
                  </details>
                ) : null}
                {canDelete.includes(n.notice_id) ? (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => remove(n.notice_id)}
                    className="text-t11 text-ink-muted hover:text-critical"
                  >
                    {tr(lang, '공지 내리기', 'Remove')}
                  </button>
                ) : null}
              </div>
            ) : null}
          </li>
        )
      })}
    </ul>
  )
}

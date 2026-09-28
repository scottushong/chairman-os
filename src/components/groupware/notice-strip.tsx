import Link from 'next/link'

import { pickText, tr, type Lang } from '@/lib/i18n'
import type { Notice } from '@/types'

/**
 * HOME 상단 공지 띠 (Phase 9 블록 1 — 원문 "직원 홈 상단에도 공지 띠").
 *
 * **직원 홈이 따로 없다.** HOME(/)이 모든 역할의 첫 화면이라(Phase 6 /me는 아직 서지 않았다)
 * 띠를 여기 건다. 게시 기간이 지난 공지는 빼고, 고정 → 안 읽음 → 최신 순으로 셋만.
 * 공지가 없으면 줄째로 안 그린다 — 빈 띠는 매일 «여기엔 아무것도 없다»를 가르친다.
 */
export function NoticeStrip({ notices, today, lang }: { notices: Notice[]; today: string; lang: Lang }) {
  const live = notices
    .filter((n) => !n.expires_on || n.expires_on >= today)
    .sort(
      (a, b) =>
        Number(b.pinned) - Number(a.pinned) ||
        Number(a.read_by_me) - Number(b.read_by_me) ||
        b.created_at.localeCompare(a.created_at),
    )
  if (live.length === 0) return null
  const unread = live.filter((n) => !n.read_by_me).length

  return (
    <div className="mt-3 flex items-center gap-3 rounded-xl border border-line-soft bg-raised px-3.5 py-2" aria-label={tr(lang, '공지', 'Notices')}>
      <span className="shrink-0 text-t11h font-semibold">
        {tr(lang, '공지', 'Notices')}
        {unread > 0 ? <span className="ml-1 rounded-full bg-accent px-1.5 text-t10 text-white tnum">{unread}</span> : null}
      </span>
      <ul className="flex min-w-0 flex-1 gap-4 overflow-hidden">
        {live.slice(0, 3).map((n) => (
          <li key={n.notice_id} className="min-w-0 truncate text-t12">
            {/* 1024px 미만은 block — inline 링크에는 min-height가 안 먹어 21px 과녁이 됐다(터치 44px 규칙). */}
            <Link
              href="/groupware"
              className={`hover:underline max-lg:block max-lg:truncate max-lg:leading-[44px] ${n.read_by_me ? 'text-ink-dim' : 'font-semibold'}`}
            >
              {n.pinned ? '📌 ' : ''}
              {pickText(lang, n.title, n.title_en)}
            </Link>
          </li>
        ))}
      </ul>
      <Link href="/groupware" className="shrink-0 text-t11 text-ink-dim hover:text-ink hover:underline">
        {tr(lang, '그룹웨어 →', 'Groupware →')}
      </Link>
    </div>
  )
}

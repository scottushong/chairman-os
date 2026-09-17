import Link from 'next/link'

/**
 * 회사 재무의 세 화면 — 재무제표 / 전표 / 계정과목 (Phase 2-B).
 * 셋은 같은 원장의 다른 면이라 같은 자리에서 오간다. 머리글 오른쪽(PageHeader children)에 선다.
 */

export type BooksTab = 'statements' | 'journal' | 'accounts'

const TABS: { tab: BooksTab; label: string; suffix: string }[] = [
  { tab: 'statements', label: '재무제표', suffix: '' },
  { tab: 'journal', label: '전표', suffix: '/journal' },
  { tab: 'accounts', label: '계정과목', suffix: '/accounts' },
]

export function BooksNav({ businessId, current }: { businessId: string; current: BooksTab }) {
  const base = `/finance/${encodeURIComponent(businessId)}`
  return (
    <nav className="flex items-center gap-1 rounded-md border border-line bg-panel p-0.5" aria-label="회사 재무">
      {TABS.map((t) => (
        <Link
          key={t.tab}
          href={`${base}${t.suffix}`}
          aria-current={t.tab === current ? 'page' : undefined}
          className={[
            'rounded px-2.5 py-1 text-[11.5px] transition-colors',
            t.tab === current ? 'bg-accent/15 font-semibold text-ink' : 'text-ink-dim hover:text-ink',
          ].join(' ')}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  )
}

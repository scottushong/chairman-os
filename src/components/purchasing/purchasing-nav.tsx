import Link from 'next/link'

/**
 * 구매 화면 다섯 장 — 개요 / 원료 / 공급처 / 시장가 / 구매 LOT. BooksNav(재무)와 같은 모양 · 같은 자리(PageHeader 오른쪽).
 */

export type PurchasingTab = 'overview' | 'materials' | 'suppliers' | 'market' | 'lots'

const TABS: { tab: PurchasingTab; label: string; suffix: string }[] = [
  { tab: 'overview', label: '개요', suffix: '' },
  { tab: 'lots', label: '구매 LOT', suffix: '/lots' },
  { tab: 'market', label: '시장가', suffix: '/market' },
  { tab: 'materials', label: '원료', suffix: '/materials' },
  { tab: 'suppliers', label: '공급처', suffix: '/suppliers' },
]

export function PurchasingNav({ businessId, current }: { businessId: string; current: PurchasingTab }) {
  const base = `/purchasing/${encodeURIComponent(businessId)}`
  return (
    <nav
      className="m-tabs flex max-w-full items-center gap-1 rounded-md border border-line bg-panel p-0.5 max-sm:max-w-[calc(100vw-2rem)]"
      aria-label="구매"
    >
      {TABS.map((t) => (
        <Link
          key={t.tab}
          href={`${base}${t.suffix}`}
          aria-current={t.tab === current ? 'page' : undefined}
          className={[
            'rounded px-2.5 py-1 text-t11h whitespace-nowrap transition-colors',
            t.tab === current ? 'bg-accent/15 font-semibold text-ink' : 'text-ink-dim hover:text-ink',
          ].join(' ')}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  )
}

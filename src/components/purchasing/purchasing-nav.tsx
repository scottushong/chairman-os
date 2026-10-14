import Link from 'next/link'

import { currentUser } from '@/lib/auth/session'
import { featureOn } from '@/lib/features-server'
import { canReadPriceReport } from '@/lib/price-report/rules'

/**
 * 구매 화면 — 개요 / 구매 LOT / 시장가 / 원료 / 공급처 / 가격 리포트(0082). BooksNav(재무)와 같은 모양 · 같은 자리(PageHeader 오른쪽).
 */

export type PurchasingTab = 'overview' | 'materials' | 'suppliers' | 'market' | 'lots' | 'price-report'

const TABS: { tab: PurchasingTab; label: string; suffix: string }[] = [
  { tab: 'overview', label: '개요', suffix: '' },
  { tab: 'lots', label: '구매 LOT', suffix: '/lots' },
  { tab: 'market', label: '시장가', suffix: '/market' },
  { tab: 'materials', label: '원료', suffix: '/materials' },
  { tab: 'suppliers', label: '공급처', suffix: '/suppliers' },
  // 0082 — 스위치 purchase_price_report · 대표 · 임원 이상 · 구매 줄에게만 보인다(원가 관리 줄만 있는 사람에게는 없다).
  { tab: 'price-report', label: '가격 리포트', suffix: '/price-report' },
]

export async function PurchasingNav({ businessId, current }: { businessId: string; current: PurchasingTab }) {
  const base = `/purchasing/${encodeURIComponent(businessId)}`
  const user = await currentUser()
  const priceReport = canReadPriceReport(user, businessId) && (await featureOn(user, 'purchase_price_report', businessId))
  return (
    <nav
      className="m-tabs flex max-w-full items-center gap-1 rounded-md border border-line bg-panel p-0.5 max-sm:max-w-[calc(100vw-2rem)]"
      aria-label="구매"
    >
      {TABS.filter((t) => t.tab !== 'price-report' || priceReport).map((t) => (
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

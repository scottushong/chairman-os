import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'

import { PageHeader } from '@/components/layout/page-header'
import { canReadPurchasing } from '@/lib/auth/roles'
import { currentUser } from '@/lib/auth/session'
import { getRepository } from '@/lib/repository'

/**
 * 구매 — 회사 고르기. 사이드바 «구매»가 오는 곳. 볼 수 있는 회사가 하나면 바로 그 회사로, 없으면 404(있는지 말하지 않는다).
 * 볼 수 있음 = 대표 또는 그 회사의 '/purchasing/<biz>' · '/costing/<biz>' 줄(안내 — 문은 DB cost_can).
 */
export default async function PurchasingIndexPage() {
  const [repo, user] = await Promise.all([getRepository(), currentUser()])
  const businesses = (await repo.listBusinesses())
    .filter((b) => b.status !== 'Archived' && canReadPurchasing(user, b.business_id))
    .sort((a, b) => a.sort_order - b.sort_order)
  if (businesses.length === 0) notFound()
  if (businesses.length === 1) redirect(`/purchasing/${encodeURIComponent(businesses[0].business_id)}`)

  return (
    <div className="mx-auto max-w-[1600px] px-4 py-5 sm:px-6">
      <PageHeader icon="cart" title="구매" code="COST-P" description="원료 · 공급처 · 시장가 · 구매 LOT — 회사를 고르세요." />
      <ul className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {businesses.map((b) => (
          <li key={b.business_id}>
            <Link
              href={`/purchasing/${encodeURIComponent(b.business_id)}`}
              className="flex min-h-11 items-center justify-between rounded-xl border border-line-soft bg-panel px-4 py-3 text-t13 transition-colors hover:border-accent"
            >
              <span className="font-semibold">{b.name}</span>
              <span className="text-t11 text-ink-muted">{b.industry}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}

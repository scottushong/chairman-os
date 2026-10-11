import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'

import { PageHeader } from '@/components/layout/page-header'
import { canReadCosts } from '@/lib/auth/roles'
import { currentUser } from '@/lib/auth/session'
import { getRepository } from '@/lib/repository'

/**
 * 원가 관리 — 회사 고르기. 사이드바 «원가 관리»이 오는 곳. 볼 수 있는 회사가 하나면 바로 그 회사로, 없으면 404(있는지 말하지 않는다).
 * 볼 수 있음 = 대표 또는 그 회사의 '/costs/<biz>' 줄(안내 — 문은 DB 0064).
 */
export default async function CostsIndexPage() {
  const [repo, user] = await Promise.all([getRepository(), currentUser()])
  const businesses = (await repo.listBusinesses())
    .filter((b) => b.status !== 'Archived' && canReadCosts(user, b.business_id))
    .sort((a, b) => a.sort_order - b.sort_order)
  if (businesses.length === 0) notFound()
  if (businesses.length === 1) redirect(`/costs/${encodeURIComponent(businesses[0].business_id)}`)

  return (
    <div className="mx-auto max-w-[1600px] px-4 py-5 sm:px-6">
      <PageHeader icon="layers" title="원가 관리" code="COST-C" description="제품 원가 · 비용 마스터 · 배부 기준 · Actual 원가 — 회사를 고르세요." />
      <ul className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {businesses.map((b) => (
          <li key={b.business_id}>
            <Link
              href={`/costs/${encodeURIComponent(b.business_id)}`}
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

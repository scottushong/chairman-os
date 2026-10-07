import Link from 'next/link'

import { FinanceView } from '@/components/finance/finance-view'
import { PageHeader } from '@/components/layout/page-header'
import { currentUser } from '@/lib/auth/session'
import { ecountUploadShortcuts } from '@/lib/ecount/shortcut'
import { firstParam, oneOf } from '@/lib/query'
import { getRepository } from '@/lib/repository'

/**
 * 그룹 재무 (Phase 2-A). 5개사 단순 합산, 회사 화면과 같은 구조.
 *
 * 보관(Archived) 회사는 뺀다. 합산 범위는 권한이 정한다 — 원장 read 정책(0015)이 볼 수 없는 회사의
 * 행을 주지 않으므로, 그룹 합계는 '내가 볼 수 있는 회사들'의 합이다. 화면이 몇 개사인지 적는다.
 */
export default async function GroupFinancePage(props: PageProps<'/finance'>) {
  const params = await props.searchParams
  const repo = await getRepository()
  const [businesses, ledger, user] = await Promise.all([repo.listBusinesses(), repo.loadFinanceLedger(), currentUser()])
  const active = businesses.filter((b) => b.status !== 'Archived').sort((a, b) => a.sort_order - b.sort_order)
  // «ECOUNT 업로드» 바로가기 — 그 회사 재무 쓰기 권한자에게만(lib/ecount/shortcut.ts). 볼 수 있는 회사 중에서만.
  const shortcuts = ecountUploadShortcuts(user, active, { withName: true })

  return (
    <div className="mx-auto max-w-[1600px] px-4 py-5 sm:px-6">
      <PageHeader
        icon="coin"
        title="그룹 재무"
        code="CH-025~027"
        description={`${active.length}개사 합산 · 손익계산서 · 재무상태표 · 현금흐름표 · 모든 숫자에 출처 꼬리표`}
      >
        {/* 폰에서는 회사 칩이 세 줄로 쌓여 첫 화면을 먹는다 — m-tabs로 한 줄에서 옆으로 민다.
            폭 상한이 %가 아닌 길이인 이유는 books-nav.tsx 주석(머리글 오른쪽 칸의 최소 폭) 참고. */}
        <div className="m-tabs flex max-w-full flex-wrap items-center gap-1 max-sm:max-w-[calc(100vw-2rem)]">
          {shortcuts.map((s) => (
            <Link key={`ecount-${s.business_id}`} href={s.href} className={'rounded-md border border-accent/60 bg-accent/10 px-2.5 py-1.5 text-t11h font-semibold text-ink transition-colors hover:border-accent hover:bg-accent/20'}>
              {s.label}
            </Link>
          ))}
          {active.map((b) => (
            <Link
              key={b.business_id}
              href={`/finance/${encodeURIComponent(b.business_id)}`}
              className="rounded-md border border-line bg-panel px-2 py-1 text-t11 text-ink-dim transition-colors hover:border-accent hover:text-ink"
            >
              {b.name}
            </Link>
          ))}
        </div>
      </PageHeader>
      <FinanceView
        ledger={ledger}
        businessIds={active.map((b) => b.business_id)}
        basePath="/finance"
        month={firstParam(params.month)}
        tab={oneOf(firstParam(params.tab), ['is', 'bs', 'cf'] as const) ?? 'is'}
      />
    </div>
  )
}

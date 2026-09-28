import Link from 'next/link'

/**
 * 회사 재무의 세 화면 — 재무제표 / 전표 / 계정과목 (Phase 2-B).
 * 셋은 같은 원장의 다른 면이라 같은 자리에서 오간다. 머리글 오른쪽(PageHeader children)에 선다.
 */

export type BooksTab = 'statements' | 'monthly' | 'official' | 'journal' | 'accounts'

const TABS: { tab: BooksTab; label: string; suffix: string }[] = [
  { tab: 'statements', label: '재무제표', suffix: '' },
  // Phase 2-C. 장부에 쓰는 두 입구 — 월별 간이 손익(잠정)과 공식 결산(확정).
  { tab: 'monthly', label: '월별 입력', suffix: '/monthly' },
  { tab: 'official', label: '공식 결산', suffix: '/statements/new' },
  { tab: 'journal', label: '전표', suffix: '/journal' },
  { tab: 'accounts', label: '계정과목', suffix: '/accounts' },
]

export function BooksNav({ businessId, current }: { businessId: string; current: BooksTab }) {
  const base = `/finance/${encodeURIComponent(businessId)}`
  // m-tabs: 폰에서 다섯 탭이 한 글자씩 세로로 접혔다(360px). 줄을 접지 않고 옆으로 밀게 한다.
  // 폭 상한을 화면 폭(- 좌우 16px)으로 못 박는 이유: PageHeader 오른쪽 칸은 내용의 최소 폭 아래로 줄지 않고,
  // 스크롤 상자라도 그 최소 폭은 탭 전체 길이로 잡힌다. %가 아닌 길이로 상한을 줘야 그 계산이 잘린다.
  return (
    <nav className="m-tabs flex max-w-full items-center gap-1 max-sm:max-w-[calc(100vw-2rem)] rounded-md border border-line bg-panel p-0.5" aria-label="회사 재무">
      {TABS.map((t) => (
        <Link
          key={t.tab}
          href={`${base}${t.suffix}`}
          aria-current={t.tab === current ? 'page' : undefined}
          className={[
            'rounded px-2.5 py-1 text-t11h transition-colors',
            t.tab === current ? 'bg-accent/15 font-semibold text-ink' : 'text-ink-dim hover:text-ink',
          ].join(' ')}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  )
}

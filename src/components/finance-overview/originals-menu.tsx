import Link from 'next/link'

/**
 * 재무 현황 오른쪽 위 «원본 보기 ›»(2026-10-20 A5) — 원본 화면(재무제표 · 전표 · 계정과목 · 공식 결산 · 재고 · 평가 · 그룹 합산)으로 가는 유일한 입구.
 * 대표 · 그룹 CFO에게만 그린다(페이지가 판정). 원본 화면 자체 · 주소 · 권한은 그대로다 — 메뉴에서만 빠졌다.
 * JS 없이 열리는 <details>(서버 컴포넌트).
 */
export function OriginalsMenu({ businessId, period, canImport }: { businessId: string; period: string; canImport: boolean }) {
  const base = `/finance/${encodeURIComponent(businessId)}`
  const items: { href: string; label: string }[] = [
    { href: `${base}?month=${period}`, label: '재무제표 원본(손익 · 재무상태 · 현금흐름)' },
    { href: `${base}/journal`, label: '전표' },
    { href: `${base}/accounts`, label: '계정과목' },
    { href: `${base}/statements/new`, label: '공식 결산' },
    ...(canImport ? [{ href: `${base}/valuation`, label: '재고 · 평가' }] : []),
    { href: '/finance?view=group', label: '그룹 합산(5개사)' },
  ]
  return (
    <details className="relative" data-testid="originals-menu">
      <summary className="flex min-h-11 cursor-pointer list-none items-center rounded-lg border border-line bg-card px-3 text-[13px] text-ink-dim hover:border-accent hover:text-accent [&::-webkit-details-marker]:hidden">
        원본 보기 ›
      </summary>
      <ul className="absolute right-0 z-20 mt-1 w-64 max-w-[calc(100vw-2rem)] max-sm:right-auto max-sm:left-0 max-sm:w-56 rounded-lg border border-line bg-card py-1 text-[14px] shadow-lg" aria-label="원본 화면">
        {items.map((i) => (
          <li key={i.href}>
            <Link href={i.href} className="flex min-h-11 items-center px-3 text-ink hover:bg-accent-soft hover:text-accent">
              {i.label}
            </Link>
          </li>
        ))}
      </ul>
    </details>
  )
}

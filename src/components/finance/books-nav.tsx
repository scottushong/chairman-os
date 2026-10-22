import Link from 'next/link'

/**
 * 회사 재무의 원본 화면 — 재무제표 / 공식 결산 / 전표 / 계정과목 / 자료 올리기 / 재고 · 평가 (Phase 2-B).
 * 2026-10-20 A5: 이 화면들은 사이드 메뉴 · 재무 현황 탭에서 빠지고 재무 현황 «원본 보기 ›»(대표 · CFO) 아래에만 있다 — 원본끼리 오가는 탭은 그대로.
 * 셋은 같은 원장의 다른 면이라 같은 자리에서 오간다. 머리글 오른쪽(PageHeader children)에 선다.
 */

export type BooksTab = 'statements' | 'official' | 'journal' | 'accounts' | 'import' | 'valuation'

const TABS: { tab: BooksTab; label: string; suffix: string }[] = [
  { tab: 'statements', label: '재무제표', suffix: '' },
  // Phase 2-C 공식 결산(확정). «월별 입력(CH-026)»은 지웠다(2026-10-20 A5 — 옛 주소는 재무 현황 손익계산서 탭으로).
  { tab: 'official', label: '공식 결산', suffix: '/statements/new' },
  { tab: 'journal', label: '전표', suffix: '/journal' },
  { tab: 'accounts', label: '계정과목', suffix: '/accounts' },
  // ECOUNT 엑셀 업로드(0050). ECOUNT 코드 회사(DY) + 그 회사 재무 쓰기 권한일 때만 — canImport(lib/auth/roles canImportEcount).
  { tab: 'import', label: '회계 · 재무 자료 올리기', suffix: '/upload' },
  // 0072. 재공품 · 완제품 평가금액 · 기초재고 연결 · 원료 출고 구분 — 올리기와 같은 권한(canImport = 장부 쓰기).
  { tab: 'valuation', label: '재고 · 평가', suffix: '/valuation' },
]

export function BooksNav({ businessId, current, canImport }: { businessId: string; current: BooksTab; canImport: boolean }) {
  const base = `/finance/${encodeURIComponent(businessId)}`
  const tabs = TABS.filter((t) => (t.tab !== 'import' && t.tab !== 'valuation') || canImport)
  // m-tabs: 폰에서 다섯 탭이 한 글자씩 세로로 접혔다(360px). 줄을 접지 않고 옆으로 밀게 한다.
  // 폭 상한을 화면 폭(- 좌우 16px)으로 못 박는 이유: PageHeader 오른쪽 칸은 내용의 최소 폭 아래로 줄지 않고,
  // 스크롤 상자라도 그 최소 폭은 탭 전체 길이로 잡힌다. %가 아닌 길이로 상한을 줘야 그 계산이 잘린다.
  return (
    <nav className="m-tabs flex max-w-full items-center gap-1 max-sm:max-w-[calc(100vw-2rem)] rounded-md border border-line bg-panel p-0.5" aria-label="회사 재무">
      {tabs.map((t) => (
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

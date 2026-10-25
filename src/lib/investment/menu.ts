/**
 * CAPITAL › INVESTMENT INTELLIGENCE 하위 메뉴(원문 2.1 — 이름 · 순서 그대로) + 데이터 상태(수집 · 손 입력).
 * 사이드바 펼침 칸(InvestmentSection)과 화면 위 탭(InvestmentTabs)이 같은 목록을 본다.
 */
export interface InvestmentMenuItem {
  key: string
  no: number | null
  label: string
  href: string
  /** 이 화면이 서는 단계(0094=1 · 0095=2 · 0096=3). 아직인 단계의 메뉴는 그리지 않는다 — 없는 화면으로 가는 링크를 만들지 않는다. */
  stage: 1 | 2 | 3
}

/** 지금 선 단계. 단계를 마칠 때 올린다. */
export const INVESTMENT_STAGE: 1 | 2 | 3 = 3

export const INVESTMENT_MENU: readonly InvestmentMenuItem[] = [
  { key: 'dashboard', no: 1, label: 'Dashboard', href: '/investment', stage: 1 },
  { key: 'radar', no: 2, label: 'Investor Radar', href: '/investment/radar', stage: 1 },
  { key: 'markets', no: 3, label: 'Future Markets', href: '/investment/markets', stage: 2 },
  { key: 'securities', no: 4, label: 'Stock & ETF 360', href: '/investment/securities', stage: 1 },
  { key: 'engine', no: 5, label: 'AI Investment Engine', href: '/investment/engine', stage: 2 },
  { key: 'recommendations', no: 6, label: 'Recommendations', href: '/investment/recommendations', stage: 2 },
  { key: 'portfolio', no: 7, label: 'DY Portfolio', href: '/investment/portfolio', stage: 3 },
  { key: 'performance', no: 8, label: 'Performance & Learning', href: '/investment/performance', stage: 3 },
  { key: 'sources', no: null, label: '데이터 상태', href: '/investment/sources', stage: 1 },
]

export const investmentMenu = () => INVESTMENT_MENU.filter((m) => m.stage <= INVESTMENT_STAGE)

/** 지금 주소가 이 메뉴인가 — Dashboard는 정확히 /investment일 때만. */
export function menuActive(pathname: string, item: InvestmentMenuItem): boolean {
  if (item.href === '/investment') return pathname === '/investment'
  return pathname === item.href || pathname.startsWith(`${item.href}/`)
}

import type { AccountCategory, AccountSection, BusinessId, CashFlowClass } from '@/types'

/**
 * 표준 계정과목표 — 한국 중소기업 (Phase 2-B 블록 1).
 *
 * 회계 원천은 자체 장부다. 스타트업 네 곳(VANA · Sticky · HOF · 보람)은 같은 표를 쓰고,
 * DY는 ECOUNT 코드 체계를 그대로 쓴다 — DY 계정은 엑셀 업로드 때 매핑돼 들어온다.
 *
 * 코드는 네 자리. 앞자리 관례(1 자산 / 2 부채 / 3 자본 / 4 매출·원가 / 8 판관비 / 9 영업외·법인세)는
 * 일반 기업회계 세 자리 코드에 0을 붙인 모양이다. mock 원장(lib/ecount/account-map.ts의 MOCK_CHART)이
 * 이미 쓰던 코드는 이름·분류까지 그대로 두었다 — dummy의 mock 전표가 이 표 위에서 그대로 읽혀야 한다.
 * scripts/check-finance-ledger.ts가 'MOCK_CHART ⊂ 표준표'를 잰다.
 *
 * 0016_books.sql이 같은 표를 네 회사에 시드한다. 한쪽을 고치면 다른 쪽도 고친다 —
 * scripts/check-migrations.ts가 PGlite에 올린 시드와 이 표를 한 줄씩 비교한다.
 *
 * 분류 세 칸의 뜻은 types/finance.ts. 대분류(category)는 원가 구조의 막대, 구분(section)은 재무제표의 줄,
 * 현금흐름(cash_flow)은 이 계정의 상대 현금이 어느 활동인가다. 현금 계정 자신과 손익 계정은 null.
 */

export interface StandardAccount {
  code: string
  name: string
  category: AccountCategory
  section: AccountSection
  cash_flow: CashFlowClass | null
}

/** 표준표를 쓰는 회사. 새 회사는 계정과목 화면의 '표준 계정과목표 적용'으로 같은 표를 받는다. */
export const STANDARD_CHART_BUSINESSES: readonly BusinessId[] = ['biz_vana', 'biz_sticky', 'biz_hof', 'biz_boram']

/** ECOUNT 코드 체계를 그대로 쓰는 회사. 표준표를 받지 않는다 — 업로드가 계정을 싣는다. */
export const ECOUNT_CODE_BUSINESSES: readonly BusinessId[] = ['biz_dy']

const a = (
  code: string,
  name: string,
  category: AccountCategory,
  section: AccountSection,
  cash_flow: CashFlowClass | null,
): StandardAccount => ({ code, name, category, section, cash_flow })

export const STANDARD_CHART: readonly StandardAccount[] = [
  // 자산 — 현금
  a('1010', '현금및현금성자산', 'asset', 'cash', null),
  a('1030', '보통예금', 'asset', 'cash', null),
  // 자산 — 매출채권
  a('1080', '외상매출금', 'asset', 'receivable', 'operating'),
  a('1100', '받을어음', 'asset', 'receivable', 'operating'),
  // 자산 — 기타
  a('1200', '미수금', 'asset', 'other_asset', 'operating'),
  a('1310', '선급금', 'asset', 'other_asset', 'operating'),
  a('1330', '선급비용', 'asset', 'other_asset', 'operating'),
  a('1350', '부가세대급금', 'asset', 'other_asset', 'operating'),
  a('1360', '가지급금', 'asset', 'other_asset', 'operating'),
  a('1400', '유형자산', 'asset', 'other_asset', 'investing'),
  // 감가상각누계액은 현금흐름에 넣지 않는다 — 상각비로 이미 더했다.
  a('1410', '감가상각누계액', 'asset', 'other_asset', null),
  a('1460', '상품', 'asset', 'other_asset', 'operating'),
  a('1500', '제품', 'asset', 'other_asset', 'operating'),
  a('1530', '원재료', 'asset', 'other_asset', 'operating'),
  a('1700', '무형자산', 'asset', 'other_asset', 'investing'),
  a('1960', '임차보증금', 'asset', 'other_asset', 'investing'),

  // 부채
  a('2010', '외상매입금', 'liability', 'payable', 'operating'),
  a('2520', '지급어음', 'liability', 'payable', 'operating'),
  a('2530', '미지급금', 'liability', 'other_liability', 'operating'),
  a('2540', '예수금', 'liability', 'other_liability', 'operating'),
  a('2550', '부가세예수금', 'liability', 'other_liability', 'operating'),
  a('2590', '선수금', 'liability', 'other_liability', 'operating'),
  a('2600', '차입금', 'liability', 'other_liability', 'financing'),
  a('2620', '미지급비용', 'liability', 'other_liability', 'operating'),
  a('2930', '장기차입금', 'liability', 'other_liability', 'financing'),
  a('2950', '퇴직급여충당부채', 'liability', 'other_liability', 'operating'),

  // 자본
  a('3310', '자본금', 'equity', 'equity', 'financing'),
  a('3410', '주식발행초과금', 'equity', 'equity', 'financing'),
  a('3750', '이월이익잉여금', 'equity', 'equity', 'financing'),

  // 매출
  a('4010', '제품매출', 'revenue', 'revenue', null),
  a('4020', '상품매출', 'revenue', 'revenue', null),
  a('4030', '용역매출', 'revenue', 'revenue', null),

  // 매출원가 — 원가 카테고리로 나눈다
  a('4510', '원재료비', 'raw_material', 'cogs', null),
  a('4520', '제조인건비', 'labor', 'cogs', null),
  a('4530', '전력비', 'electricity', 'cogs', null),
  a('4540', '운반비', 'freight', 'cogs', null),
  a('4550', '라이선스료', 'license', 'cogs', null),
  a('4590', '기타제조경비', 'other', 'cogs', null),
  a('4600', '외주가공비', 'other', 'cogs', null),
  // 되팔려고 산 상품의 원가. 원가 구조에서는 '원재료' 막대에 선다(사서 쓰는 물건).
  a('4610', '상품매출원가', 'raw_material', 'cogs', null),

  // 판매비와관리비
  a('8010', '급여(판관)', 'labor', 'sga', null),
  a('8030', '상여금', 'labor', 'sga', null),
  a('8050', '퇴직급여', 'labor', 'sga', null),
  a('8110', '복리후생비', 'labor', 'sga', null),
  a('8120', '여비교통비', 'other', 'sga', null),
  a('8130', '접대비', 'other', 'sga', null),
  a('8140', '통신비', 'other', 'sga', null),
  a('8150', '수도광열비', 'electricity', 'sga', null),
  a('8170', '세금과공과', 'other', 'sga', null),
  a('8190', '지급수수료', 'other', 'sga', null),
  a('8220', '지급임차료', 'other', 'sga', null),
  a('8230', '보험료', 'other', 'sga', null),
  a('8240', '차량유지비', 'other', 'sga', null),
  a('8250', '운반비(판관)', 'freight', 'sga', null),
  a('8260', '도서인쇄비', 'other', 'sga', null),
  a('8300', '소모품비', 'other', 'sga', null),
  a('8330', '광고선전비', 'other', 'sga', null),
  a('8340', '소프트웨어사용료', 'license', 'sga', null),
  a('8350', '연구개발비', 'other', 'sga', null),

  // 감가상각비 — EBITDA 아래 줄
  a('8210', '감가상각비', 'other', 'd_and_a', null),
  a('8280', '무형자산상각비', 'other', 'd_and_a', null),

  // 영업외
  a('9010', '영업외수익', 'other', 'non_operating', null),
  a('9020', '이자수익', 'other', 'non_operating', null),
  a('9310', '이자비용', 'other', 'non_operating', null),
  a('9320', '외환차손', 'other', 'non_operating', null),
  a('9330', '잡손실', 'other', 'non_operating', null),

  // 법인세
  a('9980', '법인세비용', 'other', 'tax', null),
]

import type { BusinessId, IsoDate, IsoDateTime, PeriodKey } from './primitives'

/**
 * Phase 2-A 재무 원천 (0015_finance_ledger).
 *
 * 원칙 하나로 모든 모양이 정해진다 — **출처 없는 숫자는 화면에 못 올린다.**
 * 그래서 원천 행은 전부 source / fetched_at / closed 세 칸을 들고 다니고,
 * 화면으로 나가는 숫자는 맨숫자(number)가 아니라 Figure다. Figure를 만들려면 basis가 있어야 하고,
 * basis는 원천 행의 세 칸에서만 나온다(lib/finance/basis.ts). 손으로 '확정'을 붙이는 경로가 없다.
 */

/** 어디서 왔나. 0015의 data_source enum. */
export const DATA_SOURCE = ['ecount', 'manual', 'estimate'] as const
export type DataSource = (typeof DATA_SOURCE)[number]

/**
 * 화면 꼬리표. 원천의 (source, closed)에서 기계적으로 나온다(lib/ledger/basis.ts).
 *   원장(전표·결산)   closed → 확정 / not closed → 잠정. ECOUNT든 자체 장부(manual)든 같다(0016)
 *   그 밖(시트·환율·지수)  ecount+closed 확정 · ecount 잠정 · manual 수기
 *   estimate          추정
 *
 * 순서가 뜻이 있다 — 뒤로 갈수록 약하다. 여러 숫자를 더한 값은 그중 가장 약한 꼬리표를 받는다.
 * 확정 11개월에 잠정 1개월을 더한 YTD는 확정이 아니다.
 */
export const FIGURE_BASIS = ['confirmed', 'provisional', 'manual', 'estimate'] as const
export type FigureBasis = (typeof FIGURE_BASIS)[number]

export const FIGURE_BASIS_LABEL_KO: Record<FigureBasis, string> = {
  confirmed: '확정',
  provisional: '잠정',
  manual: '수기',
  estimate: '추정',
}

/** 화면에 올라가는 숫자 한 개. value만 있고 basis가 없는 숫자는 타입이 받지 않는다. */
export interface Figure {
  value: number
  basis: FigureBasis
  /** 가장 오래된 원천의 수집 시각. 원천이 없으면(0으로 채운 칸) null */
  fetched_at: IsoDateTime | null
}

/** 원천 행이 공통으로 갖는 세 칸. 0015의 모든 재무 원천 표에 같은 이름으로 있다. */
export interface Provenance {
  source: DataSource
  /** 이 행을 원천에서 가져온(또는 사람이 넣은) 시각 */
  fetched_at: IsoDateTime
  /** 이 값이 더 바뀌지 않는가. 전표는 월 마감, 환율은 고시 확정, 지수는 잠정치 → 확정치 */
  closed: boolean
}

/**
 * 계정 대분류. 원가 구조 차트가 이 단위로 묶는다.
 * 사용자 지정 목록(매출/원재료/인건비/전기/운송/라이센스/기타/자산/부채)에 '자본'을 하나 더했다 —
 * 재무상태표가 자산 = 부채 + 자본으로 닫히려면 자본 계정이 있어야 한다.
 */
export const ACCOUNT_CATEGORY = [
  'revenue',
  'raw_material',
  'labor',
  'electricity',
  'freight',
  'license',
  'other',
  'asset',
  'liability',
  'equity',
] as const
export type AccountCategory = (typeof ACCOUNT_CATEGORY)[number]

export const ACCOUNT_CATEGORY_LABEL_KO: Record<AccountCategory, string> = {
  revenue: '매출',
  raw_material: '원재료',
  labor: '인건비',
  electricity: '전기',
  freight: '운송',
  license: '라이센스',
  other: '기타',
  asset: '자산',
  liability: '부채',
  equity: '자본',
}

/** 원가 구조 차트에 서는 비용 대분류. 순서가 곧 화면 순서다. */
export const COST_CATEGORIES = [
  'raw_material',
  'labor',
  'electricity',
  'freight',
  'license',
  'other',
] as const satisfies readonly AccountCategory[]
export type CostCategory = (typeof COST_CATEGORIES)[number]

/**
 * 재무제표의 어느 줄에 서는가. 대분류(category)와 축이 다르다 —
 * 인건비는 제조원가에도 판관비에도 있다. 대분류는 '무엇에 쓴 돈인가', 구분은 '손익의 어느 단계인가'다.
 */
export const ACCOUNT_SECTION = [
  // 손익계산서
  'revenue',
  'cogs',
  'sga',
  'd_and_a',
  'non_operating',
  'tax',
  // 재무상태표
  'cash',
  'receivable',
  'other_asset',
  'payable',
  'other_liability',
  'equity',
] as const
export type AccountSection = (typeof ACCOUNT_SECTION)[number]

export const PL_SECTIONS = ['revenue', 'cogs', 'sga', 'd_and_a', 'non_operating', 'tax'] as const
export const BS_SECTIONS = [
  'cash',
  'receivable',
  'other_asset',
  'payable',
  'other_liability',
  'equity',
] as const

export const ACCOUNT_SECTION_LABEL_KO: Record<AccountSection, string> = {
  revenue: '매출',
  cogs: '매출원가',
  sga: '판매비와관리비',
  d_and_a: '감가상각비',
  non_operating: '영업외손익',
  tax: '법인세비용',
  cash: '현금및현금성자산',
  receivable: '매출채권',
  other_asset: '기타자산',
  payable: '매입채무',
  other_liability: '기타부채',
  equity: '자본',
}

/** 현금흐름표에서 이 계정의 상대 현금이 어느 활동인가. 현금 계정 자신은 null이다. */
export const CASH_FLOW_CLASS = ['operating', 'investing', 'financing'] as const
export type CashFlowClass = (typeof CASH_FLOW_CLASS)[number]

export const CASH_FLOW_CLASS_LABEL_KO: Record<CashFlowClass, string> = {
  operating: '영업활동',
  investing: '투자활동',
  financing: '재무활동',
}

export type DrCr = 'debit' | 'credit'

/** 계정과목. 회사마다 따로다 — 같은 코드가 회사마다 다른 계정일 수 있다(ECOUNT 회사코드 단위). */
export interface Account extends Provenance {
  business_id: BusinessId
  /** ECOUNT 계정코드 */
  account_code: string
  name: string
  category: AccountCategory
  section: AccountSection
  cash_flow: CashFlowClass | null
  /**
   * 사용 중인가(0016). 계정은 지우지 않는다 — 전표와 결산이 코드를 문다.
   * 비활성 계정에는 새 전표를 넣을 수 없고, 이미 있는 숫자는 재무제표에 그대로 선다.
   */
  active: boolean
}

/**
 * 전표 라인. 잠정 원천이다.
 * 금액은 늘 양수이고 방향은 side가 갖는다. 부호로 차대를 표현하면 음수 차변과 대변이 구분되지 않는다.
 */
export interface JournalLine extends Provenance {
  business_id: BusinessId
  entry_date: IsoDate
  account_code: string
  amount: number
  side: DrCr
  /** ECOUNT 전표번호. 같은 전표의 라인끼리 묶이고, 현금흐름표가 상대 계정을 여기서 찾는다. */
  slip_no: string
  line_no: number
  memo: string
}

/**
 * 월 결산 한 칸. 확정 원천이다.
 *
 * amount는 **차변 − 대변**이다. 손익 계정은 그 달의 순발생액, 상태표 계정은 월말 잔액.
 * 매출·부채·자본은 그래서 음수로 저장된다 — 화면이 부호를 뒤집는다(lib/finance/ledger.ts).
 * '자연 부호'로 저장하면 계정마다 어느 쪽이 양수인지를 따로 알아야 하고, 그게 틀리는 순간 합계가 조용히 틀린다.
 *
 * closed=false는 가마감이다. 꼬리표는 잠정으로 나간다.
 */
export interface Closing extends Provenance {
  business_id: BusinessId
  period: PeriodKey
  account_code: string
  amount: number
  /** 마감일 */
  closed_on: IsoDate
  /**
   * 마감 시점에 전표로 보이던 값(같은 부호 규칙). '잠정-확정 차이'가 여기서 나온다.
   * 마감 때 전표가 하나도 없었으면 null이다 — 0과 다르다.
   */
  provisional_amount: number | null
}

/** 환율. 1 base = rate quote. */
export interface FxRate extends Provenance {
  rate_date: IsoDate
  base: string
  quote: string
  rate: number
  /** 원천 이름(예: 한국은행 ECOS). source가 어떤 '종류'인지라면 이건 '누구'인지다. */
  source_name: string
}

/** 원가 드라이버 지수. 원가 대분류 옆에 나란히 선다(lib/finance/cost-drivers.ts). */
export const COST_INDEX_CODE = ['raw_material', 'electricity', 'cpi', 'freight'] as const
export type CostIndexCode = (typeof COST_INDEX_CODE)[number]

export const COST_INDEX_LABEL_KO: Record<CostIndexCode, string> = {
  raw_material: '원재료지수',
  electricity: '산업용 전기요금',
  cpi: 'CPI',
  freight: '운임지수',
}

export interface CostIndex extends Provenance {
  index_code: CostIndexCode
  index_date: IsoDate
  value: number
  unit: string
  source_name: string
}

/**
 * 업종 멀티플. 사람이 고르고 승인하는 숫자다.
 * closed = 승인됨. 승인 전 멀티플은 화면에 올리지 않는다 — 기업가치는 이 숫자 하나로 몇십억이 움직인다.
 */
export interface MarketMultiple extends Provenance {
  multiple_id: string
  industry: string
  ev_ebitda: number | null
  psr: number | null
  as_of: IsoDate
  source_name: string
  approved_by: string | null
  approved_at: IsoDateTime | null
}

/**
 * 자체 장부 전표의 헤더 (0016 journal_entries). 라인은 JournalLine(source='manual')이고 slip_no로 묶인다.
 * ECOUNT·mock 라인에는 헤더가 없다. 전표는 고치지 않는다 — 정정 전표로 바로잡는다.
 */
export interface JournalEntry {
  business_id: BusinessId
  slip_no: string
  entry_date: IsoDate
  memo: string
  /** 증빙 링크. 파일 실체는 사내 스토리지(CLAUDE.md) */
  evidence_url: string | null
  created_by: string
  created_at: IsoDateTime
  /** 정정 전표면 원 전표번호(0016 4절). 원 전표·보통 전표는 null */
  corrects_id: string | null
  /** reversal = 원 전표를 뒤집은 역분개, restatement = 바로잡은 정정분개 */
  correction_kind: 'reversal' | 'restatement' | null
}

/** 재무 화면 한 판이 읽는 원천 전부. 화면이 원천을 따로따로 부르면 live에서 왕복이 여섯 번 생긴다. */
export interface FinanceLedger {
  accounts: Account[]
  journal: JournalLine[]
  closings: Closing[]
  /** 자체 장부 전표 헤더(0016). 라인은 journal에 있다 */
  entries: JournalEntry[]
  fxRates: FxRate[]
  costIndices: CostIndex[]
}

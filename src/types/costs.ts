import type { IsoDate } from './primitives'

/**
 * 원가 엔진 — 원가 관리(0065 비용 마스터 · 배부 · 총원가 Fully Loaded)와 대표 BOM(0063 암호문 판).
 *
 * 금액은 원/kg(월 금액 줄만 원/월). 대표 = DB가 원래 값을 주고 화면이 1원으로 그린다, 원가 관리 = DB가 1원으로 준다.
 * **BOM 칸(BomLine · BomCurrent · ProductBreakdownRow)은 대표 BOM 화면만 쓴다** — 원가 관리 · 생산 화면 코드는 부르지 않는다(check:sales-cost).
 */

export const OVERHEAD_CATEGORIES = [
  'labor',
  'power',
  'gas',
  'depreciation',
  'qc',
  'waste',
  'packaging',
  'pallet',
  'logistics',
  'warehouse',
  'rent',
  'insurance',
  'finance',
  'commission',
  'other',
] as const
export type OverheadCategory = (typeof OVERHEAD_CATEGORIES)[number]

export const OVERHEAD_CATEGORY_LABEL_KO: Record<OverheadCategory, string> = {
  labor: '인건비',
  power: '전기',
  gas: '가스',
  depreciation: '감가상각',
  qc: 'QC',
  waste: '폐기 Loss',
  packaging: '포장',
  pallet: '팔레트',
  logistics: '물류',
  warehouse: '창고',
  rent: '임대',
  insurance: '보험',
  finance: '금융비용',
  commission: '커미션',
  other: '기타',
}

export const OVERHEAD_GROUPS = ['mfg', 'pack', 'logi', 'indirect'] as const
export type OverheadGroup = (typeof OVERHEAD_GROUPS)[number]

export const OVERHEAD_GROUP_LABEL_KO: Record<OverheadGroup, string> = {
  mfg: '제조',
  pack: '포장',
  logi: '물류',
  indirect: '간접비',
}

/** 0065 cost_secret.overhead_group과 같은 묶음. */
export function overheadGroupOf(c: OverheadCategory): OverheadGroup {
  if (['labor', 'power', 'gas', 'depreciation', 'qc', 'waste'].includes(c)) return 'mfg'
  if (c === 'packaging' || c === 'pallet') return 'pack'
  if (c === 'logistics' || c === 'warehouse') return 'logi'
  return 'indirect'
}

/** monthly = 월 금액(원) · per_kg = 원/kg 직접 단가. */
export type OverheadBasis = 'monthly' | 'per_kg'

export const OVERHEAD_BASIS_LABEL_KO: Record<OverheadBasis, string> = {
  monthly: '월 금액',
  per_kg: '원/kg',
}

/** 0065 cost_overheads 한 줄. 고치지 않는다(무효 + 새 줄). */
export interface Overhead {
  overhead_id: number
  business_id: string
  category: OverheadCategory
  basis: OverheadBasis
  amount: number
  /** per_kg만 — 비우면 모든 제품. */
  product_id: string | null
  effective_from: IsoDate
  note: string
  created_at: string
  voided_at: string | null
  void_reason: string | null
}

export interface OverheadInput {
  category: OverheadCategory
  basis: OverheadBasis
  amount: number
  product_id: string | null
  effective_from: IsoDate
  note: string
}

export type AllocBasis = 'trailing' | 'plan'

/** 0065 cost_alloc_settings — 줄이 없으면 기본(trailing · 28일). */
export interface AllocSettings {
  business_id: string
  basis: AllocBasis
  window_days: number
  planned_kg_month: number | null
  updated_at: string | null
}

/** 0065 cost_overhead_summary — 항목별 오늘 적용 값 · kg당 배부 · 나눈 kg. */
export interface OverheadSummaryRow {
  category: OverheadCategory
  grp: OverheadGroup
  basis: OverheadBasis
  amount: number
  product_id: string | null
  effective_from: IsoDate
  per_kg: number | null
  divisor_kg: number | null
  basis_used: AllocBasis | null
  window_days: number | null
}

/** 0065 cost_costing_list 한 줄 — 제품마다 Market · Current · 비용 네 묶음 · 총원가(Fully Loaded). */
export interface CostingRow {
  product_id: string
  product_name: string
  as_of: IsoDate
  market_krw_per_kg: number | null
  current_krw_per_kg: number | null
  mfg_krw_per_kg: number | null
  pack_krw_per_kg: number | null
  logi_krw_per_kg: number | null
  indirect_krw_per_kg: number | null
  overhead_krw_per_kg: number | null
  total_krw_per_kg: number | null
  overhead_ready: boolean
  overhead_basis: AllocBasis | null
  computed: boolean
}

// ── 대표 BOM(0063) — 대표 BOM 화면만 ─────────────────────────────────

/** 0063 cost_bom_status — 키 · «진짜 BOM 받기» 스위치(값 없이). */
export interface BomStatus {
  key_ready: boolean
  real_allowed: boolean
  changed_at: string | null
}

/** 0063 cost_bom_versions — 판 목록(비율 없이). */
export interface BomVersionRow {
  version_id: number
  product_id: string
  valid_from: IsoDate
  yield_pct: number
  is_fake: boolean
  note: string
  created_at: string
  voided_at: string | null
  void_reason: string | null
}

export interface BomLine {
  material_id: string
  material_name: string
  kg_per_kg: number
}

/** 0063 cost_bom_get — 그 날 쓰는 판 하나와 원료 · kg/kg. */
export interface BomCurrent {
  version_id: number
  valid_from: IsoDate
  yield_pct: number
  is_fake: boolean
  lines: BomLine[]
}

/** 0063 cost_product_breakdown — 대표만. 원료별 kg/kg · 수율 반영 kg · 단가 · 기여(원/kg, 원래 값). */
export interface ProductBreakdownRow {
  material_id: string
  material_name: string
  kg_per_kg: number
  qty_kg_per_kg: number
  unit_krw_per_kg: number | null
  contribution_krw_per_kg: number | null
}

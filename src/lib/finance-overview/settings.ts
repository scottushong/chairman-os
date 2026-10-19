/**
 * 12가지 지표 기준값(0085 fin_kpi_settings) — 회사마다. 없으면 아래 기본값. 화면 «기준값»에서 대표 · CFO · 마감 권한자가 바꾼다.
 * 금액은 원 · 비율은 % · 날은 일. null = 정하지 않음(그 지표는 «기준값 없음»으로 말한다 — 지어내지 않는다).
 */
export interface KpiSettings {
  /** 안전선 잔액(원) — 자금 전망 · 투자 여력. null이면 «한 달 평균 지출»을 안전선으로 쓴다 */
  safety_cash: number | null
  /** 연체로 보는 날 수(매출채권) */
  overdue_days: number
  /** 올해 목표 — 매출 · 영업이익(원) */
  annual_revenue_target: number | null
  annual_op_target: number | null
  /** 쓰지 않은 대출 한도(원) — 투자 여력 */
  unused_credit: number
  /** 법인세 추정률(%) — 장부에 법인세가 없을 때 */
  tax_rate: number
  /** 원가율이 전월보다 몇 %p 오르면 주황 · 빨강 */
  cogs_ratio_warn: number
  cogs_ratio_bad: number
  /** 회수 기간(일) 주황 · 빨강 */
  dso_warn: number
  dso_bad: number
  /** 재고일수 주황 · 빨강 */
  inventory_days_warn: number
  inventory_days_bad: number
  /** 부채비율(%) 주황 · 빨강 */
  debt_ratio_warn: number
  debt_ratio_bad: number
  /** 이자보상배율(배) 주황 아래 · 빨강 아래 */
  interest_cover_warn: number
  interest_cover_bad: number
  /** 영업이익률(%) 주황 아래 · 빨강 아래 */
  op_margin_warn: number
  op_margin_bad: number
  /** 달력에서 «큰 수금 · 큰 지출» 날로 칠하는 금액(원) */
  big_day: number
  /** 달러 환율(원) — 비우면 자금흐름표 · 공개 고시 환율 */
  usd_krw: number | null
}

export const KPI_DEFAULTS: KpiSettings = {
  safety_cash: null,
  overdue_days: 60,
  annual_revenue_target: null,
  annual_op_target: null,
  unused_credit: 0,
  tax_rate: 22,
  cogs_ratio_warn: 1,
  cogs_ratio_bad: 3,
  dso_warn: 60,
  dso_bad: 90,
  inventory_days_warn: 60,
  inventory_days_bad: 90,
  debt_ratio_warn: 200,
  debt_ratio_bad: 300,
  interest_cover_warn: 3,
  interest_cover_bad: 1.5,
  op_margin_warn: 5,
  op_margin_bad: 0,
  big_day: 100_000_000,
  usd_krw: null,
}

export const KPI_SETTING_LABEL: Record<keyof KpiSettings, string> = {
  safety_cash: '안전선 잔액(원)',
  overdue_days: '연체 기준(일)',
  annual_revenue_target: '올해 매출 목표(원)',
  annual_op_target: '올해 영업이익 목표(원)',
  unused_credit: '쓰지 않은 대출 한도(원)',
  tax_rate: '법인세 추정률(%)',
  cogs_ratio_warn: '원가율 상승 주황(%p)',
  cogs_ratio_bad: '원가율 상승 빨강(%p)',
  dso_warn: '회수 기간 주황(일)',
  dso_bad: '회수 기간 빨강(일)',
  inventory_days_warn: '재고일수 주황(일)',
  inventory_days_bad: '재고일수 빨강(일)',
  debt_ratio_warn: '부채비율 주황(%)',
  debt_ratio_bad: '부채비율 빨강(%)',
  interest_cover_warn: '이자보상배율 주황(배 아래)',
  interest_cover_bad: '이자보상배율 빨강(배 아래)',
  op_margin_warn: '영업이익률 주황(% 아래)',
  op_margin_bad: '영업이익률 빨강(% 아래)',
  big_day: '달력 큰 금액(원)',
  usd_krw: '달러 환율(원)',
}

const NULLABLE = new Set<keyof KpiSettings>(['safety_cash', 'annual_revenue_target', 'annual_op_target', 'usd_krw'])

/** DB · 화면에서 온 값을 믿지 않고 숫자만 받는다. 모르는 칸은 버린다. */
export function parseKpiSettings(raw: unknown): KpiSettings {
  const out: KpiSettings = { ...KPI_DEFAULTS }
  if (!raw || typeof raw !== 'object') return out
  for (const k of Object.keys(KPI_DEFAULTS) as (keyof KpiSettings)[]) {
    const v = (raw as Record<string, unknown>)[k]
    if (v === null && NULLABLE.has(k)) {
      ;(out as unknown as Record<string, number | null>)[k] = null
      continue
    }
    const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v.replace(/,/g, '')) : NaN
    if (Number.isFinite(n) && Math.abs(n) < 1e15) (out as unknown as Record<string, number | null>)[k] = n
  }
  return out
}

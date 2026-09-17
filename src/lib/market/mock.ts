import type { CostIndex, CostIndexCode, FxRate, PeriodKey } from '@/types'

/**
 * 환율·원가 지수 mock (Phase 2-A).
 *
 * 실제 원천(한국은행 ECOS, 한전 요금표, 통계청 CPI, 운임지수)은 아직 붙지 않았다.
 * 붙기 전까지는 재무 담당이 손으로 넣는 표다 — 그래서 실 원천의 source는 'manual'(수기)이 된다.
 * 여기 mock은 source='estimate'(추정)다. 실제 발표치가 아니라는 사실이 꼬리표에 그대로 나와야 한다.
 *
 * 값은 달 번호 t만의 함수다(난수 없음). 재실행해도, dummy와 검증 스크립트가 따로 불러도 같다.
 * 원재료지수는 오르고, 전기요금은 두 번 계단식으로 오르고, 운임은 출렁인다 —
 * 원가 구조 차트가 '비용 전년비 vs 지수 전년비'를 나란히 놓을 때 읽을 거리가 있게 한 모양이다.
 */

export const MOCK_MARKET_START: PeriodKey = '2024-09'
export const MOCK_MARKET_FETCHED_AT = '2026-09-16T14:00:00Z'

function monthIndex(period: PeriodKey): number {
  const [y, m] = period.split('-').map(Number)
  const [y0, m0] = MOCK_MARKET_START.split('-').map(Number)
  return (y - y0) * 12 + (m - m0)
}

function round(v: number, digits: number): number {
  const p = 10 ** digits
  return Math.round(v * p) / p
}

/** 지수 값. t = 2024-09부터 몇 번째 달인가. */
export function mockIndexValue(code: CostIndexCode, period: PeriodKey): number {
  const t = monthIndex(period)
  switch (code) {
    case 'raw_material':
      return round(100 * (1 + 0.007 * t) + 3 * Math.sin(t / 2), 1)
    case 'electricity':
      // 2025-01, 2025-10 두 번 인상
      return t < 4 ? 100 : t < 13 ? 105.3 : 112.1
    case 'cpi':
      return round(100 * 1.0021 ** t, 2)
    case 'freight':
      return round(100 + 14 * Math.sin(t / 3) + 0.6 * t, 1)
  }
}

export function mockUsdKrw(period: PeriodKey): number {
  const t = monthIndex(period)
  return round(1330 + 4 * t + 22 * Math.sin(t / 4), 2)
}

const INDEX_META: Record<CostIndexCode, { unit: string; source_name: string }> = {
  raw_material: { unit: '2024-09=100', source_name: 'MOCK 원재료지수' },
  electricity: { unit: '2024-09=100', source_name: 'MOCK 산업용 전기요금' },
  cpi: { unit: '2024-09=100', source_name: 'MOCK 소비자물가지수' },
  freight: { unit: '2024-09=100', source_name: 'MOCK 운임지수' },
}

function lastDay(period: PeriodKey): string {
  const [y, m] = period.split('-').map(Number)
  return `${period}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`
}

/** 월말 기준 한 점씩. 마지막 달은 아직 발표 전이라 closed=false다. */
export function mockMarket(periods: PeriodKey[]): { fxRates: FxRate[]; costIndices: CostIndex[] } {
  const last = [...periods].sort().at(-1)
  const common = (period: PeriodKey) => ({
    source: 'estimate' as const,
    fetched_at: MOCK_MARKET_FETCHED_AT,
    closed: period !== last,
  })
  return {
    fxRates: periods.map((p) => ({
      rate_date: lastDay(p),
      base: 'USD',
      quote: 'KRW',
      rate: mockUsdKrw(p),
      source_name: 'MOCK 매매기준율',
      ...common(p),
    })),
    costIndices: periods.flatMap((p) =>
      (Object.keys(INDEX_META) as CostIndexCode[]).map((code) => ({
        index_code: code,
        index_date: lastDay(p),
        value: mockIndexValue(code, p),
        ...INDEX_META[code],
        ...common(p),
      })),
    ),
  }
}

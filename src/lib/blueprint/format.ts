import { krw } from '@/lib/sales/cost'
import type { DiagnosisCard, ForecastRow, PerfBy, ProfitBasis } from '@/types'

/**
 * 0081 화면 문구 · 표기(순수). 직원 화면 문구라 «대표»만 쓴다.
 */

export const BLUEPRINT_OFF = '지금은 쓸 수 없는 화면입니다.'

/** 0081 RPC 오류 → 화면 말. feature_off · 0081 전 DB는 여기서, 나머지는 원가 엔진 말(costEngineError)로. */
export function blueprintErrorKey(e: unknown): 'off' | 'unavailable' | null {
  const m = e instanceof Error ? e.message : String(e)
  if (/feature_off/.test(m)) return 'off'
  if (/blueprint_unavailable/.test(m)) return 'unavailable'
  return null
}

export const won = (n: number | null | undefined) => (n === null || n === undefined ? '—' : krw(n))
export const pct1 = (n: number | null | undefined) => (n === null || n === undefined ? '—' : `${n.toFixed(1)}%`)
export const kgText = (n: number | null | undefined) => (n === null || n === undefined ? '—' : `${n.toLocaleString('ko-KR', { maximumFractionDigits: 3 })}kg`)

export const FORECAST_REASON_KO: Record<NonNullable<ForecastRow['reason']>, string> = {
  no_bom: 'BOM 없음',
  price_missing: '단가 없는 원료',
  overhead_not_ready: '비용 배부 전',
  not_computed: '계산 전(원료 단가가 다 모이지 않음)',
}

export const PERF_BY_KO: Record<PerfBy, string> = { month: '월', material: '원료', supplier: '공급처', lot: 'LOT' }

export const BASIS_KO: Record<ProfitBasis, string> = { actual: '실제', estimated: '추정', mixed: '혼합', uncomputed: '계산 불가' }
export const BASIS_NOTE: Record<ProfitBasis, string> = {
  actual: '모든 판매가 생산 LOT의 실제 원가(Actual)',
  estimated: '생산 LOT가 이어지지 않아 출고일 Current 원가(그날 남은 구매 LOT 단가)로 추정',
  mixed: '실제와 추정이 섞임',
  uncomputed: '원가를 계산할 수 없는 판매뿐(BOM · 단가 · 비용 배부 없음)',
}

/** ⑧ 카드 제목(번호 동그라미 포함). */
export const CARD_TITLE: Record<number, string> = {
  1: '① Actual',
  2: '② Current',
  3: '③ Market',
  4: '④ 구매 절감',
  5: '⑤ 경쟁사보다 싸게 팔아도 남는가',
  6: '⑥ 최소 판매가(15% 경계)',
  7: '⑦ 20% 마진 가격',
  8: '⑧ 상위 고객',
  9: '⑨ 매출 대비 마진 순위',
  10: '⑩ 마진 하락 이유',
  11: '⑪ 원가 상승 최대 영향',
}

const n = (v: unknown): number | null => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null)
const s = (v: unknown): string | null => (typeof v === 'string' ? v : null)

export const BRIDGE_KEY_KO: Record<string, string> = { price: '판매가', material: '원료비', mfg: '제조비', logi: '물류비', other: '기타(포장 · 간접비)' }

/** 카드 값 → 큰 글자 한 줄 + 작은 줄들. no_data는 화면이 따로 그린다(0을 쓰지 않는다). */
export function cardText(c: DiagnosisCard): { main: string; sub: string[] } {
  const v = c.value ?? {}
  const perKg = (x: unknown) => `${won(n(x))}원/kg`
  switch (c.id) {
    case 1:
      return { main: perKg(v.krw_per_kg), sub: [`생산 LOT ${s(v.prod_lot_id) ?? '—'} · ${s(v.produced_on) ?? '—'}`] }
    case 2:
      return { main: perKg(v.krw_per_kg), sub: ['총원가(원료 Current + 비용)'] }
    case 3:
      return { main: perKg(v.krw_per_kg), sub: ['원료비(오늘 시장가)'] }
    case 4:
      return { main: `${won(n(v.krw))}원`, sub: [`최근 ${n(v.days) ?? 90}일 · 이 제품에 드는 원료의 LOT 절감 합`] }
    case 5: {
      const m = n(v.our_margin_at_competitor_pct)
      return {
        main: m === null ? '—' : m >= 0 ? `남는다 · ${pct1(m)}` : `밑진다 · ${pct1(m)}`,
        sub: [
          `경쟁사 예상 최소가 ${perKg(v.competitor_min_krw_per_kg)}`,
          `우리 목표가(20%) ${perKg(v.our_target_krw_per_kg)}`,
          `등급 ${s(v.grade) ?? '—'}${v.assumed_defaults === true ? ' · 경쟁사 가정 없음(우리 값 · 마진 15%로 셈)' : ''}`,
        ],
      }
    }
    case 6:
      return { main: perKg(v.krw_per_kg), sub: ['총원가 ÷ 0.85 — 이 밑이면 Red'] }
    case 7:
      return { main: perKg(v.krw_per_kg), sub: ['총원가 ÷ 0.8'] }
    case 8: {
      const list = Array.isArray(v.customers) ? (v.customers as Record<string, unknown>[]) : []
      return {
        main: `${list.length}곳`,
        sub: list.map((x) => `${s(x.customer) ?? '—'} · ${won(n(x.revenue_krw))}원 · ${kgText(n(x.kg))}`).concat([`최근 ${n(v.days) ?? 90}일`]),
      }
    }
    case 9:
      return { main: `매출 ${n(v.revenue_rank) ?? '—'}위 · 마진 ${n(v.gm_rank) ?? '—'}위`, sub: [`제품 ${n(v.n_products) ?? '—'}개 중 · 최근 ${n(v.days) ?? 90}일`] }
    case 10: {
      const total = n(v.total_krw_per_kg)
      const big = s(v.biggest)
      const top = v.top_material && typeof v.top_material === 'object' ? (v.top_material as Record<string, unknown>) : null
      const sub = [`가장 큰 효과: ${big ? (BRIDGE_KEY_KO[big] ?? big) : '—'} ${won(n(v.biggest_krw_per_kg))}원/kg`]
      if (n(v.material_pct) !== null) sub.push(`원료비 변화 ${pct1(n(v.material_pct))}`)
      if (top) sub.push(`원료 1위: ${s(top.material_name) ?? '—'} ${won(n(top.delta_krw_per_kg))}원/kg`)
      return { main: total === null ? '—' : `${total < 0 ? '−' : total > 0 ? '+' : ''}${won(Math.abs(total))}원/kg`, sub: ['지난달 → 이번 달 GM', ...sub] }
    }
    case 11: {
      if (s(v.material_name)) return { main: `${s(v.material_name)} ${won(n(v.delta_krw_per_kg))}원/kg`, sub: [`${n(v.days) ?? 7}일 전 대비 제품 kg당 영향`] }
      const oh = n(v.overhead_delta_krw_per_kg)
      return { main: `원료비 ${pct1(n(v.material_pct))}`, sub: [`비용 묶음 변화 ${oh === null ? '—' : `${won(oh)}원/kg`}`, `${n(v.days) ?? 7}일 전 대비`] }
    }
    default:
      return { main: '—', sub: [] }
  }
}

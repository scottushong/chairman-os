import type { SupabaseClient } from '@supabase/supabase-js'

import type { MonthlyPlView, PlSettings, PlYearRow } from '@/types'

import type { ChairmanRepository } from './types'

/**
 * 0075 «월별 손익 — 재고 반영 · 마감»의 live 어댑터 조각. supabase.ts가 펼쳐 넣는다.
 * 계산 · 판정 · 가리기는 전부 DB다(fin_pl_* 정의자 함수 — 원료별 kg는 DB 밖으로 나오지 않는다). 여기서는 모양만 옮긴다.
 * 0075가 없는 DB를 견딘다(앱이 DB보다 먼저 나갈 수 있다): 읽기는 null · 빈 목록, 쓰기는 'fin_pl_unavailable'.
 */

const MISSING = new Set(['PGRST202', '42883', 'PGRST205', '42P01'])
type Err = { code?: string; message: string }

function fail(what: string, error: Err): never {
  if (MISSING.has(error.code ?? '')) throw new Error('fin_pl_unavailable')
  const key = /fin_pl_[a-z_]+|feature_off/.exec(error.message)?.[0]
  throw new Error(key ?? `Supabase ${what} ${error.code ?? '?'}: ${error.message}`)
}

type Methods = Pick<
  ChairmanRepository,
  | 'finPlMonth'
  | 'finPlYear'
  | 'finPlSettings'
  | 'finPlRecord'
  | 'finPlReopen'
  | 'finPlAdjustPropose'
  | 'finPlAdjustDecide'
  | 'finPlSettingsSave'
  | 'finPlAdjustRow'
>

export function monthlyPlMethods(sb: SupabaseClient): Methods {
  return {
    async finPlMonth(businessId, period) {
      const { data, error } = await sb.rpc('fin_pl_month', { p_business: businessId, p_period: period })
      if (error && MISSING.has(error.code ?? '')) return null
      if (error) fail('fin_pl_month', error)
      return (data ?? null) as MonthlyPlView | null
    },
    async finPlYear(businessId, year) {
      const { data, error } = await sb.rpc('fin_pl_year', { p_business: businessId, p_year: year })
      if (error && MISSING.has(error.code ?? '')) return []
      if (error) fail('fin_pl_year', error)
      return (data ?? []) as PlYearRow[]
    },
    async finPlSettings(businessId) {
      const { data, error } = await sb.rpc('fin_pl_setting', { p_business: businessId })
      if (error && MISSING.has(error.code ?? '')) return null
      if (error) fail('fin_pl_setting', error)
      return (data ?? null) as PlSettings | null
    },
    async finPlRecord(businessId, period, final, reason) {
      const { data, error } = await sb.rpc('fin_pl_record', { p_business: businessId, p_period: period, p_final: final, p_reason: reason })
      if (error) fail('fin_pl_record', error)
      return String(data)
    },
    async finPlReopen(businessId, period, reason) {
      const { data, error } = await sb.rpc('fin_pl_reopen', { p_business: businessId, p_period: period, p_reason: reason })
      if (error) fail('fin_pl_reopen', error)
      return Number(data ?? 0)
    },
    async finPlAdjustPropose(x) {
      const { data, error } = await sb.rpc('fin_pl_adjust_propose', { p_business: x.business_id, p_period: x.period, p_kind: x.kind, p_amount: x.amount, p_reason: x.reason })
      if (error) fail('fin_pl_adjust_propose', error)
      return String(data)
    },
    async finPlAdjustDecide(adjId, action, reason) {
      const { data, error } = await sb.rpc('fin_pl_adjust_decide', { p_id: adjId, p_action: action, p_reason: reason })
      if (error) fail('fin_pl_adjust_decide', error)
      return data === true
    },
    async finPlSettingsSave(businessId, s, reason) {
      const { error } = await sb.rpc('fin_pl_setting_save', {
        p_business: businessId, p_method: s.method, p_method_confirmed: s.method_confirmed, p_tolerance: s.tolerance_krw,
        p_revenue_source: s.revenue_source, p_payment_categories: s.payment_categories, p_reason: reason,
      })
      if (error) fail('fin_pl_setting_save', error)
    },
    async finPlAdjustRow(adjId) {
      const { data, error } = await sb.from('fin_pl_adjustments').select('business_id, period').eq('adj_id', adjId).maybeSingle()
      if (error && MISSING.has(error.code ?? '')) return null
      if (error) fail('fin_pl_adjustments', error)
      return (data ?? null) as { business_id: string; period: string } | null
    },
  }
}

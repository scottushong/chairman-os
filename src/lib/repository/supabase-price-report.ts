import type { SupabaseClient } from '@supabase/supabase-js'

import type { PriceCards, PriceEvent, PriceReport, PriceReportMeta, PriceRun, PriceSlot } from '@/types'

import type { PriceReportMethods } from './types'

/**
 * 0082 가격 리포트의 live 어댑터 조각. supabase.ts가 펼쳐 넣는다. 판정 · 한도 · 감사는 전부 DB(표 RLS · price_report_request)다.
 * 0082가 없는 DB면 'price_report_unavailable'(앱이 DB보다 먼저 나갈 수 있다 — 화면이 «준비 중»).
 */

const MISSING = new Set(['PGRST202', '42883', 'PGRST205', '42P01'])
type Err = { code?: string; message: string }

function fail(what: string, error: Err): never {
  if (MISSING.has(error.code ?? '')) throw new Error('price_report_unavailable')
  const key = /price_report_[a-z_]+|feature_off/.exec(error.message)?.[0]
  throw new Error(key ?? `Supabase ${what} ${error.code ?? '?'}: ${error.message}`)
}

const META_COLS = 'report_id, business_id, report_date, slot, status, created_at, missing, figures, run_id'

/** figures(jsonb)에서 화면이 쓰는 칸만 — 모르는 모양이면 null. */
export function metaFrom(r: Record<string, unknown>): PriceReportMeta {
  const fig = r.figures && typeof r.figures === 'object' ? (r.figures as Record<string, unknown>) : {}
  return {
    report_id: String(r.report_id),
    business_id: String(r.business_id),
    report_date: String(r.report_date),
    slot: String(r.slot) as PriceSlot,
    status: r.status === 'unconfirmed' ? 'unconfirmed' : 'ok',
    created_at: String(r.created_at),
    missing: Array.isArray(r.missing) ? r.missing.map(String) : [],
    cards: fig.cards && typeof fig.cards === 'object' ? (fig.cards as PriceCards) : null,
    headline: typeof fig.headline === 'string' ? fig.headline : null,
    run_id: r.run_id ? String(r.run_id) : null,
  }
}

export function priceReportMethods(sb: SupabaseClient): PriceReportMethods {
  return {
    async listPriceReports(businessId, limit = 60) {
      const { data, error } = await sb.from('purchase_price_reports').select(META_COLS).eq('business_id', businessId).order('created_at', { ascending: false }).limit(limit)
      if (error) fail('purchase_price_reports', error)
      return (data ?? []).map((r) => metaFrom(r as Record<string, unknown>))
    },
    async getPriceReport(businessId, reportId) {
      let q = sb.from('purchase_price_reports').select(`${META_COLS}, html, chat_summary_md`).eq('business_id', businessId)
      q = reportId ? q.eq('report_id', reportId) : q.order('created_at', { ascending: false }).limit(1)
      const { data, error } = await q
      if (error) fail('purchase_price_reports', error)
      const r = (data ?? [])[0] as Record<string, unknown> | undefined
      return r ? ({ ...metaFrom(r), html: String(r.html ?? ''), chat_summary_md: r.chat_summary_md ? String(r.chat_summary_md) : null } satisfies PriceReport) : null
    },
    async listPriceEvents(businessId, limit = 40) {
      const { data, error } = await sb
        .from('purchase_price_events')
        .select('event_id, event_date, title, url, source, first_slot, first_run, first_seen_at')
        .eq('business_id', businessId)
        .eq('kind', 'event')
        .order('first_seen_at', { ascending: false })
        .order('event_id', { ascending: false })
        .limit(limit)
      if (error) fail('purchase_price_events', error)
      return (data ?? []).map(
        (r): PriceEvent => ({
          event_id: Number(r.event_id),
          event_date: r.event_date ? String(r.event_date) : null,
          title: String(r.title),
          url: r.url ? String(r.url) : null,
          source: r.source ? String(r.source) : null,
          first_slot: r.first_slot ? String(r.first_slot) : null,
          first_run: r.first_run ? String(r.first_run) : null,
          first_seen_at: String(r.first_seen_at),
        }),
      )
    },
    async listPriceRuns(businessId, limit = 20) {
      const { data, error } = await sb
        .from('purchase_price_runs')
        .select('run_id, trigger, slot, requested_by, status, created_at, started_at, finished_at, error, report_id, new_events, points')
        .eq('business_id', businessId)
        .order('created_at', { ascending: false })
        .limit(limit)
      if (error) fail('purchase_price_runs', error)
      return (data ?? []) as PriceRun[]
    },
    async priceReportRequest(businessId, perDay) {
      const { data, error } = await sb.rpc('price_report_request', { p_business: businessId, p_per_day: perDay })
      if (error) fail('price_report_request', error)
      return String(data)
    },
    async priceReportDispatchFailed(runId, message) {
      const { data, error } = await sb.rpc('price_report_dispatch_failed', { p_run: runId, p_error: message.slice(0, 300) })
      if (error) fail('price_report_dispatch_failed', error)
      return data === true
    },
  }
}

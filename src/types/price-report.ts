/**
 * 0084 DY 구매팀 가격 리포트 — 화면 · 저장소가 주고받는 모양. 숫자는 엔진(macro/engine)이 만든 것을 그대로 보인다(앱은 계산하지 않는다).
 */

export type PriceSlot = 'AM' | 'PM' | 'manual'
export type PriceReportStatus = 'ok' | 'unconfirmed'
export type PriceRunStatus = 'queued' | 'collecting' | 'done' | 'failed'

export interface PricePoint {
  date: string
  value: number
  kind: string
}

/** 엔진 supa.summary_cards()가 figures.cards에 넣는 요약(구매 개요 카드). */
export interface PriceCards {
  brent: PricePoint | null
  dubai: PricePoint | null
  wti: PricePoint | null
  naphtha_cfd: PricePoint | null
  opinet_naphtha_bbl: PricePoint | null
  crack: { date: string; value: number } | null
}

export interface PriceReportMeta {
  report_id: string
  business_id: string
  report_date: string
  slot: PriceSlot
  status: PriceReportStatus
  created_at: string
  missing: string[]
  cards: PriceCards | null
  headline: string | null
  run_id: string | null
}

export interface PriceReport extends PriceReportMeta {
  html: string
  chat_summary_md: string | null
}

export interface PriceEvent {
  event_id: number
  event_date: string | null
  title: string
  url: string | null
  source: string | null
  first_slot: string | null
  first_run: string | null
  first_seen_at: string
}

export interface PriceRun {
  run_id: string
  trigger: 'auto' | 'manual'
  slot: PriceSlot
  requested_by: string | null
  status: PriceRunStatus
  created_at: string
  started_at: string | null
  finished_at: string | null
  error: string | null
  report_id: string | null
  new_events: number | null
  points: number | null
}

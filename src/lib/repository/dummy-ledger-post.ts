import type { LedgerPostStatus, LedgerQueueRow } from '@/types'

import type { ChairmanRepository } from './types'

/**
 * 0079 «원장 → 장부 반영»의 dummy 자리(live에서는 돌지 않는다). 0079 ledger_post_*를 옮겨 적었다.
 * 원장 줄 · 같은 거래 묶음은 dummy 자료 올리기 저장소(가짜 9월 원장)를 읽는다. 전표는 **dummy 장부에 쓰지 않는다** — 전표 번호만 흉내(M…-D…).
 * 문: 스위치 'ledger_post' · 장부 쓰기(canKeepBooks 거울) · 마감 달은 대표 · CFO + 이유.
 */

export interface DummyLedgerLine {
  line_id: number
  business_id: string
  period: string
  voided: boolean
  row: Record<string, string | number | null>
}

export interface DummyLedgerPostDeps {
  featureOn(businessId: string): Promise<boolean>
  canKeep(businessId: string): boolean
  top(): boolean
  lines(): DummyLedgerLine[]
  /** 살아 있는 묶음의 원장 줄 → 묶음 상태 · 같은 묶음 원장 줄들. */
  groupOf(lineId: number): { status: 'same' | 'suspect' | 'rejected'; ledgerLines: number[] } | null
  closed(businessId: string, period: string): boolean
}

interface Post {
  post_id: string
  business_id: string
  period: string
  status: LedgerPostStatus
  lines: number[]
  counter: string | null
  closed: boolean
  slip_no: string | null
}

const posts: Post[] = []
let seq = 0

export function dummyLedgerPost(d: DummyLedgerPostDeps): Pick<ChairmanRepository, 'ledgerPostQueue' | 'ledgerPostStage' | 'ledgerPostApply' | 'ledgerPostVoid'> {
  const gate = async (b: string) => {
    if (!(await d.featureOn(b))) throw new Error('feature_off')
    if (!d.canKeep(b)) throw new Error('ledger_forbidden')
  }
  const live = (lineId: number) => posts.find((p) => p.status !== 'voided' && p.lines.includes(lineId)) ?? null
  const num = (v: unknown) => (v === null || v === undefined ? 0 : Number(v))
  const slip = (period: string) => `M${period.slice(2, 4)}${period.slice(5, 7)}-D${String(++seq).padStart(5, '0')}`
  return {
    async ledgerPostQueue(b, period) {
      await gate(b)
      return d
        .lines()
        .filter((l) => l.business_id === b && l.period === period && !l.voided)
        .map((l): LedgerQueueRow => {
          const p = live(l.line_id)
          return {
            line_id: l.line_id, tx_date: (l.row.tx_date as string) ?? null, account_code: (l.row.account_code as string) ?? null, account_name: (l.row.account_name as string) ?? null,
            counterparty: (l.row.counterparty as string) ?? null, memo: (l.row.memo as string) ?? null,
            debit: l.row.debit === null || l.row.debit === undefined ? null : Number(l.row.debit), credit: l.row.credit === null || l.row.credit === undefined ? null : Number(l.row.credit),
            group_status: d.groupOf(l.line_id)?.status ?? null, post_id: p?.post_id ?? null, post_status: p?.status ?? null, slip_no: p?.slip_no ?? null, closed_month: d.closed(b, period),
          }
        })
    },
    async ledgerPostStage(b, lineIds, counter, _date, reason) {
      await gate(b)
      if (lineIds.length === 0 || lineIds.length > 200) throw new Error('ledger_invalid')
      if (lineIds.some((id) => d.groupOf(id)?.status === 'suspect')) throw new Error('ledger_dedupe_suspect')
      const ids = [...new Set(lineIds.flatMap((id) => { const g = d.groupOf(id); return g?.status === 'same' ? [id, ...g.ledgerLines] : [id] }))]
      const ls = ids.map((id) => d.lines().find((l) => l.line_id === id && l.business_id === b && !l.voided))
      if (ls.some((l) => !l)) throw new Error('ledger_not_found')
      const periods = new Set(ls.map((l) => l!.period))
      if (periods.size !== 1) throw new Error('ledger_one_period')
      if (ids.some((id) => live(id))) throw new Error('ledger_already_staged')
      if (ls.some((l) => num(l!.row.debit) < 0 || num(l!.row.credit) < 0)) throw new Error('ledger_line_shape')
      // 리뷰 고침 I2 — 전표 날짜 달 = 원장 달(그 달이 마감이면 뒤의 달)
      if (_date && _date.slice(0, 7) !== [...periods][0] && !(d.closed(b, [...periods][0]) && _date.slice(0, 7) > [...periods][0])) throw new Error('ledger_entry_date')
      const dr = ls.reduce((t, l) => t + num(l!.row.debit), 0)
      const cr = ls.reduce((t, l) => t + num(l!.row.credit), 0)
      if (dr !== cr && !counter?.trim()) throw new Error('ledger_unbalanced')
      const period = [...periods][0]
      const closed = d.closed(b, period)
      if (closed && (!d.top() || !reason?.trim())) throw new Error('ledger_closed_month')
      const p: Post = { post_id: crypto.randomUUID(), business_id: b, period, status: 'pending', lines: ids, counter: dr !== cr ? counter!.trim() : null, closed, slip_no: null }
      posts.push(p)
      return p.post_id
    },
    async ledgerPostApply(id, reason) {
      const p = posts.find((x) => x.post_id === id)
      if (!p) throw new Error('ledger_not_found')
      await gate(p.business_id)
      if (p.status !== 'pending') throw new Error('ledger_not_pending')
      if ((p.closed || d.closed(p.business_id, p.period)) && (!d.top() || !(reason ?? '').trim())) throw new Error('ledger_closed_month')
      p.status = 'posted'
      p.slip_no = slip(p.period)
      return p.slip_no
    },
    async ledgerPostVoid(id, reason) {
      const p = posts.find((x) => x.post_id === id)
      if (!p) throw new Error('ledger_not_found')
      await gate(p.business_id)
      if (!reason.trim() || reason.length > 300) throw new Error('ledger_void_reason')
      if (p.status === 'voided') throw new Error('ledger_not_pending')
      const rev = p.status === 'posted' ? slip(p.period) : null
      p.status = 'voided'
      return rev ?? p.post_id
    },
  }
}

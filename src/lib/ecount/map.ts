import type { Account, Closing, IsoDateTime, JournalLine, PeriodKey } from '@/types'

import type { AccountChart } from './account-map'
import type { EcountAccountRow, EcountClosingRow, EcountSlipLineRow } from './types'
import { EcountApiError } from './types'

/**
 * ECOUNT 표기 ↔ Chairman OS 표기. 두 세계의 말이 다른 자리를 전부 여기서 흡수한다.
 *   날짜   YYYYMMDD ↔ YYYY-MM-DD,  월 YYYYMM ↔ YYYY-MM
 *   금액   문자열 ↔ 숫자. 숫자로 못 읽으면 0이 아니라 실패다.
 *   차대   DR_AMT / CR_AMT 두 칸 ↔ amount + side
 *
 * 원천 행을 만들 때 source / fetched_at / closed를 여기서 붙인다. 출처는 가져오는 순간 정해진다 —
 * 나중에 붙이면 '언제 누가 가져왔나'를 모르는 행이 한동안 DB에 존재한다.
 */

export function toIsoDate(yyyymmdd: string): string {
  if (!/^\d{8}$/.test(yyyymmdd)) throw new EcountApiError(`날짜 형식이 아니다: ${yyyymmdd}`)
  return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`
}

export function toYyyymmdd(isoDate: string): string {
  return isoDate.replaceAll('-', '')
}

export function toPeriod(yymm: string): PeriodKey {
  if (!/^\d{6}$/.test(yymm)) throw new EcountApiError(`월 형식이 아니다: ${yymm}`)
  return `${yymm.slice(0, 4)}-${yymm.slice(4, 6)}`
}

function amount(value: string, field: string): number {
  const n = Number(String(value).replaceAll(',', '').trim() || '0')
  if (!Number.isFinite(n)) throw new EcountApiError(`${field}가 숫자가 아니다: ${value}`)
  return n
}

export interface MapContext {
  /** 이 회사의 계정과목표. mock은 MOCK_CHART, 실제 회사는 DB accounts(account-map.ts chartOf) */
  chart: AccountChart
  business_id: string
  fetched_at: IsoDateTime
  /** 이 달까지는 월 마감이 끝났다. 그 달의 전표 라인은 closed=true로 들어간다. 없으면 null */
  last_closed_period: PeriodKey | null
}

/** 분류를 모르는 계정. 동기화가 그 회사를 멈추는 이유가 된다. */
export class UnmappedAccountError extends Error {
  constructor(readonly codes: string[]) {
    super(`분류되지 않은 계정 ${codes.length}개: ${codes.slice(0, 10).join(', ')}`)
  }
}

export function mapAccounts(rows: EcountAccountRow[], ctx: MapContext): Account[] {
  const missing: string[] = []
  const out: Account[] = []
  for (const r of rows) {
    const c = ctx.chart[r.ACCT_CODE]
    if (!c) {
      missing.push(r.ACCT_CODE)
      continue
    }
    out.push({
      business_id: ctx.business_id,
      account_code: r.ACCT_CODE,
      // 이름은 ECOUNT 것을 쓴다. 계정과목표의 이름은 분류를 정할 때 사람이 보는 참고일 뿐이다.
      name: r.ACCT_NAME,
      category: c.category,
      section: c.section,
      cash_flow: c.cash_flow,
      source: 'ecount',
      fetched_at: ctx.fetched_at,
      closed: true,
      active: true,
    })
  }
  if (missing.length) throw new UnmappedAccountError(missing)
  return out
}

export function mapSlipLines(rows: EcountSlipLineRow[], ctx: MapContext): JournalLine[] {
  return rows.flatMap((r): JournalLine[] => {
    const dr = amount(r.DR_AMT, 'DR_AMT')
    const cr = amount(r.CR_AMT, 'CR_AMT')
    if (dr !== 0 && cr !== 0) {
      throw new EcountApiError(`전표 ${r.SLIP_NO}-${r.SER_NO}에 차변과 대변이 같이 있다`)
    }
    if (dr === 0 && cr === 0) return []
    const entry_date = toIsoDate(r.IO_DATE)
    const signed = dr !== 0 ? dr : -cr
    return [
      {
        business_id: ctx.business_id,
        entry_date,
        account_code: r.ACCT_CODE,
        amount: Math.abs(signed),
        // 음수 차변(역분개)은 대변으로 옮긴다. 금액 칸은 늘 양수다(0015 check).
        side: signed > 0 ? 'debit' : 'credit',
        slip_no: r.SLIP_NO,
        line_no: Number(r.SER_NO),
        memo: r.REMARKS ?? '',
        source: 'ecount',
        fetched_at: ctx.fetched_at,
        closed: ctx.last_closed_period !== null && entry_date.slice(0, 7) <= ctx.last_closed_period,
      },
    ]
  })
}

/**
 * provisional_amount는 ECOUNT가 주지 않는다. 마감을 처음 가져오는 순간 우리가 가진 전표 합을 찍어 둔다(sync.ts).
 * 그래서 여기서는 인자로 받는다.
 */
export function mapClosings(
  rows: EcountClosingRow[],
  ctx: MapContext,
  provisionalOf: (period: PeriodKey, accountCode: string) => number | null,
): Closing[] {
  return rows.map((r) => {
    const period = toPeriod(r.YYMM)
    return {
      business_id: ctx.business_id,
      period,
      account_code: r.ACCT_CODE,
      amount: amount(r.BAL_AMT, 'BAL_AMT'),
      closed_on: toIsoDate(r.CLOSE_DATE),
      provisional_amount: provisionalOf(period, r.ACCT_CODE),
      source: 'ecount',
      fetched_at: ctx.fetched_at,
      closed: r.CLOSE_YN === 'Y',
    }
  })
}

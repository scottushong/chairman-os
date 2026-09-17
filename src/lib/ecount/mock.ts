import { sheetFinanceKpis } from '@/data'
import { addMonths } from '@/lib/ledger/basis'
import { mockIndexValue, mockUsdKrw } from '@/lib/market/mock'
import type { FinanceMetric, PeriodKey, SheetFinanceKpi } from '@/types'

import { MOCK_CHART } from './account-map'
import type {
  EcountAccountRow,
  EcountClosingRow,
  EcountCompany,
  EcountLedgerSource,
  EcountSlipLineRow,
} from './types'

/**
 * ECOUNT 모양 mock 원장 (Phase 2-A). dummy 재무 화면 전체가 이 위에서 돈다. live DB에는 들어가지 않는다.
 *
 * ── 무엇을 지키나 ────────────────────────────────────────────────────────────
 * **06_Dummy_Data 시트값이 이긴다(CLAUDE.md).** 이 mock의 전표를 0015의 공식(lib/ledger/cells.ts)으로
 * 다시 접으면, 시트가 가진 2025-09~2026-08의 8개 지표가 원 단위까지 그대로 나와야 한다.
 * VANA 2026-08 EBITDA 2.8억도 여기서 계산으로 나온다. scripts/check-finance-ledger.ts가 480칸 전부를 잰다.
 *
 * ── 시트의 모순을 숨기지 않는다 (DEFERRED D-01) ─────────────────────────────
 * 시트의 과거 달 여럿은 복식부기로 닫히지 않는다.
 *   Revenue − Cost < EBITDA        판관비가 음수여야 맞는다 (예: VANA 2025-09, Boram 2025-09)
 *   OperatingProfit > EBITDA       감가상각비가 음수여야 맞는다 (예: DY 2025-09)
 * 공식을 비틀어 맞추지 않고, 그 차이를 '시트 정합 조정(판관)'(8990) / '시트 정합 조정(상각)'(8299)
 * 계정에 명시적으로 싣는다. 손익계산서에 그 줄이 보이면 그 달의 시트 숫자가 서로 맞지 않는다는 뜻이다.
 * 최신 달(2026-08)은 다섯 회사 모두 모순이 없어 이 계정이 비어 있다.
 *
 * ── 시트에 없는 것을 어떻게 채웠나 ──────────────────────────────────────────
 *   1) 2024-09~2025-08    전년동월비·TTM이 서려면 12개월이 더 필요하다. 시트 1년 뒤 같은 달 × 0.84~0.96(유량)
 *                         / × 0.90~1.00(잔액, 지표·달마다 고정 배율)로 거꾸로 만든다. 시트값이 없는 달이라 시트와 부딪히지 않는다.
 *   2) 원가의 대분류 분해  시트 Cost는 한 숫자다. 업종별 기본 비중에 지수(원재료·전기·CPI·운임·환율)를
 *                         약하게 물려 나눈다. 합은 시트 Cost와 원 단위로 같다(마지막 칸이 반올림을 흡수).
 *   3) 현금·채권·채무      월말 잔액이 시트와 같아지도록 회수·지급을 역산한다. 남는 차이는
 *                         설비투자(1400)나 차입(2600)으로 보낸다 — 현금흐름표의 투자·재무활동이 여기서 생긴다.
 *
 * ── 확정 / 잠정 ─────────────────────────────────────────────────────────────
 *   2026-07까지 월 마감 완료(확정). 2026-08은 마감 전이라 전표만 있다(잠정).
 *   2026-07 마감에는 전표에 없는 결산조정 두 건(전력비 미지급 · 상여 충당)이 들어 있다.
 *   '잠정-확정 차이'가 보이게 하려는 것이고, 실제 결산이 흔히 그렇다.
 *
 * 난수는 없다. 모든 값이 시트와 달 번호의 함수라 몇 번을 돌려도 같다.
 */

export const MOCK_LAST_CLOSED: PeriodKey = '2026-07'
export const MOCK_FETCHED_AT = '2026-09-16T14:00:00Z'
const SHEET_FIRST: PeriodKey = '2025-09'
const BACKCAST_MONTHS = 12

/** 원가 대분류의 업종별 기본 비중. 합이 1일 필요는 없다(정규화한다). */
const COST_MIX: Record<string, Record<'4510' | '4520' | '4530' | '4540' | '4550' | '4590', number>> = {
  biz_dy: { '4510': 0.58, '4520': 0.18, '4530': 0.09, '4540': 0.06, '4550': 0.01, '4590': 0.08 },
  biz_vana: { '4510': 0, '4520': 0.52, '4530': 0.04, '4540': 0, '4550': 0.3, '4590': 0.14 },
  biz_sticky: { '4510': 0.62, '4520': 0.08, '4530': 0.02, '4540': 0.2, '4550': 0, '4590': 0.08 },
  biz_hof: { '4510': 0.35, '4520': 0.45, '4530': 0.05, '4540': 0.03, '4550': 0.04, '4590': 0.08 },
  biz_boram: { '4510': 0.5, '4520': 0.15, '4530': 0.03, '4540': 0.12, '4550': 0.05, '4590': 0.15 },
}

type Values = Record<FinanceMetric, number>

interface Line {
  date: string
  slip: string
  code: string
  dr: number
  cr: number
  memo: string
}

export interface MockBook {
  lines: Line[]
  /** 전표에는 없고 마감에만 있는 결산조정 */
  closingOnly: Line[]
  periods: PeriodKey[]
}

function lastDay(period: PeriodKey): string {
  const [y, m] = period.split('-').map(Number)
  return `${period}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`
}

function sheetValues(businessId: string): Map<PeriodKey, Values> {
  const out = new Map<PeriodKey, Values>()
  for (const k of sheetFinanceKpis as SheetFinanceKpi[]) {
    if (k.business_id !== businessId) continue
    const v = out.get(k.period) ?? ({} as Values)
    v[k.metric] = k.value
    out.set(k.period, v)
  }
  // 1) 거꾸로 12개월
  for (let i = 1; i <= BACKCAST_MONTHS; i += 1) {
    const period = addMonths(SHEET_FIRST, -i)
    const ahead = out.get(addMonths(period, 12))
    if (!ahead) continue
    // 지표·달마다 조금씩 다른 배율. 한 배율로 줄이면 전년동월비가 전부 +11.1%로 같아져 화면이 읽을 거리를 잃는다.
    const factor = (k: number, base: number, spread: number) => {
      const x = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453
      return base + spread * (x - Math.floor(x))
    }
    let k = 0
    const flow = (x: number) => Math.round(x * factor((k += 1), 0.84, 0.12))
    const bal = (x: number) => Math.round(x * factor((k += 1), 0.9, 0.1))
    out.set(period, {
      Revenue: flow(ahead.Revenue),
      Cost: flow(ahead.Cost),
      EBITDA: flow(ahead.EBITDA),
      OperatingProfit: flow(ahead.OperatingProfit),
      NetIncome: flow(ahead.NetIncome),
      Cash: bal(ahead.Cash),
      AR: bal(ahead.AR),
      AP: bal(ahead.AP),
    })
  }
  return out
}

/** 2) 원가 분해. 지수에 약하게 물린 비중으로 나누고 마지막 칸이 반올림을 흡수한다. */
function splitCost(businessId: string, period: PeriodKey, cost: number): [string, number][] {
  const base = COST_MIX[businessId]
  const idx = (c: Parameters<typeof mockIndexValue>[0]) => mockIndexValue(c, period) / 100
  const weights: [string, number][] = [
    ['4510', base['4510'] * idx('raw_material') ** 0.8],
    ['4520', base['4520'] * idx('cpi') ** 1.5],
    ['4530', base['4530'] * idx('electricity')],
    ['4540', base['4540'] * idx('freight') ** 0.5],
    ['4550', base['4550'] * (mockUsdKrw(period) / 1330)],
    ['4590', base['4590']],
  ]
  const total = weights.reduce((s, [, w]) => s + w, 0)
  let used = 0
  return weights.map(([code, w], i) => {
    const amount = i === weights.length - 1 ? cost - used : Math.round((cost * w) / total)
    used += amount
    return [code, amount]
  })
}

export function buildMockBook(businessId: string): MockBook | null {
  if (!COST_MIX[businessId]) return null
  const values = sheetValues(businessId)
  const periods = [...values.keys()].sort()
  const lines: Line[] = []
  const closingOnly: Line[] = []
  let seq = 0

  /** 금액이 음수면 차대를 바꾼다. 0이면 줄을 만들지 않는다. */
  function post(target: Line[], date: string, dr: string, cr: string, amount: number, memo: string) {
    if (amount === 0) return
    const [d, c, a] = amount > 0 ? [dr, cr, amount] : [cr, dr, -amount]
    seq += 1
    const slip = `${date.replaceAll('-', '')}-${seq}`
    target.push({ date, slip, code: d, dr: a, cr: 0, memo }, { date, slip, code: c, dr: 0, cr: a, memo })
  }

  const first = values.get(periods[0])!
  // 기초 잔액: 첫 달 월말 잔액에서 출발한다. 첫 달의 흐름 차이는 아래 현금 역산이 흡수한다.
  const ppe = Math.round(first.Revenue * 6)
  const openDate = `${periods[0]}-01`
  post(lines, openDate, '1010', '3310', first.Cash, '기초 이월')
  post(lines, openDate, '1080', '3310', first.AR, '기초 이월')
  post(lines, openDate, '1400', '3310', ppe, '기초 이월')
  post(lines, openDate, '3310', '2010', first.AP, '기초 이월')

  let prev = { Cash: first.Cash, AR: first.AR, AP: first.AP }

  for (const period of periods) {
    const v = values.get(period)!
    const eom = lastDay(period)
    const on = (day: number) => `${period}-${String(day).padStart(2, '0')}`

    post(lines, on(25), '1080', '4010', v.Revenue, '제품 매출')

    let apAdded = 0
    for (const [code, amount] of splitCost(businessId, period, v.Cost)) {
      // 결산조정: 마감 달의 전력비 일부는 전표가 아니라 마감에만 있다.
      const adjust = period === MOCK_LAST_CLOSED && code === '4530' ? Math.round(amount * 0.04) : 0
      post(lines, on(20), code, '2010', amount - adjust, `${MOCK_CHART[code].name} 매입`)
      post(closingOnly, eom, code, '2010', adjust, '결산조정 — 전력비 미지급 계상')
      apAdded += amount
    }

    const sga = v.Revenue - v.Cost - v.EBITDA
    if (sga >= 0) {
      const labor = Math.round(sga * 0.55)
      const bonus = period === MOCK_LAST_CLOSED ? Math.round(labor * 0.06) : 0
      post(lines, on(25), '8010', '2010', labor - bonus, '급여(판관)')
      post(closingOnly, eom, '8010', '2010', bonus, '결산조정 — 상여 충당')
      post(lines, on(25), '8190', '2010', sga - labor, '지급수수료')
    } else {
      post(lines, eom, '2010', '8990', -sga, 'D-01 시트 정합 조정: Revenue − Cost < EBITDA')
    }
    apAdded += sga

    const da = v.EBITDA - v.OperatingProfit
    if (da >= 0) post(lines, eom, '8210', '1410', da, '감가상각비')
    else post(lines, eom, '1410', '8299', -da, 'D-01 시트 정합 조정: OperatingProfit > EBITDA')

    const below = v.OperatingProfit - v.NetIncome
    if (below >= 0) {
      const interest = Math.round(below * 0.4)
      post(lines, on(28), '9310', '1010', interest, '이자비용')
      post(lines, eom, '9980', '1010', below - interest, '법인세비용')
    } else {
      post(lines, on(28), '1010', '9010', -below, '영업외수익')
    }

    // 3) 잔액이 시트와 같아지도록 회수·지급·투자/차입을 역산한다.
    const collected = prev.AR + v.Revenue - v.AR
    post(lines, on(28), '1010', '1080', collected, '매출채권 회수')
    const paid = prev.AP + apAdded - v.AP
    post(lines, on(27), '2010', '1010', paid, '매입채무 지급')
    const cashNow = prev.Cash + collected - paid - below
    const gap = v.Cash - cashNow
    if (gap > 0) post(lines, eom, '1010', '2600', gap, '단기차입')
    else post(lines, eom, '1400', '1010', -gap, '설비투자')

    prev = { Cash: v.Cash, AR: v.AR, AP: v.AP }
  }

  return { lines, closingOnly, periods }
}

const books = new Map<string, MockBook | null>()
function book(businessId: string): MockBook | null {
  if (!books.has(businessId)) books.set(businessId, buildMockBook(businessId))
  return books.get(businessId)!
}

function toRow(l: Line, serNo: number): EcountSlipLineRow {
  return {
    IO_DATE: l.date.replaceAll('-', ''),
    SLIP_NO: l.slip,
    SER_NO: String(serNo),
    ACCT_CODE: l.code,
    DR_AMT: String(l.dr),
    CR_AMT: String(l.cr),
    REMARKS: l.memo,
  }
}

/** mock은 파일도 네트워크도 타지 않는다. 대신 업로드가 낼 ECOUNT 모양(문자열 금액, YYYYMMDD)으로 준다. */
export const mockLedgerSource: EcountLedgerSource = {
  mode: 'mock',

  async listAccounts(company: EcountCompany): Promise<EcountAccountRow[]> {
    if (!book(company.business_id)) return []
    return Object.entries(MOCK_CHART).map(([code, c]) => ({ ACCT_CODE: code, ACCT_NAME: c.name }))
  },

  async listSlipLines(company, fromDate, toDate) {
    const b = book(company.business_id)
    if (!b) return []
    return b.lines
      .map((l, i) => ({ l, ser: (i % 2) + 1 }))
      .filter(({ l }) => {
        const d = l.date.replaceAll('-', '')
        return d >= fromDate && d <= toDate
      })
      .map(({ l, ser }) => toRow(l, ser))
  },

  async listClosings(company, fromYymm, toYymm) {
    const b = book(company.business_id)
    if (!b) return []
    const out: EcountClosingRow[] = []
    const all = [...b.lines, ...b.closingOnly]
    for (const period of b.periods) {
      const yymm = period.replace('-', '')
      if (period > MOCK_LAST_CLOSED || yymm < fromYymm || yymm > toYymm) continue
      const eom = lastDay(period)
      for (const code of Object.keys(MOCK_CHART)) {
        const bs = /^[123]/.test(code)
        const net = all
          .filter((l) => l.code === code && (bs ? l.date <= eom : l.date.startsWith(period)))
          .reduce((s, l) => s + l.dr - l.cr, 0)
        if (net === 0 && !bs) continue
        out.push({
          YYMM: yymm,
          ACCT_CODE: code,
          BAL_AMT: String(net),
          CLOSE_DATE: `${addMonths(period, 1).replace('-', '')}10`,
          CLOSE_YN: 'Y',
        })
      }
    }
    return out
  },
}

/** mock이 원장을 들고 있는 회사. 이 목록 밖(CH-002로 방금 만든 회사)은 원장이 비어 있다. */
export const MOCK_COMPANIES: EcountCompany[] = Object.keys(COST_MIX).map((business_id) => ({ business_id }))

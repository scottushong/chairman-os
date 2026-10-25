import type { InvFact } from '../types'
import type { Http } from './http'

/**
 * SEC XBRL companyfacts — 기업 재무 원천(13F 보유와 별개 경로).
 *   https://data.sec.gov/api/xbrl/companyfacts/CIK##########.json
 *   티커 → CIK: https://www.sec.gov/files/company_tickers.json
 * 필요한 개념만, 최근 7년 기간만, 10-K · 10-Q · 20-F · 40-F 공시만 남긴다. 같은 기간을 여러 공시가 다시 낸 값(수정)은
 * 공시번호(accession)별로 모두 남긴다 — 화면은 가장 늦게 낸 값을 쓰고 이력은 표에 그대로 있다.
 */

export const XBRL_CONCEPTS: Record<'us-gaap' | 'ifrs-full' | 'dei', readonly string[]> = {
  'us-gaap': [
    'Revenues',
    'RevenueFromContractWithCustomerExcludingAssessedTax',
    'SalesRevenueNet',
    'GrossProfit',
    'CostOfRevenue',
    'OperatingIncomeLoss',
    'NetIncomeLoss',
    'NetCashProvidedByUsedInOperatingActivities',
    'PaymentsToAcquirePropertyPlantAndEquipment',
    'DepreciationDepletionAndAmortization',
    'DepreciationAndAmortization',
    'EarningsPerShareDiluted',
    'WeightedAverageNumberOfDilutedSharesOutstanding',
    'CashAndCashEquivalentsAtCarryingValue',
    'LongTermDebt',
    'LongTermDebtNoncurrent',
    'LongTermDebtCurrent',
    'DebtCurrent',
    'ShortTermBorrowings',
    'StockholdersEquity',
    'IncomeTaxExpenseBenefit',
    'IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest',
  ],
  'ifrs-full': [
    'Revenue',
    'GrossProfit',
    'ProfitLossFromOperatingActivities',
    'ProfitLoss',
    'CashFlowsFromUsedInOperatingActivities',
    'PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities',
    'DilutedEarningsLossPerShare',
    'CashAndCashEquivalents',
    'Equity',
  ],
  dei: ['EntityCommonStockSharesOutstanding'],
}

const FORMS = new Set(['10-K', '10-Q', '20-F', '40-F', '10-K/A', '10-Q/A', '20-F/A'])

interface RawFact {
  start?: string
  end: string
  val: number
  accn: string
  fy?: number
  fp?: string
  form?: string
  filed?: string
  frame?: string
}

interface CompanyFacts {
  cik?: number
  entityName?: string
  facts?: Record<string, Record<string, { units?: Record<string, RawFact[]> }>>
}

export function cik10(n: number | string) {
  return String(n).padStart(10, '0')
}

export function factsFromCompanyFacts(j: CompanyFacts, securityId: string, today: string): InvFact[] {
  if (!j.facts || typeof j.cik !== 'number') throw new Error('XBRL companyfacts 모양이 다르다')
  const cik = cik10(j.cik)
  const since = `${Number(today.slice(0, 4)) - 7}-01-01`
  const out: InvFact[] = []
  for (const tax of Object.keys(XBRL_CONCEPTS) as (keyof typeof XBRL_CONCEPTS)[]) {
    const space = j.facts[tax]
    if (!space) continue
    for (const concept of XBRL_CONCEPTS[tax]) {
      const units = space[concept]?.units
      if (!units) continue
      for (const [unit, list] of Object.entries(units)) {
        for (const f of list) {
          if (!f.end || f.end < since || typeof f.val !== 'number' || !f.accn) continue
          if (tax !== 'dei' && !FORMS.has(f.form ?? '')) continue
          out.push({
            security_id: securityId,
            cik,
            taxonomy: tax,
            concept,
            unit,
            period_start: f.start ?? null,
            period_end: f.end,
            period_key: `${f.start ?? ''}|${f.end}`,
            fy: f.fy ?? null,
            fp: f.fp ?? null,
            form: f.form ?? null,
            filed: f.filed ?? null,
            accession: f.accn,
            frame: f.frame ?? null,
            value: f.val,
            source_url: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik}&type=10-K`,
          })
        }
      }
    }
  }
  // 같은 (개념, 단위, 기간, 공시번호)가 두 번 나오면(드물게 있음) 하나만.
  const seen = new Set<string>()
  return out.filter((f) => {
    const k = `${f.taxonomy}|${f.concept}|${f.unit}|${f.period_key}|${f.accession}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

export async function fetchCompanyFacts(http: Http, cik: string): Promise<CompanyFacts> {
  return http.json<CompanyFacts>(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`, 'sec')
}

/** 티커 → CIK(10자리). SEC 공식 파일 하나. */
export async function fetchTickerMap(http: Http): Promise<Map<string, string>> {
  const j = await http.json<Record<string, { cik_str: number; ticker: string }>>('https://www.sec.gov/files/company_tickers.json', 'sec')
  const m = new Map<string, string>()
  for (const v of Object.values(j)) if (v?.ticker) m.set(v.ticker.toUpperCase().replace(/-/g, '.'), cik10(v.cik_str))
  return m
}

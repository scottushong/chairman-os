import type { InvCorporateAction, InvPrice } from '../types'
import type { Http } from './http'

/**
 * 종목 식별 · 가격 · 환율 — 무료 경로만.
 *   OpenFIGI(CUSIP → 티커 · 거래소 · FIGI · ETF 여부). 키(OPENFIGI_API_KEY) 없이 한 번에 10개 · 분당 25회.
 *   Twelve Data(주가 · ETF · 분할 · 배당). 키 TWELVEDATA_API_KEY — 비면 이 경로는 UNAVAILABLE(가짜로 채우지 않는다).
 *   frankfurter(ECB 기준환율 USD→KRW, 키 없음 — lib/fx.ts와 같은 곳).
 */

export const normTicker = (t: string) => t.trim().toUpperCase().replace(/[/-]/g, '.')

export interface FigiHit {
  cusip: string
  ticker: string | null
  name: string | null
  exchange: string | null
  figi: string | null
  kind: 'stock' | 'etf' | 'fund' | 'other'
}

interface FigiRow {
  figi?: string
  name?: string
  ticker?: string
  exchCode?: string
  securityType?: string
  securityType2?: string
}

export function kindFromFigi(r: FigiRow): FigiHit['kind'] {
  const t = `${r.securityType ?? ''} ${r.securityType2 ?? ''}`.toUpperCase()
  if (/ETP|ETF/.test(t)) return 'etf'
  if (/MUTUAL FUND|CLOSED-END|FUND/.test(t)) return 'fund'
  if (/COMMON STOCK|ADR|REIT|PREFERRED|EQUITY|SHARE/.test(t)) return 'stock'
  return 'other'
}

export async function figiMap(http: Http, cusips: readonly string[]): Promise<FigiHit[]> {
  const key = process.env.OPENFIGI_API_KEY?.trim()
  const size = key ? 100 : 10
  const out: FigiHit[] = []
  for (let i = 0; i < cusips.length; i += size) {
    const chunk = cusips.slice(i, i + size)
    const res = await http.postJson<({ data?: FigiRow[] } | { warning?: string; error?: string })[]>(
      'https://api.openfigi.com/v3/mapping',
      chunk.map((c) => ({ idType: 'ID_CUSIP', idValue: c, exchCode: 'US' })),
      key ? { 'X-OPENFIGI-APIKEY': key } : {},
    )
    chunk.forEach((cusip, j) => {
      const row = (res[j] as { data?: FigiRow[] })?.data?.[0]
      out.push(
        row
          ? { cusip, ticker: row.ticker ? normTicker(row.ticker) : null, name: row.name ?? null, exchange: row.exchCode ?? null, figi: row.figi ?? null, kind: kindFromFigi(row) }
          : { cusip, ticker: null, name: null, exchange: null, figi: null, kind: 'other' },
      )
    })
  }
  return out
}

export const twelveKey = () => process.env.TWELVEDATA_API_KEY?.trim() || null
const TD = 'https://api.twelvedata.com'

interface TdSeries {
  status?: string
  message?: string
  values?: { datetime: string; close: string; volume?: string }[]
}

export function pricesFromTwelve(j: TdSeries, splitAdjusted: TdSeries | null, url: string): InvPrice[] {
  if (j.status !== 'ok' || !Array.isArray(j.values)) throw new Error(`Twelve Data: ${j.message ?? j.status ?? '응답 없음'}`)
  const all = new Map((splitAdjusted?.values ?? []).map((v) => [v.datetime.slice(0, 10), Number(v.close)]))
  return j.values
    .map((v) => ({
      d: v.datetime.slice(0, 10),
      close: Number(v.close),
      adj_close: all.get(v.datetime.slice(0, 10)) ?? null,
      volume: v.volume === undefined ? null : Number(v.volume),
      source: 'twelvedata' as const,
      source_url: url,
    }))
    .filter((p) => Number.isFinite(p.close) && p.close > 0)
}

/** 일봉 — close = 분할 보정 가격, adj_close = 분할 + 배당 보정(총수익 기준). 처음엔 5000일, 그 뒤엔 40일. */
export async function twelvePrices(http: Http, symbol: string, full: boolean): Promise<InvPrice[]> {
  const key = twelveKey()
  if (!key) throw new Error('TWELVEDATA_API_KEY 없음')
  const size = full ? 5000 : 40
  const q = (adjust: string) => `${TD}/time_series?symbol=${encodeURIComponent(symbol)}&interval=1day&outputsize=${size}&adjust=${adjust}&apikey=${key}`
  const splits = await http.json<TdSeries>(q('splits'))
  const all = await http.json<TdSeries>(q('all'))
  return pricesFromTwelve(splits, all, `https://twelvedata.com/stocks/${encodeURIComponent(symbol)}`)
}

export async function twelveSplits(http: Http, symbol: string, securityId: string): Promise<InvCorporateAction[]> {
  const key = twelveKey()
  if (!key) throw new Error('TWELVEDATA_API_KEY 없음')
  const j = await http.json<{ splits?: { date: string; from_factor: number; to_factor: number }[]; status?: string; message?: string }>(
    `${TD}/splits?symbol=${encodeURIComponent(symbol)}&range=full&apikey=${key}`,
  )
  if (!Array.isArray(j.splits)) throw new Error(`Twelve Data splits: ${j.message ?? j.status ?? '응답 없음'}`)
  return j.splits
    .filter((s) => s.from_factor > 0 && s.to_factor > 0)
    .map((s) => ({
      security_id: securityId,
      ex_date: s.date.slice(0, 10),
      kind: 'split' as const,
      ratio: s.to_factor / s.from_factor,
      amount: null,
      currency: null,
      source: 'twelvedata' as const,
      source_url: `https://twelvedata.com/stocks/${encodeURIComponent(symbol)}`,
    }))
}

/** USD → KRW 일별(ECB). from~to 구간 한 번. */
export async function usdKrw(http: Http, from: string, to: string): Promise<InvPrice[]> {
  const url = `https://api.frankfurter.dev/v1/${from}..${to}?from=USD&to=KRW`
  const j = await http.json<{ rates?: Record<string, { KRW?: number }> }>(url)
  if (!j.rates) throw new Error('frankfurter 응답 모양이 다르다')
  return Object.entries(j.rates)
    .filter(([, r]) => typeof r.KRW === 'number' && r.KRW > 0)
    .map(([d, r]) => ({ d, close: r.KRW!, adj_close: null, volume: null, source: 'frankfurter' as const, source_url: 'https://frankfurter.dev' }))
    .sort((a, b) => a.d.localeCompare(b.d))
}

/** 13F 평가액 ÷ 주식 수 = 분기말 파생 가격. 여러 기관 · 줄의 중앙값(옵션 · PRN 제외). */
export function impliedPrice(rows: readonly { value: number | null; shares: number | null; share_type: string | null; put_call: string | null }[]): number | null {
  const xs = rows
    .filter((r) => !r.put_call && r.share_type !== 'PRN' && r.value && r.shares && r.shares > 0)
    .map((r) => r.value! / r.shares!)
    .sort((a, b) => a - b)
  if (xs.length === 0) return null
  const m = Math.floor(xs.length / 2)
  return xs.length % 2 ? xs[m] : (xs[m - 1] + xs[m]) / 2
}

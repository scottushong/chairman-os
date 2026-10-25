import type { Http } from './http'

/**
 * NBIM 전체 보유 목록 — nbim.no «All investments» 화면이 읽는 공개 파일.
 *   목록: https://www.nbim.no/api/investments/v2/init.json → data.details[{ label, date, fileName, v, interim }]
 *   한 기준일: https://www.nbim.no/api/investments/v2/<YYYY-MM-DD>.json → data[{ id, cc, n, a:{e: USD, n: NOK}, at, o, eq:{vid, v, s} }]
 * at = 0 주식(1 채권 · 2 부동산 · 3 재생에너지 인프라)만 쓴다. o = 지분율(%), eq.vid = 티커, eq.v = 의결권(%), eq.s = 업종.
 * **주식 수가 없다** — 계속 보유 종목의 ADD/TRIM은 이 목록으로 판정하지 않는다(미국분은 SEC 13F Norges Bank로).
 */

export const NBIM_BASE = 'https://www.nbim.no/api/investments/v2/'
export const NBIM_PAGE = 'https://www.nbim.no/en/investments/all-investments/'

export interface NbimPeriod {
  as_of: string
  label: string
  file: string
  v: string
  interim: boolean
}

export interface NbimHolding {
  id: string
  name: string
  country: string | null
  ticker: string | null
  value_usd: number
  ownership_pct: number | null
  voting_pct: number | null
  sector: string | null
}

export function periodsFromInit(j: unknown): NbimPeriod[] {
  const details = (j as { data?: { details?: unknown[] } })?.data?.details
  if (!Array.isArray(details)) throw new Error('NBIM init.json 모양이 다르다')
  return details
    .map((x) => x as { label?: string; date?: string; fileName?: string; v?: string; interim?: boolean })
    .filter((x) => typeof x.fileName === 'string' && /^\d{4}-\d{2}-\d{2}\.json$/.test(x.fileName))
    .map((x) => ({ as_of: x.fileName!.slice(0, 10), label: x.label ?? x.fileName!, file: x.fileName!, v: x.v ?? '', interim: !!x.interim }))
    .sort((a, b) => b.as_of.localeCompare(a.as_of))
}

export function holdingsFromFile(j: unknown): NbimHolding[] {
  const data = (j as { data?: unknown })?.data
  if (!Array.isArray(data)) throw new Error('NBIM 보유 파일 모양이 다르다')
  const out: NbimHolding[] = []
  for (const raw of data) {
    const x = raw as { id?: string; cc?: string; n?: string; a?: { e?: number }; at?: number; o?: number; eq?: { vid?: string; v?: number; s?: string } }
    if (x.at !== 0 || typeof x.id !== 'string' || typeof x.n !== 'string' || typeof x.a?.e !== 'number') continue
    out.push({
      id: x.id,
      name: x.n,
      country: x.cc ?? null,
      ticker: x.eq?.vid ? x.eq.vid.toUpperCase() : null,
      value_usd: x.a.e,
      ownership_pct: typeof x.o === 'number' ? x.o : null,
      voting_pct: typeof x.eq?.v === 'number' ? x.eq.v : null,
      sector: x.eq?.s ?? null,
    })
  }
  if (out.length === 0) throw new Error('NBIM 보유 파일에 주식 줄이 없다')
  return out
}

export async function listNbimPeriods(http: Http): Promise<NbimPeriod[]> {
  return periodsFromInit(await http.json(`${NBIM_BASE}init.json`))
}

export async function fetchNbimHoldings(http: Http, p: NbimPeriod): Promise<NbimHolding[]> {
  return holdingsFromFile(await http.json(`${NBIM_BASE}${p.file}${p.v ? `?v=${encodeURIComponent(p.v)}` : ''}`))
}

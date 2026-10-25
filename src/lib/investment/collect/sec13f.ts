import type { Http } from './http'

/**
 * SEC 13F-HR — 보유 내역 수집 경로(XBRL 재무와 별개 경로 · 머리말 «데이터»).
 *   제출 목록: data.sec.gov/submissions/CIK##########.json
 *   한 제출:   www.sec.gov/Archives/edgar/data/<cik>/<접수번호 숫자>/index.json → primary_doc.xml(표지) + 정보표 xml
 * 2023-01-03 이후 제출은 평가액이 달러 단위(그 전은 천 달러) — 옛 제출은 ×1000.
 * 정규식으로 읽는다(정보표는 평평한 반복 구조 · 접두사 ns1: 있어도 된다). 모양이 다르면 빈 목록이 아니라 오류를 낸다.
 */

export interface FilingRef {
  accession: string
  form: '13F-HR' | '13F-HR/A'
  report_date: string
  filing_date: string
}

export interface InfoEntry {
  issuer: string
  title_of_class: string | null
  cusip: string
  value: number
  shares: number
  share_type: 'SH' | 'PRN'
  put_call: 'Put' | 'Call' | null
  discretion: string | null
}

export interface Filing13F {
  ref: FilingRef
  period: string
  is_amendment: boolean
  amendment_type: 'RESTATEMENT' | 'NEW HOLDINGS' | null
  table_entry_total: number | null
  table_value_total: number | null
  confidential_omitted: boolean
  entries: InfoEntry[]
  index_url: string
}

const cikInt = (cik: string) => String(Number(cik))
const accNo = (acc: string) => acc.replace(/-/g, '')

export function filingIndexUrl(cik: string, acc: string) {
  return `https://www.sec.gov/Archives/edgar/data/${cikInt(cik)}/${accNo(acc)}/${acc}-index.htm`
}

interface Submissions {
  filings?: { recent?: { form: string[]; accessionNumber: string[]; reportDate: string[]; filingDate: string[] } }
}

export function filingsFromSubmissions(j: Submissions): FilingRef[] {
  const r = j.filings?.recent
  if (!r || !Array.isArray(r.form)) throw new Error('SEC 제출 목록 모양이 다르다')
  const out: FilingRef[] = []
  for (let i = 0; i < r.form.length; i++) {
    const form = r.form[i]
    if (form !== '13F-HR' && form !== '13F-HR/A') continue
    out.push({ accession: r.accessionNumber[i], form, report_date: r.reportDate[i], filing_date: r.filingDate[i] })
  }
  return out
}

export async function listFilings(http: Http, cik: string): Promise<FilingRef[]> {
  const j = await http.json<Submissions>(`https://data.sec.gov/submissions/CIK${cik}.json`, 'sec')
  return filingsFromSubmissions(j)
}

const tag = (xml: string, name: string) => {
  const m = new RegExp(`<(?:\\w+:)?${name}>\\s*([^<]*?)\\s*</(?:\\w+:)?${name}>`).exec(xml)
  return m ? decodeXml(m[1]) : null
}

function decodeXml(s: string) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, '&')
}

const mdY = (s: string | null) => {
  const m = s ? /^(\d{2})-(\d{2})-(\d{4})$/.exec(s) : null
  return m ? `${m[3]}-${m[1]}-${m[2]}` : null
}

export function parseCover(xml: string) {
  const period = mdY(tag(xml, 'periodOfReport')) ?? mdY(tag(xml, 'reportCalendarOrQuarter'))
  if (!period) throw new Error('13F 표지에 보고 기준일이 없다')
  const amendType = tag(xml, 'amendmentType')
  const num = (v: string | null) => (v === null || v === '' ? null : Number(v))
  return {
    period,
    is_amendment: tag(xml, 'isAmendment') === 'true',
    amendment_type: amendType === 'RESTATEMENT' || amendType === 'NEW HOLDINGS' ? amendType : null,
    table_entry_total: num(tag(xml, 'tableEntryTotal')),
    table_value_total: num(tag(xml, 'tableValueTotal')),
    confidential_omitted: tag(xml, 'isConfidentialOmitted') === 'true',
  } as const
}

export function parseInfoTable(xml: string, valueMultiplier = 1): InfoEntry[] {
  const blocks = xml.match(/<(?:\w+:)?infoTable>[\s\S]*?<\/(?:\w+:)?infoTable>/g) ?? []
  if (blocks.length === 0 && !/<(?:\w+:)?informationTable\b/.test(xml)) throw new Error('13F 정보표 모양이 다르다')
  // 기밀 처리 제출(Norges Bank 1 · 3분기)은 «NA · 000000000 · 0» 자리표 한 줄만 있다 — 보유가 아니다.
  return blocks.filter((b) => !/<(?:\w+:)?cusip>\s*0{9}\s*</.test(b)).map((b) => {
    const cusip = (tag(b, 'cusip') ?? '').toUpperCase()
    const shares = Number(tag(b, 'sshPrnamt'))
    const value = Number(tag(b, 'value'))
    const type = tag(b, 'sshPrnamtType')
    const pc = tag(b, 'putCall')
    if (!/^[0-9A-Z]{9}$/.test(cusip) || !Number.isFinite(shares) || !Number.isFinite(value)) {
      throw new Error(`13F 줄을 읽지 못했다: ${tag(b, 'nameOfIssuer') ?? '?'} ${cusip}`)
    }
    return {
      issuer: tag(b, 'nameOfIssuer') ?? cusip,
      title_of_class: tag(b, 'titleOfClass'),
      cusip,
      value: value * valueMultiplier,
      shares,
      share_type: type === 'PRN' ? 'PRN' : 'SH',
      put_call: pc === 'Put' || pc === 'PUT' ? 'Put' : pc === 'Call' || pc === 'CALL' ? 'Call' : null,
      discretion: tag(b, 'investmentDiscretion'),
    }
  })
}

export async function fetchFiling(http: Http, cik: string, ref: FilingRef): Promise<Filing13F> {
  const base = `https://www.sec.gov/Archives/edgar/data/${cikInt(cik)}/${accNo(ref.accession)}/`
  const idx = await http.json<{ directory?: { item?: { name: string }[] } }>(`${base}index.json`, 'sec')
  const names = (idx.directory?.item ?? []).map((i) => i.name)
  const primary = names.find((n) => n.toLowerCase() === 'primary_doc.xml')
  const info = names.find((n) => n.toLowerCase().endsWith('.xml') && n.toLowerCase() !== 'primary_doc.xml')
  if (!primary || !info) throw new Error(`13F 문서를 찾지 못했다(${ref.accession})`)
  const cover = parseCover(await http.text(base + primary, 'sec'))
  const mult = ref.filing_date < '2023-01-03' ? 1000 : 1
  const entries = parseInfoTable(await http.text(base + info, 'sec'), mult)
  return { ref, ...cover, entries, index_url: filingIndexUrl(cik, ref.accession) }
}

/**
 * 데이터 품질 0~100 — 정보표 줄 수 · 합계가 표지와 맞는가 · 기밀 생략이 있는가.
 * 숫자 근거: 표지 합계와 1% 넘게 어긋나면 −20, 줄 수가 다르면 −15, 기밀 생략 −15, 기본 95.
 */
export function filingQuality(f: Filing13F): number {
  let q = 95
  if (f.table_entry_total !== null && f.table_entry_total !== f.entries.length) q -= 15
  const sum = f.entries.reduce((s, e) => s + e.value, 0)
  if (f.table_value_total && Math.abs(sum - f.table_value_total) / f.table_value_total > 0.01) q -= 20
  if (f.confidential_omitted) q -= 15
  return Math.max(0, q)
}

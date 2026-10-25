import Link from 'next/link'

import { InvCard, NoData, PageTitle, RowLink, StatusBadge, T, Td, Th } from '@/components/investment/ui'
import { day, usdBig } from '@/lib/investment/format'
import { investmentViewer } from '@/lib/investment/screen'
import type { ManagerId } from '@/lib/investment/types'
import { loadRadar } from '@/lib/investment/view'

export const dynamic = 'force-dynamic'

/** 4. Stock & ETF 360 — 종목 목록(관심 후보 · 벤치마크). 검색 · 종류 · 관심만. */
export default async function SecuritiesPage(props: PageProps<'/investment/securities'>) {
  const sp = await props.searchParams
  const q = typeof sp.q === 'string' ? sp.q.trim().toUpperCase() : ''
  const kind = sp.kind === 'etf' || sp.kind === 'stock' ? sp.kind : null
  const all = sp.all === '1'
  const { repo } = await investmentViewer()
  const [securities, radar] = await Promise.all([repo.invSecurities(), loadRadar(repo)])
  const latest = radar.pairs.filter((p) => p.source.kind === 'sec_13f' && p.to)
  const positions = await repo.invPositions({ disclosureIds: latest.flatMap((p) => p.to!.members.map((d) => d.disclosure_id)) })
  const mgrOf = new Map(radar.disclosures.map((d) => [d.disclosure_id, d.manager_id]))
  const holders = new Map<string, { m: Set<ManagerId>; value: number }>()
  for (const p of positions) {
    if (!p.security_id || p.put_call) continue
    const h = holders.get(p.security_id) ?? { m: new Set<ManagerId>(), value: 0 }
    h.m.add(mgrOf.get(p.disclosure_id)!)
    h.value += p.value ?? 0
    holders.set(p.security_id, h)
  }
  const rows = securities
    .filter((s) => s.kind !== 'fx')
    .filter((s) => all || s.watch || s.kind === 'etf')
    .filter((s) => !kind || s.kind === kind)
    .filter((s) => !q || (s.ticker ?? '').includes(q) || s.name.toUpperCase().includes(q) || s.cusip === q)
    .sort((a, b) => (holders.get(b.security_id)?.m.size ?? 0) - (holders.get(a.security_id)?.m.size ?? 0) || (holders.get(b.security_id)?.value ?? 0) - (holders.get(a.security_id)?.value ?? 0))
  const short = (id: string) => radar.managers.find((m) => m.manager_id === id)?.name.split(' ')[0] ?? id

  return (
    <div className="flex flex-col gap-4">
      <PageTitle title="Stock & ETF 360" sub="종목마다 주가 그래프 · 기관 보유 추이 · 기업 재무 · 적정가치를 한 화면에." />
      <InvCard>
        <form className="flex flex-wrap items-center gap-2" action="/investment/securities">
          <input name="q" defaultValue={q} placeholder="티커 · 이름 · CUSIP" aria-label="종목 검색" className="min-h-11 w-56 rounded-lg border border-line-soft bg-panel px-3 text-[14px] lg:min-h-9" />
          {kind ? <input type="hidden" name="kind" value={kind} /> : null}
          {all ? <input type="hidden" name="all" value="1" /> : null}
          <button className="inline-flex min-h-11 items-center rounded-lg border border-line-soft px-4 text-[14px] lg:min-h-9">찾기</button>
          {[
            { k: null, l: '전체 종류' },
            { k: 'stock', l: '주식' },
            { k: 'etf', l: 'ETF' },
          ].map((x) => (
            <Link key={x.l} href={`/investment/securities?${new URLSearchParams({ ...(q ? { q } : {}), ...(x.k ? { kind: x.k } : {}), ...(all ? { all: '1' } : {}) })}`} className={`inline-flex min-h-11 items-center rounded-full border px-3 text-[13px] lg:min-h-8 ${kind === x.k ? 'border-accent bg-accent/15 font-semibold' : 'border-line-soft text-ink-muted'}`}>
              {x.l}
            </Link>
          ))}
          <Link href={`/investment/securities?${new URLSearchParams({ ...(q ? { q } : {}), ...(kind ? { kind } : {}), ...(all ? {} : { all: '1' }) })}`} className="inline-flex min-h-11 items-center rounded-full border border-line-soft px-3 text-[13px] text-ink-muted lg:min-h-8">
            {all ? '관심 후보만' : '관심 아닌 종목도'}
          </Link>
        </form>
        {rows.length === 0 ? (
          <NoData need="해당 종목이 없습니다(관심 후보는 13F 수집 뒤 생깁니다)." href="/investment/sources" />
        ) : (
          <T minWidth={760}>
            <thead>
              <tr><Th>티커</Th><Th>이름</Th><Th>종류</Th><Th>업종(SEC SIC)</Th><Th>보유 기관(13F 최신)</Th><Th n>합계 평가액</Th><Th>가격</Th><Th>재무</Th></tr>
            </thead>
            <tbody>
              {rows.map((s) => {
                const h = holders.get(s.security_id)
                return (
                  <tr key={s.security_id}>
                    <Td><RowLink href={`/investment/securities/${s.security_id}`}>{s.ticker ?? '(티커 없음)'}</RowLink></Td>
                    <Td className="max-w-[240px] truncate" title={s.name}>{s.name}</Td>
                    <Td>{s.kind === 'etf' ? 'ETF' : s.kind === 'stock' ? '주식' : s.kind}</Td>
                    <Td className="max-w-[200px] truncate text-[13px] text-ink-muted">{s.sector ?? '—'}</Td>
                    <Td>{h ? `${h.m.size}곳 · ${[...h.m].map(short).join(' · ')}` : s.watch_reason?.startsWith('벤치마크') ? s.watch_reason : '—'}</Td>
                    <Td n>{h ? usdBig(h.value) : '—'}</Td>
                    <Td>{s.prices_checked_at ? <StatusBadge status="LIVE" title="일별(Twelve Data)" /> : h ? <StatusBadge status="PARTIAL" title="13F 분기말 파생 가격" /> : <StatusBadge status="UNAVAILABLE" title="가격 없음" />}</Td>
                    <Td>{s.facts_checked_at ? <StatusBadge status="LIVE" title={`SEC XBRL · 확인 ${day(s.facts_checked_at)}`} /> : s.kind === 'etf' ? <span className="text-[13px] text-ink-muted">ETF</span> : <StatusBadge status="UNAVAILABLE" title={s.cik ? '수집 차례 전' : 'CIK 없음'} />}</Td>
                  </tr>
                )
              })}
            </tbody>
          </T>
        )}
        <p className="text-[13px] text-ink-muted">{rows.length}종목. 관심 후보 = 집중투자 기관(Berkshire · Fundsmith · Pershing) 13F 최신 보유 + 대표 지정. 재무는 하루 한도 안에서 종목을 돌려가며 받습니다.</p>
      </InvCard>
    </div>
  )
}

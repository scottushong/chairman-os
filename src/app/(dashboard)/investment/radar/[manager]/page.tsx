import { notFound } from 'next/navigation'

import { ChangeBadge, InvCard, NoData, PageTitle, RowLink, SourceLine, StatusBadge, T, Td, Th } from '@/components/investment/ui'
import { effectivePeriods } from '@/lib/investment/changes'
import { day, pct, shares, usdBig } from '@/lib/investment/format'
import { investmentViewer } from '@/lib/investment/screen'
import { loadRadar, sourceStatus } from '@/lib/investment/view'

export const dynamic = 'force-dynamic'

/** 기관 한 곳 — 공시 이력(기준일 · 공개일 따로) · 최신 보유 · (NBIM) 국가 · 업종 비중 · 편입/제외. */
export default async function ManagerPage(props: PageProps<'/investment/radar/[manager]'>) {
  const { manager } = await props.params
  const { repo } = await investmentViewer()
  const radar = await loadRadar(repo)
  const m = radar.managers.find((x) => x.manager_id === manager)
  if (!m) notFound()
  const sec = radar.pairs.find((p) => p.source.source_id === `sec13f:${m.manager_id}`)
  const list = radar.pairs.find((p) => p.source.kind === 'nbim_holdings' && p.manager.manager_id === m.manager_id)
  const manual = radar.pairs.filter((p) => (p.source.kind === 'factsheet' || p.source.kind === 'site') && p.manager.manager_id === m.manager_id)
  const top13F = sec?.to ? await repo.invPositions({ disclosureIds: sec.to.members.map((d) => d.disclosure_id), limit: 60 }) : []
  const total13F = sec?.to?.primary.total_value ?? null
  const securities = await repo.invSecurities()
  const secByCusip = new Map(securities.filter((s) => s.cusip).map((s) => [s.cusip!, s]))

  // NBIM 전체 목록 — 국가 · 업종 비중(평가액 기준), 편입 · 제외 상위
  let nbim: { countries: [string, number][]; sectors: [string, number][]; total: number; top: Awaited<ReturnType<typeof repo.invPositions>> } | null = null
  let nbimMoves: Awaited<ReturnType<typeof repo.invChanges>> = []
  if (list?.to) {
    const all = await repo.invPositions({ disclosureIds: list.to.members.map((d) => d.disclosure_id) })
    const total = all.reduce((s, p) => s + (p.value ?? 0), 0)
    const agg = (key: 'country' | 'sector') => {
      const mm = new Map<string, number>()
      for (const p of all) mm.set(p[key] ?? '미상', (mm.get(p[key] ?? '미상') ?? 0) + (p.value ?? 0))
      return [...mm].sort((a, b) => b[1] - a[1]).slice(0, 10)
    }
    nbim = { countries: agg('country'), sectors: agg('sector'), total, top: [...all].sort((a, b) => (b.value ?? 0) - (a.value ?? 0)).slice(0, 20) }
    nbimMoves = (await repo.invChanges({ toDisclosures: [list.to.primary.disclosure_id], statuses: ['NEW', 'EXIT'] })).sort(
      (a, b) => (b.cur_value ?? b.prev_value ?? 0) - (a.cur_value ?? a.prev_value ?? 0),
    )
  }
  const disclosures = radar.disclosures.filter((d) => d.manager_id === m.manager_id).sort((a, b) => b.data_as_of.localeCompare(a.data_as_of) || (b.source_published_at ?? '').localeCompare(a.source_published_at ?? ''))

  return (
    <div className="flex flex-col gap-4">
      <PageTitle title={m.name} sub={`${m.operator} · ${m.style === 'index' ? '지수 기반 분산(낮은 확신 신호)' : '집중투자'}`} />
      <p className="text-[14px] text-ink-dim">{m.coverage_note}</p>

      <InvCard title={`13F 최신 보유 ${sec?.to ? `· ${sec.to.as_of}` : ''}`} sub="평가액 큰 순 60줄(같은 종목의 여러 줄은 운용 단위별 — 합치면 판정 표와 같다)">
        {!sec?.to ? (
          <NoData need="13F 공시가 아직 없습니다." href="/investment/sources" />
        ) : (
          <>
            <SourceLine url={sec.to.primary.source_url} label={`SEC ${sec.to.primary.form ?? '13F'} ${sec.to.primary.doc_key}`} asOf={sec.to.as_of} published={sec.to.primary.source_published_at} ingested={sec.to.primary.ingested_at} />
            <T minWidth={620}>
              <thead>
                <tr><Th>종목</Th><Th>종류</Th><Th>CUSIP</Th><Th n>주식 수</Th><Th n>평가액</Th><Th n>비중</Th></tr>
              </thead>
              <tbody>
                {top13F.map((p) => {
                  const s = p.cusip ? secByCusip.get(p.cusip) : undefined
                  return (
                    <tr key={`${p.disclosure_id}${p.line_no}`}>
                      <Td>{s ? <RowLink href={`/investment/securities/${s.security_id}`}>{s.ticker ?? p.issuer_name}</RowLink> : p.issuer_name}<div className="max-w-[220px] truncate text-[13px] text-ink-muted">{p.issuer_name}</div></Td>
                      <Td>{p.title_of_class ?? '—'}{p.put_call ? ` · ${p.put_call}` : ''}</Td>
                      <Td className="text-[13px] text-ink-muted">{p.cusip}</Td>
                      <Td n>{shares(p.shares)}</Td>
                      <Td n>{usdBig(p.value)}</Td>
                      <Td n>{total13F && p.value !== null ? pct((p.value / total13F) * 100, 2) : '—'}</Td>
                    </tr>
                  )
                })}
              </tbody>
            </T>
          </>
        )}
      </InvCard>

      {nbim && list?.to ? (
        <>
          <div className="grid min-w-0 gap-4 lg:grid-cols-2">
            <InvCard title="국가별 투자 비중" sub={`전체 보유 목록 ${list.to.as_of} · 주식 ${list.to.primary.position_count?.toLocaleString('en-US')}종목 · ${usdBig(nbim.total)}`}>
              <Bars rows={nbim.countries} total={nbim.total} />
            </InvCard>
            <InvCard title="산업별 투자 비중" sub="NBIM 분류(eq.s)">
              <Bars rows={nbim.sectors} total={nbim.total} />
            </InvCard>
          </div>
          <InvCard title="신규 편입 · 제외(전체 목록)" sub={`${list.from?.as_of ?? '—'} → ${list.to.as_of} · 목록에 있나 없나만(주식 수 없음) · 평가액 큰 순`}>
            {nbimMoves.length === 0 ? (
              <NoData need="비교할 이전 기준일이 없습니다." />
            ) : (
              <T minWidth={480}>
                <thead>
                  <tr><Th>종목</Th><Th>판정</Th><Th n>평가액</Th><Th n>지분율</Th></tr>
                </thead>
                <tbody>
                  {nbimMoves.slice(0, 30).map((c) => (
                    <tr key={c.holding_key}>
                      <Td>{c.issuer_name}</Td>
                      <Td><ChangeBadge status={c.status} /></Td>
                      <Td n>{usdBig(c.cur_value ?? c.prev_value)}</Td>
                      <Td n>{pct(c.cur_ownership_pct ?? c.prev_ownership_pct, 2)}</Td>
                    </tr>
                  ))}
                </tbody>
              </T>
            )}
            <SourceLine url={list.to.primary.source_url} label="NBIM All investments" asOf={list.to.as_of} published={list.to.primary.source_published_at} ingested={list.to.primary.ingested_at} />
          </InvCard>
        </>
      ) : null}

      {manual.length > 0 ? (
        <InvCard title="공식 사이트 공개 포지션" sub="자동 수집이 막힌 경로 — 대표 손 입력(출처 · 기준일 필수)">
          {manual.map((p) => (
            <div key={p.source.source_id} className="flex flex-wrap items-center gap-2">
              <span className="text-[14px]">{p.source.label}</span>
              <StatusBadge status={p.to ? 'PARTIAL' : sourceStatus(p.source)} title={p.source.status_note ?? undefined} />
              <span className="text-[13px] text-ink-muted">{p.to ? `최근 입력 기준일 ${p.to.as_of}` : (p.source.status_note ?? '')}</span>
            </div>
          ))}
          <RowLink href="/investment/sources#manual">손 입력하기 ›</RowLink>
        </InvCard>
      ) : null}

      <InvCard title="공시 이력" sub="기준일(분기말 · 반기말)과 공개일(제출일)을 따로 — 수정공시(13F/A)는 따로 남는다">
        <T minWidth={640}>
          <thead>
            <tr><Th>기준일</Th><Th>공개일</Th><Th>경로 · 양식</Th><Th n>줄 수</Th><Th n>합계</Th><Th n>품질</Th><Th>범위</Th></tr>
          </thead>
          <tbody>
            {disclosures.map((d) => (
              <tr key={d.disclosure_id}>
                <Td>{day(d.data_as_of)}</Td>
                <Td>{d.source_published_at ? day(d.source_published_at) : '파일에 없음'}</Td>
                <Td><a href={d.source_url} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center text-accent hover:underline lg:min-h-0">{d.form ?? d.source_type}{d.is_amendment ? ` (${d.amendment_type ?? '수정'})` : ''}</a></Td>
                <Td n>{d.position_count?.toLocaleString('en-US') ?? '—'}</Td>
                <Td n>{usdBig(d.total_value)}</Td>
                <Td n className={(d.data_quality ?? 100) < 50 ? 'text-critical' : ''}>{d.data_quality ?? '—'}</Td>
                <Td className="max-w-[280px] truncate text-[13px] text-ink-muted" title={d.coverage}>{(d.data_quality ?? 100) < 50 ? '기밀 처리 — 공개 줄이 거의 없어 비교에서 뺌' : d.coverage}</Td>
              </tr>
            ))}
          </tbody>
        </T>
      </InvCard>
      {effectivePeriods(disclosures).length === 0 ? <NoData need="이 기관의 공시가 아직 없습니다." href="/investment/sources" /> : null}
    </div>
  )
}

function Bars({ rows, total }: { rows: [string, number][]; total: number }) {
  const max = rows[0]?.[1] ?? 1
  return (
    <ul className="flex flex-col gap-1.5">
      {rows.map(([k, v]) => (
        <li key={k} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
          <div className="min-w-0">
            <div className="truncate text-[13px] text-ink">{k}</div>
            <div className="mt-0.5 h-2 rounded-full bg-raised"><div className="h-2 rounded-full bg-accent" style={{ width: `${(v / max) * 100}%` }} /></div>
          </div>
          <span className="text-[13px] text-ink-muted tnum">{pct((v / total) * 100)} · {usdBig(v)}</span>
        </li>
      ))}
    </ul>
  )
}

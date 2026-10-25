import Link from 'next/link'

import { ChangeBadge, InvCard, NoData, PageTitle, RowLink, SourceLine, StatusBadge, T, Td, Th } from '@/components/investment/ui'
import { pct, seoulDateTime, shares, usdBig } from '@/lib/investment/format'
import { investmentViewer } from '@/lib/investment/screen'
import type { ChangeStatus, ManagerId } from '@/lib/investment/types'
import { commonHoldings, loadRadar, sourceStatus } from '@/lib/investment/view'

export const dynamic = 'force-dynamic'

const STATUSES: ChangeStatus[] = ['NEW', 'ADD', 'TRIM', 'EXIT', 'HOLD', 'UNKNOWN']

/** 2. Investor Radar(원문 4) — 기관 넷 · 공시 기준일/공개일 · NEW/ADD/TRIM/EXIT · 공통 보유 · 업종 집중도. */
export default async function RadarPage(props: PageProps<'/investment/radar'>) {
  const sp = await props.searchParams
  const { repo } = await investmentViewer()
  const radar = await loadRadar(repo)
  const managerFilter = typeof sp.manager === 'string' && radar.managers.some((m) => m.manager_id === sp.manager) ? (sp.manager as ManagerId) : null
  const statusFilter = typeof sp.status === 'string' && STATUSES.includes(sp.status as ChangeStatus) ? (sp.status as ChangeStatus) : null
  const [common, securities] = await Promise.all([commonHoldings(repo, radar), repo.invSecurities()])
  const secById = new Map(securities.map((s) => [s.security_id, s]))
  const rows = radar.latest13F
    .filter((c) => (!managerFilter || c.manager_id === managerFilter) && (statusFilter ? c.status === statusFilter : c.status !== 'HOLD'))
    .sort((a, b) => (b.cur_value ?? b.prev_value ?? 0) - (a.cur_value ?? a.prev_value ?? 0))
  const shown = rows.slice(0, 300)
  const href = (m: string | null, s: string | null) => {
    const q = new URLSearchParams()
    if (m) q.set('manager', m)
    if (s) q.set('status', s)
    const t = q.toString()
    return t ? `/investment/radar?${t}` : '/investment/radar'
  }
  const short = (id: string) => radar.managers.find((m) => m.manager_id === id)?.name.split(' ')[0] ?? id

  // 업종 집중도(공통 보유 기준 — SEC SIC 업종)
  const sectors = new Map<string, { n: number; weight: number }>()
  for (const h of common) {
    const sec = (h.security_id && secById.get(h.security_id)?.sector) || '업종 미확인(재무 수집 전)'
    const cur = sectors.get(sec) ?? { n: 0, weight: 0 }
    sectors.set(sec, { n: cur.n + 1, weight: cur.weight + h.weight })
  }

  return (
    <div className="flex flex-col gap-4">
      <PageTitle title="Investor Radar" sub="글로벌 기관 네 곳의 공개 보유와 공시 사이 순보유 변화 — 맹목적으로 따라 사지 않는다(연구 자료)." />

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {radar.managers.map((m) => {
          const srcs = radar.sources.filter((s) => s.manager_id === m.manager_id)
          const pair = radar.pairs.find((p) => p.source.source_id === `sec13f:${m.manager_id}`)
          return (
            <InvCard key={m.manager_id} title={<RowLink href={`/investment/radar/${m.manager_id}`}>{m.name}</RowLink>} sub={m.operator}>
              <p className="text-[13px] text-ink-dim">{m.style === 'index' ? '지수 기반 분산 — 낮은 확신 신호(가중치 0.5)' : '집중투자'}</p>
              <ul className="flex flex-col gap-1.5">
                {srcs.map((s) => (
                  <li key={s.source_id} className="flex flex-wrap items-center justify-between gap-1">
                    <span className="text-[13px] text-ink">{s.label}</span>
                    <StatusBadge status={sourceStatus(s)} title={s.status_note ?? undefined} />
                    <span className="w-full text-[13px] text-ink-muted">
                      {s.last_success_at ? `마지막 성공 ${seoulDateTime(s.last_success_at)}` : (s.status_note ?? '수집 전')}
                      {s.last_error ? ` · 최근 오류: ${s.last_error.slice(0, 80)}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
              {pair?.to ? <SourceLine url={pair.to.primary.source_url} label="최신 13F" asOf={pair.to.as_of} published={pair.to.primary.source_published_at} /> : null}
              <p className="text-[13px] text-ink-muted">{m.coverage_note}</p>
            </InvCard>
          )
        })}
      </div>

      <InvCard title="보유 변화" sub="13F 최신 두 공시(분기말) 비교 · 주식 수 기준 · 분할 보정 · 옵션 제외. 행을 누르면 Stock & ETF 360.">
        <div className="flex flex-wrap gap-1.5">
          <FilterLink href={href(null, statusFilter)} on={!managerFilter}>전체 기관</FilterLink>
          {radar.managers.map((m) => (
            <FilterLink key={m.manager_id} href={href(m.manager_id, statusFilter)} on={managerFilter === m.manager_id}>{m.name.split(' ')[0]}</FilterLink>
          ))}
        </div>
        <div className="flex flex-wrap gap-1.5">
          <FilterLink href={href(managerFilter, null)} on={!statusFilter}>HOLD 빼고 전부</FilterLink>
          {STATUSES.map((s) => (
            <FilterLink key={s} href={href(managerFilter, s)} on={statusFilter === s}>{s}</FilterLink>
          ))}
        </div>
        {shown.length === 0 ? (
          <NoData need="해당하는 변화가 없습니다(또는 아직 비교할 두 공시가 없습니다)." href="/investment/sources" />
        ) : (
          <T minWidth={760}>
            <thead>
              <tr><Th>기관</Th><Th>종목</Th><Th n>이전 수량(보정)</Th><Th n>현재 수량</Th><Th>변화</Th><Th n>순변화</Th><Th n>현재 평가액</Th><Th>메모</Th></tr>
            </thead>
            <tbody>
              {shown.map((c) => (
                <tr key={`${c.to_disclosure}${c.holding_key}`}>
                  <Td>{short(c.manager_id)}</Td>
                  <Td>{c.security_id ? <RowLink href={`/investment/securities/${c.security_id}`}>{secById.get(c.security_id)?.ticker ?? c.issuer_name}</RowLink> : c.issuer_name}<div className="max-w-[220px] truncate text-[13px] text-ink-muted">{c.issuer_name}</div></Td>
                  <Td n>{shares(c.prev_shares_adj)}</Td>
                  <Td n>{shares(c.cur_shares)}</Td>
                  <Td><ChangeBadge status={c.status} pct={c.change_pct} /></Td>
                  <Td n>{c.net_change === null ? '—' : `${c.net_change > 0 ? '+' : ''}${shares(c.net_change)}`}</Td>
                  <Td n>{usdBig(c.cur_value)}</Td>
                  <Td className="max-w-[260px] truncate text-[13px] text-ink-muted" title={c.note ?? undefined}>{c.note ?? ''}</Td>
                </tr>
              ))}
            </tbody>
          </T>
        )}
        <p className="text-[13px] text-ink-muted">{rows.length}줄{rows.length > shown.length ? ` 중 평가액 큰 ${shown.length}줄` : ''}. 판정 버전 {radar.latest13F[0]?.calculation_version ?? '—'}. EXIT는 «최신 공개 범위에서 확인되지 않음»이지 전량 매도 확정이 아닙니다.</p>
      </InvCard>

      <div className="grid min-w-0 gap-4 2xl:grid-cols-2">
        <InvCard title="공통 보유" sub="같은 종목(CUSIP)을 보유한 기관 수 · 신호 가중치 합(NBIM 0.5) — 13F 최신 공시">
          {common.length === 0 ? (
            <NoData need="둘 이상의 기관이 함께 보유한 종목이 아직 없습니다." />
          ) : (
            <T minWidth={440}>
              <thead>
                <tr><Th>종목</Th><Th n>기관 수</Th><Th n>가중치</Th><Th>기관</Th><Th n>합계 평가액</Th></tr>
              </thead>
              <tbody>
                {common.slice(0, 40).map((h) => (
                  <tr key={h.cusip}>
                    <Td>{h.security_id ? <RowLink href={`/investment/securities/${h.security_id}`}>{secById.get(h.security_id)?.ticker ?? h.issuer}</RowLink> : h.issuer}</Td>
                    <Td n className={h.managers.length >= 3 ? 'font-bold text-ok' : ''}>{h.managers.length}</Td>
                    <Td n>{h.weight.toFixed(1)}</Td>
                    <Td>{h.managers.map(short).join(' · ')}</Td>
                    <Td n>{usdBig(h.value)}</Td>
                  </tr>
                ))}
              </tbody>
            </T>
          )}
          <p className="text-[13px] text-ink-muted">3곳 이상 {common.filter((h) => h.managers.length >= 3).length}종목 · 2곳 이상 {common.length}종목. 서로 다른 투자철학이 같은 기업을 고른 것은 연구 신호이지 매수 근거가 아닙니다.</p>
        </InvCard>
        <InvCard title="업종별 기관 투자 집중도" sub="공통 보유 종목의 업종(SEC SIC) — 종목 수 · 가중치 합">
          {sectors.size === 0 ? (
            <NoData need="공통 보유 종목이 없습니다." />
          ) : (
            <ul className="flex flex-col gap-1.5">
              {[...sectors].sort((a, b) => b[1].weight - a[1].weight).slice(0, 12).map(([name, v]) => {
                const max = Math.max(...[...sectors.values()].map((x) => x.weight))
                return (
                  <li key={name} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-[13px] text-ink">{name}</div>
                      <div className="mt-0.5 h-2 rounded-full bg-raised"><div className="h-2 rounded-full bg-accent" style={{ width: `${(v.weight / max) * 100}%` }} /></div>
                    </div>
                    <span className="text-[13px] text-ink-muted tnum">{v.n}종목 · {pct((v.weight / [...sectors.values()].reduce((s, x) => s + x.weight, 0)) * 100)}</span>
                  </li>
                )
              })}
            </ul>
          )}
        </InvCard>
      </div>
    </div>
  )
}

function FilterLink({ href, on, children }: { href: string; on: boolean; children: React.ReactNode }) {
  return (
    <Link href={href} aria-current={on ? 'true' : undefined} className={`inline-flex min-h-11 items-center rounded-full border px-3 text-[13px] lg:min-h-8 ${on ? 'border-accent bg-accent/15 font-semibold text-ink' : 'border-line-soft text-ink-muted hover:text-ink'}`}>
      {children}
    </Link>
  )
}

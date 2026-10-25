import Link from 'next/link'

import { AlertReadButton, RunAnalysisButton } from '@/components/investment/forms'
import { InvCard, NoData, PageTitle, REC_STATUS_CLASS as STATUS_CLASS, RowLink, T, Td, Th } from '@/components/investment/ui'
import { day, pct, seoulDateTime, usd } from '@/lib/investment/format'
import { investmentViewer } from '@/lib/investment/screen'
import type { InvRecommendation } from '@/lib/investment/types'

export const dynamic = 'force-dynamic'

const QUESTIONS: [keyof InvRecommendation['explanation'], string][] = [
  ['why_company', 'WHY THIS COMPANY?'],
  ['why_market', 'WHY THIS MARKET?'],
  ['why_now', 'WHY NOW?'],
  ['buy_price', 'WHAT IS THE BUY PRICE?'],
  ['what_could_go_wrong', 'WHAT COULD GO WRONG?'],
  ['invalidation', 'WHAT WOULD INVALIDATE THE THESIS?'],
]

/** 6. Recommendations(원문 10) — 종목마다 최신 버전(순위 = Opportunity) · 이력은 불변(새 버전 줄). ?security=로 한 종목의 버전 이력. */
export default async function RecommendationsPage(props: PageProps<'/investment/recommendations'>) {
  const sp = await props.searchParams
  const { repo, admin } = await investmentViewer()
  const [latest, securities, markets, alerts] = await Promise.all([repo.invRecommendations({ latestOnly: true }), repo.invSecurities(), repo.invMarkets(), repo.invAlerts(30)])
  const sec = (id: string) => securities.find((s) => s.security_id === id)
  const ranked = [...latest].sort((a, b) => (b.opportunity_score ?? -1) - (a.opportunity_score ?? -1) || (a.status === 'NEED DATA' ? 1 : 0) - (b.status === 'NEED DATA' ? 1 : 0))
  const focus = typeof sp.security === 'string' ? sp.security : null
  const history = focus ? await repo.invRecommendations({ securityId: focus }) : []

  return (
    <div className="flex flex-col gap-4">
      <PageTitle title="Recommendations" sub="Opportunity Score가 높다고 BUY를 주지 않는다 — BUY ZONE은 검증 조건을 모두 통과한 system 판정만. AI는 설명 글만 쓴다." right={admin ? <RunAnalysisButton /> : null} />

      {focus ? (
        <InvCard title={`추천 이력 — ${sec(focus)?.ticker ?? sec(focus)?.name ?? focus}`} sub="버전마다 그 시점의 입력 · 결과 · 근거가 그대로 남는다(고치지 않음 · 모델이 바뀌어도 소급 수정 없음)" more={{ href: '/investment/recommendations', label: '전체 목록 ›' }}>
          {history.length === 0 ? <NoData need="이 종목의 추천 기록이 없습니다." /> : history.map((r) => (
            <details key={r.rec_id} open={r === history[0]} className="rounded-lg border border-line-soft p-3">
              <summary className="flex min-h-11 cursor-pointer flex-wrap items-center gap-2 text-[14px] lg:min-h-0">
                <span className="font-semibold">v{r.version}</span>
                <span className={`rounded px-1.5 py-0.5 text-[13px] font-bold ${STATUS_CLASS[r.status]}`}>{r.status}</span>
                <span className="text-ink-muted">{seoulDateTime(r.created_at)} · Opportunity {r.opportunity_score ?? 'NEED DATA'} · 품질 {r.data_quality ?? '—'} · {r.calculation_version}{r.model_version ? ` · 설명 ${r.model_version}` : ' · 설명 템플릿(AI 아님)'}</span>
              </summary>
              <dl className="mt-2 grid gap-2 md:grid-cols-2">
                {QUESTIONS.map(([k, q]) => (
                  <div key={k} className="rounded border border-line-soft/70 px-2.5 py-2">
                    <dt className="text-[13px] font-bold text-ink-dim">{q}</dt>
                    <dd className="text-[14px]">{r.explanation[k] ?? '—'}</dd>
                  </div>
                ))}
              </dl>
              <ul className="mt-2 flex flex-col gap-0.5">
                {r.checks.map((c) => <li key={c.key} className="text-[13px]"><span className={c.pass ? 'text-ok' : 'text-critical'}>{c.pass ? '✓' : '✗'}</span> {c.label} — <span className="text-ink-muted">{c.detail}</span></li>)}
              </ul>
              <p className="mt-1 text-[13px] text-ink-muted">현재가 {usd(r.current_price)}({day(r.price_as_of)}) · 매수 기준가 {usd(r.buy_price)} · 차이 {pct(r.gap_pct, 1, true)} · 5년 예상 {pct(r.expected_return_5y, 1, true)} · 원천 기준일 {day(r.data_as_of)}</p>
            </details>
          ))}
        </InvCard>
      ) : null}

      <InvCard title="추천 순위" sub="종목마다 최신 버전 · Opportunity 높은 순">
        {ranked.length === 0 ? (
          <NoData need="추천이 아직 없습니다 — «지금 분석» 또는 아침 cron(수집 뒤 AI 분석 계정)이 만듭니다." />
        ) : (
          <T minWidth={1180}>
            <thead>
              <tr><Th n>순위</Th><Th>기업명</Th><Th>Ticker</Th><Th>산업</Th><Th n>Market</Th><Th n>Leader</Th><Th n>Valuation</Th><Th n>Opportunity</Th><Th n>현재 주가</Th><Th n>매수 기준가</Th><Th n>기준가 대비</Th><Th n>5년 예상</Th><Th n>Data Quality</Th><Th>추천 상태</Th><Th>최종 분석일</Th></tr>
            </thead>
            <tbody>
              {ranked.map((r, i) => {
                const s = sec(r.security_id)
                return (
                  <tr key={r.rec_id}>
                    <Td n>{i + 1}</Td>
                    <Td className="max-w-[200px] truncate"><RowLink href={`/investment/recommendations?security=${r.security_id}`}>{s?.name ?? r.security_id}</RowLink></Td>
                    <Td>{s ? <RowLink href={`/investment/securities/${s.security_id}`}>{s.ticker ?? '—'}</RowLink> : '—'}</Td>
                    <Td>{markets.find((m) => m.market_id === r.market_id)?.name ?? '—'}</Td>
                    <Td n>{r.market_score ?? '—'}</Td>
                    <Td n>{r.leader_score ?? '—'}</Td>
                    <Td n>{r.valuation_score ?? '—'}</Td>
                    <Td n className="font-semibold">{r.opportunity_score ?? '—'}</Td>
                    <Td n>{usd(r.current_price)}</Td>
                    <Td n>{usd(r.buy_price)}</Td>
                    <Td n>{pct(r.gap_pct, 1, true)}</Td>
                    <Td n>{pct(r.expected_return_5y, 1, true)}</Td>
                    <Td n>{r.data_quality ?? '—'}</Td>
                    <Td><span className={`rounded px-1.5 py-0.5 text-[13px] font-bold whitespace-nowrap ${STATUS_CLASS[r.status]}`}>{r.status}</span></Td>
                    <Td>{day(r.created_at)}</Td>
                  </tr>
                )
              })}
            </tbody>
          </T>
        )}
        <p className="text-[13px] text-ink-muted">NEED DATA = 필수 입력(검증된 일별 주가 · XBRL 재무 · 가정 다섯의 출처/기준일/품질)이 하나라도 부족 — 일별 주가는 TWELVEDATA_API_KEY가 있어야 LIVE입니다(13F 분기말 파생 가격은 PARTIAL).</p>
      </InvCard>

      <InvCard title="알림" sub="공시 · 매수 기준가 접근/도달 · 프리미엄 · 상태 변화 · 갱신 실패 — 각 알림은 근거 화면으로">
        {alerts.length === 0 ? <NoData need="알림이 없습니다." /> : (
          <ul className="flex flex-col">
            {alerts.map((a) => (
              <li key={a.alert_id} className={`flex flex-wrap items-center gap-2 border-b border-line-soft/60 py-1.5 text-[14px] ${a.read_at ? 'opacity-60' : ''}`}>
                <span className={`rounded px-1.5 text-[13px] font-semibold ${a.severity === 'critical' ? 'bg-critical/12 text-critical' : a.severity === 'warn' ? 'bg-warning/12 text-warning' : 'bg-raised text-ink-dim'}`}>{a.kind}</span>
                {a.link ? <Link href={a.link} className="inline-flex min-h-11 items-center hover:underline lg:min-h-0">{a.title}</Link> : <span>{a.title}</span>}
                <span className="text-[13px] text-ink-muted">{seoulDateTime(a.created_at)}{a.body ? ` · ${a.body.slice(0, 80)}` : ''}</span>
                {admin && !a.read_at ? <AlertReadButton alertId={a.alert_id!} /> : null}
              </li>
            ))}
          </ul>
        )}
      </InvCard>
    </div>
  )
}

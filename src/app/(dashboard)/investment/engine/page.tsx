import { AiReasonsButton, MarketSelect, RunAnalysisButton, ScenarioForm, ScoreForm, ThesisForm, WeightsForm } from '@/components/investment/forms'
import { ValuationSimulator } from '@/components/investment/valuation-simulator'
import { DemoBanner, InvCard, NoData, PageTitle, RowLink, StatusBadge, T, Td, Th } from '@/components/investment/ui'
import { analyzeSecurity } from '@/lib/investment/analyze'
import { DEMO_VALUATION } from '@/lib/investment/demo'
import { day, pct, usd } from '@/lib/investment/format'
import { computeMetrics, sharesOutstanding } from '@/lib/investment/metrics'
import { investmentViewer } from '@/lib/investment/screen'
import { DEFAULT_WEIGHTS, LEADER_FACTORS } from '@/lib/investment/scores'
import type { ScenarioInputs } from '@/lib/investment/types'
import { valuate } from '@/lib/investment/valuation'

export const dynamic = 'force-dynamic'

const KIND_LABEL = { company: '투자 가설', manager_reason: '기관 보유 이유', invalidation: '훼손 조건' } as const

/** 5. AI Investment Engine(원문 8 · 9 · 11) — 계산기 · 시나리오 · 점수 분해 · 가설/근거. 계산은 결정론, AI는 글만. */
export default async function EnginePage(props: PageProps<'/investment/engine'>) {
  const sp = await props.searchParams
  const { repo, admin } = await investmentViewer()
  const [securities, settings, managers, disclosures, marketScores, markets, philosophy, usage] = await Promise.all([
    repo.invSecurities(),
    repo.invSettings(),
    repo.invManagers(),
    repo.invDisclosures(),
    repo.invScores('market'),
    repo.invMarkets(),
    repo.invPhilosophy(),
    admin ? repo.invAiUsage().catch(() => null) : Promise.resolve(null),
  ])
  const watch = securities.filter((s) => s.watch && s.kind !== 'fx').sort((a, b) => (a.ticker ?? a.name).localeCompare(b.ticker ?? b.name))
  const sec = typeof sp.security === 'string' ? securities.find((s) => s.security_id === sp.security) ?? null : null
  const weights = settings.weights ?? DEFAULT_WEIGHTS

  let a: Awaited<ReturnType<typeof analyzeSecurity>> | null = null
  let fcfPs: { value: number | null; source_url: string | null; as_of: string | null; quality: number | null } = { value: null, source_url: null, as_of: null, quality: null }
  let scenarios: Awaited<ReturnType<typeof repo.invScenarios>> = []
  let theses: Awaited<ReturnType<typeof repo.invTheses>> = []
  let evidence: Awaited<ReturnType<typeof repo.invEvidence>> = []
  if (sec) {
    const [facts, prices] = await Promise.all([repo.invFacts(sec.security_id), repo.invPrices(sec.security_id)])
    const m = computeMetrics(facts, prices, sharesOutstanding(facts)?.value ?? null)
    fcfPs = { value: m.fcfPerShare, source_url: facts[0]?.source_url ?? null, as_of: m.fy?.period_end ?? null, quality: m.fcfPerShare !== null ? 90 : null }
    a = await analyzeSecurity(repo, sec, { today: new Date().toISOString().slice(0, 10), managers, disclosures, marketScores, minQuality: settings.data_quality_min, weights })
    ;[scenarios, theses] = await Promise.all([repo.invScenarios(sec.security_id), repo.invTheses(sec.security_id)])
    evidence = await repo.invEvidence(theses.map((t) => t.thesis_id!).filter(Boolean))
  }
  const lastScenario = (k: string) => scenarios.filter((x) => x.scenario === k).at(-1)
  const base = sec ? lastScenario('base') : undefined
  const initial = sec && a?.priceRef && fcfPs.value && fcfPs.value > 0
    ? {
        price: a.priceRef.value,
        fcfPerShare: Math.round((base?.inputs.fcf_per_share.value ?? fcfPs.value) * 100) / 100,
        fcfCagr: (base?.inputs.fcf_cagr.value ?? 10) / 100,
        exitMultiple: base?.inputs.exit_multiple.value ?? 20,
        requiredReturn: (base?.inputs.required_return.value ?? 12) / 100,
        marginOfSafety: (base?.inputs.margin_of_safety.value ?? 20) / 100,
        years: base?.years ?? 5,
      }
    : null
  const holders = a ? [...new Set((await repo.invChanges({ securityId: sec!.security_id })).map((c) => c.manager_id))] : []

  return (
    <div className="flex flex-col gap-4">
      <PageTitle title="AI Investment Engine" sub="미래 시장이 성장한다는 이유만으로 투자하지 않는다 — 주당 FCF · 미래 배수 · 요구수익률 · 안전마진으로 매수가를 계산한다." right={admin ? <RunAnalysisButton /> : null} />

      <InvCard>
        <form action="/investment/engine" className="flex flex-wrap items-center gap-2">
          <select name="security" defaultValue={sec?.security_id ?? ''} aria-label="종목" className="min-h-11 w-full max-w-full min-w-0 rounded-lg sm:w-auto border border-line-soft bg-panel px-3 text-[14px] lg:min-h-9">
            <option value="">계산기만(원문 8.3 DEMO)</option>
            {watch.map((s) => (
              <option key={s.security_id} value={s.security_id}>{s.ticker ?? s.name} — {s.name}</option>
            ))}
          </select>
          <button className="inline-flex min-h-11 items-center rounded-lg border border-line-soft px-4 text-[14px] lg:min-h-9">열기</button>
          {sec ? <RowLink href={`/investment/securities/${sec.security_id}`}>Stock & ETF 360 ›</RowLink> : null}
        </form>
      </InvCard>

      <InvCard title="Valuation Simulator" sub="입력을 바꾸면 즉시 다시 계산(원문 8.4)">
        {initial ? (
          <ValuationSimulator key={sec!.security_id} initial={initial} demo={false} label={`${sec!.ticker ?? sec!.name} — 현재가 ${a!.priceRef!.as_of}${a!.priceRef!.source === 'sec13f_implied' ? '(13F 분기말 파생)' : ''} · FCF/주 ${fcfPs.as_of ?? ''} XBRL${base ? ' · 가정은 최신 Base 시나리오' : ' · 성장률 · 배수는 임시값 — 시나리오를 저장하세요'}`} />
        ) : (
          <>
            <DemoBanner>원문 8.3 계산 예시 — 결과 $201.14 · $114.13 · $91.30 · WATCH. {sec ? '이 종목은 가격 또는 FCF/주가 없어 예시로 보입니다.' : ''}</DemoBanner>
            <ValuationSimulator initial={{ ...DEMO_VALUATION }} demo label="DEMO" />
          </>
        )}
      </InvCard>

      {sec && a ? (
        <>
          <InvCard title="Bear · Base · Bull" sub="시나리오마다 성장률 · 배수를 따로 — 최신 저장 버전 기준. 확률은 대표 판단(AI 추정이면 표시)">
            <T minWidth={720}>
              <thead><tr><Th>시나리오</Th><Th n>FCF 성장</Th><Th n>배수</Th><Th n>미래 주가</Th><Th n>현재가 대비</Th><Th n>연복리</Th><Th n>확률</Th><Th>전제 · 위험</Th><Th n>품질</Th></tr></thead>
              <tbody>
                {(['bear', 'base', 'bull'] as const).map((k) => {
                  const row = lastScenario(k)
                  const v = a!.valuations[k]
                  const qs = row ? Object.values(row.inputs as ScenarioInputs).map((x) => x.quality ?? 0) : []
                  return (
                    <tr key={k}>
                      <Td className="font-semibold">{k.toUpperCase()}</Td>
                      <Td n>{row ? pct(row.inputs.fcf_cagr.value) : '—'}</Td>
                      <Td n>{row ? `${row.inputs.exit_multiple.value}x` : '—'}</Td>
                      <Td n>{v ? usd(v.futurePrice) : 'NEED DATA'}</Td>
                      <Td n>{v ? pct(v.upsidePct, 1, true) : '—'}</Td>
                      <Td n>{v ? pct(v.expectedCagrPct, 1, true) : '—'}</Td>
                      <Td n>{row?.probability !== null && row?.probability !== undefined ? `${row.probability}%${row.probability_is_ai ? '(AI 추정 확률)' : ''}` : '—'}</Td>
                      <Td className="max-w-[260px] whitespace-normal text-[13px] text-ink-muted">{row ? [row.premise, row.risk && `위험: ${row.risk}`].filter(Boolean).join(' · ') || '—' : '시나리오 없음'}</Td>
                      <Td n>{qs.length ? Math.min(...qs) : '—'}</Td>
                    </tr>
                  )
                })}
              </tbody>
            </T>
            {admin ? <ScenarioForm securityId={sec.security_id} defaults={{ fcf_per_share: fcfPs }} /> : null}
          </InvCard>

          <InvCard title="Opportunity Score" sub={`Market × ${weights.w_opp_market}% + Leader × ${weights.w_opp_leader}% + Valuation × ${weights.w_opp_valuation}% + Institutional × ${weights.w_opp_inst}% — 점수와 BUY는 별개`}>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              {a.opportunity.parts.map((p) => (
                <div key={p.key} className="rounded-lg border border-line-soft px-3 py-2">
                  <div className="text-[13px] text-ink-muted">{p.key === 'market' ? 'Market' : p.key === 'leader' ? 'Leader' : p.key === 'valuation' ? 'Valuation' : 'Institutional'} · {p.weight}%</div>
                  <div className="text-[20px] font-bold tnum">{p.score === null ? (p.key === 'institutional' ? 'UNKNOWN' : 'NEED DATA') : p.score.toFixed(1)}</div>
                </div>
              ))}
              <div className="rounded-lg border border-accent/50 bg-accent/10 px-3 py-2">
                <div className="text-[13px] text-ink-muted">Opportunity</div>
                <div className="text-[20px] font-bold tnum">{a.opportunity.total === null ? 'NEED DATA' : a.opportunity.total.toFixed(2)}</div>
              </div>
            </div>
            <p className="text-[13px] text-ink-muted">
              Data Quality {a.dataQuality ?? '—'}/100 · 상태 <strong>{a.status}</strong>{a.opportunity.note ? ` · ${a.opportunity.note}` : ''} · Institutional: {a.institutional.note}
              {' '}· Valuation Score = 50 + (PV ÷ 가격 − 1) × 100.
            </p>
            {admin ? <MarketSelect securityId={sec.security_id} current={sec.market_id ?? null} markets={markets.map((m) => ({ id: m.market_id, name: m.name }))} /> : null}
            <ul className="flex flex-col gap-1">
              {a.checks.map((c) => (
                <li key={c.key} className="flex flex-wrap items-center gap-2 text-[14px]">
                  <span className={c.pass ? 'text-ok' : 'text-critical'}>{c.pass ? '✓' : '✗'}</span>
                  <span>{c.label}{c.required ? '' : ' (BUY 조건)'}</span>
                  <span className="text-[13px] text-ink-muted">{c.detail}</span>
                </li>
              ))}
            </ul>
          </InvCard>

          {sec.kind === 'stock' && a.leader ? (
            <InvCard title="Future Leader Score" sub="Market Share × 25% + Moat × 25% + Cash Flow × 20% + Balance Sheet × 15% + Management × 15% — 재무에서 나오는 셋은 공식, 나머지는 판단 · AI 추정">
              <T minWidth={640}>
                <thead><tr><Th>요소</Th><Th n>가중치</Th><Th n>점수</Th><Th>방법 · 공식</Th></tr></thead>
                <tbody>
                  {a.leader.parts.map((p) => (
                    <tr key={p.key}>
                      <Td>{p.label}</Td>
                      <Td n>{p.weight}%</Td>
                      <Td n>{p.score === null ? 'NEED DATA' : p.score.toFixed(1)}</Td>
                      <Td className="max-w-[360px] whitespace-normal text-[13px] text-ink-muted">{p.method === 'ai_estimate' ? 'AI 추정 · ' : p.method === 'judgment' ? '대표 판단 · ' : p.method === 'formula' ? '공식 · ' : ''}{p.formula}</Td>
                    </tr>
                  ))}
                </tbody>
              </T>
              <p className="text-[13px] text-ink-muted">Leader Score {a.leader.total === null ? `NEED DATA — 빠진 요소: ${a.leader.missing.join(' · ')}` : a.leader.total.toFixed(2)}{a.leader.aiEstimated ? ' · AI 추정 요소 포함' : ''}</p>
              {admin ? <ScoreForm subjectType="company" subjectId={sec.security_id} factors={LEADER_FACTORS.map((f) => ({ key: f.key, label: f.label }))} /> : null}
            </InvCard>
          ) : null}

          <InvCard title="투자 논리 · 근거" sub="CONFIRMED(공식 문서) · INFERRED(AI 추론) · HYPOTHESIS(검증 필요) · UNKNOWN — 출처 URL · 문서 기준일과 함께. 고치지 않고 새 줄을 더한다">
            {theses.length === 0 ? <NoData need="가설이 아직 없습니다." /> : (
              <ul className="flex flex-col gap-2">
                {[...theses].reverse().map((t) => (
                  <li key={t.thesis_id} className="rounded-lg border border-line-soft p-2.5">
                    <div className="flex flex-wrap items-center gap-2 text-[14px]">
                      <span className={`rounded px-1.5 py-0.5 text-[13px] font-bold ${t.classification === 'CONFIRMED' ? 'bg-ok/15 text-ok' : t.classification === 'INFERRED' ? 'bg-[#2f6fd0]/12 text-[#3b74d6]' : t.classification === 'HYPOTHESIS' ? 'bg-warning/12 text-warning' : 'bg-raised text-ink-dim'}`}>{t.classification}</span>
                      <span className="text-[13px] text-ink-muted">{KIND_LABEL[t.kind]}{t.manager_id ? ` · ${t.manager_id}` : ''}{t.created_kind === 'ai' ? ` · AI 작성(${t.model_version ?? ''})` : ''}{t.state === 'broken' ? ' · 훼손' : ''} · {day(t.created_at)}</span>
                    </div>
                    <p className="mt-1 text-[14px]">{t.statement}</p>
                    {t.source_url ? <p className="text-[13px] text-ink-muted"><a className="text-accent hover:underline" href={t.source_url} target="_blank" rel="noreferrer">출처</a> · 문서 기준일 {day(t.document_date)}</p> : null}
                    <ul className="mt-1 text-[13px] text-ink-muted">
                      {evidence.filter((e) => e.thesis_id === t.thesis_id).map((e) => (
                        <li key={e.evidence_id}>· {e.label}: {e.value_text}{e.source_url ? <> (<a className="text-accent hover:underline" href={e.source_url} target="_blank" rel="noreferrer">출처</a>{e.as_of ? ` ${e.as_of}` : ''})</> : ''}</li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
            {admin ? (
              <>
                <div className="flex flex-wrap gap-2">
                  {holders.map((mid) => (
                    <AiReasonsButton key={mid} securityId={sec.security_id} managerId={mid} label={`AI: ${managers.find((m) => m.manager_id === mid)?.name.split(' ')[0] ?? mid} 보유 이유 추론`} />
                  ))}
                </div>
                <ThesisForm securityId={sec.security_id} managers={managers.map((m) => ({ id: m.manager_id, name: m.name }))} />
              </>
            ) : null}
          </InvCard>
        </>
      ) : null}

      <InvCard title="투자기관의 철학" sub="공개 투자철학(원문 11) — 공식 문서 문장을 대조하면 «확인»(대표가 새 줄로). 기관이 특정 종목을 산 이유를 사실처럼 단정하지 않는다">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {managers.map((m) => (
            <div key={m.manager_id} className="rounded-lg border border-line-soft p-3">
              <div className="text-[14px] font-semibold">{m.name}</div>
              <ul className="mt-1 text-[13px] text-ink-dim">
                {philosophy.filter((p) => p.manager_id === m.manager_id).map((p) => (
                  <li key={p.principle}>· {p.principle} {p.verified ? '' : <span className="text-ink-muted">(문서 대조 전)</span>}</li>
                ))}
              </ul>
              {philosophy.find((p) => p.manager_id === m.manager_id) ? <a className="inline-flex min-h-11 items-center text-[13px] text-accent hover:underline lg:min-h-0" href={philosophy.find((p) => p.manager_id === m.manager_id)!.source_url} target="_blank" rel="noreferrer">공식 자료</a> : null}
            </div>
          ))}
        </div>
      </InvCard>

      {admin ? (
        <InvCard title="가중치 · AI 사용" sub="관리자 설정 — 가중치를 바꿔도 지난 추천은 그 시점 값 그대로">
          <WeightsForm weights={weights as unknown as Record<string, number>} />
          <div className="flex flex-wrap items-center gap-2 text-[14px]">
            <StatusBadge status={usage ? 'LIVE' : 'UNAVAILABLE'} />
            {usage ? `AI 오늘 ${usage.today_calls}/${usage.daily_limit}회 · 이번 달 $${usage.month_usd.toFixed(4)} / $${usage.monthly_limit}` : 'AI 사용 기록 없음(0095 전)'}
          </div>
          <p className="text-[13px] text-ink-muted">월 비용은 이 기능의 예약 · 기록으로 계산합니다 — 같은 ANTHROPIC_API_KEY를 다른 기능도 쓰므로 Anthropic 청구액과 다를 수 있습니다. 한도에 닿으면 AI만 멈추고 계산 · 공시 · 주가 · 점수는 그대로입니다.</p>
        </InvCard>
      ) : null}
    </div>
  )
}

void valuate

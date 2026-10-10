import Link from 'next/link'
import { notFound } from 'next/navigation'

import { ChainProgress } from '@/components/approvals/chain-progress'
import { PageHeader } from '@/components/layout/page-header'
import { QuoteActions } from '@/components/sales/quote-actions'
import { QuoteForm } from '@/components/sales/quote-form'
import { GradeBadge } from '@/components/sales/sales-cost-board'
import { recordScreenRead } from '@/lib/activity-record'
import { kstToday } from '@/lib/chairman-project'
import { krw } from '@/lib/sales/cost'
import { openSales } from '@/lib/sales/page'
import { QUOTE_STATUS_LABEL_KO, shownQuoteStatus } from '@/types'

const ROW = 'flex gap-2'
const DT = 'w-28 shrink-0 text-ink-muted'

/**
 * 견적 상세(0066) — 스냅숏(저장 순간 영업이 본 총원가 · 마진 · 등급) · 상태 · 가격 예외 결재 · 판 이력 · 새 판.
 * 버튼은 만든 사람 · 대표에게만 그린다(판정은 DB). 영업 팀장은 읽기만.
 */
export default async function QuoteDetailPage(props: PageProps<'/sales/[business_id]/quotes/[quote_id]'>) {
  const { business_id, quote_id } = await props.params
  const { repo, user, business } = await openSales(business_id)
  const found = await repo.getQuote(quote_id)
  if (!found || found.quote.business_id !== business_id) notFound()
  await recordScreenRead({ path: `/sales/${business_id}/quotes/${quote_id}`, kind: 'page', business_id })
  const { quote: q, versions } = found
  const today = kstToday()
  const shown = shownQuoteStatus(q, today)
  const owner = user.role === 'Chairman' || q.created_by === user.user_id
  const decisionStatus = q.decision_id ? ((await repo.listDecisions()).find((d) => d.decision_id === q.decision_id)?.status ?? null) : null
  // 결재 진행(0059 칸) — 결재를 읽을 수 있는 사람에게만 칸이 온다(못 읽으면 빈 목록 → 상태 링크만).
  const steps = q.decision_id ? await repo.listApprovalSteps([q.decision_id]).catch(() => []) : []
  const products = owner ? (await repo.listCostProducts(business_id)).filter((p) => p.active) : []
  const latest = versions[versions.length - 1]?.quote_id === q.quote_id
  const fx = q.currency !== 'KRW' ? ` (견적서 ${q.currency})` : ''

  return (
    <div className="mx-auto max-w-[1200px] space-y-4 px-4 py-5 sm:px-6">
      <PageHeader icon="target" title={`견적 — ${q.customer_company}`} code="COST-Q2" description={`${business.name} · ${q.product_name} · ${q.version}판`} />
      <p className="text-t12">
        <Link href={`/sales/${business_id}/quotes`} className="text-accent hover:underline">
          ← 견적 목록
        </Link>
      </p>
      <section className="grid gap-3 rounded-xl border border-line-soft bg-panel p-4 text-t13 sm:grid-cols-2" aria-label="견적 내용">
        <dl className="space-y-1.5">
          <div className={ROW}>
            <dt className={DT}>고객</dt>
            <dd>
              {q.customer_company} · {q.customer_name}
            </dd>
          </div>
          <div className={ROW}>
            <dt className={DT}>제품</dt>
            <dd>{q.product_name}</dd>
          </div>
          <div className={ROW}>
            <dt className={DT}>수량</dt>
            <dd className="tnum">{q.kg.toLocaleString('ko-KR')} kg</dd>
          </div>
          <div className={ROW}>
            <dt className={DT}>제시가</dt>
            <dd className="tnum font-semibold">
              {krw(q.price_krw_per_kg)}원/kg{fx}
            </dd>
          </div>
          <div className={ROW}>
            <dt className={DT}>유효기간</dt>
            <dd className="tnum">{q.valid_until}</dd>
          </div>
          <div className={ROW}>
            <dt className={DT}>상태</dt>
            <dd className="font-semibold">{QUOTE_STATUS_LABEL_KO[shown]}</dd>
          </div>
        </dl>
        <dl className="space-y-1.5">
          <div className={ROW}>
            <dt className={DT}>저장 순간 총원가</dt>
            <dd className="tnum">{krw(q.cost_total_krw_per_kg)}원/kg</dd>
          </div>
          <div className={ROW}>
            <dt className={DT}>마진</dt>
            <dd className="tnum">
              {krw(q.margin_krw_per_kg)}원/kg · {q.margin_pct.toFixed(1)}%
            </dd>
          </div>
          <div className={`${ROW} items-center`}>
            <dt className={DT}>등급</dt>
            <dd>
              <GradeBadge grade={q.grade} />
            </dd>
          </div>
          <div className={ROW}>
            <dt className={DT}>원가 기준</dt>
            <dd>
              {q.cost_as_of} · {q.cost_basis === 'midnight' ? '오늘 0시 기준' : '지금 저장된 값'}
            </dd>
          </div>
          {q.decision_id ? (
            <div className={ROW}>
              <dt className={DT}>가격 예외 결재</dt>
              <dd>
                <Link href={`/approvals?id=${q.decision_id}`} className="text-accent hover:underline">
                  {decisionStatus === 'Approved' ? '승인됨' : decisionStatus === 'Rejected' ? '반려됨' : '결재 진행 중'}
                </Link>
              </dd>
            </div>
          ) : null}
        </dl>
      </section>
      {steps.length > 0 ? (
        <section className="rounded-xl border border-line-soft bg-panel p-4" aria-label="가격 예외 결재 진행">
          <h2 className="mb-2 text-t13 font-semibold">가격 예외 결재 진행</h2>
          <ChainProgress steps={steps} viewerId={user.user_id} viewerRole={user.role} />
        </section>
      ) : null}
      {owner ? <QuoteActions quote={q} shown={shown} decisionStatus={decisionStatus} /> : null}

      <section className="rounded-xl border border-line-soft bg-panel p-4" aria-label="판 이력">
        <h2 className="mb-2 text-t13 font-semibold">판 이력</h2>
        <ol className="space-y-1 text-t12">
          {versions.map((v) => (
            <li key={v.quote_id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <Link href={`/sales/${business_id}/quotes/${v.quote_id}`} className={v.quote_id === q.quote_id ? 'font-semibold' : 'text-accent hover:underline'}>
                {v.version}판
              </Link>
              <span className="tnum">{krw(v.price_krw_per_kg)}원/kg</span>
              <GradeBadge grade={v.grade} />
              <span className="text-ink-muted">{QUOTE_STATUS_LABEL_KO[shownQuoteStatus(v, today)]}</span>
            </li>
          ))}
        </ol>
      </section>
      {owner && latest && products.length > 0 && shown !== 'cancelled' ? (
        <QuoteForm businessId={business_id} products={products} today={today} parent={q} />
      ) : null}
    </div>
  )
}

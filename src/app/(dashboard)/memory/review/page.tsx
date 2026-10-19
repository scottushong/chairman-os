import Link from 'next/link'

import { PageHeader } from '@/components/layout/page-header'
import { ReviewCard } from '@/components/memory/memory-client'
import { memoryViewer, seoulDay, targetOptions } from '@/lib/memory/screen'
import { REVIEW_TYPE_LABEL, REVIEW_TYPES, type MemoryReview, type ReviewType } from '@/lib/memory/types'

const PRIORITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3 } as const
const RESULT_LABEL = { confirmed: '확인', edited: '고쳐서 확인', rejected: '거절', linked: '이음', created: '새로 만듦', open: '열림' } as const

/**
 * 기억 검토함(0086) — AI · 규칙이 확신하지 못한 것(누구인지 · 연결 · 바뀜 · 금액 · 업무 후보 · 모호한 날짜 · 결정)을 대표가 정한다.
 * 확인 · 고치기 · 거절 · 기존 대상에 잇기 · 새 인물/회사로. 처리한 뒤에도 이력이 남는다(memory_revisions · 검토 줄은 지우지 않음).
 */
export default async function MemoryReviewPage(props: PageProps<'/memory/review'>) {
  const { repo } = await memoryViewer()
  const sp = await props.searchParams
  const show = sp.show === 'closed' ? 'closed' : 'open'
  const type = typeof sp.type === 'string' && (REVIEW_TYPES as readonly string[]).includes(sp.type) ? (sp.type as ReviewType) : null
  const [reviews, dir, recentItems] = await Promise.all([
    repo.listMemoryReviews({ status: show, limit: 300 }).catch(() => [] as MemoryReview[]),
    repo.memoryDirectory().catch(() => ({ businesses: [], projects: [], people: [], aliases: [], entities: [] })),
    repo.listMemoryItems({ limit: 500 }).catch(() => []),
  ])
  const shown = reviews.filter((r) => !type || r.review_type === type).sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] || b.created_at.localeCompare(a.created_at))
  const options = targetOptions(dir)
  const projects = dir.projects.map((p) => ({ project_id: p.project_id, label: `${dir.businesses.find((b) => b.business_id === p.business_id)?.name ?? p.business_id} · ${p.name}` }))
  const capOfItem = new Map(recentItems.map((i) => [i.item_id, i.capture_id]))
  const countBy = (t: ReviewType) => reviews.filter((r) => r.review_type === t).length

  return (
    <div className="mx-auto max-w-[1000px] px-4 py-5 sm:px-6">
      <Link href="/memory" className="text-t11h text-ink-dim hover:text-ink">← 기억</Link>
      <div className="mt-2">
        <PageHeader icon="check-circle" title="기억 검토함" code="Review Queue" description="AI · 규칙이 확신하지 못한 것입니다. 회장님이 정하기 전에는 확정 정보로 쓰지 않습니다.">
          <Link href={show === 'open' ? '/memory/review?show=closed' : '/memory/review'} className="rounded-md border border-line bg-panel px-2.5 py-1.5 text-t11h text-ink-dim hover:border-accent">
            {show === 'open' ? '처리한 것 보기' : '열린 것 보기'}
          </Link>
        </PageHeader>
      </div>

      <nav className="mt-3 flex flex-wrap gap-1.5" aria-label="검토 종류">
        <Link href={`/memory/review${show === 'closed' ? '?show=closed' : ''}`} className={`rounded-full border px-2.5 py-1 text-t11h ${!type ? 'border-accent text-ink' : 'border-line-soft text-ink-dim'}`}>전체 {reviews.length}</Link>
        {REVIEW_TYPES.filter((t) => countBy(t) > 0).map((t) => (
          <Link key={t} href={`/memory/review?type=${t}${show === 'closed' ? '&show=closed' : ''}`} className={`rounded-full border px-2.5 py-1 text-t11h ${type === t ? 'border-accent text-ink' : 'border-line-soft text-ink-dim'}`}>
            {REVIEW_TYPE_LABEL[t]} {countBy(t)}
          </Link>
        ))}
      </nav>

      {shown.length === 0 ? (
        <p className="mt-4 rounded-lg border border-line-soft bg-panel px-3 py-3 text-t12 text-ink-dim">{show === 'open' ? '검토할 것이 없습니다.' : '처리한 검토가 없습니다.'}</p>
      ) : show === 'open' ? (
        <ul className="mt-3 space-y-2">
          {shown.map((r) => (
            <ReviewCard
              key={r.review_id}
              review={r}
              options={options}
              projects={projects}
              sourceHref={`/memory/${r.capture_id}`}
              relatedHref={r.related_item_id && capOfItem.get(r.related_item_id) ? `/memory/${capOfItem.get(r.related_item_id)}` : null}
            />
          ))}
        </ul>
      ) : (
        <ul className="mt-3 space-y-1.5">
          {shown.map((r) => (
            <li key={r.review_id} className="rounded-lg border border-line-soft bg-panel px-3 py-2 text-t12">
              <span className="rounded bg-raised px-1.5 py-0.5 text-t10h text-ink-dim">{REVIEW_TYPE_LABEL[r.review_type]}</span>{' '}
              <Link href={`/memory/${r.capture_id}`} className="text-ink hover:underline">{r.title}</Link>
              <span className="ml-1 text-t10h text-ink-muted">
                {RESULT_LABEL[r.status]}{r.resolution?.auto ? '(다시 처리로 자동 닫힘)' : ''} · {r.resolved_at ? seoulDay(r.resolved_at) : ''}
                {typeof r.resolution?.task_id === 'string' ? ` · 업무 ${r.resolution.task_id}` : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

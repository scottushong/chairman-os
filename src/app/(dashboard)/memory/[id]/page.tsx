import Link from 'next/link'
import { notFound } from 'next/navigation'

import { PageHeader } from '@/components/layout/page-header'
import { ItemActions, ReprocessButton, ReviewCard } from '@/components/memory/memory-client'
import { memoryViewer, seoulDateTime, seoulDay, targetOptions } from '@/lib/memory/screen'
import {
  CAPTURE_TYPE_LABEL,
  CATEGORY_LABEL,
  MEMORY_TYPE_LABEL,
  MEMORY_TYPES,
  STATUS_LABEL,
  type MemoryItem,
} from '@/lib/memory/types'

export const maxDuration = 60

const DIRECTION_LABEL = { mine: '내가 한 약속', others: '남이 한 약속', unknown: '' } as const
const LIFECYCLE_LABEL = { open: '열림', done: '끝남', superseded: '뒤 기록으로 바뀜', cancelled: '취소', on_hold: '보류' } as const
const VERIFY_LABEL = { draft: '초안', confirmed: '확정', rejected: '틀림' } as const
const ASSET_LABEL = { stored: '보관', waiting_transcript: '원본 보관 · 전사 대기', extracted: '글 읽음', failed: '읽기 실패', skipped: '읽지 않음(형식 · 원가 자료)' } as const

/**
 * 기록 하나(0086) — 원본(고치지 않음) · 요약(AI 또는 규칙이 만든 것 — 따로 표시) · 뽑은 정보(근거 인용 · 기록 시점 · 기한) ·
 * 연결 · 이 기록의 검토 · 파일 · 처리 이력. 대표 전용(아니면 /me) · 남의 기록이나 없는 기록은 404(DB가 0행).
 */
export default async function MemoryCapturePage(props: PageProps<'/memory/[id]'>) {
  const { id } = await props.params
  const { repo } = await memoryViewer()
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound()
  const d = await repo.getMemoryCapture(id).catch(() => null)
  if (!d) notFound()
  const { capture: c } = d
  const [names, dir, files] = await Promise.all([
    repo.memoryTargetNames(d.links.map((l) => ({ target_type: l.target_type, target_id: l.target_id }))).catch(() => []),
    repo.memoryDirectory().catch(() => ({ businesses: [], projects: [], people: [], aliases: [], entities: [] })),
    Promise.all(d.assets.map(async (a) => ({ ...a, url: await repo.memoryFileUrl(a.storage_path).catch(() => null) }))),
  ])
  const nameOf = (t: string, i: string) => names.find((n) => n.target_type === t && n.target_id === i)
  const lastExtract = [...d.runs].reverse().find((r) => r.processing_stage === 'extract')
  const summaryBy = lastExtract?.engine === 'ai' ? `AI 요약(${lastExtract.model ?? ''})` : lastExtract?.engine === 'mock' ? '시험용 요약' : '규칙 요약(AI 아님 — 첫 문장)'
  const openReviews = d.reviews.filter((r) => r.status === 'open')
  const options = targetOptions(dir)
  const projects = dir.projects.map((p) => ({ project_id: p.project_id, label: `${dir.businesses.find((b) => b.business_id === p.business_id)?.name ?? p.business_id} · ${p.name}` }))
  const live = d.items.filter((i) => i.verification_status !== 'rejected')
  const byType = MEMORY_TYPES.map((t) => [t, live.filter((i) => i.memory_type === t)] as const).filter(([, l]) => l.length > 0)
  const relatedCapture = async (itemId: string | null) => {
    if (!itemId) return null
    const hit = (await repo.listMemoryItems({ limit: 200 }).catch(() => [])).find((i) => i.item_id === itemId)
    return hit ? `/memory/${hit.capture_id}` : null
  }
  const relHrefs = new Map<string, string | null>()
  for (const r of openReviews) if (r.related_item_id) relHrefs.set(r.review_id, await relatedCapture(r.related_item_id))

  return (
    <div className="mx-auto max-w-[1100px] px-4 py-5 sm:px-6">
      <Link href="/memory" className="text-t11h text-ink-dim hover:text-ink">← 기억</Link>
      <div className="mt-2">
        <PageHeader icon="book" title={c.title ?? (c.raw_text.slice(0, 40) || CAPTURE_TYPE_LABEL[c.capture_type])} code="Capture" description={`${CAPTURE_TYPE_LABEL[c.capture_type]} · ${seoulDateTime(c.captured_at)} 기록 · ${STATUS_LABEL[c.processing_status]}`}>
          <ReprocessButton captureId={c.capture_id} label={c.processing_status === 'failed' ? '다시 처리(원본 그대로)' : '다시 처리'} />
        </PageHeader>
      </div>

      {c.processing_status === 'failed' && d.job?.last_error ? (
        <p className="mt-3 rounded-lg border border-line-soft border-l-4 border-l-critical bg-panel px-3 py-2 text-t12 text-ink-dim">
          처리에 실패했습니다 — 원본은 그대로 저장돼 있습니다. 다음 자동 시도 {seoulDateTime(d.job.next_at)} · 이유: {d.job.last_error}
        </p>
      ) : null}

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-4">
          <section className="rounded-xl border border-line-soft bg-panel p-3.5">
            <h2 className="text-t13 font-semibold">원본 <span className="text-t11h font-normal text-ink-muted">· 저장된 그대로(고치지 않음)</span></h2>
            {c.raw_text ? <p className="mt-2 whitespace-pre-wrap text-t13 leading-relaxed text-ink">{c.raw_text}</p> : <p className="mt-2 text-t12 text-ink-dim">(글 없음 — 파일만)</p>}
            {Array.isArray(c.metadata.participants) && c.metadata.participants.length ? (
              <p className="mt-2 text-t11h text-ink-muted">참석자(적은 그대로): {(c.metadata.participants as string[]).join(', ')}{c.metadata.consent_noted ? ' · 기록/녹음 고지함' : ''}</p>
            ) : null}
          </section>

          {c.summary ? (
            <section className="rounded-xl border border-line-soft bg-panel p-3.5">
              <h2 className="text-t13 font-semibold">요약 <span className="text-t11h font-normal text-ink-muted">· {summaryBy}</span></h2>
              <p className="mt-2 whitespace-pre-wrap text-t13 text-ink-dim">{c.summary}</p>
              {c.categories.length ? <p className="mt-2 text-t11h text-ink-muted">{c.categories.map((x) => `#${CATEGORY_LABEL[x]}`).join(' ')}</p> : null}
            </section>
          ) : null}

          <section className="rounded-xl border border-line-soft bg-panel p-3.5">
            <h2 className="text-t13 font-semibold">뽑은 정보 <span className="text-t11h font-normal text-ink-muted">· 초안은 확인 전 · 담당 · 금액 · 기한은 원문에 있을 때만</span></h2>
            {byType.length === 0 ? <p className="mt-2 text-t12 text-ink-dim">뽑은 정보가 없습니다.</p> : null}
            {byType.map(([t, list]) => (
              <div key={t} className="mt-3">
                <h3 className="text-t11h font-semibold text-ink-dim">{MEMORY_TYPE_LABEL[t]} {list.length}</h3>
                <ul className="mt-1 space-y-2">
                  {list.map((i) => <ItemRow key={i.item_id} i={i} />)}
                </ul>
              </div>
            ))}
          </section>

          {openReviews.length ? (
            <section>
              <h2 className="text-t13 font-semibold">이 기록의 검토 {openReviews.length}</h2>
              <ul className="mt-2 space-y-2">
                {openReviews.map((r) => (
                  <ReviewCard key={r.review_id} review={r} options={options} projects={projects} sourceHref={`/memory/${c.capture_id}`} relatedHref={relHrefs.get(r.review_id) ?? null} />
                ))}
              </ul>
            </section>
          ) : null}
        </div>

        <aside className="space-y-3">
          <section className="rounded-xl border border-line-soft bg-panel p-3">
            <h2 className="text-t13 font-semibold">연결</h2>
            {d.links.filter((l) => l.verification_status !== 'rejected').length === 0 ? <p className="mt-1.5 text-t12 text-ink-dim">이어진 회사 · 사람 · 프로젝트가 없습니다.</p> : null}
            <ul className="mt-1.5 space-y-1">
              {d.links
                .filter((l) => l.verification_status !== 'rejected' && (l.item_id === null || l.relationship === 'created_task'))
                .map((l) => {
                  const n = nameOf(l.target_type, l.target_id)
                  const label = n?.name ?? l.mention_text ?? l.target_id
                  return (
                    <li key={l.link_id} className="text-t12">
                      {n?.href ? <Link href={n.href} className="text-ink hover:underline">{label}</Link> : <span className="text-ink">{label}</span>}
                      <span className="ml-1 text-t10h text-ink-muted">
                        {l.relationship === 'created_task' ? '출처: 기억 → 업무' : l.verification_status === 'confirmed' ? '확정' : '제안(확인 전)'}
                        {l.mention_text && n && l.mention_text !== n.name ? ` · «${l.mention_text}»` : ''}
                      </span>
                    </li>
                  )
                })}
            </ul>
          </section>

          {files.length ? (
            <section className="rounded-xl border border-line-soft bg-panel p-3">
              <h2 className="text-t13 font-semibold">파일</h2>
              <ul className="mt-1.5 space-y-1">
                {files.map((a) => (
                  <li key={a.asset_id} className="text-t12">
                    {a.url ? <a href={a.url} className="text-ink hover:underline">{a.file_name}</a> : <span className="text-ink">{a.file_name}</span>}
                    <span className="ml-1 text-t10h text-ink-muted">{ASSET_LABEL[a.processing_status]} · {Math.max(1, Math.round(a.file_size / 1024))}KB</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section className="rounded-xl border border-line-soft bg-panel p-3">
            <h2 className="text-t13 font-semibold">처리 이력</h2>
            <ul className="mt-1.5 space-y-1">
              {d.runs.map((r) => (
                <li key={r.run_id} className="text-t11h text-ink-dim">
                  <span className="tnum">{seoulDateTime(r.created_at)}</span> · {r.processing_stage} · {r.status === 'failed' ? <span className="text-critical">실패</span> : r.status} · {r.engine}
                  {r.model ? ` · ${r.model}` : ''}
                  {r.error_details ? ` · ${r.error_details.slice(0, 80)}` : ''}
                </li>
              ))}
            </ul>
            {d.revisions.length ? (
              <>
                <h3 className="mt-3 text-t11h font-semibold text-ink-dim">바뀜 이력</h3>
                <ul className="mt-1 space-y-1">
                  {d.revisions.map((r) => (
                    <li key={r.revision_id} className="text-t11h text-ink-dim">{seoulDay(r.changed_at)} · {r.change_reason}</li>
                  ))}
                </ul>
              </>
            ) : null}
          </section>
        </aside>
      </div>
    </div>
  )
}

function ItemRow({ i }: { i: MemoryItem }) {
  return (
    <li className={`rounded-lg bg-raised px-2.5 py-2 ${i.lifecycle_status === 'superseded' || i.lifecycle_status === 'cancelled' ? 'opacity-60' : ''}`}>
      <p className="text-t13 text-ink">{i.content}</p>
      <p className="mt-0.5 flex flex-wrap gap-x-2 text-t10h text-ink-muted">
        <span>{VERIFY_LABEL[i.verification_status]}</span>
        <span>{LIFECYCLE_LABEL[i.lifecycle_status]}</span>
        {DIRECTION_LABEL[i.direction] ? <span>{DIRECTION_LABEL[i.direction]}</span> : null}
        {i.who_text ? <span>하는 사람 «{i.who_text}»</span> : null}
        {i.to_text ? <span>받는 사람 «{i.to_text}»</span> : null}
        {i.due_date ? <span>기한 {i.due_date}{i.due_text ? ` («${i.due_text}»)` : ''}</span> : i.due_text ? <span>기한 말 «{i.due_text}» — 날짜 미확정</span> : null}
        {i.amount_text ? <span className="text-warning">금액 «{i.amount_text}» — 확인 전</span> : null}
        <span>신뢰도 {Math.round(i.confidence * 100)}%</span>
        <span>{i.origin === 'ai' ? 'AI' : i.origin === 'rule' ? '규칙' : '사람'}</span>
      </p>
      {i.source_quote && i.source_quote !== i.content ? <p className="mt-1 border-l-2 border-line pl-2 text-t11h text-ink-dim">근거: «{i.source_quote}»</p> : null}
      <div className="mt-1.5">
        <ItemActions itemId={i.item_id} lifecycle={i.lifecycle_status} verification={i.verification_status} />
      </div>
    </li>
  )
}

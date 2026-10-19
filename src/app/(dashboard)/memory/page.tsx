import Link from 'next/link'

import { PageHeader } from '@/components/layout/page-header'
import { MemoryAutoProcess } from '@/components/memory/memory-client'
import { Icon } from '@/components/ui/icon'
import { memoryViewer, seoulDateTime, seoulDay } from '@/lib/memory/screen'
import {
  CAPTURE_TYPE_LABEL,
  CATEGORY_LABEL,
  MEMORY_TYPE_LABEL,
  MEMORY_TYPES,
  STATUS_LABEL,
  type LinkTargetType,
  type MemoryCaptureRow,
  type MemoryItemWithCapture,
  type MemorySearchHit,
  type MemoryType,
} from '@/lib/memory/types'

export const maxDuration = 60

/**
 * 기억(0086) — 대표 본인의 기록을 시간순으로 · 연결된 대상으로 찾아보는 화면. 대표 전용(아니면 /me) · 스위치 꺼지면 404.
 *
 *   위: 검색(낱말 · 종류 · 기간 · 회사/프로젝트/사람)
 *   왼쪽: 타임라인(검색하면 검색 결과 — 기록 줄 · 정보 줄, 모두 원본으로 이어진다)
 *   오른쪽: 열린 약속(내가 / 남이) · 결정 · 바뀐 것 같은 것 · 검토함 수
 * 숫자를 지어내지 않는다 — 초안(AI · 규칙이 뽑음)과 확정을 따로 표시한다.
 */
export default async function MemoryPage(props: PageProps<'/memory'>) {
  const { repo } = await memoryViewer()
  const sp = await props.searchParams
  const one = (k: string) => (typeof sp[k] === 'string' ? (sp[k] as string) : '')
  const q = one('q').slice(0, 120)
  const type = (MEMORY_TYPES as readonly string[]).includes(one('type')) ? (one('type') as MemoryType) : null
  const from = /^\d{4}-\d{2}-\d{2}$/.test(one('from')) ? one('from') : null
  const to = /^\d{4}-\d{2}-\d{2}$/.test(one('to')) ? one('to') : null
  const [tt, ...tid] = one('target').split(':')
  const target = ['business', 'project', 'person', 'entity'].includes(tt) && tid.length ? { type: tt as LinkTargetType, id: tid.join(':') } : null
  const searching = !!(q || type || from || to || target)

  let unavailable = false
  const safe = async <T,>(p: Promise<T>, fallback: T): Promise<T> =>
    p.catch((e) => {
      if (e instanceof Error && e.message === 'memory_unavailable') unavailable = true
      return fallback
    })

  const [dir, captures, hits, commitments, decisions, reviews] = await Promise.all([
    safe(repo.memoryDirectory(), { businesses: [], projects: [], people: [], aliases: [], entities: [] }),
    searching ? Promise.resolve([] as MemoryCaptureRow[]) : safe(repo.listMemoryCaptures({ limit: 40 }), [] as MemoryCaptureRow[]),
    searching ? safe(repo.searchMemory({ query: q, type, from, to, targetType: target?.type ?? null, targetId: target?.id ?? null, limit: 60 }), [] as MemorySearchHit[]) : Promise.resolve([] as MemorySearchHit[]),
    safe(repo.listMemoryItems({ types: ['commitment', 'task'], lifecycle: ['open'], limit: 60 }), [] as MemoryItemWithCapture[]),
    safe(repo.listMemoryItems({ types: ['decision', 'question'], lifecycle: ['open'], limit: 30 }), [] as MemoryItemWithCapture[]),
    safe(repo.listMemoryReviews({ status: 'open', limit: 200 }), []),
  ])
  const changes = reviews.filter((r) => r.review_type === 'change_detected' || r.review_type === 'conflict')
  const today = seoulDay(new Date().toISOString())
  const mine = commitments.filter((i) => i.direction === 'mine' || i.memory_type === 'task')
  const others = commitments.filter((i) => i.direction === 'others')
  const unknownDir = commitments.filter((i) => i.memory_type === 'commitment' && i.direction === 'unknown')

  const targetLabel = (t: string, id: string) =>
    t === 'business' ? dir.businesses.find((b) => b.business_id === id)?.name : t === 'project' ? dir.projects.find((p) => p.project_id === id)?.name : t === 'person' ? dir.people.find((p) => p.user_id === id)?.display_name : dir.entities.find((e) => e.entity_id === id)?.display_name

  return (
    <div className="mx-auto max-w-[1280px] px-4 py-5 sm:px-6">
      <PageHeader icon="book" title="기억" code="Memory Engine · 0086" description="회장님이 남긴 메모 · 회의 · 대화를 시간순으로 기억하고, 회사 · 사람 · 프로젝트에 이어 둡니다. 원본은 고치지 않습니다.">
        <Link href="/memory/review" className="flex items-center gap-1 rounded-md border border-line bg-panel px-2.5 py-1.5 text-t11h text-ink-dim hover:border-accent hover:text-ink">
          검토함 <span className="tnum font-semibold text-ink">{reviews.length}</span>
        </Link>
      </PageHeader>
      <MemoryAutoProcess />

      {unavailable ? (
        <p className="mt-4 rounded-lg border border-line-soft bg-panel px-3 py-2 text-t12 text-ink-dim">기억 기능이 아직 준비되지 않았습니다(DB 0086 반영 전).</p>
      ) : null}

      <form className="mt-4 flex flex-wrap items-end gap-2 rounded-xl border border-line-soft bg-panel p-3" action="/memory">
        <label className="flex min-w-[200px] flex-1 flex-col gap-1 text-t11h text-ink-muted">
          검색
          <input name="q" defaultValue={q} placeholder="회사 · 사람 · 주제(예: A회사 납품)" className="min-h-9 rounded-md border border-line bg-panel px-2.5 text-t13 text-ink" />
        </label>
        <label className="flex flex-col gap-1 text-t11h text-ink-muted">
          종류
          <select name="type" defaultValue={type ?? ''} className="min-h-9 rounded-md border border-line bg-panel px-2 text-t12 text-ink">
            <option value="">전체</option>
            {MEMORY_TYPES.map((t) => (
              <option key={t} value={t}>{MEMORY_TYPE_LABEL[t]}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-t11h text-ink-muted">
          대상
          <select name="target" defaultValue={target ? `${target.type}:${target.id}` : ''} className="min-h-9 max-w-[220px] rounded-md border border-line bg-panel px-2 text-t12 text-ink">
            <option value="">전체</option>
            <optgroup label="회사">{dir.businesses.map((b) => <option key={b.business_id} value={`business:${b.business_id}`}>{b.name}</option>)}</optgroup>
            <optgroup label="프로젝트">{dir.projects.map((p) => <option key={p.project_id} value={`project:${p.project_id}`}>{p.name}</option>)}</optgroup>
            <optgroup label="사람">{dir.people.map((p) => <option key={p.user_id} value={`person:${p.user_id}`}>{p.display_name}</option>)}</optgroup>
            <optgroup label="바깥 인물 · 회사">{dir.entities.map((e) => <option key={e.entity_id} value={`entity:${e.entity_id}`}>{e.display_name}{e.status === 'pending' ? ' (확인 전)' : ''}</option>)}</optgroup>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-t11h text-ink-muted">
          부터
          <input type="date" name="from" defaultValue={from ?? ''} className="min-h-9 rounded-md border border-line bg-panel px-2 text-t12 text-ink" />
        </label>
        <label className="flex flex-col gap-1 text-t11h text-ink-muted">
          까지
          <input type="date" name="to" defaultValue={to ?? ''} className="min-h-9 rounded-md border border-line bg-panel px-2 text-t12 text-ink" />
        </label>
        <button className="min-h-9 rounded-md bg-gold px-3 text-t12 font-semibold text-ink">찾기</button>
        {searching ? <Link href="/memory" className="min-h-9 px-2 py-2 text-t11h text-ink-dim hover:text-ink">지우기</Link> : null}
      </form>

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <section aria-label={searching ? '검색 결과' : '타임라인'}>
          <h2 className="flex items-center gap-1.5 text-t13 font-semibold">
            <Icon name={searching ? 'search' : 'clock'} className="size-4 text-ink-dim" />
            {searching ? `검색 결과 ${hits.length}건` : '타임라인'}
            {searching ? (
              <span className="text-t11h font-normal text-ink-muted">
                {[q && `«${q}»`, type && MEMORY_TYPE_LABEL[type], target && targetLabel(target.type, target.id), from && `${from}부터`, to && `${to}까지`].filter(Boolean).join(' · ')}
              </span>
            ) : null}
          </h2>
          {searching ? (
            hits.length === 0 ? (
              <p className="mt-2 rounded-lg border border-line-soft bg-panel px-3 py-3 text-t12 text-ink-dim">찾지 못했습니다 — 기록에 없는 내용입니다.</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {hits.map((h) => (
                  <li key={`${h.kind}:${h.item_id ?? h.capture_id}`} className="rounded-lg border border-line-soft bg-panel px-3 py-2">
                    <div className="flex flex-wrap items-baseline gap-2 text-t11h text-ink-muted">
                      <span className="rounded bg-raised px-1.5 py-0.5 text-ink-dim">{h.memory_type ? MEMORY_TYPE_LABEL[h.memory_type] : CAPTURE_TYPE_LABEL[h.capture_type]}</span>
                      <span className="tnum">{seoulDay(h.captured_at)} 기록</span>
                      {h.due_date ? <span className="tnum">· 기한 {h.due_date}</span> : null}
                      {h.lifecycle_status === 'superseded' ? <span className="text-warning">· 뒤 기록으로 바뀜</span> : null}
                      {h.verification_status === 'draft' ? <span>· 초안</span> : null}
                    </div>
                    <Link href={`/memory/${h.capture_id}`} className="mt-1 block text-t13 text-ink hover:underline">{h.title}</Link>
                    {h.snippet && h.snippet !== h.title ? <p className="mt-0.5 line-clamp-2 text-t12 text-ink-dim">{h.snippet}</p> : null}
                  </li>
                ))}
              </ul>
            )
          ) : captures.length === 0 ? (
            <p className="mt-2 rounded-lg border border-line-soft bg-panel px-3 py-3 text-t12 text-ink-dim">아직 기록이 없습니다. 오른쪽 아래 연필 단추(또는 Alt+M)로 남겨 보세요.</p>
          ) : (
            <ol className="mt-2 space-y-2">
              {captures.map((c) => (
                <li key={c.capture_id} className="rounded-lg border border-line-soft bg-panel px-3 py-2.5">
                  <div className="flex flex-wrap items-center gap-2 text-t11h text-ink-muted">
                    <span className="tnum">{seoulDateTime(c.captured_at)}</span>
                    <span className="rounded bg-raised px-1.5 py-0.5 text-ink-dim">{CAPTURE_TYPE_LABEL[c.capture_type]}</span>
                    <StatusChip status={c.processing_status} />
                    {c.categories.filter((x) => x !== 'other').slice(0, 3).map((x) => <span key={x}>#{CATEGORY_LABEL[x]}</span>)}
                  </div>
                  <Link href={`/memory/${c.capture_id}`} className="mt-1 block text-t13 font-medium text-ink hover:underline">
                    {c.title ?? (c.raw_text.slice(0, 60) || '(파일만)')}
                  </Link>
                  <p className="mt-0.5 line-clamp-2 whitespace-pre-line text-t12 text-ink-dim">{c.summary ?? c.raw_text.slice(0, 240)}</p>
                </li>
              ))}
            </ol>
          )}
        </section>

        <aside className="space-y-3">
          <Panel title="내가 한 약속 · 할 일" icon="check-circle" empty="열린 약속 · 할 일이 없습니다." rows={mine} today={today} />
          <Panel title="남이 나에게 한 약속" icon="users" empty="받은 약속이 없습니다." rows={others} today={today} />
          {unknownDir.length ? <Panel title="방향을 모르는 약속" icon="message" empty="" rows={unknownDir} today={today} /> : null}
          <Panel title="결정 · 정해야 할 것" icon="stamp" empty="열린 결정이 없습니다." rows={decisions} today={today} />
          <section className="rounded-xl border border-line-soft bg-panel p-3">
            <h2 className="flex items-center gap-1.5 text-t13 font-semibold"><Icon name="bell" className="size-4 text-ink-dim" />바뀐 것 같은 것 <span className="tnum text-ink-muted">{changes.length}</span></h2>
            {changes.length === 0 ? (
              <p className="mt-1.5 text-t12 text-ink-dim">앞 기록과 다른 새 기록이 없습니다.</p>
            ) : (
              <ul className="mt-1.5 space-y-1.5">
                {changes.slice(0, 6).map((r) => (
                  <li key={r.review_id} className="text-t12">
                    <Link href={`/memory/${r.capture_id}`} className="text-ink hover:underline">{r.title}</Link>
                  </li>
                ))}
              </ul>
            )}
            {changes.length ? <Link href="/memory/review" className="mt-2 inline-block text-t11h text-accent hover:underline">검토함에서 확인 →</Link> : null}
          </section>
        </aside>
      </div>
    </div>
  )
}

function StatusChip({ status }: { status: MemoryCaptureRow['processing_status'] }) {
  const tone = status === 'failed' ? 'text-critical' : status === 'needs_review' ? 'text-warning' : status === 'ready' ? 'text-ok' : 'text-ink-muted'
  return <span className={tone}>● {STATUS_LABEL[status]}</span>
}

function Panel({ title, icon, empty, rows, today }: { title: string; icon: 'check-circle' | 'users' | 'message' | 'stamp'; empty: string; rows: MemoryItemWithCapture[]; today: string }) {
  return (
    <section className="rounded-xl border border-line-soft bg-panel p-3">
      <h2 className="flex items-center gap-1.5 text-t13 font-semibold"><Icon name={icon} className="size-4 text-ink-dim" />{title} <span className="tnum text-ink-muted">{rows.length}</span></h2>
      {rows.length === 0 ? (
        <p className="mt-1.5 text-t12 text-ink-dim">{empty}</p>
      ) : (
        <ul className="mt-1.5 space-y-1.5">
          {rows.slice(0, 8).map((i) => (
            <li key={i.item_id} className="text-t12">
              <Link href={`/memory/${i.capture_id}`} className="text-ink hover:underline">{i.content}</Link>
              <span className="ml-1 text-t10h text-ink-muted">
                {i.due_date ? <span className={i.due_date < today ? 'text-critical' : ''}>기한 {i.due_date}{i.due_date < today ? ' 지남' : ''}</span> : i.due_text ? `«${i.due_text}»` : '기한 없음'}
                {' · '}
                {seoulDay(i.captured_at)} 기록{i.verification_status === 'draft' ? ' · 초안' : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

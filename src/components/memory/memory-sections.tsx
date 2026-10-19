import 'server-only'

import Link from 'next/link'

import { GlassCard } from '@/components/ui/glass-card'
import { Icon } from '@/components/ui/icon'
import { memoryPanelAllowed, seoulDay } from '@/lib/memory/screen'
import { MEMORY_TYPE_LABEL, type LinkTargetType, type MemoryItemWithCapture, type MemoryReview } from '@/lib/memory/types'
import { getRepository } from '@/lib/repository'

/**
 * 기존 화면에 끼우는 기억 칸(0086) — 대표 · 스위치일 때만 그린다(아니면 아무것도 없음 — 직원 화면에 존재가 보이지 않는다).
 *   MemoryRelated   회사 · 프로젝트 상세의 «관련 기억»
 *   MemoryAttention 주의 화면의 «기억에서 나온 주의»(기본 위험 후보 — 지난 기한 · 바뀜 · 금액 · 오래 열린 결정)
 *   MemoryMorning   아침 루틴의 «어제 기억 · 열린 약속»(코드로 센다 — AI 요약은 Phase 4)
 */

const today = () => seoulDay(new Date().toISOString())
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400_000).toISOString().slice(0, 10)

export async function MemoryRelated({ targetType, targetId }: { targetType: LinkTargetType; targetId: string }) {
  if (!(await memoryPanelAllowed())) return null
  const repo = await getRepository()
  const [captures, items] = await Promise.all([
    repo.listMemoryCaptures({ targetType, targetId, limit: 6 }).catch(() => []),
    repo.listMemoryItems({ targetType, targetId, types: ['decision', 'commitment', 'task', 'risk', 'question'], lifecycle: ['open'], limit: 12 }).catch(() => [] as MemoryItemWithCapture[]),
  ])
  return (
    <section className="mt-4 rounded-xl border border-line-soft bg-panel p-3.5" aria-label="관련 기억">
      <div className="flex items-center gap-1.5">
        <Icon name="book" className="size-4 text-ink-dim" />
        <h2 className="text-t13 font-semibold">관련 기억</h2>
        <Link href={`/memory?target=${targetType}:${encodeURIComponent(targetId)}`} className="ml-auto text-t11h text-accent hover:underline">전체 →</Link>
      </div>
      {captures.length === 0 && items.length === 0 ? (
        <p className="mt-1.5 text-t12 text-ink-dim">이어진 기록이 없습니다.</p>
      ) : (
        <div className="mt-2 grid gap-3 md:grid-cols-2">
          <div>
            <h3 className="text-t11h font-semibold text-ink-dim">최근 기록</h3>
            <ul className="mt-1 space-y-1">
              {captures.map((c) => (
                <li key={c.capture_id} className="text-t12">
                  <Link href={`/memory/${c.capture_id}`} className="text-ink hover:underline">{c.title ?? c.raw_text.slice(0, 50)}</Link>
                  <span className="ml-1 text-t10h text-ink-muted">{seoulDay(c.captured_at)}</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="text-t11h font-semibold text-ink-dim">열린 결정 · 약속 · 위험</h3>
            <ul className="mt-1 space-y-1">
              {items.map((i) => (
                <li key={i.item_id} className="text-t12">
                  <span className="text-t10h text-ink-muted">{MEMORY_TYPE_LABEL[i.memory_type]} · </span>
                  <Link href={`/memory/${i.capture_id}`} className="text-ink hover:underline">{i.content}</Link>
                  {i.due_date ? <span className="ml-1 text-t10h text-ink-muted">기한 {i.due_date}</span> : null}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </section>
  )
}

interface AttentionRow {
  level: 'Critical' | 'High' | 'Medium' | 'Low'
  kind: string
  text: string
  why: string
  href: string
  estimate: boolean
}

/** 기본 위험 후보(순수) — 모든 미완료를 경고하지 않고 무게 있는 것만. */
export function memoryAttentionRows(items: MemoryItemWithCapture[], reviews: MemoryReview[], day: string): AttentionRow[] {
  const rows: AttentionRow[] = []
  for (const r of reviews) {
    if (r.review_type === 'change_detected' || r.review_type === 'conflict') {
      const repeats = Number((r.proposed_change as { repeats?: number }).repeats ?? 0)
      rows.push({ level: repeats >= 1 ? 'Critical' : 'High', kind: repeats >= 1 ? '반복된 바뀜' : '앞 기록과 다름', text: r.title, why: '새 기록과 앞 기록의 기한 · 금액 · 담당이 다릅니다(AI · 규칙 판정 — 확인 전)', href: `/memory/${r.capture_id}`, estimate: true })
    } else if (r.review_type === 'financial') {
      rows.push({ level: 'High', kind: '금액', text: r.title, why: '금액이 든 기록 — 확인 전에는 확정으로 쓰지 않습니다', href: `/memory/${r.capture_id}`, estimate: true })
    }
  }
  for (const i of items) {
    if ((i.memory_type === 'commitment' || i.memory_type === 'task') && i.due_date && i.due_date < day) {
      rows.push({ level: i.direction === 'others' ? 'High' : 'High', kind: i.direction === 'others' ? '받은 약속 기한 지남' : '내 약속 · 할 일 기한 지남', text: i.content, why: `기한 ${i.due_date} · ${seoulDay(i.captured_at)} 기록`, href: `/memory/${i.capture_id}`, estimate: i.verification_status !== 'confirmed' })
    } else if ((i.memory_type === 'commitment' || i.memory_type === 'task') && i.due_date && i.due_date <= addDays(day, 3)) {
      rows.push({ level: 'Medium', kind: '기한 임박', text: i.content, why: `기한 ${i.due_date}`, href: `/memory/${i.capture_id}`, estimate: i.verification_status !== 'confirmed' })
    } else if ((i.memory_type === 'decision' || i.memory_type === 'question') && seoulDay(i.captured_at) <= addDays(day, -7)) {
      rows.push({ level: 'Medium', kind: '오래 열린 결정', text: i.content, why: `${seoulDay(i.captured_at)}부터 열림`, href: `/memory/${i.capture_id}`, estimate: i.verification_status !== 'confirmed' })
    } else if (i.memory_type === 'risk' && i.verification_status === 'confirmed') {
      rows.push({ level: 'Low', kind: '위험', text: i.content, why: '확정된 위험', href: `/memory/${i.capture_id}`, estimate: false })
    }
  }
  const order = { Critical: 0, High: 1, Medium: 2, Low: 3 }
  return rows.sort((a, b) => order[a.level] - order[b.level])
}

export async function MemoryAttention() {
  if (!(await memoryPanelAllowed())) return null
  const repo = await getRepository()
  const [items, reviews] = await Promise.all([
    repo.listMemoryItems({ types: ['commitment', 'task', 'decision', 'question', 'risk'], lifecycle: ['open'], limit: 300 }).catch(() => []),
    repo.listMemoryReviews({ status: 'open', limit: 300 }).catch(() => []),
  ])
  const rows = memoryAttentionRows(items, reviews, today()).slice(0, 12)
  const tone = { Critical: 'text-critical', High: 'text-warning', Medium: 'text-ink-dim', Low: 'text-ink-muted' } as const
  return (
    <section className="mt-3 rounded-xl border border-line-soft bg-panel p-3.5" aria-label="기억에서 나온 주의">
      <h2 className="flex items-center gap-1.5 text-t13 font-semibold">
        <Icon name="book" className="size-4 text-ink-dim" />
        기억에서 나온 주의 <span className="tnum text-ink-muted">{rows.length}</span>
        <Link href="/memory/review" className="ml-auto text-t11h font-normal text-accent hover:underline">검토함 →</Link>
      </h2>
      {rows.length === 0 ? (
        <p className="mt-1.5 text-t12 text-ink-dim">지난 기한 · 바뀐 약속 · 확인할 금액이 없습니다.</p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {rows.map((r, n) => (
            <li key={n} className="text-t12">
              <span className={`mr-1 text-t10h font-semibold ${tone[r.level]}`}>{r.level}</span>
              <span className="mr-1 text-t10h text-ink-muted">{r.kind}</span>
              <Link href={r.href} className="text-ink hover:underline">{r.text}</Link>
              <span className="ml-1 text-t10h text-ink-muted">· {r.why}{r.estimate ? ' · 추정(확인 전)' : ''}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export async function MemoryMorning() {
  if (!(await memoryPanelAllowed())) return null
  const repo = await getRepository()
  const day = today()
  const since = new Date(Date.parse(`${addDays(day, -1)}T00:00:00+09:00`)).toISOString()
  const [captures, open, reviews] = await Promise.all([
    repo.listMemoryCaptures({ since, limit: 30 }).catch(() => []),
    repo.listMemoryItems({ types: ['commitment', 'task'], lifecycle: ['open'], limit: 100 }).catch(() => []),
    repo.listMemoryReviews({ status: 'open', limit: 300 }).catch(() => []),
  ])
  const yesterday = captures.filter((c) => seoulDay(c.captured_at) === addDays(day, -1))
  const dueSoon = open.filter((i) => i.due_date && i.due_date <= addDays(day, 3)).slice(0, 6)
  return (
    <GlassCard as="section">
      <h2 className="flex items-center gap-1.5 text-t13 font-semibold text-ink"><Icon name="book" className="size-4 text-ink-dim" />어제 기억 · 열린 약속</h2>
      <p className="mt-1 text-t12 text-ink-dim">
        어제 기록 {yesterday.length}건 · 열린 약속 · 할 일 {open.length}건 · 검토 {reviews.length}건
        <span className="text-ink-muted"> · 코드로 센 숫자입니다(AI 요약은 아직 — Phase 4)</span>
      </p>
      {dueSoon.length ? (
        <ul className="mt-2 space-y-1">
          {dueSoon.map((i) => (
            <li key={i.item_id} className="text-t12">
              <Link href={`/memory/${i.capture_id}`} className="text-ink hover:underline">{i.content}</Link>
              <span className="ml-1 text-ink-muted">기한 {i.due_date}{i.due_date! < day ? ' 지남' : ''}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <Link href="/memory" className="mt-2 inline-block text-t11h text-accent hover:underline">기억 열기</Link>
    </GlassCard>
  )
}

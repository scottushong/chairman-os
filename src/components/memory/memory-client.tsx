'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState, useTransition } from 'react'

import { processPendingMemory, reprocessMemoryAction, resolveMemoryReviewAction, setMemoryItemAction } from '@/app/actions/memory'
import type { MemoryReview, ReviewAction } from '@/lib/memory/types'
import { REVIEW_TYPE_LABEL } from '@/lib/memory/types'

/**
 * 기억 화면(0086)의 손잡이들 — 남은 일 처리 · 다시 처리 · 정보 상태 · 검토함 카드. 판정은 서버 액션 + DB.
 */

/** 화면을 열면 한 번 — 대기 · 실패(다음 시도 시각 지남) 기록을 처리하고, 처리한 것이 있으면 다시 그린다. */
export function MemoryAutoProcess() {
  const router = useRouter()
  const ran = useRef(false)
  const [note, setNote] = useState<string | null>(null)
  useEffect(() => {
    if (ran.current) return
    ran.current = true
    processPendingMemory()
      .then((r) => {
        if (r.processed > 0) {
          setNote(`남은 기록 ${r.processed}건을 처리했습니다.`)
          router.refresh()
        }
      })
      .catch(() => {})
  }, [router])
  return note ? <p className="mt-2 text-t11h text-ink-dim" aria-live="polite">{note}</p> : null
}

export function ReprocessButton({ captureId, label = '다시 처리' }: { captureId: string; label?: string }) {
  const router = useRouter()
  const [busy, start] = useTransition()
  const [msg, setMsg] = useState<string | null>(null)
  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        disabled={busy}
        onClick={() =>
          start(async () => {
            const r = await reprocessMemoryAction(captureId)
            setMsg(r.ok ? '처리했습니다.' : (r.error ?? '실패'))
            router.refresh()
          })
        }
        className="min-h-8 rounded-md border border-line bg-panel px-2.5 text-t11h text-ink-dim hover:border-accent hover:text-ink disabled:opacity-60"
      >
        {busy ? '처리 중…' : label}
      </button>
      {msg ? <span className="text-t11h text-ink-muted">{msg}</span> : null}
    </span>
  )
}

export function ItemActions({ itemId, lifecycle, verification }: { itemId: string; lifecycle: string; verification: string }) {
  const router = useRouter()
  const [busy, start] = useTransition()
  const [err, setErr] = useState<string | null>(null)
  const act = (patch: { lifecycle_status?: string; verification_status?: string }, reason: string) =>
    start(async () => {
      const r = await setMemoryItemAction(itemId, patch, reason)
      if (!r.ok) setErr(r.error ?? '실패')
      router.refresh()
    })
  const btn = 'min-h-7 rounded border border-line-soft px-1.5 text-t10h text-ink-dim hover:border-line disabled:opacity-50'
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {verification === 'draft' ? (
        <button type="button" disabled={busy} className={btn} onClick={() => act({ verification_status: 'confirmed' }, '대표 확인')}>확정</button>
      ) : null}
      {lifecycle === 'open' ? (
        <>
          <button type="button" disabled={busy} className={btn} onClick={() => act({ lifecycle_status: 'done' }, '끝남 표시')}>끝남</button>
          <button type="button" disabled={busy} className={btn} onClick={() => act({ lifecycle_status: 'on_hold' }, '보류 표시')}>보류</button>
          <button type="button" disabled={busy} className={btn} onClick={() => act({ lifecycle_status: 'cancelled' }, '취소 표시')}>취소</button>
        </>
      ) : lifecycle !== 'superseded' ? (
        <button type="button" disabled={busy} className={btn} onClick={() => act({ lifecycle_status: 'open' }, '다시 열기')}>다시 열기</button>
      ) : null}
      {verification !== 'rejected' ? (
        <button type="button" disabled={busy} className={btn} onClick={() => act({ verification_status: 'rejected' }, '틀린 정보로 표시')}>틀림</button>
      ) : null}
      {err ? <span className="text-t10h text-critical">{err}</span> : null}
    </span>
  )
}

export interface ReviewOption {
  target_type: string
  target_id: string
  label: string
}

/** 검토함 카드 — 확인 · 고치기 · 거절 · 기존 대상에 잇기 · 새 인물/회사로. 업무 후보는 프로젝트를 고른다. */
export function ReviewCard({
  review,
  options,
  projects,
  sourceHref,
  relatedHref,
}: {
  review: MemoryReview
  options: ReviewOption[]
  projects: { project_id: string; label: string }[]
  sourceHref: string
  relatedHref: string | null
}) {
  const router = useRouter()
  const [busy, start] = useTransition()
  const [err, setErr] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const p = review.proposed_change as Record<string, unknown>
  const cands = (Array.isArray(p.candidates) ? p.candidates : []) as { target_type: string; target_id: string; name: string; why: string; score: number }[]
  const [target, setTarget] = useState<string>(cands[0] ? `${cands[0].target_type}:${cands[0].target_id}` : '')
  const [entityName, setEntityName] = useState<string>(String(p.entity_name ?? p.mention ?? ''))
  const [project, setProject] = useState<string>(String(p.project_id ?? ''))
  const [content, setContent] = useState<string>(String(p.title ?? p.content ?? ''))
  const [due, setDue] = useState<string>(String(p.due_date ?? ''))
  const identity = review.review_type === 'entity_identity' || review.review_type === 'link_suggestion'
  const isTask = review.review_type === 'task_candidate'

  const go = (action: ReviewAction, data: Record<string, unknown> = {}) =>
    start(async () => {
      setErr(null)
      const r = await resolveMemoryReviewAction(review.review_id, action, data)
      if (!r.ok) {
        setErr(r.error ?? '실패')
        return
      }
      setDone(action === 'reject' ? '거절했습니다' : r.result?.task_id ? `업무 ${r.result.created ? '만듦' : '— 이미 있는 업무에 이음'}` : '처리했습니다')
      router.refresh()
    })

  const tone = review.priority === 'critical' || review.priority === 'high' ? 'border-l-warning' : 'border-l-line'
  const btn = 'min-h-8 rounded-md border px-2.5 text-t11h disabled:opacity-50'

  if (done) return <li className="rounded-lg border border-line-soft bg-panel px-3 py-2 text-t12 text-ink-dim">{review.title} — {done}</li>

  return (
    <li className={`rounded-lg border border-line-soft border-l-4 ${tone} bg-panel px-3 py-2.5`}>
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="rounded bg-raised px-1.5 py-0.5 text-t10h text-ink-dim">{REVIEW_TYPE_LABEL[review.review_type]}</span>
        <p className="min-w-0 flex-1 text-t13 text-ink">{review.title}</p>
      </div>
      <p className="mt-1 text-t11h text-ink-muted">
        <a href={sourceHref} className="text-accent hover:underline">원본 기록</a>
        {relatedHref ? (
          <>
            {' · '}
            <a href={relatedHref} className="text-accent hover:underline">앞 기록</a>
          </>
        ) : null}
        {typeof p.before === 'string' ? ` · 앞: ${p.before} → 새: ${String(p.after ?? '')}` : ''}
        {' · AI · 규칙의 제안입니다 — 확정은 대표가 합니다'}
      </p>

      {identity ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <select value={target} onChange={(e) => setTarget(e.target.value)} className="min-h-8 max-w-full rounded-md border border-line bg-panel px-2 text-t12" aria-label="잇을 대상">
            <option value="">— 잇을 대상 고르기 —</option>
            {cands.length ? (
              <optgroup label="후보(문맥)">
                {cands.map((c) => (
                  <option key={`${c.target_type}:${c.target_id}`} value={`${c.target_type}:${c.target_id}`}>{`${c.name} — ${c.why}`}</option>
                ))}
              </optgroup>
            ) : null}
            <optgroup label="전체">
              {options.map((o) => (
                <option key={`${o.target_type}:${o.target_id}`} value={`${o.target_type}:${o.target_id}`}>{o.label}</option>
              ))}
            </optgroup>
          </select>
          <button type="button" disabled={busy || !target} className={`${btn} border-accent text-ink`} onClick={() => {
            const [t, ...rest] = target.split(':')
            go('link', { target_type: t, target_id: rest.join(':') })
          }}>이 대상에 잇기</button>
          {review.link_id ? <button type="button" disabled={busy} className={`${btn} border-line text-ink-dim`} onClick={() => go('confirm')}>제안 그대로 확인</button> : null}
          <span className="inline-flex items-center gap-1">
            <input value={entityName} onChange={(e) => setEntityName(e.target.value)} className="min-h-8 w-36 rounded-md border border-line bg-panel px-2 text-t12" aria-label="새 이름" />
            <button type="button" disabled={busy || !entityName.trim()} className={`${btn} border-line text-ink-dim`} onClick={() => go('create_entity', { display_name: entityName, entity_type: p.kind === 'company' ? 'company' : 'person' })}>새 {p.kind === 'company' ? '회사' : '인물'}로</button>
          </span>
        </div>
      ) : isTask ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input value={content} onChange={(e) => setContent(e.target.value)} className="min-h-8 min-w-0 flex-1 rounded-md border border-line bg-panel px-2 text-t12" aria-label="업무 제목" />
          <select value={project} onChange={(e) => setProject(e.target.value)} className="min-h-8 rounded-md border border-line bg-panel px-2 text-t12" aria-label="프로젝트">
            <option value="">— 프로젝트 —</option>
            {projects.map((pr) => (
              <option key={pr.project_id} value={pr.project_id}>{pr.label}</option>
            ))}
          </select>
          <input type="date" value={due} onChange={(e) => setDue(e.target.value)} className="min-h-8 rounded-md border border-line bg-panel px-2 text-t12" aria-label="기한" />
          <button type="button" disabled={busy || !project} className={`${btn} border-accent text-ink`} onClick={() => go('edit', { project_id: project, title: content, due_date: due })}>업무로 만들기</button>
        </div>
      ) : (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input value={content} onChange={(e) => setContent(e.target.value)} placeholder="고칠 내용(선택)" className="min-h-8 min-w-0 flex-1 rounded-md border border-line bg-panel px-2 text-t12" aria-label="고칠 내용" />
          <input type="date" value={due} onChange={(e) => setDue(e.target.value)} className="min-h-8 rounded-md border border-line bg-panel px-2 text-t12" aria-label="날짜" />
          <button type="button" disabled={busy} className={`${btn} border-accent text-ink`} onClick={() => go('confirm')}>{review.review_type === 'change_detected' || review.review_type === 'conflict' ? '새 기록이 맞다' : '확인'}</button>
          <button type="button" disabled={busy || (!content.trim() && !due)} className={`${btn} border-line text-ink-dim`} onClick={() => go('edit', { content, due_date: due })}>고쳐서 확인</button>
        </div>
      )}
      <div className="mt-2 flex items-center gap-2">
        <button type="button" disabled={busy} className={`${btn} border-line-soft text-ink-muted`} onClick={() => go('reject')}>
          {review.review_type === 'change_detected' || review.review_type === 'conflict' ? '앞 기록 유지(거절)' : '거절'}
        </button>
        {err ? <span className="text-t11h text-critical" role="alert">{err}</span> : null}
      </div>
    </li>
  )
}

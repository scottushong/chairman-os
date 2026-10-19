'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState, useTransition } from 'react'

import { eaAct, eaAddFile, eaFollowup, eaRefMark, eaResubmit, eaWithdraw } from '@/app/actions/e-approval'
import { DOC_STATUS_LABEL, EVENT_LABEL, FOLLOWUP_STATUS_LABEL, dateTime, fullDate, won, type EaBox, type EaDocView, type EaFollowupStatus } from '@/lib/approvals/types'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

import { C, FOLLOWUP_TONE, Field, Pill, Section, stepLabel, stepWord } from './parts'

const newReq = () => globalThis.crypto.randomUUID()

/**
 * 문서 상세(시안 오른쪽 칸). 조작:
 *   지금 내 차례(대결 포함) → 의견 + 반려 · 승인(합의). 반려는 사유 필수.
 *   기안자 → 회수(아무도 처리 전) · 재상신(반려 · 회수 뒤 새 판).
 *   참조 · 열람자 → «확인»(열어 본 것과 따로). 승인 버튼은 없다.
 *   후속 담당 → 처리 중 · 처리 완료(결과 · 전표번호 글자 · 증빙).
 * 요청 id는 한 번 누를 때 하나 — 실패해서 다시 누르면 **같은 id**로 보낸다(이미 반영됐으면 서버가 한 번으로 친다).
 * 실패해도 의견 · 입력은 그대로 남는다.
 */
export function EaDetail({ view, box, mode, backHref, today }: { view: EaDocView; box: EaBox; mode: 'live' | 'dummy'; backHref: string; today: string }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [comment, setComment] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [req, setReq] = useState<string>(newReq)
  const d = view.doc
  const steps = view.steps
  const mine = steps.find((s) => s.can_act)
  const cur = steps.find((s) => s.seq === d.current_seq)
  const lastSeq = steps.at(-1)?.seq
  const fields = d.form_snapshot?.fields ?? []

  // 참조자가 열면 «열람»만 남긴다(확인과 다르다).
  const isRef = !!view.me.ref
  useEffect(() => {
    if (isRef) void eaRefMark(d.doc_id, false)
  }, [isRef, d.doc_id])
  const overdue = d.status === 'in_progress' && !!d.due_date && d.due_date < today

  function go(fn: () => Promise<{ ok: boolean; error?: string; data?: unknown }>, after?: (data: unknown) => void) {
    setError(null)
    start(async () => {
      const r = await fn()
      if (!r.ok) {
        setError(r.error ?? '처리하지 못했습니다.')
        return
      }
      setReq(newReq())
      setComment('')
      if (after) after(r.data)
      else router.refresh()
    })
  }

  return (
    <article className={`${C.card} flex min-w-0 flex-col`}>
      <div className="flex flex-col gap-2 px-4 pt-4 pb-4 sm:px-[18px]">
        <Link href={backHref} className="mb-1 text-[13px] text-[#2f5bd3] lg:hidden">
          ← 목록으로
        </Link>
        <div className="flex flex-wrap items-center gap-1.5">
          <Pill tone="blue">{d.form_name}</Pill>
          {d.version > 1 ? <Pill tone="gray">{d.version}판</Pill> : null}
          {cur && overdue ? <Pill tone="orange">{stepWord(cur.kind, cur.seq === lastSeq)} 기한 지남</Pill> : null}
        </div>
        <h2 className="text-[19px] font-bold break-words text-[#1f2329]">{d.title}</h2>
        <div className="text-[13px] text-[#6b7280]">
          문서번호 {d.doc_no ?? '(상신 전)'} · <span className={d.status === 'rejected' ? 'text-[#b4372b]' : ''}>{DOC_STATUS_LABEL[d.status]}</span>
        </div>
      </div>

      <section className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-[#eceef2] px-4 py-4 sm:px-[18px]">
        <Field label="기안자">
          {d.drafter_name}
          {d.drafter_dept ? ` · ${d.drafter_dept}` : ''}
        </Field>
        <Field label="상신일">{fullDate(d.submitted_at)}</Field>
        <Field label="현재 단계">{d.status === 'in_progress' && cur ? `${cur.name} ${stepWord(cur.kind, cur.seq === lastSeq)}` : DOC_STATUS_LABEL[d.status]}</Field>
        <Field label="후속 처리">
          {view.followup ? FOLLOWUP_STATUS_LABEL[view.followup.status] : d.form_snapshot?.followup_kind ? (d.status === 'approved' ? FOLLOWUP_STATUS_LABEL.none : '최종 승인 후 시작') : FOLLOWUP_STATUS_LABEL.none}
        </Field>
        {d.due_date ? <Field label="처리 기한">{fullDate(d.due_date)}</Field> : null}
        {d.wish_date ? <Field label="처리 희망일">{fullDate(d.wish_date)}</Field> : null}
      </section>

      <Section title="결재선">
        <ol className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-2">
          <li className="rounded-md bg-[#f3f4f6] px-3 py-2.5">
            <div className="text-[13px] font-medium text-[#1f2329]">{d.drafter_name}</div>
            <div className="text-[12px] text-[#6b7280]">{d.status === 'draft' ? '작성 중' : '기안 완료'}</div>
          </li>
          {steps.map((s) => (
            <li key={s.seq} className={`rounded-md px-3 py-2.5 ${s.status === 'waiting' ? 'bg-[#eaf0fd]' : s.status === 'rejected' ? 'bg-[#fdecea]' : 'bg-[#f3f4f6]'}`}>
              <div className={`text-[13px] font-medium ${s.status === 'waiting' ? 'text-[#2f5bd3]' : 'text-[#1f2329]'}`}>{s.name}</div>
              <div className={`text-[12px] ${s.status === 'rejected' ? 'text-[#b4372b]' : 'text-[#6b7280]'}`}>{stepLabel(s.kind, s.status, s.seq === lastSeq)}</div>
              {s.acted_at ? (
                <div className="mt-0.5 text-[11px] text-[#6b7280]">
                  {dateTime(s.acted_at)}
                  {s.as_proxy && s.acted_by_name ? ` · 대결 ${s.acted_by_name}` : ''}
                </div>
              ) : null}
            </li>
          ))}
        </ol>
        {view.refs.length ? (
          <div className="text-[12px] text-[#6b7280]">
            참조 · 열람: {view.refs.map((r) => `${r.name}(${r.kind === 'cc' ? '참조' : '열람'}${r.confirmed ? ' · 확인' : r.seen ? ' · 열어 봄' : ''})`).join(', ')}
          </div>
        ) : null}
      </Section>

      <Section title="신청 내용">
        <p className="text-[14px] leading-relaxed break-words whitespace-pre-wrap text-[#374151]">{d.body || '—'}</p>
        {fields.length ? (
          <dl className="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2">
            {fields
              .filter((f) => f.key !== 'total' || d.form_key !== 'purchase')
              .map((f) => (
                <div key={f.key} className="flex min-w-0 gap-2 text-[13px]">
                  <dt className="shrink-0 text-[#6b7280]">{f.label}</dt>
                  <dd className="min-w-0 break-words text-[#1f2329]">{f.type === 'money' && d.fields[f.key] ? won(Number(d.fields[f.key])) : d.fields[f.key] || '—'}</dd>
                </div>
              ))}
          </dl>
        ) : null}
        {d.form_key === 'vacation' ? <div className="text-[12px] text-[#6b7280]">잔여일수 · 중복 신청 검증: 근태 기능 연동 준비 중</div> : null}
      </Section>

      {d.amount != null ? (
        <Section title="신청 금액">
          <div className="text-[24px] text-[#1f2329] tnum">{won(d.amount)}</div>
          {d.form_key === 'purchase' && d.fields.supply ? (
            <div className="text-[12px] text-[#6b7280]">
              공급가 {won(Number(d.fields.supply))} + 부가세 {won(Number(d.fields.vat))}
            </div>
          ) : null}
          <div className="text-[12px] text-[#6b7280]">결재 금액입니다 — 회계 · 재무 숫자에는 자동 반영하지 않습니다.</div>
        </Section>
      ) : null}

      <Section title="첨부파일">
        {view.files.length ? (
          <ul className="flex flex-col gap-1.5">
            {view.files.map((f) => (
              <li key={f.file_id}>
                <a href={`/e-approval/file?path=${encodeURIComponent(f.path)}`} className="block rounded-md border border-[#e3e6eb] bg-[#f6f7f9] px-3 py-2.5 text-[13px] break-all text-[#1f2329] hover:bg-[#eef0f3]">
                  {f.name} · {Math.max(1, Math.round(f.size / 1024))}KB{f.kind === 'evidence' ? ' · 후속 증빙' : ''}
                  {mode === 'dummy' ? ' · 개발용 예시 파일' : ''}
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <div className="text-[13px] text-[#6b7280]">첨부 없음</div>
        )}
      </Section>

      {view.followup ? <FollowupPanel view={view} mode={mode} onDone={() => router.refresh()} /> : null}

      {view.events.length ? (
        <Section title="결재 의견 · 변경 이력">
          <ul className="flex flex-col gap-2">
            {view.events.map((e, i) => (
              <li key={i} className="text-[13px] text-[#374151]">
                <span className="text-[#6b7280]">{dateTime(e.at)}</span> · {e.actor}
                {e.as_proxy && e.original ? `(${e.original} 대결)` : ''} · <span className="font-medium">{EVENT_LABEL[e.action] ?? e.action}</span>
                {e.comment ? <div className="mt-0.5 rounded bg-[#f6f7f9] px-2 py-1 break-words whitespace-pre-wrap text-[#1f2329]">{e.comment}</div> : null}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {view.versions.length || view.next_version || view.related.length ? (
        <Section title="관련 문서 · 이전 버전">
          <ul className="flex flex-col gap-1 text-[13px]">
            {view.versions.map((v) => (
              <li key={v.doc_id}>
                <Link className="text-[#2f5bd3] hover:underline" href={`/e-approval?box=${box}&doc=${v.doc_id}`}>
                  {v.version}판 {v.doc_no ?? ''} · {DOC_STATUS_LABEL[v.status]}
                </Link>
              </li>
            ))}
            {view.next_version ? (
              <li>
                <Link className="text-[#2f5bd3] hover:underline" href={`/e-approval?box=${box}&doc=${view.next_version}`}>
                  보완본(다음 판) 보기
                </Link>
              </li>
            ) : null}
            {view.related
              .filter((r) => !view.versions.some((v) => v.doc_id === r.doc_id))
              .map((r) => (
                <li key={r.doc_id}>{r.title ? <Link className="text-[#2f5bd3] hover:underline" href={`/e-approval?box=${box}&doc=${r.doc_id}`}>{r.doc_no ?? ''} {r.title}</Link> : <span className="text-[#6b7280]">권한 없는 관련 문서 1건</span>}</li>
              ))}
          </ul>
        </Section>
      ) : null}

      {mine ? (
        <section className="flex flex-col gap-2.5 border-t border-[#eceef2] px-4 py-4 sm:px-[18px]">
          <label className="text-[13px] text-[#6b7280]" htmlFor="ea-comment">
            {stepWord(mine.kind, mine.seq === lastSeq)} 의견 · 반려 시 필수{mine.as_proxy || !mine.mine ? ' · 대결로 처리합니다' : ''}
          </label>
          <textarea id="ea-comment" value={comment} onChange={(e) => setComment(e.target.value)} rows={3} maxLength={2000} placeholder="증빙·금액 확인 의견을 입력하세요." className={C.input} />
          {error ? <Err text={error} /> : null}
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={pending} className={C.btnLine} onClick={() => go(() => eaAct(d.doc_id, mine.seq, 'reject', comment, req))}>
              반려
            </button>
            <button type="button" disabled={pending} className={C.btn} onClick={() => go(() => eaAct(d.doc_id, mine.seq, 'approve', comment, req))}>
              {mine.kind === 'agree' ? '합의' : mine.seq === lastSeq ? '최종 승인' : '검토 승인'}
            </button>
          </div>
        </section>
      ) : null}

      {view.me.drafter && (view.me.can_withdraw || view.me.can_resubmit || d.status === 'draft') ? (
        <section className="flex flex-col gap-2 border-t border-[#eceef2] px-4 py-4 sm:px-[18px]">
          {error && !mine ? <Err text={error} /> : null}
          <div className="flex flex-wrap gap-2">
            {d.status === 'draft' ? (
              <Link href={`/e-approval?box=drafts&edit=${d.doc_id}`} className={C.btn}>
                이어서 작성
              </Link>
            ) : null}
            {view.me.can_withdraw ? (
              <button type="button" disabled={pending} className={C.btnLine} onClick={() => go(() => eaWithdraw(d.doc_id, req))}>
                회수
              </button>
            ) : null}
            {view.me.can_resubmit ? (
              <button type="button" disabled={pending} className={C.btn} onClick={() => go(() => eaResubmit(d.doc_id), (id) => router.push(`/e-approval?box=drafts&edit=${String(id)}`))}>
                보완해 재상신
              </button>
            ) : null}
          </div>
          {d.status === 'in_progress' && !view.me.can_withdraw ? <div className="text-[12px] text-[#6b7280]">이미 처리한 결재자가 있어 직접 회수할 수 없습니다. 지금 담당자에게 반려를 요청하세요.</div> : null}
          {view.me.can_resubmit ? <div className="text-[12px] text-[#6b7280]">원문서와 의견은 그대로 남고, 보완본이 새 판으로 만들어져 처음부터 결재합니다.</div> : null}
        </section>
      ) : view.me.drafter && d.status === 'in_progress' ? (
        <section className="border-t border-[#eceef2] px-4 py-3 text-[12px] text-[#6b7280] sm:px-[18px]">이미 처리한 결재자가 있어 직접 회수할 수 없습니다. 지금 담당자에게 반려를 요청하세요.</section>
      ) : null}

      {view.me.ref ? (
        <section className="flex flex-wrap items-center gap-2 border-t border-[#eceef2] px-4 py-4 sm:px-[18px]">
          {error && !mine ? <Err text={error} /> : null}
          {view.me.ref.confirmed ? (
            <Pill tone="green">확인함</Pill>
          ) : (
            <button type="button" disabled={pending} className={C.btnLine} onClick={() => go(() => eaRefMark(d.doc_id, true))}>
              확인
            </button>
          )}
          <span className="text-[12px] text-[#6b7280]">{view.me.ref.kind === 'cc' ? '참조' : '열람'}로 지정된 문서입니다 — 결재는 할 수 없습니다.</span>
        </section>
      ) : null}
    </article>
  )
}

function Err({ text }: { text: string }) {
  return (
    <div role="alert" className="rounded-md bg-[#fdecea] px-3 py-2 text-[13px] text-[#b4372b]">
      {text}{' '}
      <button type="button" className="underline" onClick={() => location.reload()}>
        새로 고쳐 상태 확인
      </button>
    </div>
  )
}

function FollowupPanel({ view, mode, onDone }: { view: EaDocView; mode: 'live' | 'dummy'; onDone: () => void }) {
  const f = view.followup!
  const [pending, start] = useTransition()
  const [result, setResult] = useState(f.result ?? '')
  const [slip, setSlip] = useState(f.ecount_slip ?? '')
  const [error, setError] = useState<string | null>(null)
  const [req, setReq] = useState<string>(newReq)
  const [file, setFile] = useState<File | null>(null)
  const docId = view.doc.doc_id

  function save(status: EaFollowupStatus) {
    setError(null)
    start(async () => {
      if (file) {
        const path = `${docId}/fu-${newReq()}${/\.[a-z0-9]{1,5}$/i.exec(file.name)?.[0]?.toLowerCase() ?? ''}`
        const form = new FormData()
        form.set('doc_id', docId)
        form.set('path', path)
        form.set('name', file.name)
        form.set('size', String(file.size))
        form.set('mime', file.type)
        if (mode === 'live') {
          const { error: up } = await createSupabaseBrowserClient().storage.from('ea-files').upload(path, file, { upsert: false, contentType: file.type || 'application/octet-stream' })
          if (up) return setError(`증빙을 올리지 못했습니다(${up.message.slice(0, 80)}).`)
        } else form.set('file', file)
        const a = await eaAddFile(form)
        if (!a.ok) return setError(a.error ?? '증빙을 붙이지 못했습니다.')
        setFile(null)
      }
      const r = await eaFollowup(docId, status, result, slip, req)
      if (!r.ok) return setError(r.error ?? '저장하지 못했습니다.')
      setReq(newReq())
      onDone()
    })
  }

  return (
    <Section title="후속 처리" aside={<Pill tone={FOLLOWUP_TONE[f.status]}>{FOLLOWUP_STATUS_LABEL[f.status]}</Pill>}>
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-[13px]">
        <div>
          <span className="text-[#6b7280]">업무</span> {f.kind}
        </div>
        <div>
          <span className="text-[#6b7280]">담당</span> {f.assignee}
        </div>
        <div>
          <span className="text-[#6b7280]">기한</span> {f.due_date ? fullDate(f.due_date) : '—'}
        </div>
        <div>
          <span className="text-[#6b7280]">전표번호</span> {f.ecount_slip ?? '—'}
        </div>
        {f.done_at ? (
          <div className="col-span-2">
            <span className="text-[#6b7280]">완료</span> {f.done_by} · {dateTime(f.done_at)} · {f.result}
          </div>
        ) : null}
      </div>
      <div className="text-[12px] text-[#6b7280]">후속 처리가 끝나지 않아도 문서의 «승인 완료»는 그대로입니다.</div>
      {f.mine && f.status !== 'done' ? (
        <div className="flex flex-col gap-2">
          <textarea value={result} onChange={(e) => setResult(e.target.value)} rows={2} maxLength={2000} placeholder="처리 결과(완료 시 필수) — 예: 발주서 발송" className={C.input} />
          <input value={slip} onChange={(e) => setSlip(e.target.value)} maxLength={60} placeholder="이카운트 전표번호(있으면 · 글자만 기록)" className={C.input} />
          <input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-[13px]" aria-label="증빙 파일" />
          {error ? <div className="rounded-md bg-[#fdecea] px-3 py-2 text-[13px] text-[#b4372b]">{error}</div> : null}
          <div className="flex flex-wrap gap-2">
            {f.status === 'waiting' ? (
              <button type="button" disabled={pending} className={C.btnLine} onClick={() => save('doing')}>
                처리 중으로
              </button>
            ) : null}
            <button type="button" disabled={pending} className={C.btn} onClick={() => save('done')}>
              처리 완료
            </button>
          </div>
        </div>
      ) : null}
    </Section>
  )
}

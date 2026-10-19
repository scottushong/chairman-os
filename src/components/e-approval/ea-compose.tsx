'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

import { eaAddFile, eaDeleteDraft, eaRemoveFile, eaSaveAndSubmit, eaSaveDraft, eaSaveFavorite } from '@/app/actions/e-approval'
import { won, type EaDocView, type EaDraftInput, type EaForm, type EaLineEntry, type EaMySettings, type EaPerson, type EaRefEntry } from '@/lib/approvals/types'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

import { C } from './parts'

const newReq = () => globalThis.crypto.randomUUID()
const MAX = 20 * 1024 * 1024

/**
 * 새 문서 작성 · 임시저장 이어서 쓰기. 기안자 · 부서는 서버가 넣는다(상신 때 이름 · 부서를 문서에 얼린다).
 * 결재선 = 사람(검토 · 합의) + 역할 «대표»(승인). 필수 칸 · 합계 · 첨부 · 결재선은 서버가 다시 본다(여기 검사는 안내뿐).
 * 첨부는 문서가 한 번 저장된 뒤에 붙는다(경로가 «<문서>/<이름>») — 파일을 고르면 먼저 임시저장한다.
 * 상신이 막혀도 작성 내용은 화면에 그대로 있고, 저장된 부분은 임시저장으로 남는다.
 */
export function EaCompose({
  form,
  forms,
  people,
  businesses,
  initial,
  favorites,
  mode,
  me,
}: {
  form: EaForm
  forms: EaForm[]
  people: EaPerson[]
  businesses: { business_id: string; name: string }[]
  initial: EaDocView | null
  favorites: EaMySettings['favorites']
  mode: 'live' | 'dummy'
  me: { name: string; dept: string | null }
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const d = initial?.doc
  const [docId, setDocId] = useState<string | null>(d?.doc_id ?? null)
  const [biz, setBiz] = useState(d?.business_id ?? businesses[0]?.business_id ?? '')
  const [title, setTitle] = useState(d?.title === '(제목 없음)' ? '' : (d?.title ?? ''))
  const [body, setBody] = useState(d?.body ?? '')
  const [fields, setFields] = useState<Record<string, string>>(d?.fields ?? {})
  const [line, setLine] = useState<EaLineEntry[]>(d?.line ?? [{ role: 'Chairman', kind: 'approve' }])
  const [refs, setRefs] = useState<EaRefEntry[]>(d?.refs_draft ?? [])
  const [due, setDue] = useState(d?.due_date ?? '')
  const [wish, setWish] = useState(d?.wish_date ?? '')
  const [fu, setFu] = useState(d?.followup_assignee ?? '')
  const [files, setFiles] = useState(initial?.files ?? [])
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [req, setReq] = useState<string>(newReq)
  const [favName, setFavName] = useState('')

  const name = (uid?: string) => people.find((p) => p.user_id === uid)?.name ?? '사람 선택'
  const setF = (k: string, v: string) => setFields((x) => ({ ...x, [k]: v }))
  const sumHint =
    form.form_key === 'purchase' && fields.supply && fields.vat ? Number(fields.supply || 0) + Number(fields.vat || 0) : null

  function input(): EaDraftInput {
    return { doc_id: docId, business_id: biz, form_key: form.form_key, title, body, fields, line, refs, due_date: due || null, wish_date: wish || null, followup_assignee: fu || null, related: d?.related ?? [] }
  }

  async function ensureSaved(): Promise<string | null> {
    const r = await eaSaveDraft(input())
    if (!r.ok || !r.data) {
      setError(r.error ?? '저장하지 못했습니다.')
      return null
    }
    setDocId(r.data)
    return r.data
  }

  function saveDraft() {
    setError(null)
    start(async () => {
      const id = await ensureSaved()
      if (id) {
        setNote('임시저장했습니다. 결재자에게는 보이지 않습니다.')
        router.replace(`/e-approval?box=drafts&edit=${id}`)
      }
    })
  }

  function submit() {
    setError(null)
    start(async () => {
      const r = await eaSaveAndSubmit(input(), req)
      if (r.data?.doc_id) setDocId(r.data.doc_id)
      if (!r.ok) return setError(r.error ?? '상신하지 못했습니다.')
      setReq(newReq())
      router.push(`/e-approval?box=mine&doc=${r.data!.doc_id}`)
    })
  }

  function attach(list: FileList | null) {
    const picked = Array.from(list ?? [])
    if (!picked.length) return
    setError(null)
    start(async () => {
      const id = docId ?? (await ensureSaved())
      if (!id) return
      for (const f of picked) {
        if (f.size < 1 || f.size > MAX) {
          setError(`${f.name}: 20MB 이하 파일만 올릴 수 있습니다.`)
          continue
        }
        const ext = /\.[a-z0-9]{1,5}$/i.exec(f.name)?.[0]?.toLowerCase() ?? ''
        const path = `${id}/${newReq()}${ext}`
        const form = new FormData()
        form.set('doc_id', id)
        form.set('path', path)
        form.set('name', f.name)
        form.set('size', String(f.size))
        form.set('mime', f.type)
        if (mode === 'live') {
          const { error: up } = await createSupabaseBrowserClient().storage.from('ea-files').upload(path, f, { upsert: false, contentType: f.type || 'application/octet-stream' })
          if (up) {
            setError(`${f.name}을(를) 올리지 못했습니다(${up.message.slice(0, 80)}).`)
            continue
          }
        } else form.set('file', f)
        const r = await eaAddFile(form)
        if (!r.ok) setError(r.error ?? '첨부하지 못했습니다.')
        else setFiles((x) => [...x, { file_id: path, name: f.name, size: f.size, kind: 'doc', path }])
      }
      router.replace(`/e-approval?box=drafts&edit=${id}`)
      router.refresh()
    })
  }

  return (
    <div className={`${C.card} flex flex-col gap-5 px-4 py-5 sm:px-6`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-[12px] text-[#6b7280]">새 문서 · {form.name_ko}{d?.version && d.version > 1 ? ` · ${d.version}판(보완본)` : ''}</div>
          <h2 className="text-[19px] font-bold text-[#1f2329]">{d ? '이어서 작성' : '새 문서 작성'}</h2>
        </div>
        <div className="text-[13px] text-[#6b7280]">
          기안자 {me.name}
          {me.dept ? ` · ${me.dept}` : ''}
        </div>
      </div>
      {form.note ? <div className="rounded-md bg-[#f6f7f9] px-3 py-2 text-[13px] text-[#4b5563]">{form.note}</div> : null}

      <div className="grid gap-4 sm:grid-cols-2">
        {businesses.length > 1 ? (
          <Label text="회사">
            <select value={biz} onChange={(e) => setBiz(e.target.value)} className={C.input}>
              {businesses.map((b) => (
                <option key={b.business_id} value={b.business_id}>
                  {b.name}
                </option>
              ))}
            </select>
          </Label>
        ) : null}
        <Label text="양식">
          <select
            value={form.form_key}
            disabled={!!docId}
            onChange={(e) => router.replace(`/e-approval?box=drafts&new=${e.target.value}`)}
            className={C.input}
          >
            {forms.map((f) => (
              <option key={f.form_key} value={f.form_key}>
                {f.name_ko}
              </option>
            ))}
          </select>
        </Label>
      </div>

      <Label text="제목 *">
        <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} className={C.input} placeholder="예: 포장기 소모품 구매품의" />
      </Label>
      <Label text={`신청 내용${form.form_key === 'general' ? ' *' : ''}`}>
        <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={5} maxLength={20000} className={C.input} />
      </Label>

      {form.fields.length ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {form.fields.map((f) => (
            <Label key={f.key} text={`${f.label}${f.required ? ' *' : ''}`} wide={f.type === 'textarea'}>
              {f.type === 'textarea' ? (
                <textarea value={fields[f.key] ?? ''} onChange={(e) => setF(f.key, e.target.value)} rows={3} className={C.input} />
              ) : f.type === 'select' ? (
                <select value={fields[f.key] ?? ''} onChange={(e) => setF(f.key, e.target.value)} className={C.input}>
                  <option value="">선택</option>
                  {(f.options ?? []).map((o) => (
                    <option key={o}>{o}</option>
                  ))}
                </select>
              ) : (
                <input
                  type={f.type === 'date' ? 'date' : 'text'}
                  inputMode={f.type === 'money' || f.type === 'number' ? 'numeric' : undefined}
                  value={fields[f.key] ?? ''}
                  onChange={(e) => setF(f.key, f.type === 'money' ? e.target.value.replace(/[^0-9]/g, '') : e.target.value)}
                  className={C.input}
                />
              )}
              {f.type === 'money' && fields[f.key] ? <span className="text-[12px] text-[#6b7280]">{won(Number(fields[f.key]))}</span> : null}
              {f.key === 'total' && sumHint != null && String(sumHint) !== fields.total ? (
                <button type="button" className="self-start text-[12px] text-[#2f5bd3] underline" onClick={() => setF('total', String(sumHint))}>
                  공급가 + 부가세 = {won(sumHint)}로 맞추기
                </button>
              ) : null}
            </Label>
          ))}
        </div>
      ) : null}
      {form.form_key === 'vacation' ? <div className="text-[12px] text-[#6b7280]">잔여일수 · 중복 신청 검증: 근태 기능 연동 준비 중</div> : null}

      <fieldset className="flex flex-col gap-2 rounded-md border border-[#e3e6eb] p-3">
        <legend className="px-1 text-[13px] font-semibold text-[#1f2329]">결재선 *</legend>
        <ol className="flex flex-col gap-2">
          {line.map((s, i) => (
            <li key={i} className="flex flex-wrap items-center gap-2">
              <span className="w-6 text-[13px] text-[#6b7280]">{i + 1}</span>
              {s.role === 'Chairman' ? (
                <span className="min-w-[8rem] rounded-md bg-[#f3f4f6] px-3 py-2 text-[14px]">대표</span>
              ) : (
                <select value={s.user_id ?? ''} onChange={(e) => setLine((x) => x.map((y, j) => (j === i ? { ...y, user_id: e.target.value } : y)))} className={`${C.input} w-auto min-w-[10rem] flex-1`}>
                  <option value="">사람 선택</option>
                  {people.map((p) => (
                    <option key={p.user_id} value={p.user_id}>
                      {p.name}
                      {p.dept ? ` · ${p.dept}` : ''}
                      {p.title ? ` · ${p.title}` : ''}
                    </option>
                  ))}
                </select>
              )}
              <select value={s.kind} onChange={(e) => setLine((x) => x.map((y, j) => (j === i ? { ...y, kind: e.target.value === 'agree' ? 'agree' : 'approve' } : y)))} className={`${C.input} w-auto`}>
                <option value="approve">{i === line.length - 1 ? '승인' : '검토(승인)'}</option>
                <option value="agree">합의</option>
              </select>
              <button type="button" className="text-[13px] text-[#6b7280]" disabled={i === 0} onClick={() => setLine((x) => swap(x, i, i - 1))} aria-label="위로">
                ↑
              </button>
              <button type="button" className="text-[13px] text-[#6b7280]" disabled={i === line.length - 1} onClick={() => setLine((x) => swap(x, i, i + 1))} aria-label="아래로">
                ↓
              </button>
              <button type="button" className="text-[13px] text-[#b4372b]" onClick={() => setLine((x) => x.filter((_, j) => j !== i))}>
                빼기
              </button>
            </li>
          ))}
        </ol>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={C.btnLine} onClick={() => setLine((x) => insertBeforeBoss(x, { user_id: '', kind: 'approve' }))}>
            + 검토자
          </button>
          <button type="button" className={C.btnLine} onClick={() => setLine((x) => insertBeforeBoss(x, { user_id: '', kind: 'agree' }))}>
            + 합의자
          </button>
          {!line.some((s) => s.role === 'Chairman') ? (
            <button type="button" className={C.btnLine} onClick={() => setLine((x) => [...x, { role: 'Chairman', kind: 'approve' }])}>
              + 대표
            </button>
          ) : null}
          {favorites.length ? (
            <select
              className={`${C.input} w-auto`}
              value=""
              onChange={(e) => {
                const f = favorites.find((x) => x.fav_id === e.target.value)
                if (f) {
                  setLine(f.line)
                  setRefs(f.refs)
                }
              }}
            >
              <option value="">자주 쓰는 결재선 불러오기</option>
              {favorites.map((f) => (
                <option key={f.fav_id} value={f.fav_id}>
                  {f.name}
                </option>
              ))}
            </select>
          ) : null}
        </div>
        <div className="text-[12px] text-[#6b7280]">
          순서대로 처리합니다: {line.map((s) => (s.role === 'Chairman' ? '대표' : name(s.user_id)) + (s.kind === 'agree' ? '(합의)' : '')).join(' → ') || '—'}. 금액이 큰 구매 · 지출 · 수리는 대표 승인이 필요합니다(관리자가 정한 규칙).
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input value={favName} onChange={(e) => setFavName(e.target.value)} maxLength={40} placeholder="이 결재선을 이름 붙여 저장" className={`${C.input} w-auto flex-1`} />
          <button
            type="button"
            className={C.btnLine}
            disabled={!favName.trim() || pending}
            onClick={() =>
              start(async () => {
                const r = await eaSaveFavorite(favName, line, refs)
                setNote(r.ok ? '자주 쓰는 결재선에 저장했습니다.' : (r.error ?? '저장하지 못했습니다.'))
                if (r.ok) setFavName('')
              })
            }
          >
            저장
          </button>
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-2 rounded-md border border-[#e3e6eb] p-3">
        <legend className="px-1 text-[13px] font-semibold text-[#1f2329]">참조 · 열람</legend>
        {refs.map((r, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <select value={r.user_id} onChange={(e) => setRefs((x) => x.map((y, j) => (j === i ? { ...y, user_id: e.target.value } : y)))} className={`${C.input} w-auto min-w-[10rem] flex-1`}>
              <option value="">사람 선택</option>
              {people.map((p) => (
                <option key={p.user_id} value={p.user_id}>
                  {p.name}
                  {p.dept ? ` · ${p.dept}` : ''}
                </option>
              ))}
            </select>
            <select value={r.kind} onChange={(e) => setRefs((x) => x.map((y, j) => (j === i ? { ...y, kind: e.target.value === 'viewer' ? 'viewer' : 'cc' } : y)))} className={`${C.input} w-auto`}>
              <option value="cc">참조</option>
              <option value="viewer">열람</option>
            </select>
            <button type="button" className="text-[13px] text-[#b4372b]" onClick={() => setRefs((x) => x.filter((_, j) => j !== i))}>
              빼기
            </button>
          </div>
        ))}
        <button type="button" className={`${C.btnLine} self-start`} onClick={() => setRefs((x) => [...x, { user_id: '', kind: 'cc' }])}>
          + 참조자
        </button>
        <div className="text-[12px] text-[#6b7280]">참조자는 문서를 보고 «확인»만 합니다 — 결재를 진행시키지 않습니다.</div>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-3">
        <Label text="처리 기한(있을 때만 «기한 초과» 표시)">
          <input type="date" value={due} onChange={(e) => setDue(e.target.value)} className={C.input} />
        </Label>
        <Label text="처리 희망일">
          <input type="date" value={wish} onChange={(e) => setWish(e.target.value)} className={C.input} />
        </Label>
        {form.followup_kind ? (
          <Label text={`후속 담당자(${form.followup_kind})${form.followup_required ? ' *' : ''}`}>
            <select value={fu} onChange={(e) => setFu(e.target.value)} className={C.input}>
              <option value="">선택</option>
              {people.map((p) => (
                <option key={p.user_id} value={p.user_id}>
                  {p.name}
                  {p.dept ? ` · ${p.dept}` : ''}
                </option>
              ))}
            </select>
          </Label>
        ) : null}
      </div>

      <fieldset className="flex flex-col gap-2 rounded-md border border-[#e3e6eb] p-3">
        <legend className="px-1 text-[13px] font-semibold text-[#1f2329]">첨부파일{form.attachment_required ? ' *' : ''}</legend>
        {files.length ? (
          <ul className="flex flex-col gap-1">
            {files.map((f) => (
              <li key={f.file_id} className="flex items-center justify-between gap-2 rounded-md bg-[#f6f7f9] px-3 py-2 text-[13px]">
                <span className="min-w-0 break-all">
                  {f.name} · {Math.max(1, Math.round(f.size / 1024))}KB
                </span>
                {initial?.files.some((x) => x.file_id === f.file_id) ? (
                  <button
                    type="button"
                    className="shrink-0 text-[#b4372b]"
                    onClick={() =>
                      start(async () => {
                        const r = await eaRemoveFile(f.file_id)
                        if (r.ok) setFiles((x) => x.filter((y) => y.file_id !== f.file_id))
                        else setError(r.error ?? '빼지 못했습니다.')
                      })
                    }
                  >
                    빼기
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
        <input type="file" multiple onChange={(e) => attach(e.target.files)} disabled={pending} className="text-[13px]" aria-label="첨부파일 고르기" />
        <div className="text-[12px] text-[#6b7280]">파일당 20MB. 이 문서를 볼 수 있는 사람만 내려받습니다. 상신 뒤에는 바꿀 수 없습니다.</div>
      </fieldset>

      {error ? (
        <div role="alert" className="rounded-md bg-[#fdecea] px-3 py-2 text-[13px] text-[#b4372b]">
          {error}
        </div>
      ) : null}
      {note ? <div className="rounded-md bg-[#e7f5ee] px-3 py-2 text-[13px] text-[#1f7a4d]">{note}</div> : null}

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={pending} className={C.btn} onClick={submit}>
          상신
        </button>
        <button type="button" disabled={pending} className={C.btnLine} onClick={saveDraft}>
          임시저장
        </button>
        <Link href="/e-approval" className={C.btnLine}>
          취소
        </Link>
        {docId ? (
          <button
            type="button"
            disabled={pending}
            className="ml-auto text-[13px] text-[#b4372b]"
            onClick={() =>
              start(async () => {
                const r = await eaDeleteDraft(docId)
                if (r.ok) router.push('/e-approval?box=drafts')
                else setError(r.error ?? '지우지 못했습니다.')
              })
            }
          >
            임시저장 삭제
          </button>
        ) : null}
      </div>
    </div>
  )
}

function Label({ text, children, wide }: { text: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <label className={`flex min-w-0 flex-col gap-1 ${wide ? 'sm:col-span-2' : ''}`}>
      <span className="text-[13px] text-[#4b5563]">{text}</span>
      {children}
    </label>
  )
}

function swap<T>(x: T[], a: number, b: number): T[] {
  const y = [...x]
  ;[y[a], y[b]] = [y[b], y[a]]
  return y
}

function insertBeforeBoss(x: EaLineEntry[], e: EaLineEntry): EaLineEntry[] {
  const i = x.findIndex((s) => s.role === 'Chairman')
  return i < 0 ? [...x, e] : [...x.slice(0, i), e, ...x.slice(i)]
}

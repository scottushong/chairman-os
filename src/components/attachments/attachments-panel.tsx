'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useRef, useState, useTransition } from 'react'

import {
  beginAttachment,
  cancelAttachment,
  deleteAttachmentAction,
  downloadAttachmentAction,
  setAttachmentViewerAction,
  summarizeAttachmentAction,
  uploadAttachmentBytes,
} from '@/app/actions/attachments'
import { saveInitiativeField } from '@/app/actions/initiatives'
import { Icon } from '@/components/ui/icon'
import {
  ATTACHMENT_ACCEPT,
  ATTACHMENT_CLASS_HINT,
  ATTACHMENT_CLASS_LABEL,
  ATTACHMENT_MAX_BYTES,
  IMAGE_SOFT_MAX_BYTES,
  attachmentClassAllowed,
  attachmentMime,
  defaultAttachmentClass,
  formatBytes,
  isImageMime,
} from '@/lib/attachments/rules'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import {
  ATTACHMENT_STATUS_LABEL_KO,
  type Attachment,
  type AttachmentClass,
  type AttachmentEntity,
  type AttachmentViewer,
  type SecurityClass,
} from '@/types'

/**
 * Phase 10 «첨부» 칸 — 이니셔티브 · 회사 · 문서 · 결재 상세가 같이 쓴다.
 *
 * 드래그 앤 드롭 + 버튼 + (폰) 카메라. 등급 기본은 «본인 보안등급 이하에서 가장 높은 것»
 * (회장 → 제한, 일반 직원 → 일반 — Vault는 파일을 받지 않으므로 기본이 아니다). 본인 등급보다 높은 등급은 못 고른다. 올리면 곧바로 요약을 부른다 —
 * 요약이 실패해도 파일은 남고 «다시 요약»이 선다. 요약은 늘 «결정 아님» 표시와 같이 그린다.
 *
 * 바이트 길: live는 브라우저가 Supabase Storage로 바로(0045 버킷 정책이 «줄을 만든 본인»만 받는다),
 * dummy는 서버 액션. Vercel 함수가 20MB 요청을 못 받아서 갈라졌다(DEFERRED Phase 10).
 */

type FillField = 'goal' | 'next_action' | 'blocker'
const FILL_LABEL: Record<FillField, string> = { goal: '목표', next_action: '다음 행동', blocker: '막힌 점' }

export interface AttachmentsPanelProps {
  entityTable: AttachmentEntity
  entityId: string
  attachments: Attachment[]
  mode: 'dummy' | 'live'
  /** max_security_class — 등급 기본값과 고를 수 있는 등급을 정한다(0045 attachment_class_ok). */
  viewer: { user_id: string; role: string; maxClass: SecurityClass }
  names: Record<string, string>
  /** 회장에게만 — Vault 지정자 목록과 고를 사람. */
  vaultViewers?: Record<string, AttachmentViewer[]>
  people?: { user_id: string; display_name: string }[]
  /** 이니셔티브 상세에서만 — 비어 있는 칸(채우기 제안 대상). */
  fill?: { initiativeId: string; empty: FillField[] }
  compact?: boolean
}

/** 긴 변 2400px JPEG로. 폰 사진(대개 5MB+)이 Claude 이미지 한도를 넘지 않게. */
async function shrinkImage(file: File): Promise<File> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, 2400 / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, 'image/jpeg', 0.85))
  if (!blob) return file
  return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' })
}

export function AttachmentsPanel(props: AttachmentsPanelProps) {
  const { entityTable, entityId, attachments, mode, viewer } = props
  const router = useRouter()
  const isChairman = viewer.role === 'Chairman'
  const defaultCls = defaultAttachmentClass(viewer.maxClass)
  // 올릴 수 있는 등급이 하나도 없으면(Public) 올리기 칸을 그리지 않는다 — 0045가 어차피 막는다.
  const canUpload = viewer.role !== 'AIAgent' && viewer.role !== 'Integration' && defaultCls !== null
  const [cls, setCls] = useState<AttachmentClass>(defaultCls ?? 'Normal')
  const [drag, setDrag] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const cameraRef = useRef<HTMLInputElement>(null)

  async function uploadOne(original: File) {
    const mime = attachmentMime(original.name, original.type)
    if (!mime) throw new Error(`${original.name}: PDF · Word · Excel · PowerPoint · PNG · JPG만 받습니다.`)
    const file = isImageMime(mime) && original.size > IMAGE_SOFT_MAX_BYTES ? await shrinkImage(original) : original
    const finalMime = file === original ? mime : 'image/jpeg'
    if (file.size > ATTACHMENT_MAX_BYTES) throw new Error(`${original.name}: 20MB까지 올릴 수 있습니다.`)

    setBusy(`${file.name} 올리는 중…`)
    const begun = await beginAttachment({
      entity_table: entityTable,
      entity_id: entityId,
      file_name: file.name,
      mime: finalMime,
      size_bytes: file.size,
      security_class: cls,
    })
    if (begun.error || !begun.id || !begun.path) throw new Error(begun.error ?? '올리지 못했습니다.')

    let upErr: string | undefined
    if (mode === 'live') {
      const { error: e } = await createSupabaseBrowserClient()
        .storage.from('attachments')
        .upload(begun.path, file, { contentType: finalMime, upsert: false })
      upErr = e?.message
    } else {
      const fd = new FormData()
      fd.set('file', file)
      upErr = (await uploadAttachmentBytes(begun.id, fd)).error
    }
    if (upErr) {
      await cancelAttachment(begun.id)
      throw new Error(`${file.name}: 파일을 올리지 못했습니다(${upErr}).`)
    }
    router.refresh()

    if (begun.status !== 'skipped_vault') {
      setBusy(`${file.name} 요약 중… (긴 문서는 1~2분)`)
      const s = await summarizeAttachmentAction(begun.id)
      if (s.error) setError(`${file.name}: ${s.error} — 파일은 올라갔습니다. «다시 요약»을 누르세요.`)
    }
  }

  async function uploadAll(files: FileList | File[] | null) {
    if (!files || files.length === 0) return
    setError(null)
    try {
      for (const f of Array.from(files)) await uploadOne(f)
    } catch (e) {
      setError(e instanceof Error ? e.message : '올리지 못했습니다.')
    } finally {
      setBusy(null)
      router.refresh()
      if (fileRef.current) fileRef.current.value = ''
      if (cameraRef.current) cameraRef.current.value = ''
    }
  }

  return (
    <section className="rounded-xl border border-line-soft bg-panel p-4" aria-label="첨부">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-t13 font-semibold">
          <Icon name="file-text" className="size-4 text-accent" />
          첨부 <span className="text-t11 font-normal text-ink-muted">{attachments.length}건</span>
        </h2>
        <p className="text-t10h text-ink-muted">AI 요약은 참고용 — 결정 아님</p>
      </div>

      {canUpload ? (
        <div
          onDragOver={(e) => {
            e.preventDefault()
            setDrag(true)
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDrag(false)
            if (cls !== 'Vault') void uploadAll(e.dataTransfer.files)
          }}
          className={`mt-3 rounded-lg border border-dashed p-3 transition-colors ${drag ? 'border-accent bg-accent/10' : 'border-line'}`}
        >
          <div className="flex flex-wrap items-center gap-2">
            {cls === 'Vault' ? null : (
              <>
            <button
              type="button"
              disabled={!!busy}
              onClick={() => fileRef.current?.click()}
              className="min-h-11 rounded-md border border-line bg-panel px-3 text-t11h text-ink-dim transition-colors hover:border-accent hover:text-ink disabled:opacity-50 lg:min-h-0 lg:py-1.5"
            >
              파일 고르기
            </button>
            <button
              type="button"
              disabled={!!busy}
              onClick={() => cameraRef.current?.click()}
              className="min-h-11 rounded-md border border-line bg-panel px-3 text-t11h text-ink-dim transition-colors hover:border-accent hover:text-ink disabled:opacity-50 lg:hidden"
            >
              카메라로 찍기
            </button>
              </>
            )}
            <label className="flex items-center gap-1.5 text-t11 text-ink-muted">
              등급
              <select
                value={cls}
                onChange={(e) => setCls(e.target.value as AttachmentClass)}
                className="min-h-11 rounded-md border border-line bg-panel px-2 text-t11h text-ink lg:min-h-0 lg:py-1"
              >
                <option value="Normal">{ATTACHMENT_CLASS_LABEL.Normal}</option>
                <option value="Restricted" disabled={!attachmentClassAllowed('Restricted', viewer.maxClass)}>
                  {`${ATTACHMENT_CLASS_LABEL.Restricted}${attachmentClassAllowed('Restricted', viewer.maxClass) ? '' : ' (보안등급 밖)'}`}
                </option>
                {isChairman ? <option value="Vault">{ATTACHMENT_CLASS_LABEL.Vault}</option> : null}
              </select>
            </label>
            <span className="text-t10h text-ink-muted">{ATTACHMENT_CLASS_HINT[cls]}</span>
          </div>
          {cls === 'Vault' ? (
            // CLAUDE.md — Vault 원본은 사내 스토리지에 두고 링크만. 앱 레벨 암호화(회사 보유 키)가
            // 생기기 전까지 파일은 받지 않는다. 0045의 Vault 줄 규칙은 그날을 위해 남겨 둔다.
            <p className="mt-2 rounded-md border border-gold/40 bg-gold/10 px-2.5 py-2 text-t11h text-ink">
              Vault 파일은 올리지 않습니다. 원본은 사내 스토리지에 두고{' '}
              <Link href="/documents?register=Vault" className="font-semibold text-accent underline underline-offset-2">
                문서 화면에서 링크로 등록
              </Link>
              하세요.
            </p>
          ) : (
            <p className="mt-1.5 text-t10h text-ink-muted">
              여기로 끌어다 놓아도 됩니다 · PDF · Word · Excel · PowerPoint · PNG · JPG, 20MB까지
            </p>
          )}
          <input ref={fileRef} type="file" multiple accept={ATTACHMENT_ACCEPT} className="hidden" onChange={(e) => void uploadAll(e.target.files)} />
          {/* 폰: 명함 · 계약서를 바로 찍는다 → vision 요약. */}
          <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => void uploadAll(e.target.files)} />
        </div>
      ) : null}

      {busy ? <p className="mt-2 text-t11 text-accent" aria-live="polite">{busy}</p> : null}
      {error ? (
        <p role="alert" className="mt-2 rounded-md border border-critical/40 bg-critical/10 px-2.5 py-1.5 text-t11h text-critical">
          {error}
        </p>
      ) : null}

      <ul className="mt-3 space-y-2.5">
        {attachments.map((a) => (
          <AttachmentCard key={a.attachment_id} a={a} {...props} />
        ))}
      </ul>
      {attachments.length === 0 ? <p className="mt-3 text-t11 text-ink-muted">아직 붙인 파일이 없습니다.</p> : null}
    </section>
  )
}

function AttachmentCard({ a, viewer, names, vaultViewers, people, fill }: AttachmentsPanelProps & { a: Attachment }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<string | null>(null)
  const [filled, setFilled] = useState<FillField[]>([])
  const mine = viewer.role === 'Chairman' || a.uploaded_by === viewer.user_id
  const s = a.ai_summary

  const run = (fn: () => Promise<{ error?: string } | undefined | void>) =>
    start(async () => {
      setMsg(null)
      const r = await fn()
      if (r && r.error) setMsg(r.error)
      router.refresh()
    })

  // 목표 = 요약 첫 줄, 다음 행동 = 제안 첫 줄, 막힌 점 = 결정 필요 첫 줄. 빈 칸에만 제안한다(DEFERRED).
  const suggestions: { field: FillField; value: string }[] =
    fill && s
      ? ([
          ['goal', s.summary[0]],
          ['next_action', s.next_actions[0]],
          ['blocker', s.decisions_needed[0]],
        ] as [FillField, string | undefined][])
          .filter(([f, v]) => v && fill.empty.includes(f) && !filled.includes(f))
          .map(([field, value]) => ({ field, value: value! }))
      : []

  return (
    <li className="rounded-lg border border-line-soft bg-raised/40 p-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            run(async () => {
              const r = await downloadAttachmentAction(a.attachment_id)
              if (r.url?.startsWith('data:')) {
                // dummy는 서명 URL 대신 data URL을 준다 — 브라우저가 data URL로의 새 탭 이동을 막으므로 내려받기로.
                const link = document.createElement('a')
                link.href = r.url
                link.download = a.file_name
                link.click()
              } else if (r.url) window.open(r.url, '_blank', 'noopener')
              return r
            })
          }
          className="min-w-0 truncate text-left text-t12h font-semibold text-ink underline-offset-2 hover:underline"
          title="내려받기(기록이 남습니다)"
        >
          {a.file_name}
        </button>
        <span className="text-t10h text-ink-muted">{formatBytes(a.size_bytes)}</span>
        <span
          className={`rounded px-1.5 py-0.5 text-t10h ${
            a.security_class === 'Vault' ? 'bg-gold/15 text-gold' : a.security_class === 'Restricted' ? 'bg-warning/15 text-warning' : 'bg-line-soft text-ink-dim'
          }`}
        >
          {ATTACHMENT_CLASS_LABEL[a.security_class]}
        </span>
        <span className={`text-t10h ${a.status === 'failed' ? 'text-critical' : 'text-ink-muted'}`}>{ATTACHMENT_STATUS_LABEL_KO[a.status]}</span>
        <span className="text-t10h text-ink-muted">
          {names[a.uploaded_by] ?? '올린 사람'} · {a.created_at.slice(0, 10)}
        </span>
        <span className="ml-auto flex gap-1.5">
          {mine && a.security_class !== 'Vault' && a.status !== 'extracting' ? (
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => summarizeAttachmentAction(a.attachment_id))}
              className="min-h-11 rounded px-1.5 text-t10h text-accent hover:underline disabled:opacity-50 lg:min-h-0 lg:py-0.5"
            >
              {a.status === 'uploaded' ? '요약하기' : '다시 요약'}
            </button>
          ) : null}
          {mine ? (
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                if (confirm(`«${a.file_name}»을(를) 지웁니다. 되돌릴 수 없습니다.`)) run(() => deleteAttachmentAction(a.attachment_id))
              }}
              className="min-h-11 rounded px-1.5 text-t10h text-critical hover:underline disabled:opacity-50 lg:min-h-0 lg:py-0.5"
            >
              지우기
            </button>
          ) : null}
        </span>
      </div>

      {pending ? <p className="mt-1.5 text-t11 text-accent">처리 중…</p> : null}
      {msg ? <p role="alert" className="mt-1.5 text-t11 text-critical">{msg}</p> : null}
      {a.status === 'failed' && a.ai_error ? <p className="mt-1.5 text-t11 text-critical">{a.ai_error}</p> : null}
      {a.status === 'extracting' && !pending ? <p className="mt-1.5 text-t11 text-ink-muted">요약 중입니다. 잠시 뒤 새로 고침하세요.</p> : null}

      {a.security_class === 'Vault' ? (
        <VaultBlock a={a} isChairman={viewer.role === 'Chairman'} viewers={vaultViewers?.[a.attachment_id] ?? []} people={people ?? []} />
      ) : null}

      {s ? (
        <div className="mt-2 space-y-2 border-t border-line-soft pt-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="rounded bg-accent/10 px-1.5 py-0.5 text-t10h font-semibold text-accent">AI 요약 · 결정 아님</span>
            {s.dummy ? <span className="rounded bg-warning/15 px-1.5 py-0.5 text-t10h font-semibold text-warning">DUMMY 요약</span> : null}
            <span className="text-t10h text-ink-muted">
              확신도 {s.confidence === 'high' ? '높음' : s.confidence === 'medium' ? '보통' : '낮음'}
              {s.sections ? ` · ${s.sections}구간 합침` : ''}
              {a.ai_model ? ` · ${a.ai_model}` : ''}
            </span>
          </div>
          <ol className="list-decimal space-y-0.5 pl-5 text-t12h leading-relaxed text-ink">
            {s.summary.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ol>
          {s.summary_ko?.length ? (
            <ol className="list-decimal space-y-0.5 pl-5 text-t11h leading-relaxed text-ink-dim" lang="ko">
              {s.summary_ko.map((l, i) => (
                <li key={i}>{l}</li>
              ))}
            </ol>
          ) : null}
          {s.key_numbers.length ? (
            <div className="flex flex-wrap gap-1.5">
              {s.key_numbers.map((n, i) => (
                <span key={i} className="rounded border border-line px-1.5 py-0.5 text-t10h text-ink-dim tabular-nums">
                  {n}
                </span>
              ))}
            </div>
          ) : null}
          <SummaryList title="결정 필요" items={s.decisions_needed} />
          <SummaryList title="다음 행동(제안)" items={s.next_actions} />
          {suggestions.length ? (
            <div className="rounded-md border border-accent/30 bg-accent/5 p-2">
              <p className="text-t10h font-semibold text-accent">비어 있는 칸 채우기 — 받으면 이 건에 저장되고 이력에 남습니다</p>
              <ul className="mt-1 space-y-1">
                {suggestions.map(({ field, value }) => (
                  <li key={field} className="flex flex-wrap items-center gap-2 text-t11 text-ink-dim">
                    <span className="font-semibold text-ink">{FILL_LABEL[field]}</span>
                    <span className="min-w-0 flex-1">{value}</span>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() =>
                        run(async () => {
                          const r = await saveInitiativeField(fill!.initiativeId, field, value.slice(0, field === 'goal' ? 2000 : 500))
                          if (!r.error) setFilled((f) => [...f, field])
                          return r
                        })
                      }
                      className="rounded border border-accent px-2 py-0.5 text-t10h text-accent hover:bg-accent/10 disabled:opacity-50"
                    >
                      채우기
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </li>
  )
}

function SummaryList({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null
  return (
    <div>
      <p className="text-t10h font-semibold text-ink-muted">{title}</p>
      <ul className="mt-0.5 list-disc space-y-0.5 pl-5 text-t11h text-ink-dim">
        {items.map((l, i) => (
          <li key={i}>{l}</li>
        ))}
      </ul>
    </div>
  )
}

function VaultBlock({ a, isChairman, viewers, people }: { a: Attachment; isChairman: boolean; viewers: AttachmentViewer[]; people: { user_id: string; display_name: string }[] }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [pick, setPick] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const set = (userId: string, on: boolean) =>
    start(async () => {
      setMsg(null)
      const r = await setAttachmentViewerAction(a.attachment_id, userId, on)
      if (r.error) setMsg(r.error)
      setPick('')
      router.refresh()
    })
  return (
    <div className="mt-2 rounded-md border border-gold/30 bg-gold/5 p-2 text-t11 text-ink-dim">
      <p className="flex items-center gap-1 font-semibold text-gold">
        <Icon name="shield" className="size-3.5" />
        Vault — AI로 보내지 않습니다. 회장과 지정된 사람만 봅니다.
      </p>
      {isChairman ? (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <span className="text-t10h text-ink-muted">지정자</span>
          {viewers.length === 0 ? <span className="text-t10h text-ink-muted">없음</span> : null}
          {viewers.map((v) => (
            <span key={v.user_id} className="inline-flex items-center gap-1 rounded border border-line px-1.5 py-0.5 text-t10h">
              {v.display_name}
              <button type="button" disabled={pending} onClick={() => set(v.user_id, false)} aria-label={`${v.display_name} 지정 해제`} className="text-ink-muted hover:text-critical">
                <Icon name="x" className="size-3" />
              </button>
            </span>
          ))}
          <select value={pick} onChange={(e) => setPick(e.target.value)} className="rounded border border-line bg-panel px-1.5 py-0.5 text-t10h">
            <option value="">사람 고르기…</option>
            {people
              .filter((p) => !viewers.some((v) => v.user_id === p.user_id))
              .map((p) => (
                <option key={p.user_id} value={p.user_id}>
                  {p.display_name}
                </option>
              ))}
          </select>
          <button type="button" disabled={!pick || pending} onClick={() => set(pick, true)} className="rounded border border-gold px-2 py-0.5 text-t10h text-gold disabled:opacity-40">
            지정
          </button>
        </div>
      ) : null}
      {msg ? <p role="alert" className="mt-1 text-critical">{msg}</p> : null}
    </div>
  )
}

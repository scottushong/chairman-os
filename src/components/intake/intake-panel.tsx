'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

import { downloadAttachmentAction, uploadAttachmentBytes } from '@/app/actions/attachments'
import {
  attestIntakeAction,
  beginIntakeAction,
  cancelIntakeAction,
  keepIntakeAction,
  liftIntakeBlockAction,
  loadIntakeToDocumentAction,
  readIntakeAction,
  setIntakeKindAction,
  undoIntakeLoadAction,
} from '@/app/actions/intake'
import { prepareUpload } from '@/components/attachments/attachments-panel'
import { FileDropZone } from '@/components/ui/file-drop-zone'
import { Icon } from '@/components/ui/icon'
import {
  ATTACHMENT_ACCEPT,
  ATTACHMENT_CLASS_LABEL,
  ATTACHMENT_FORMATS_KO,
  ATTACHMENT_MAX_BYTES,
  attachmentClassAllowed,
  checkAttachmentFile,
  defaultAttachmentClass,
  formatBytes,
} from '@/lib/attachments/rules'
import { PDF_DOC_MAX_PAGES } from '@/lib/attachments/limits'
import { boss, bossText } from '@/lib/boss'
import { MIX_RATIO_LIMITS, MIX_RATIO_MESSAGE } from '@/lib/intake/mix-ratio'
import { CONFIDENCE_LABEL_KO } from '@/lib/intake/proposal'
import { INTAKE_FILTER_LABEL_KO, isDocumentKind, matchesFilter, type IntakeFilter } from '@/lib/intake/rules'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import {
  INTAKE_KIND,
  INTAKE_KIND_LABEL_KO,
  INTAKE_STATUS_LABEL_KO,
  type IntakeKind,
  type IntakeRow,
  type Role,
  type SecurityClass,
} from '@/types'

/**
 * 회사 화면의 «자료 받는 입구»(설계서 A1 · A2 · A5 · A6 · B③④).
 *
 * 올리기 → (서버) 읽기 · 배합비 감지 · 분류 → **제안(«AI 제안 — 결정 아님»)** → 사람이 확인 → 문서. 이 블록의 적재 대상은 문서뿐이다
 * (재무제표는 0060 · 구매는 취소 — 원가 엔진으로 따로). 권한은 화면이 판정하지 않는다 — 버튼을 그릴지만 정하고(안내),
 * DB(0058 RLS · stamp · RPC)가 최종이다. 회장이 아닌 사람에게는 «회장» 대신 «대표»(boss · bossText).
 *
 * 바이트 길은 첨부와 같다: live는 브라우저가 Storage로 바로, dummy는 서버 액션.
 */

type ClassChoice = 'Normal' | 'Restricted'

export interface IntakePanelProps {
  businessId: string
  items: IntakeRow[]
  mode: 'dummy' | 'live'
  viewer: { user_id: string; role: Role; maxClass: SecurityClass }
  /** 이 회사 문서 등록 권한(0048) — 확인 · 적재 버튼을 그릴지. */
  canConfirm: boolean
  names: Record<string, string>
  /** item_id → 같은 파일 알림 한 줄(0058 intake_same_file). */
  notices: Record<string, string>
}

const BTN =
  'min-h-11 rounded-md border px-3 text-t11h transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50 lg:min-h-0 lg:py-1.5'
const BTN_MAIN = `${BTN} border-accent bg-accent/10 font-semibold text-accent hover:bg-accent/20`
const BTN_PLAIN = `${BTN} border-line bg-panel text-ink-dim hover:border-accent hover:text-ink`

async function sha256(file: File): Promise<string | null> {
  try {
    const d = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
    return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('')
  } catch {
    return null // 해시를 못 내면 같은 파일 알림만 빠진다
  }
}

export function IntakePanel(props: IntakePanelProps) {
  const { businessId, items, mode, viewer, names } = props
  const router = useRouter()
  const defaultCls = defaultAttachmentClass(viewer.maxClass)
  const canUpload = viewer.role !== 'AIAgent' && viewer.role !== 'Integration' && defaultCls !== null
  const [cls, setCls] = useState<ClassChoice>(defaultCls === 'Restricted' ? 'Restricted' : 'Normal')
  const [attested, setAttested] = useState(false)
  const [filter, setFilter] = useState<IntakeFilter>('waiting')
  const shown = items.filter((i) => matchesFilter(i, filter, viewer.user_id))

  async function uploadOne(original: File, phase: (text: string) => void): Promise<string | void> {
    const { file, mime } = await prepareUpload(original, phase)
    if (file.size > ATTACHMENT_MAX_BYTES) throw new Error('20MB까지 올릴 수 있습니다.')
    phase('올리는 중…')
    const begun = await beginIntakeAction({
      business_id: businessId,
      file_name: file.name,
      mime,
      size_bytes: file.size,
      security_class: cls,
      file_sha256: await sha256(file),
      mix_attested: attested,
    })
    if (begun.error || !begun.itemId || !begun.attachmentId || !begun.path) throw new Error(begun.error ?? '올리지 못했습니다.')

    let upErr: string | undefined
    if (mode === 'live') {
      const { error } = await createSupabaseBrowserClient().storage.from('attachments').upload(begun.path, file, { contentType: mime, upsert: false })
      upErr = error?.message
    } else {
      const fd = new FormData()
      fd.set('file', file)
      upErr = (await uploadAttachmentBytes(begun.attachmentId, fd)).error
    }
    if (upErr) {
      await cancelIntakeAction(begun.attachmentId)
      throw new Error(`파일을 올리지 못했습니다(${upErr}).`)
    }
    router.refresh()
    phase('읽는 중… (종류 판단 — 긴 문서는 1분 안팎)')
    const r = await readIntakeAction(begun.itemId)
    if (r.error) return bossText(r.error, viewer.role)
    if (r.status !== 'proposed' && r.message) return bossText(r.message, viewer.role)
  }

  return (
    <section className="rounded-xl border border-line-soft bg-panel p-4" aria-label="자료 받는 입구">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-t13 font-semibold">
          <Icon name="file-text" className="size-4 text-accent" />
          자료 받는 입구 <span className="text-t11 font-normal text-ink-muted">{items.length}건</span>
        </h2>
        <p className="text-t11 text-ink-muted">AI 제안 — 결정 아님 · 배합비는 Vault에</p>
      </div>
      <p className="mt-1 text-t11 text-ink-muted">
        파일을 놓으면 AI가 한 번 읽고 어떤 자료인지 제안합니다. 확인하면 문서로 들어갑니다. 계약서 · 공문 · 그 외 문서는 문서로, 재무제표 · 단가표는 지금은 보관만 합니다.
      </p>

      {canUpload ? (
        <FileDropZone
          label="자료 받는 입구에 올리기"
          className="mt-3"
          accept={ATTACHMENT_ACCEPT}
          check={checkAttachmentFile}
          upload={uploadOne}
          onSettled={() => router.refresh()}
          camera
          hint={`${ATTACHMENT_FORMATS_KO}, 20MB까지 · 스캔한 PDF는 ${PDF_DOC_MAX_PAGES}쪽까지 읽습니다 · Vault 파일은 받지 않습니다(문서 › 링크로 등록)`}
          extra={
            <>
              <label className="flex min-h-11 items-center gap-1.5 text-t11 text-ink-muted lg:min-h-0">
                등급
                <select
                  value={cls}
                  onChange={(e) => setCls(e.target.value as ClassChoice)}
                  className="min-h-11 rounded-md border border-line bg-panel px-2 text-t11h text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent lg:min-h-0 lg:py-1"
                >
                  <option value="Normal">{ATTACHMENT_CLASS_LABEL.Normal}</option>
                  <option value="Restricted" disabled={!attachmentClassAllowed('Restricted', viewer.maxClass)}>
                    {`${ATTACHMENT_CLASS_LABEL.Restricted}${attachmentClassAllowed('Restricted', viewer.maxClass) ? '' : ' (보안등급 밖)'}`}
                  </option>
                </select>
              </label>
              <label className="flex min-h-11 items-center gap-1.5 text-t11 text-ink lg:min-h-0">
                <input type="checkbox" checked={attested} onChange={(e) => setAttested(e.target.checked)} className="size-5 accent-accent lg:size-4" />
                배합비 · 레시피가 아닙니다(사진 · 스캔본)
              </label>
            </>
          }
        />
      ) : null}
      <p className="mt-2 text-t11 text-ink-muted">
        사진 · 스캔본은 위 칸을 눌러야 AI가 읽습니다(누르지 않으면 «AI 안 보냄» — 종류는 직접 고를 수 있습니다). 글자가 있는 파일은 AI에 보내기 전에 배합비인지 먼저 봅니다.
      </p>

      <div className="mt-3 flex flex-wrap gap-1.5" role="tablist" aria-label="입구 거르기">
        {(['waiting', 'mine', 'loaded', 'all'] as IntakeFilter[]).map((f) => (
          <button
            key={f}
            type="button"
            role="tab"
            aria-selected={filter === f}
            onClick={() => setFilter(f)}
            className={`${BTN} ${filter === f ? 'border-accent bg-accent/10 font-semibold text-accent' : 'border-line bg-panel text-ink-dim hover:border-accent'}`}
          >
            {INTAKE_FILTER_LABEL_KO[f]} <span className="text-ink-muted">{items.filter((i) => matchesFilter(i, f, viewer.user_id)).length}</span>
          </button>
        ))}
      </div>

      <ul className="mt-3 space-y-2.5">
        {shown.map((i) => (
          <IntakeCard key={i.item_id} item={i} {...props} uploaderName={names[i.created_by] ?? '올린 사람'} />
        ))}
      </ul>
      {shown.length === 0 ? <p className="mt-3 text-t11 text-ink-muted">{items.length === 0 ? '아직 올린 자료가 없습니다.' : '이 거르기에 맞는 자료가 없습니다.'}</p> : null}
    </section>
  )
}

function IntakeCard({ item, viewer, canConfirm, notices, names, uploaderName }: IntakePanelProps & { item: IntakeRow; uploaderName: string }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<string | null>(null)
  const [open, setOpen] = useState(item.status !== 'loaded' && item.status !== 'kept')
  const [form, setForm] = useState<null | { plain: boolean }>(null)
  const [title, setTitle] = useState(item.proposal?.fields.title ?? item.file?.file_name.replace(/\.[^.]+$/, '') ?? '')
  const [docLink, setDocLink] = useState<string | null>(null)

  const isChair = viewer.role === 'Chairman'
  const mine = item.created_by === viewer.user_id
  const canEdit = viewer.role !== 'AIAgent' && viewer.role !== 'Integration' && (isChair || mine || canConfirm)
  const kind: IntakeKind | null = item.kind ?? item.proposal?.kind ?? null
  const p = item.proposal
  const say = (t: string) => bossText(t, viewer.role)
  // 적재 버튼 — 문서 등록 권한 · 읽는 중이 아님 · «AI 안 보냄» 줄은 대표만(0058 intake_ai_blocked).
  const canLoad = canConfirm && item.status !== 'reading' && item.status !== 'uploaded' && (item.status !== 'no_ai' || isChair)

  const run = (fn: () => Promise<{ error?: string; message?: string; status?: string } | undefined | void>) =>
    start(async () => {
      setMsg(null)
      const r = await fn()
      if (r && r.error) setMsg(say(r.error))
      else if (r && r.message && r.status !== 'proposed') setMsg(say(r.message))
      router.refresh()
    })

  const load = (plain: boolean) =>
    run(async () => {
      const r = await loadIntakeToDocumentAction(item.item_id, { title, plain })
      if (r.documentId) {
        setDocLink(`/documents/${r.documentId}`)
        setForm(null)
      }
      return r
    })

  return (
    <li className="rounded-lg border border-line-soft bg-raised/40 p-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex min-h-11 min-w-0 items-center gap-1.5 text-left text-t12h font-semibold text-ink lg:min-h-0"
        >
          <Icon name={open ? 'chevron-down' : 'chevron-right'} className="size-3.5 shrink-0 text-ink-muted" />
          <span className="truncate">{item.file?.file_name ?? '문서로 들어간 파일'}</span>
        </button>
        {item.file ? <span className="text-t11 text-ink-muted">{formatBytes(item.file.size_bytes)}</span> : null}
        <span className={`rounded px-1.5 py-0.5 text-t11 ${item.security_class === 'Restricted' ? 'bg-warning/15 text-warning' : 'bg-line-soft text-ink-dim'}`}>
          {ATTACHMENT_CLASS_LABEL[item.security_class]}
        </span>
        <span className={`text-t11 ${item.status === 'failed' || item.status === 'no_ai' ? 'text-critical' : item.status === 'loaded' ? 'text-ok' : 'text-ink-muted'}`}>
          {INTAKE_STATUS_LABEL_KO[item.status]}
        </span>
        {kind ? (
          <span className="rounded border border-line px-1.5 py-0.5 text-t11 text-ink-dim">
            {INTAKE_KIND_LABEL_KO[kind]}
            {item.kind ? ' · 확인됨' : ' · 제안'}
          </span>
        ) : null}
        <span className="text-t11 text-ink-muted">
          {uploaderName} · {item.created_at.slice(0, 10)}
        </span>
        {item.status === 'loaded' && item.loaded_id ? (
          <Link href={`/documents/${item.loaded_id}`} className="ml-auto inline-flex min-h-11 items-center text-t11h font-semibold text-accent underline-offset-2 hover:underline lg:min-h-0">
            문서로 들어감 → 열기
          </Link>
        ) : null}
      </div>

      {notices[item.item_id] ? <p className="mt-1.5 text-t11 text-warning">{notices[item.item_id]}</p> : null}
      {pending ? <p className="mt-1.5 text-t11 text-accent">처리 중…</p> : null}
      {msg ? (
        <p role="alert" className="mt-1.5 text-t11 text-critical">
          {msg}
        </p>
      ) : null}
      {docLink ? (
        <p className="mt-1.5 text-t11 text-ok">
          문서로 넣었습니다 —{' '}
          <Link href={docLink} className="font-semibold underline underline-offset-2">
            문서 열기
          </Link>
        </p>
      ) : null}

      {open ? (
        <div className="mt-2 space-y-2 border-t border-line-soft pt-2">
          {/* 상태별 안내 */}
          {item.status === 'reading' ? <p className="text-t11 text-ink-muted">읽는 중입니다. 잠시 뒤 새로 고침하세요.</p> : null}
          {item.status === 'uploaded' ? <p className="text-t11 text-ink-muted">아직 읽지 않았습니다.</p> : null}
          {item.status === 'failed' ? (
            <p className="text-t11 text-critical">이 파일은 아직 읽을 수 없습니다 — 읽기에 실패했습니다(다시 읽거나 종류를 직접 고르세요). 파일은 올라갔습니다.</p>
          ) : null}
          {item.status === 'no_ai' || item.ai_blocked_reason ? <NoAiBlock item={item} viewer={viewer} mine={mine} pending={pending} run={run} /> : null}
          {item.status === 'kept' ? <p className="text-t11 text-ink-muted">입구에 보관 중입니다(어느 메뉴에도 넣지 않았습니다).</p> : null}

          {/* 제안 카드 */}
          {p ? (
            <div className="rounded-md border border-accent/30 bg-accent/5 p-2.5">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="rounded bg-accent/15 px-1.5 py-0.5 text-t11 font-semibold text-accent">AI 제안 — 결정 아님</span>
                {p.dummy ? <span className="rounded bg-warning/15 px-1.5 py-0.5 text-t11 font-semibold text-warning">DUMMY 제안</span> : null}
                <span className="text-t11 text-ink-muted">{p.model}</span>
              </div>
              <p className="mt-1.5 text-t12h text-ink">
                이 파일은 <b>{INTAKE_KIND_LABEL_KO[p.kind]}</b>로 보입니다(확신 {CONFIDENCE_LABEL_KO[p.confidence]}).
              </p>
              <p className="mt-0.5 text-t11h text-ink-dim">이유: {p.reason}</p>
              <Preview fields={p.fields} />
            </div>
          ) : null}
          {item.kind ? (
            <p className="text-t11 text-ink-muted">
              확인한 종류: {INTAKE_KIND_LABEL_KO[item.kind]}
              {item.kind_confirmed_by ? ` — ${names[item.kind_confirmed_by] ?? '확인한 사람'}` : ''}
              {item.kind_confirmed_at ? ` · ${item.kind_confirmed_at.slice(0, 16).replace('T', ' ')}` : ''}
            </p>
          ) : null}

          {/* 버튼 */}
          {item.status !== 'loaded' && item.status !== 'discarded' ? (
            <div className="space-y-2">
              {kind && !isDocumentKind(kind) ? (
                <p className="text-t11 text-ink-muted">
                  재무제표 · 단가표는 아직 그 메뉴로 넣지 않습니다(결산 초안은 다음 단계 · 구매는 원가 엔진으로 따로). 입구에 보관하거나 문서로 넣으세요.
                </p>
              ) : null}
              {!canConfirm && canEdit ? <p className="text-t11 text-ink-muted">이 메뉴에 넣을 권한이 없습니다 — 문서 등록 권한자에게 넘기세요.</p> : null}
              <div className="flex flex-wrap items-center gap-1.5">
                {canLoad && kind && isDocumentKind(kind) ? (
                  <button type="button" disabled={pending} onClick={() => setForm({ plain: false })} className={BTN_MAIN}>
                    이 메뉴에 초안 만들기(문서)
                  </button>
                ) : null}
                {canEdit ? <KindPicker value={item.kind} pending={pending} onPick={(k) => run(() => setIntakeKindAction(item.item_id, k))} /> : null}
                {canLoad ? (
                  <button type="button" disabled={pending} onClick={() => setForm({ plain: true })} className={BTN_PLAIN}>
                    그냥 보관(문서)
                  </button>
                ) : null}
                {canEdit && item.status !== 'kept' && item.status !== 'no_ai' && item.status !== 'reading' ? (
                  <button type="button" disabled={pending} onClick={() => run(() => keepIntakeAction(item.item_id))} className={BTN_PLAIN}>
                    입구에만 두기
                  </button>
                ) : null}
                {canEdit && !item.ai_blocked_reason && item.status !== 'no_ai' ? (
                  <button type="button" disabled={pending} onClick={() => run(() => readIntakeAction(item.item_id))} className={BTN_PLAIN}>
                    {item.status === 'uploaded' ? '읽기' : '다시 읽기'}
                  </button>
                ) : null}
                {item.file ? (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() =>
                      run(async () => {
                        const r = await downloadAttachmentAction(item.attachment_id)
                        if (r.url?.startsWith('data:')) {
                          const a = document.createElement('a')
                          a.href = r.url
                          a.download = item.file!.file_name
                          a.click()
                        } else if (r.url) window.open(r.url, '_blank', 'noopener')
                        return r
                      })
                    }
                    className={BTN_PLAIN}
                  >
                    원본 보기
                  </button>
                ) : null}
              </div>
              {form ? (
                <div className="rounded-md border border-line p-2.5">
                  <label className="block text-t11 text-ink-muted">
                    문서 제목
                    <input
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      maxLength={300}
                      className="mt-1 block min-h-11 w-full rounded-md border border-line bg-panel px-2 text-t12h text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent lg:min-h-0 lg:py-1.5"
                    />
                  </label>
                  <p className="mt-1.5 text-t11 text-ink-muted">
                    {form.plain ? '종류 «그 외 문서»로 문서 목록에 들어갑니다.' : `«${INTAKE_KIND_LABEL_KO[kind ?? 'other']}» 문서로 들어갑니다.`} 등급은 {ATTACHMENT_CLASS_LABEL[item.security_class]} 그대로 · 원본은 그 문서의 첨부가 됩니다. 지우면 입구로 되돌아옵니다.
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <button type="button" disabled={pending || !title.trim()} onClick={() => load(form.plain)} className={BTN_MAIN}>
                      확인 — 문서로 넣기
                    </button>
                    <button type="button" disabled={pending} onClick={() => setForm(null)} className={BTN_PLAIN}>
                      그만두기
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          {item.status === 'loaded' ? (
            <div className="flex flex-wrap items-center gap-1.5">
              <p className="text-t11 text-ink-muted">
                {item.loaded_by ? `${names[item.loaded_by] ?? '확인한 사람'}이(가) ` : ''}
                {item.loaded_at ? `${item.loaded_at.slice(0, 10)}에 ` : ''}문서로 넣었습니다. 되돌리면 문서를 지우고 이 줄이 입구로 돌아옵니다.
              </p>
              {isChair || item.loaded_by === viewer.user_id ? (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => {
                    if (confirm('문서를 지우고 이 파일을 입구로 되돌립니다.')) run(() => undoIntakeLoadAction(item.item_id))
                  }}
                  className={BTN_PLAIN}
                >
                  되돌리기
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </li>
  )
}

function NoAiBlock({
  item,
  viewer,
  mine,
  pending,
  run,
}: {
  item: IntakeRow
  viewer: IntakePanelProps['viewer']
  mine: boolean
  pending: boolean
  run: (fn: () => Promise<{ error?: string; message?: string; status?: string } | undefined | void>) => void
}) {
  const [ok, setOk] = useState(false)
  const reason = item.ai_blocked_reason ?? item.no_ai_reason
  const isChair = viewer.role === 'Chairman'
  const who = boss(viewer.role)
  return (
    <div className="rounded-md border border-critical/30 bg-critical/5 p-2.5 text-t11h text-ink">
      {reason === 'mix_ratio' ? (
        <>
          <p className="font-semibold text-critical">{MIX_RATIO_MESSAGE}</p>
          <p className="mt-1 text-t11 text-ink-dim">{MIX_RATIO_LIMITS}</p>
          <p className="mt-1 text-t11 text-ink-dim">잘못 걸었으면(지분표 · 영양성분표 등) {who}가 «배합비 아님»으로 풉니다. 종류는 직접 고를 수 있습니다.</p>
        </>
      ) : reason === 'not_attested' ? (
        <>
          <p className="font-semibold text-critical">AI 안 보냄 — 사진 · 스캔본은 올린 사람이 «배합비 · 레시피가 아닙니다»를 확인해야 AI가 읽습니다.</p>
          <p className="mt-1 text-t11 text-ink-dim">확인 전에도 종류를 직접 골라 넣을 수 있습니다.</p>
          {mine ? (
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <label className="flex min-h-11 items-center gap-1.5 lg:min-h-0">
                <input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} className="size-5 accent-accent lg:size-4" />
                배합비 · 레시피가 아닙니다
              </label>
              <button type="button" disabled={!ok || pending} onClick={() => run(() => attestIntakeAction(item.item_id))} className={BTN_MAIN}>
                확인하고 AI로 읽기
              </button>
            </div>
          ) : (
            <p className="mt-1 text-t11 text-ink-dim">올린 사람만 확인할 수 있습니다.</p>
          )}
        </>
      ) : (
        <p className="font-semibold text-critical">AI 제외 자료입니다 — AI로 보내지 않습니다.</p>
      )}
      {isChair && item.status === 'no_ai' ? (
        <button type="button" disabled={pending} onClick={() => run(() => liftIntakeBlockAction(item.item_id))} className={`${BTN_PLAIN} mt-1.5`}>
          {reason === 'mix_ratio' ? '배합비 아님 — 풀고 읽기' : '차단 풀고 읽기'}
        </button>
      ) : null}
      {item.status === 'loaded' && item.ai_blocked_reason ? <p className="mt-1 text-t11 text-ink-dim">문서로 넣었지만 AI 차단은 그대로입니다(요약도 하지 않습니다).</p> : null}
    </div>
  )
}

function KindPicker({ value, pending, onPick }: { value: IntakeKind | null; pending: boolean; onPick: (k: IntakeKind) => void }) {
  return (
    <label className="flex items-center gap-1 text-t11 text-ink-muted">
      <span className="sr-only">종류 바꾸기</span>
      <select
        value=""
        disabled={pending}
        onChange={(e) => {
          if (e.target.value) onPick(e.target.value as IntakeKind)
        }}
        className="min-h-11 rounded-md border border-line bg-panel px-2 text-t11h text-ink-dim focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent lg:min-h-0 lg:py-1.5"
      >
        <option value="">{value ? '종류 바꾸기…' : '직접 종류 고르기…'}</option>
        {INTAKE_KIND.map((k) => (
          <option key={k} value={k}>
            {INTAKE_KIND_LABEL_KO[k]}
          </option>
        ))}
      </select>
    </label>
  )
}

function Preview({ fields }: { fields: NonNullable<IntakeRow['proposal']>['fields'] }) {
  const rows: [string, string | null][] = [
    ['제목', fields.title],
    ['상대방', fields.counterparty],
    ['날짜', fields.date],
    ['기간', fields.period],
    ['만료일', fields.expiry],
    ['금액(적힌 그대로)', fields.amount],
  ]
  const shown = rows.filter(([, v]) => v)
  if (!shown.length) return null
  return (
    <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-t11h">
      {shown.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-ink-muted">{k}</dt>
          <dd className="min-w-0 break-words text-ink">{v}</dd>
        </div>
      ))}
    </dl>
  )
}

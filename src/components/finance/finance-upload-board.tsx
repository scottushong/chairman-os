'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useRef, useState, useTransition } from 'react'

import { applyPendingUpload, cancelUpload, reinterpretUpload, revertUpload, uploadFinanceFile } from '@/app/actions/finance-upload'
import { saveOfficialStatement } from '@/app/actions/statements'
import { FIN_INBOX, inboxPath } from '@/lib/finance-upload/inbox'
import { KIND_SPECS, type FieldSpec, type UploadKind } from '@/lib/finance-upload/kinds'
import { sendEach } from '@/lib/finance-upload/send-each'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import { GROUP_SECTIONS, OFFICIAL_GROUP_KO, officialLines, type OfficialGroup } from '@/lib/finance-upload/official-lines'
import { REVERT_SCOPE_KO, STATE_KO } from '@/lib/finance-upload/v21-text'
import { balanceCheck, incomeSubtotals } from '@/lib/statements/balance'
import type { OfficialDraft } from '@/lib/finance-upload/doc-read'
import type { FileCard } from '@/lib/finance-upload/process'
import type { AccountSection, FinRow, FinUpload, FinUploadPending, Role } from '@/types'

/** 공식 결산 계정 맞추기에 쓰는 계정(그 회사 · 사용 중) */
export interface AccountOption {
  account_code: string
  name: string
  section: AccountSection
}

const FORMAT_KO: Record<string, string> = { excel: '엑셀', pdf_text: 'PDF', pdf_scan: '스캔 PDF', image: '사진' }
/** process.ts OFFICIAL_RECORD_NOTE의 앞머리 — 공식 결산 갈래의 기록 줄(내용 없음) */
const OFFICIAL_PREFIX = '공식 결산으로 보냄'

/**
 * «회계 · 재무 자료 올리기» v2 화면 몸통 — 체크표 · 놓는 칸 하나 · 파일 카드 · 미리보기 대기 · 최근 올리기(되돌리기 7일).
 * 직원 화면에도 선다 — «회장»이 들어가지 않는다(대표 · CFO).
 */

export interface PendingView {
  upload: FinUpload
  rows: FinRow[]
  rowCount: number
  peopleCount: number | null
  hasGrid: boolean
  meta: NonNullable<FinUploadPending['meta']>
  overlap: boolean
  /** 0080: 원료 숫자가 가려진 대기(이 사람은 넣지 못한다) */
  masked?: boolean
}

const ACCEPT = '.xlsx,.xls,.csv,.pdf,.jpg,.jpeg,.png'
/** 파일 하나의 천장(lib/finance-upload/open.ts UPLOAD_MAX_BYTES와 같다 — 0082 버킷 한도도 20MB) */
const UPLOAD_MAX = 20 * 1024 * 1024
/** process.ts HOLD_PREFIX — 보류 기록(DB에는 끝난 줄)의 앞머리 */
const HOLD_PREFIX = '보류 — '

/** PDF · 사진이 꺼진 까닭(화면 안내) */
export type DocsClosed = { why: 'switch'; audience: string | null; where: string } | { why: 'env' }

const failCard = (fileName: string, message: string): FileCard => ({ file_name: fileName, sheet: null, kind: 'unknown', period: null, status: 'failed', upload_id: null, rows: 0, message, why: [], ai_used: 0, confidence: 'none' })

const STATUS_KO: Record<string, string> = {
  applied: '자동 넣음',
  needs_review: '확인 필요',
  failed: '실패',
  duplicate: '이미 올림',
  official: '공식 결산',
  refused: '받지 않음',
  later: '보류',
  reverted: '되돌림',
  cancelled: '취소',
  replaced: '새 값으로 바뀜',
  skipped: '기존 값 둠',
}
const STATUS_TONE: Record<string, string> = {
  applied: 'bg-ok/15 text-ok',
  needs_review: 'bg-gold/15 text-gold',
  failed: 'bg-critical/10 text-critical',
  duplicate: 'bg-raised text-ink-dim',
  official: 'bg-accent/15 text-accent',
  refused: 'bg-critical/10 text-critical',
  later: 'bg-raised text-ink-dim',
  reverted: 'bg-raised text-ink-dim',
  cancelled: 'bg-raised text-ink-dim',
  replaced: 'bg-raised text-ink-dim',
  skipped: 'bg-raised text-ink-dim',
}
const kindLabel = (k: string) => {
  const s = KIND_SPECS.find((x) => x.kind === k)
  return s ? `${s.no} ${s.label}` : '종류 모름'
}

export function FinanceUploadBoard({
  businessId,
  month,
  uploads,
  pendings,
  received,
  role,
  ai,
  revertable,
  docsOpen = false,
  docsClosed = null,
  isChairman = false,
  accounts = [],
  userId,
  mode,
}: {
  businessId: string
  month: string
  uploads: FinUpload[]
  pendings: PendingView[]
  received: Record<string, FinUpload | null>
  role: Role
  ai: { on: boolean; perFile: number; perDay: number }
  /** 되돌릴 수 있는 올리기(넣은 지 7일 안) — 서버가 정한다(화면은 시계를 읽지 않는다). */
  revertable: string[]
  /** C단계 PDF · 사진을 이 사람에게 여는가(입구 스위치 — 꺼지면 대표만) */
  docsOpen?: boolean
  /** 꺼진 까닭 — 스위치(범위 · 어느 줄)인지 서버 설정(키 · 한도)인지. 열렸으면 null */
  docsClosed?: DocsClosed | null
  /** 대표에게만 «기능 스위치에서 바꾸기» 링크 */
  isChairman?: boolean
  /** 공식 결산 계정 맞추기 */
  accounts?: AccountOption[]
  /** 0082 수신함 경로의 둘째 칸(본인) */
  userId: string
  mode: 'dummy' | 'live'
}) {
  const router = useRouter()
  const input = useRef<HTMLInputElement>(null)
  const [cards, setCards] = useState<FileCard[]>([])
  const [error, setError] = useState<string | null>(null)
  const [over, setOver] = useState(false)
  const [progress, setProgress] = useState<string | null>(null)
  const [busy, start] = useTransition()

  /**
   * 파일마다 한 요청(2026-10-16): 한 파일이 실패해도 다른 파일은 그대로 가고, 화면은 늘 다시 그린다(router.refresh).
   * live는 0082 수신함으로 바로 올리고 경로만 보낸다(Vercel 4.5MB 요청 한도 — «파일당 20MB»가 사실이 되게). dummy는 바이트를 보낸다.
   */
  function send(files: FileList | File[]) {
    const list = [...files].slice(0, 10)
    if (!list.length) return
    setError(null)
    setCards([])
    if (files.length > 10) setError(`한 번에 10개까지 — 앞 10개만 올립니다(${files.length}개 중).`)
    start(async () => {
      try {
        await sendEach(list, sendOne, failCard, (done, total, f, out) => {
          setCards([...out])
          setProgress(done < total ? `${done + 1} / ${total} · ${f.name}` : null)
        })
      } finally {
        setProgress(null)
        router.refresh()
      }
    })
  }

  async function sendOne(f: File): Promise<FileCard[]> {
    if (f.size < 1) return [failCard(f.name, '빈 파일입니다.')]
    if (f.size > UPLOAD_MAX) return [failCard(f.name, '20MB가 넘는 파일입니다 — 기간을 나눠 내려받아 올려 주세요.')]
    if (/\.(heic|heif|webp)$/i.test(f.name)) return [failCard(f.name, 'HEIC · WEBP 사진은 받지 않습니다 — JPG로 저장해 올려 주세요.')]
    const form = new FormData()
    form.set('business_id', businessId)
    if (mode === 'live') {
      const path = inboxPath(businessId, userId, f.name, crypto.randomUUID())
      const { error: upErr } = await createSupabaseBrowserClient().storage.from(FIN_INBOX).upload(path, f, { contentType: f.type || 'application/octet-stream', upsert: false })
      if (upErr) return [failCard(f.name, `파일을 올리지 못했습니다(${upErr.message.slice(0, 80)}) — 다시 올려 주세요.`)]
      form.set('path', path)
      form.set('name', f.name)
    } else {
      form.set('file', f)
    }
    const r = await uploadFinanceFile(form)
    if (r.error) return [failCard(f.name, r.error)]
    return r.cards
  }

  const got = Object.values(received).filter(Boolean).length
  const recent = uploads.filter((u) => u.status !== 'needs_review').slice(0, 30)

  return (
    <div className="mt-4 space-y-4">
      {/* 14가지 + 0072 넷 체크표 */}
      <section className="rounded-xl border border-line-soft bg-panel p-3">
        <div className="flex flex-wrap items-baseline gap-2">
          <h2 className="text-t13 font-semibold">이번 달 자료 · {month}</h2>
          <span className="text-t11h text-ink-muted tnum">받은 것 {got} / {KIND_SPECS.length}</span>
          <form className="ml-auto flex items-center gap-1 text-t11h" action="">
            <label className="text-ink-muted" htmlFor="month">달</label>
            <input id="month" name="month" type="month" defaultValue={month} className="rounded-md border border-line bg-panel px-2 py-1 text-t11h" />
            <button className="min-h-8 rounded-md border border-line px-2 text-ink-dim hover:border-accent">보기</button>
          </form>
        </div>
        <ul className="mt-2 grid gap-1.5 sm:grid-cols-2 lg:grid-cols-4">
          {KIND_SPECS.map((k) => {
            const u = received[k.kind]
            return (
              <li key={k.kind} className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-t11h ${u ? 'border-ok/30 bg-ok/5' : 'border-line-soft'}`}>
                <span aria-hidden className={`grid size-5 shrink-0 place-items-center rounded-full text-t10 font-bold ${u ? 'bg-ok text-white' : 'bg-raised text-ink-muted'}`}>{u ? '✓' : ''}</span>
                <span className="min-w-0 truncate">{k.no} {k.label}</span>
                <span className="ml-auto shrink-0 text-t10 text-ink-muted">{u ? `${u.row_count}줄${u.auto ? ' · 자동' : ''}` : '아직 없음'}</span>
              </li>
            )
          })}
        </ul>
      </section>

      {/* 놓는 칸 하나 */}
      <section
        onDragOver={(e) => {
          e.preventDefault()
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setOver(false)
          send(e.dataTransfer.files)
        }}
        className={`rounded-xl border-2 border-dashed p-5 text-center transition-colors ${over ? 'border-accent bg-accent/5' : 'border-line bg-panel'}`}
      >
        <p className="text-t13 font-semibold">파일을 여기에 놓으세요 — 여러 개 한 번에</p>
        <p className="mt-1 text-t11h text-ink-dim">엑셀(xlsx · xls · csv) · PDF · jpg · png, 파일당 20MB · 10개까지. 종류 · 기간 · 칸을 알아내 넣고, 확실하지 않으면 아래 «확인 필요»로 멈춥니다.</p>
        <p className="mt-1 text-t10h text-ink-muted">
          {ai.on
            ? `AI 구조 해석: 파일당 ${ai.perFile}번 · 하루 ${ai.perDay}번까지(머리글 근처 줄 · 요약 줄의 글만 보내고 숫자는 «<숫자>»로 가립니다 — 숫자는 코드가 읽고 합계 줄과 대조합니다).`
            : 'AI 구조 해석 꺼짐 — 낱말 규칙으로만 읽습니다(한도 미설정).'}{' '}
          이름 · 주민번호 · 계좌 · 카드번호 · 원료 투입 줄은 열 때 먼저 지웁니다.
        </p>
        <p data-testid="docs-note" className="mt-1 text-t10h text-ink-muted">
          {docsOpen && !docsClosed
            ? 'PDF · 사진: AI가 표를 읽고 합계를 코드가 대조합니다(30쪽까지 — 결산서는 재무상태표 · 손익계산서 쪽을 먼저). 사진 · 스캔은 처음 3개월 늘 «확인 필요»로 멈춥니다. 급여대장 · 제조지시명세서는 엑셀로만, 배합비 · 구성표 파일은 받지 않습니다. 세무사 결산서는 «공식 결산»으로 갑니다.'
            : docsClosed?.why === 'env'
              ? `PDF · 사진: 읽는 AI가 서버에 설정되어 있지 않아 보류합니다${isChairman ? '(Vercel 환경 변수 ANTHROPIC_API_KEY · FINANCE_UPLOAD_AI_PER_FILE · FINANCE_UPLOAD_AI_PER_DAY)' : ' — 대표에게 알려 주세요'}. 엑셀은 그대로 받습니다.`
              : `PDF · 사진 읽기는 ${docsClosed?.why === 'switch' && docsClosed.audience ? `지금 «${docsClosed.audience}» 쓸 수 있습니다` : '지금 꺼져 있습니다'}(기능 스위치 «PDF · 사진 읽기»${docsClosed?.why === 'switch' ? ` · ${docsClosed.where}` : ''}). 엑셀은 그대로 받습니다.`}
          {docsClosed?.why === 'switch' && isChairman ? (
            <>
              {' '}
              <Link href="/settings/features" className="font-semibold text-accent underline-offset-2 hover:underline">
                기능 스위치에서 바꾸기
              </Link>
            </>
          ) : null}
        </p>
        <input ref={input} type="file" multiple accept={ACCEPT} className="hidden" onChange={(e) => e.target.files && send(e.target.files)} />
        <button type="button" disabled={busy} onClick={() => input.current?.click()} className="mt-3 min-h-11 rounded-md bg-accent px-4 text-t12 font-semibold text-white disabled:opacity-50">
          {busy ? '읽는 중…' : '파일 고르기'}
        </button>
        {progress ? <p role="status" className="mt-2 text-t11h text-ink-dim tnum">올리고 읽는 중 — {progress} (긴 파일은 1~2분)</p> : null}
        {error ? <p role="alert" className="mt-2 text-t11h text-critical">{error}</p> : null}
      </section>

      {cards.length ? (
        <section className="space-y-1.5">
          <h2 className="text-t13 font-semibold">방금 올린 파일</h2>
          {cards.map((c, i) => (
            <article key={`${c.file_name}-${c.sheet}-${i}`} className="rounded-lg border border-line bg-panel px-3 py-2">
              <div className="flex flex-wrap items-center gap-2 text-t11h">
                <span className={`rounded px-1.5 py-0.5 text-t10 font-semibold ${STATUS_TONE[c.status]}`}>{STATUS_KO[c.status]}</span>
                {c.format && c.format !== 'excel' ? <span className="rounded border border-line px-1 text-t10 text-ink-muted">{FORMAT_KO[c.format]}</span> : null}
                <span className="min-w-0 break-all font-semibold">{c.file_name}</span>
                {c.sheet ? <span className="text-ink-muted">«{c.sheet}»</span> : null}
                {c.status === 'official' || c.status === 'refused' || c.status === 'later' ? null : <span>{kindLabel(c.kind)}</span>}
                {c.period ? <span className="tnum">{c.period}</span> : null}
                {c.rows ? <span className="text-ink-muted tnum">{c.rows}줄</span> : null}
              </div>
              <p className="mt-0.5 text-t11h text-ink-dim">{c.message}</p>
              {c.why.length ? <ul className="mt-0.5 list-disc pl-4 text-t10h text-ink-muted">{c.why.map((w) => <li key={w}>{w}</li>)}</ul> : null}
              {c.fixes?.length ? <p className="mt-0.5 text-t10h text-ink-muted">고친 것: {c.fixes.join(' · ')}</p> : null}
              {c.notes?.length ? <p data-testid="card-notes" className="mt-0.5 text-t10h text-ink-muted">{c.notes.join(' · ')}</p> : null}
              {c.reinterpret_id ? <ReinterpretAgain businessId={businessId} uploadId={c.reinterpret_id} /> : null}
              {c.status === 'official' ? <OfficialPanel businessId={businessId} draft={c.official ?? null} accounts={accounts} fileName={c.file_name} /> : null}
            </article>
          ))}
        </section>
      ) : null}

      {pendings.length ? (
        <section className="space-y-2">
          <h2 className="text-t13 font-semibold">확인 필요 · {pendings.length}</h2>
          {pendings.map((p) => (
            <PendingPanel key={p.upload.upload_id} businessId={businessId} p={p} role={role} />
          ))}
        </section>
      ) : null}

      <section className="rounded-xl border border-line-soft bg-panel p-3">
        <h2 className="text-t13 font-semibold">최근 올리기</h2>
        <p className="mt-0.5 text-t10h text-ink-muted" data-testid="revert-scope">{REVERT_SCOPE_KO}</p>
        {recent.length === 0 ? <p className="mt-2 text-t11h text-ink-muted">아직 없습니다.</p> : null}
        <ul className="mt-2 divide-y divide-line-soft">
          {recent.map((u) => (
            <RecentRow key={u.upload_id} u={u} businessId={businessId} canRevert={revertable.includes(u.upload_id)} />
          ))}
        </ul>
      </section>
    </div>
  )
}

/** 같은 파일을 다시 올렸을 때 — «이전 올리기를 다시 해석할까요?»의 단추(파일을 다시 받지 않고 대기의 칸 격자로). */
function ReinterpretAgain({ businessId, uploadId }: { businessId: string; uploadId: string }) {
  const router = useRouter()
  const [busy, start] = useTransition()
  const [msg, setMsg] = useState<string | null>(null)
  return (
    <div className="mt-1 flex flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={busy || !!msg}
        data-testid="reinterpret-again"
        onClick={() =>
          start(async () => {
            try {
              const r = await reinterpretUpload(uploadId, businessId)
              const c = r.cards.find((x) => x.status === 'applied' || x.status === 'needs_review') ?? r.cards[0]
              setMsg(r.error ?? (c ? `다시 해석했습니다 — ${STATUS_KO[c.status]}. ${c.message}` : '다시 해석했습니다.'))
            } catch {
              setMsg('다시 해석하지 못했습니다(연결 끊김) — 아래 «확인 필요» 카드에서 다시 눌러 주세요.')
            } finally {
              router.refresh()
            }
          })
        }
        className="min-h-9 rounded-md border border-accent/50 px-3 text-t11h text-accent hover:bg-accent/5 disabled:opacity-40"
      >
        {busy ? '해석 중…' : '이전 올리기를 AI로 다시 해석'}
      </button>
      {msg ? <span role="status" className="text-t10h text-ink-dim">{msg}</span> : null}
    </div>
  )
}

function RecentRow({ u, businessId, canRevert }: { u: FinUpload; businessId: string; canRevert: boolean }) {
  const router = useRouter()
  const [busy, start] = useTransition()
  const [msg, setMsg] = useState<string | null>(null)
  const hold = u.status === 'failed' && !!u.error?.startsWith(HOLD_PREFIX)
  return (
    <li className="flex flex-wrap items-center gap-2 py-1.5 text-t11h">
      {u.status === 'failed' && u.error?.startsWith(OFFICIAL_PREFIX) ? (
        <span className={`rounded px-1.5 py-0.5 text-t10 font-semibold ${STATUS_TONE.official}`}>{STATUS_KO.official}</span>
      ) : hold ? (
        <span className={`rounded px-1.5 py-0.5 text-t10 font-semibold ${STATUS_TONE.later}`}>{STATUS_KO.later}</span>
      ) : (
        <span className={`rounded px-1.5 py-0.5 text-t10 font-semibold ${STATUS_TONE[u.status] ?? 'bg-raised'}`}>{u.status === 'applied' && !u.auto ? '넣음' : STATUS_KO[u.status]}</span>
      )}
      <span className="min-w-0 truncate font-semibold">{u.file_name}</span>
      <span>{kindLabel(u.kind)}</span>
      <span className="tnum">{u.period ?? '—'}</span>
      <span className="text-ink-muted tnum">{u.row_count}줄 · AI {u.ai_confidence === 'none' ? '안 씀' : u.ai_confidence}</span>
      {u.error ? <span className={hold ? 'text-ink-dim' : 'text-critical'}>{hold ? u.error.slice(HOLD_PREFIX.length) : u.error}</span> : null}
      <span className="text-ink-muted">{u.created_at.slice(0, 16).replace('T', ' ')}</span>
      {canRevert ? (
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            start(async () => {
              const r = await revertUpload(u.upload_id, businessId, '화면에서 되돌림')
              setMsg(r.error ?? (u.kind === 'valuation' ? '되돌렸습니다(지우지 않고 무효 처리). 손으로 저장했던 평가금액은 되살아나지 않습니다 — «재고 · 평가»에서 다시 저장하세요.' : '되돌렸습니다(지우지 않고 무효 처리).'))
              router.refresh()
            })
          }
          className="ml-auto min-h-8 rounded-md border border-line px-2 text-ink-dim hover:border-critical hover:text-critical disabled:opacity-50"
        >
          되돌리기
        </button>
      ) : null}
      {msg ? <span className="w-full text-t10h text-ink-muted">{msg}</span> : null}
    </li>
  )
}

function PendingPanel({ businessId, p, role }: { businessId: string; p: PendingView; role: Role }) {
  const router = useRouter()
  const [kind, setKind] = useState<string>(p.upload.kind === 'unknown' ? '' : p.upload.kind)
  const [period, setPeriod] = useState(p.upload.period ?? '')
  // 0074: 원료 출고 · 재고의 바꾸기는 대표 · CFO만 — 다른 사람에게는 «기존 값 두기»만 보인다.
  const replaceOk = (k: string) => !(k === 'material_issue' || k === 'inventory') || role === 'Chairman' || role === 'GroupCFO'
  const [overlap, setOverlap] = useState<'none' | 'replace' | 'keep_old'>(p.overlap ? (replaceOk(p.upload.kind) ? 'replace' : 'keep_old') : 'none')
  const [reason, setReason] = useState('')
  const [cols, setCols] = useState<Record<string, number>>(p.meta.columns ?? {})
  const [msg, setMsg] = useState<string | null>(null)
  const [problems, setProblems] = useState<string[]>([])
  const [busy, start] = useTransition()
  const spec = KIND_SPECS.find((k) => k.kind === kind)
  const header = p.meta.header ?? []
  // 0072 구성표 노출 금지: 원료 출고는 kg 칸을 보이지 않는다(대기 줄에도 kg가 오지 않는다) — 대신 규칙 구분을 보인다.
  const issue = kind === 'material_issue'
  const shownFields = (spec?.fields ?? []).filter((f) => !(issue && f.key === 'qty_kg'))
  return (
    <article className="rounded-xl border border-gold/40 bg-panel p-3">
      <div className="flex flex-wrap items-center gap-2 text-t11h">
        <span className="rounded bg-gold/15 px-1.5 py-0.5 text-t10 font-semibold text-gold">확인 필요</span>
        {p.meta.source_format ? <span className="rounded border border-line px-1 text-t10 text-ink-muted">{FORMAT_KO[p.meta.source_format]}</span> : null}
        <span className="min-w-0 break-all font-semibold">{p.upload.file_name}</span>
        {p.upload.sheet_name ? <span className="text-ink-muted">«{p.upload.sheet_name}»</span> : null}
        <span className="text-ink-muted">{p.rowCount}줄{p.peopleCount !== null ? ` · 개인 줄 ${p.peopleCount}(대표 · CFO만)` : ''}</span>
      </div>
      {p.meta.reason ? <p className="mt-1 text-t10h text-ink-muted">분류 근거: {p.meta.reason}{p.meta.period_how ? ` · 기간: ${p.meta.period_how}` : ''}</p> : null}
      {p.meta.fixes?.length ? <p className="mt-0.5 text-t10h text-ink-muted">고친 것: {p.meta.fixes.join(' · ')}</p> : null}
      {p.meta.why_not_auto?.length ? <ul className="mt-1 list-disc pl-4 text-t11h text-ink-dim">{p.meta.why_not_auto.map((w) => <li key={w}>{w}</li>)}</ul> : null}
      {p.meta.dup_notes?.length ? (
        <div className="mt-1 rounded-md bg-gold/10 px-2 py-1 text-t10h text-ink-dim">
          <span className="font-semibold">자료 간 중복 의심</span> — 넣으면 «자료 간 같은 거래» 칸에 «중복 의심»으로 남고, 사람이 정할 때까지 같은 거래로 치지 않습니다.
          <ul className="list-disc pl-4">{p.meta.dup_notes.map((w) => <li key={w}>{w}</li>)}</ul>
        </div>
      ) : null}
      {[...(p.meta.errors ?? []), ...(p.meta.warnings ?? [])].length ? (
        <ul className="mt-1 list-disc pl-4 text-t11h">
          {(p.meta.errors ?? []).map((e) => <li key={e} className="text-critical">{e}</li>)}
          {(p.meta.warnings ?? []).map((w) => <li key={w} className="text-gold">{w}</li>)}
        </ul>
      ) : null}

      <div className="mt-2 grid gap-2 sm:grid-cols-4">
        <label className="text-t10h text-ink-muted">
          종류
          <select value={kind} onChange={(e) => { setKind(e.target.value); if (!replaceOk(e.target.value) && overlap === 'replace') setOverlap('keep_old') }} className="mt-0.5 block w-full rounded-md border border-line bg-panel px-2 py-1.5 text-t12h text-ink">
            <option value="">고르세요</option>
            {KIND_SPECS.map((k) => (
              <option key={k.kind} value={k.kind}>
                {k.no} {k.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-t10h text-ink-muted">
          기간(달)
          <input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} className="mt-0.5 block w-full rounded-md border border-line bg-panel px-2 py-1.5 text-t12h text-ink" />
        </label>
        {p.overlap ? (
          <label className="text-t10h text-ink-muted">
            같은 달 자료가 이미 있음
            <select value={overlap} onChange={(e) => setOverlap(e.target.value as typeof overlap)} className="mt-0.5 block w-full rounded-md border border-line bg-panel px-2 py-1.5 text-t12h text-ink">
              {replaceOk(kind) ? <option value="replace">새 값으로 바꾸기(기존 줄 무효)</option> : null}
              <option value="keep_old">기존 값 두기(이 파일 버림)</option>
            </select>
            {replaceOk(kind) ? null : <span className="mt-0.5 block text-t10h text-ink-muted">원료 출고 · 재고 자료의 바꾸기는 대표 · CFO만 합니다.</span>}
          </label>
        ) : null}
        <label className="text-t10h text-ink-muted">
          이유{role === 'Chairman' || role === 'GroupCFO' ? '(마감 달은 필수)' : ''}
          <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} className="mt-0.5 block w-full rounded-md border border-line bg-panel px-2 py-1.5 text-t12h text-ink" />
        </label>
      </div>

      {spec && p.hasGrid && header.length ? (
        <details className="mt-2">
          <summary className="cursor-pointer text-t11h text-ink-dim">칸 바꾸기(머리글 «{header.filter(Boolean).slice(0, 5).join(' · ')}…»)</summary>
          <div className="mt-1 grid gap-1.5 sm:grid-cols-4">
            {shownFields.map((f) => (
              <label key={f.key} className="text-t10h text-ink-muted">
                {f.label}
                <select
                  value={cols[f.key] ?? ''}
                  onChange={(e) => setCols((c) => {
                    const n = { ...c }
                    if (e.target.value === '') delete n[f.key]
                    else n[f.key] = Number(e.target.value)
                    return n
                  })}
                  className="mt-0.5 block w-full rounded-md border border-line bg-panel px-1.5 py-1 text-t11h text-ink"
                >
                  <option value="">없음</option>
                  {header.map((h, i) => (
                    <option key={i} value={i}>
                      {i + 1}열 {h || '(빈 칸)'}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        </details>
      ) : null}

      {p.rows.length && spec ? (
        <div className="mt-2 max-h-64 overflow-auto rounded-md border border-line-soft">
          <table className="w-full text-t11">
            <thead className="sticky top-0 bg-raised">
              <tr>
                <th className="px-2 py-1 text-left font-medium text-ink-muted">원본 줄</th>
                {shownFields.map((f) => <th key={f.key} className="px-2 py-1 text-left font-medium text-ink-muted">{f.label}</th>)}
                {issue ? <th className="px-2 py-1 text-left font-medium text-ink-muted">구분(규칙)</th> : null}
              </tr>
            </thead>
            <tbody>
              {p.rows.map((r, i) => (
                <tr key={i} className="border-t border-line-soft">
                  <td className="px-2 py-1 tnum text-ink-muted">{r.row_no}행</td>
                  {shownFields.map((f) => (
                    <td key={f.key} className={`px-2 py-1 ${f.type === 'number' ? 'text-right tnum' : ''}`}>
                      <Cell r={r} f={f} />
                    </td>
                  ))}
                  {issue ? (
                    <td className="px-2 py-1">
                      <span className={r.class === 'needs_review' ? 'font-semibold text-gold' : ''}>{ISSUE_CLASS_KO[String(r.class)] ?? '확인 필요'}</span>
                      {r.class_reason ? <span className="block text-t10 text-ink-muted">{String(r.class_reason)}</span> : null}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {p.rowCount > p.rows.length ? <p className="mt-1 text-t10h text-ink-muted">앞 {p.rows.length}줄만 보입니다(전체 {p.rowCount}줄).</p> : null}

      {p.masked ? (
        <p className="mt-1 rounded-md bg-gold/10 px-2 py-1 text-t11h text-ink-dim" data-testid="pending-masked">
          원료 단가 · 수량은 올린 사람(올린 뒤 1시간) · 대표 · CFO · 원가 관리만 봅니다. 이 미리보기는 숫자 없이 보이며 여기서 넣을 수 없습니다 — 넣으려면 파일을 다시 올려 주세요.
        </p>
      ) : null}
      {problems.length ? <ul className="mt-1 list-disc pl-4 text-t11h text-critical">{problems.map((x) => <li key={x}>{x}</li>)}</ul> : null}
      {msg ? <p role="status" className="mt-1 text-t11h">{msg}</p> : null}
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy || !kind || !period || !!p.masked}
          onClick={() =>
            start(async () => {
              setProblems([])
              const r = await applyPendingUpload({ uploadId: p.upload.upload_id, businessId, kind, period, columns: p.hasGrid ? cols : undefined, overlap: p.overlap ? overlap : 'none', reason })
              if (r.error) {
                setMsg(r.error)
                setProblems(r.problems ?? [])
              } else {
                setMsg('넣었습니다.')
                router.refresh()
              }
            })
          }
          className="min-h-10 rounded-md bg-accent px-4 text-t12 font-semibold text-white disabled:opacity-40"
        >
          {busy ? '넣는 중…' : '확인하고 넣기'}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            start(async () => {
              const r = await cancelUpload(p.upload.upload_id, businessId)
              setMsg(r.error ?? '취소했습니다.')
              router.refresh()
            })
          }
          className="min-h-10 rounded-md border border-line px-3 text-t12 text-ink-dim hover:border-critical hover:text-critical"
        >
          취소
        </button>
        {p.hasGrid && !p.masked ? (
          <button
            type="button"
            disabled={busy}
            data-testid="reinterpret"
            onClick={() =>
              start(async () => {
                setProblems([])
                try {
                  const r = await reinterpretUpload(p.upload.upload_id, businessId)
                  const c = r.cards.find((x) => x.status === 'applied' || x.status === 'needs_review') ?? r.cards[0]
                  setMsg(r.error ?? (c ? `다시 해석했습니다 — ${STATUS_KO[c.status]}${c.ai_used ? ` · AI ${c.ai_used}번` : ''}. ${c.message}` : '다시 해석했습니다.'))
                } catch {
                  setMsg('다시 해석하지 못했습니다(연결 끊김 · 시간 초과) — 화면을 새로 고친 뒤 다시 눌러 주세요.')
                } finally {
                  router.refresh()
                }
              })
            }
            className="min-h-10 rounded-md border border-accent/50 px-3 text-t12 text-accent hover:bg-accent/5 disabled:opacity-40"
          >
            {busy ? '해석 중…' : 'AI로 다시 해석'}
          </button>
        ) : null}
      </div>
      {p.hasGrid && !p.masked ? <p className="mt-1 text-t10h text-ink-muted">«AI로 다시 해석»은 파일을 다시 올리지 않고 줄 종류(거래 · 월계 · 누계 · 합계 …)와 칸을 처음부터 다시 읽어 합계 줄과 대조합니다. 맞지 않으면 차이를 보여 주고 멈춥니다.</p> : null}
    </article>
  )
}

export type { UploadKind }

/**
 * C단계 5 — 세무사 확정 결산 PDF · 사진 → «공식 결산» 미리보기. 자료 표(fin_*)에 넣지 않고, 사람이 계정 · 금액 · 증빙 링크를 확인해
 * 0020 공식 결산 저장(saveOfficialStatement — 권한 · 균형 · 감사는 DB)으로 넣는다. 자동은 없다. 미리보기는 저장하지 않는다
 * (화면을 떠나면 다시 올린다).
 */
const SKIP = '__skip'

function OfficialPanel({ businessId, draft, accounts, fileName }: { businessId: string; draft: OfficialDraft | null; accounts: AccountOption[]; fileName: string }) {
  const router = useRouter()
  // 줄마다 고른 계정(SKIP = 넣지 않음 · null = 아직) — 해가 바뀌어도 같은 고름을 쓴다(계정은 해마다 같다).
  const [picks, setPicks] = useState<(string | null)[]>(() => (draft?.lines ?? []).map((l) => (l.skip ? SKIP : l.account_code)))
  const [yearKey, setYearKey] = useState(draft?.period_key ?? draft?.years[draft.years.length - 1] ?? '')
  const [typedYear, setTypedYear] = useState('')
  const [evidence, setEvidence] = useState('')
  const [memo, setMemo] = useState(`세무사 확정 결산 — ${fileName}`.slice(0, 200))
  const [saved, setSaved] = useState<string[]>([])
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, start] = useTransition()
  const manual = `/finance/${businessId}/statements/new`
  if (!draft || !draft.lines.length) {
    return (
      <p className="mt-1 text-t11h">
        <Link href={manual} className="font-semibold text-accent underline-offset-2 hover:underline">«공식 결산» 화면에서 손으로 넣기</Link>
      </p>
    )
  }
  const year = yearKey || typedYear
  const lines = draft.lines.map((l, i) => {
    const pick = picks[i]
    const acc = pick && pick !== SKIP ? (accounts.find((a) => a.account_code === pick) ?? null) : null
    const value = l.values[yearKey]
    return { ...l, i, pick, acc, value, guessed: !!acc && acc.account_code === l.account_code && l.how !== 'exact' }
  })
  // 이 해에 값이 있는 줄만 센다(그 해에 없는 계정은 고르지 않아도 된다).
  const inYear = lines.filter((l) => typeof l.value === 'number' && l.value !== 0)
  const picked = inYear.filter((l) => l.acc)
  const missing = inYear.filter((l) => !l.pick)
  const summed = officialLines(picked.map((l) => ({ label: l.label, account: l.acc!, printed: l.value! })))
  const balance = summed.length ? balanceCheck(summed) : null
  const net = summed.length ? incomeSubtotals(summed).netIncome : null
  const printedNet = draft.net_income[yearKey]
  const netOff = typeof printedNet === 'number' && net !== null && Math.abs(net - printedNet) > 1
  const blockers = [
    !/^20\d{2}$/.test(year) && '결산 연도(네 자리)를 적어 주세요',
    missing.length > 0 && `계정을 안 고른 줄 ${missing.length}개 — 고르거나 «넣지 않음»`,
    !summed.length && '넣을 줄이 없습니다',
    !!balance && !balance.balanced && (balance.difference === 0 ? '재무상태표 줄(자산 · 부채 · 자본)을 하나도 고르지 않았습니다' : `재무상태표 차이 ${balance.difference.toLocaleString('ko-KR')}원 — 계정 · «넣지 않음»을 확인하세요`),
    !/^https?:\/\//i.test(evidence.trim()) && '증빙 링크(https://…)를 넣어 주세요',
    !memo.trim() && '메모를 적어 주세요',
    saved.includes(year) && `${year}년은 방금 저장했습니다`,
  ].filter((b): b is string => !!b)
  // 묶음마다 못 고른 줄 — 한 번에 같은 계정으로(또는 넣지 않음).
  const openGroups = [...new Set(missing.map((l) => l.group ?? 'none'))]
  const setPick = (i: number, v: string) => setPicks((p) => p.map((x, j) => (j === i ? v || null : x)))
  const optionsFor = (group: OfficialGroup | null) => {
    const home = group ? accounts.filter((a) => GROUP_SECTIONS[group].includes(a.section)) : []
    const rest = accounts.filter((a) => !home.includes(a))
    return (
      <>
        <option value="">고르세요</option>
        <option value={SKIP}>넣지 않음</option>
        {home.length ? (
          <optgroup label={`${OFFICIAL_GROUP_KO[group!]} 계정`}>
            {home.map((a) => (
              <option key={a.account_code} value={a.account_code}>{a.account_code} {a.name}</option>
            ))}
          </optgroup>
        ) : null}
        <optgroup label={home.length ? '다른 계정' : '계정'}>
          {rest.map((a) => (
            <option key={a.account_code} value={a.account_code}>{a.account_code} {a.name}</option>
          ))}
        </optgroup>
      </>
    )
  }
  return (
    <div data-testid="official-panel" className="mt-2 rounded-lg border border-accent/30 bg-accent/5 p-2">
      <p className="text-t11h font-semibold">공식 결산 미리보기 — 자동으로 넣지 않습니다</p>
      {[...draft.errors, ...draft.warnings].length ? (
        <ul className="mt-1 list-disc pl-4 text-t11h">
          {draft.errors.map((e) => <li key={e} className="text-critical">{e}</li>)}
          {draft.warnings.map((w) => <li key={w} className="text-gold">{w}</li>)}
        </ul>
      ) : null}
      {draft.years.filter(Boolean).length > 1 ? (
        <div role="tablist" aria-label="결산 연도" className="mt-2 flex flex-wrap gap-1">
          {draft.years.filter(Boolean).map((y) => (
            <button
              key={y}
              type="button"
              role="tab"
              aria-selected={y === yearKey}
              onClick={() => {
                setYearKey(y)
                setMsg(null)
              }}
              className={`min-h-9 rounded-md border px-3 text-t12 font-semibold ${y === yearKey ? 'border-accent bg-accent text-white' : 'border-line bg-panel text-ink'}`}
            >
              {y}
              {saved.includes(y) ? ' ✓' : ''}
            </button>
          ))}
        </div>
      ) : null}
      {openGroups.length ? (
        <div className="mt-2 grid gap-1">
          {openGroups.map((g) => {
            const group = g === 'none' ? null : (g as OfficialGroup)
            const n = missing.filter((l) => (l.group ?? 'none') === g).length
            return (
              <label key={g} className="flex flex-wrap items-center gap-2 text-t11h">
                <span className="text-gold">«{group ? OFFICIAL_GROUP_KO[group] : '구분 모름'}» 안 고른 {n}줄 → 한 번에</span>
                <select
                  aria-label={`${group ? OFFICIAL_GROUP_KO[group] : '구분 모름'} 안 고른 줄 한 번에`}
                  value=""
                  onChange={(e) => {
                    const v = e.target.value
                    if (!v) return
                    const targets = new Set(missing.filter((l) => (l.group ?? 'none') === g).map((l) => l.i))
                    setPicks((p) => p.map((x, j) => (targets.has(j) ? v : x)))
                  }}
                  className="max-w-[16rem] rounded-md border border-gold bg-panel px-1.5 py-1 text-t11h"
                >
                  {optionsFor(group)}
                </select>
              </label>
            )
          })}
        </div>
      ) : null}
      <div className="mt-1 max-h-96 overflow-auto rounded-md border border-line-soft bg-panel">
        <table className="w-full text-t11">
          <thead className="sticky top-0 bg-raised">
            <tr>
              <th className="px-2 py-1 text-left font-medium text-ink-muted">구분</th>
              <th className="px-2 py-1 text-left font-medium text-ink-muted">문서의 계정</th>
              <th className="px-2 py-1 text-right font-medium text-ink-muted">{year || '금액'}</th>
              <th className="px-2 py-1 text-left font-medium text-ink-muted">맞춘 계정과목</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={`${l.label}-${l.i}`} className={`border-t border-line-soft ${typeof l.value === 'number' && l.value !== 0 ? '' : 'opacity-50'}`}>
                <td className="px-2 py-1 text-ink-muted">{l.group ? OFFICIAL_GROUP_KO[l.group] : '—'}</td>
                <td className="px-2 py-1">{l.label}</td>
                <td className="px-2 py-1 text-right tnum">{typeof l.value === 'number' ? l.value.toLocaleString('ko-KR') : '—'}</td>
                <td className="px-2 py-1">
                  <div className="flex items-center gap-1">
                    <select
                      aria-label={`${l.label} 계정과목`}
                      value={l.pick ?? ''}
                      onChange={(e) => setPick(l.i, e.target.value)}
                      className={`w-full max-w-[14rem] rounded-md border bg-panel px-1.5 py-1 text-t11h ${l.pick ? 'border-line' : 'border-gold text-gold'}`}
                    >
                      {optionsFor(l.group)}
                    </select>
                    {l.guessed ? <span className="shrink-0 rounded bg-gold/15 px-1 text-t10 text-gold" title="이름이 같지 않아 비슷한 계정으로 맞췄습니다 — 확인하세요">추정</span> : null}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-1 text-t11h tnum">
        {balance ? `${year || ''} 자산 ${balance.assets.toLocaleString('ko-KR')} · 부채 ${balance.liabilities.toLocaleString('ko-KR')} · 자본 ${balance.equity.toLocaleString('ko-KR')} — ${balance.balanced ? '닫힘' : `차이 ${balance.difference.toLocaleString('ko-KR')}원`}` : '고른 계정이 아직 없습니다.'}
        {net !== null ? ` · 당기순이익 ${net.toLocaleString('ko-KR')}` : ''}
        {typeof printedNet === 'number'
          ? !netOff
            ? ' (문서와 같음)'
            : missing.length
              ? ` (문서 ${printedNet.toLocaleString('ko-KR')} — 안 고른 줄을 마저 고르면 다시 맞춰 봅니다)`
              : ` (문서 ${printedNet.toLocaleString('ko-KR')} — 다릅니다: 빠졌거나 두 번 센 줄을 확인하세요)`
          : ''}
      </p>
      <div className="mt-2 grid gap-2 sm:grid-cols-3">
        {yearKey ? null : (
          <label className="text-t10h text-ink-muted">
            결산 연도
            <input value={typedYear} onChange={(e) => setTypedYear(e.target.value.trim())} inputMode="numeric" maxLength={4} placeholder="2025" className="mt-0.5 block w-full rounded-md border border-line bg-panel px-2 py-1.5 text-t12h text-ink" />
          </label>
        )}
        <label className="text-t10h text-ink-muted">
          증빙 링크(필수 — 이 PDF를 올려 둔 사내 드라이브 주소)
          <input value={evidence} onChange={(e) => setEvidence(e.target.value)} placeholder="https://drive.google.com/…" inputMode="url" className="mt-0.5 block w-full rounded-md border border-line bg-panel px-2 py-1.5 text-t12h text-ink" />
        </label>
        <label className="text-t10h text-ink-muted">
          메모
          <input value={memo} onChange={(e) => setMemo(e.target.value)} maxLength={200} className="mt-0.5 block w-full rounded-md border border-line bg-panel px-2 py-1.5 text-t12h text-ink" />
        </label>
      </div>
      <p className="mt-1 text-t10h text-ink-muted">
        이 화면은 올린 파일을 보관하지 않습니다(읽은 뒤 지움). 확정 결산의 근거가 되도록 원본 PDF를 사내 드라이브에 두고 그 주소를 넣어 주세요. 저장하면 그 해의 월별 입력이 잠깁니다.
      </p>
      {blockers.length && !busy ? (
        <ul data-testid="official-blockers" className="mt-1 list-disc pl-4 text-t11h text-gold">
          {blockers.map((b) => <li key={b}>{b}</li>)}
        </ul>
      ) : null}
      {msg ? <p role="status" className="mt-1 text-t11h">{msg}</p> : null}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={busy || blockers.length > 0}
          onClick={() =>
            start(async () => {
              const r = await saveOfficialStatement({ businessId, periodKind: 'year', periodKey: year, evidenceUrl: evidence.trim(), memo, lines: summed.map((l) => ({ account_code: l.account_code, amount: l.amount })) })
              if (r.error) {
                setMsg(r.error)
                return
              }
              setSaved((s) => [...s, year])
              const next = draft.years.filter((y) => y && y !== year && !saved.includes(y))
              setMsg(`${year}년을 공식 결산으로 저장했습니다(그 해의 월별 입력이 잠깁니다).${next.length ? ` 남은 해: ${next.join(' · ')}` : ''}`)
              router.refresh()
            })
          }
          className="min-h-10 rounded-md bg-accent px-4 text-t12 font-semibold text-white disabled:opacity-40"
        >
          {busy ? '저장 중…' : `확인하고 ${year ? `${year}년 ` : ''}공식 결산으로 저장`}
        </button>
        <Link href={manual} className="text-t11h text-ink-dim underline-offset-2 hover:underline">«공식 결산» 화면에서 손으로 넣기</Link>
      </div>
    </div>
  )
}

const ISSUE_CLASS_KO: Record<string, string> = { production: '생산 투입', non_production: '비생산', needs_review: '확인 필요' }

/** 미리보기 칸 — 0072 상태 칸이 있는 숫자는 «확인된 0 / 미입력»을 보인다(빈칸은 0이 아니다). */
function Cell({ r, f }: { r: FinRow; f: FieldSpec }) {
  const v = r[f.key]
  if (f.type === 'number' && f.state) {
    if (v === null || v === undefined) return <span className="text-t10 text-ink-muted">{STATE_KO.missing}</span>
    if (v === 0) return <span>0 <span className="text-t10 text-ink-muted">{STATE_KO.confirmed_zero}</span></span>
  }
  if (typeof v === 'number') return <>{v.toLocaleString('ko-KR')}</>
  return <>{v ?? ''}</>
}
